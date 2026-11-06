/**
 * KeeperStore: the smallest dependable memory core.
 *
 * - Native `node:sqlite` only. No ORM, server, embeddings or background work.
 * - WAL journal + busy timeout so concurrent CLI/agent processes share one file.
 * - FTS5 index kept correct via triggers (content-sync pattern).
 * - Updates happen only through atomic `supersede`: the old record is linked,
 *   never mutated in place, and ordinary search hides superseded records.
 * - Revision checks give writers optimistic-concurrency protection.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  MAX_BODY_CHARS,
  MAX_SOURCE_CHARS,
  MAX_SOURCES,
  MAX_TASK_SCOPE_CHARS,
  MAX_TITLE_CHARS,
  assertNoSecrets,
} from './secrets.js';
import type {
  ClaimStatus,
  EvidenceGrade,
  ExportOptions,
  GradeEvidence,
  LinkRel,
  MemoryRecord,
  RecordKind,
  RecordLink,
  SaveInput,
  SearchHit,
  SearchOptions,
} from './types.js';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
export const DEFAULT_SNIPPET_CHARS = 280;
export const MAX_SNIPPET_CHARS = 2000;
export const DEFAULT_MAX_CHARS = 12000;
export const MAX_MAX_CHARS = 200000;
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export class KeeperError extends Error {
  code = 'keeper-error';
}
export class NotFoundError extends KeeperError {
  code = 'not-found';
}
export class ConflictError extends KeeperError {
  code = 'revision-conflict';
}
export class BudgetError extends KeeperError {
  code = 'budget-exceeded';
}
export class ValidationError extends KeeperError {
  code = 'validation';
}

const KINDS: readonly RecordKind[] = ['decision', 'gotcha', 'checkpoint', 'baseline', 'ask', 'brief'];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision','gotcha','checkpoint','baseline','ask','brief')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  task_scope TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  claim_status TEXT NOT NULL DEFAULT 'provisional'
    CHECK (claim_status IN ('provisional','evidenced')),
  grade TEXT NOT NULL DEFAULT 'INFERRED'
    CHECK (grade IN ('INFERRED','SOURCE-READ','TESTED')),
  evidence TEXT,
  depends_on TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT REFERENCES records(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts
  USING fts5(title, body, task_scope, content='records', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, title, body, task_scope)
    VALUES (new.rowid, new.title, new.body, new.task_scope);
END;
CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, title, body, task_scope)
    VALUES ('delete', old.rowid, old.title, old.body, old.task_scope);
END;
CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, title, body, task_scope)
    VALUES ('delete', old.rowid, old.title, old.body, old.task_scope);
  INSERT INTO records_fts(rowid, title, body, task_scope)
    VALUES (new.rowid, new.title, new.body, new.task_scope);
END;
`;

interface ValidatedInput {
  kind: RecordKind;
  title: string;
  body: string;
  taskScope: string | null;
  sources: string[];
  claimStatus: ClaimStatus;
  grade: EvidenceGrade;
  evidence: GradeEvidence | null;
  dependsOn: string[];
  links: RecordLink[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function checkString(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && trimmed === '') throw new ValidationError(`${field} must not be empty`);
  if (trimmed.length > max) {
    throw new ValidationError(
      `${field} exceeds ${max} characters (${trimmed.length}); summarise instead of pasting raw output`,
    );
  }
  return trimmed === '' ? null : trimmed;
}

function validateInput(input: SaveInput): ValidatedInput {
  if (!input || typeof input !== 'object') throw new ValidationError('input must be an object');
  if (!KINDS.includes(input.kind)) {
    throw new ValidationError(`kind must be one of ${KINDS.join(', ')}`);
  }
  const title = checkString(input.title, 'title', MAX_TITLE_CHARS, true)!;
  const body = checkString(input.body, 'body', MAX_BODY_CHARS, true)!;
  const taskScope = checkString(input.taskScope, 'taskScope', MAX_TASK_SCOPE_CHARS, false);
  let sources: string[] = [];
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) throw new ValidationError('sources must be an array of strings');
    if (input.sources.length > MAX_SOURCES) {
      throw new ValidationError(`sources exceeds ${MAX_SOURCES} entries; keep references concise`);
    }
    sources = input.sources.map((s, i) => {
      if (typeof s !== 'string' || s.trim() === '') {
        throw new ValidationError(`sources[${i}] must be a non-empty string`);
      }
      const t = s.trim();
      if (t.length > MAX_SOURCE_CHARS) {
        throw new ValidationError(`sources[${i}] exceeds ${MAX_SOURCE_CHARS} characters`);
      }
      return t;
    });
  }
  // Grades (v2): INFERRED is the default and maps to provisional.
  // SOURCE-READ and TESTED map to evidenced and require at least one source.
  // TESTED additionally requires run evidence (command + exit code) so the
  // grade can never be claimed without the run behind it. An explicit
  // claimStatus is still honoured for backwards compatibility, but it may
  // never exceed what the grade allows (evidenced requires a non-INFERRED
  // grade with sources).
  let grade: EvidenceGrade = 'INFERRED';
  if (input.grade !== undefined) {
    if (input.grade !== 'INFERRED' && input.grade !== 'SOURCE-READ' && input.grade !== 'TESTED') {
      throw new ValidationError(`grade must be INFERRED, SOURCE-READ or TESTED`);
    }
    grade = input.grade;
  }
  let evidence: GradeEvidence | null = null;
  if (input.evidence !== undefined) {
    if (typeof input.evidence !== 'object' || input.evidence === null) {
      throw new ValidationError('evidence must be {run, exit}');
    }
    const run = checkString(input.evidence.run, 'evidence.run', MAX_SOURCE_CHARS, true)!;
    const exit = input.evidence.exit;
    if (typeof exit !== 'number' || !Number.isInteger(exit)) {
      throw new ValidationError('evidence.exit must be an integer exit code');
    }
    evidence = { run, exit };
  }
  if ((grade === 'SOURCE-READ' || grade === 'TESTED') && sources.length === 0) {
    throw new ValidationError(`grade '${grade}' requires at least one source`);
  }
  if (grade === 'TESTED' && evidence === null) {
    throw new ValidationError(
      `grade 'TESTED' requires evidence {run, exit}: re-run the command, record its exit code, then save`,
    );
  }
  let claimStatus: ClaimStatus = grade === 'INFERRED' ? 'provisional' : 'evidenced';
  if (input.claimStatus !== undefined) {
    if (input.claimStatus !== 'provisional' && input.claimStatus !== 'evidenced') {
      throw new ValidationError(`claimStatus must be 'provisional' or 'evidenced'`);
    }
    if (input.claimStatus === 'evidenced' && claimStatus === 'provisional') {
      if (sources.length === 0) {
        throw new ValidationError(`claimStatus 'evidenced' requires a non-INFERRED grade with sources`);
      }
      // Backwards compatibility: pre-grade callers mark evidenced with
      // sources. That is exactly SOURCE-READ, so promote rather than refuse.
      grade = 'SOURCE-READ';
      claimStatus = 'evidenced';
    } else {
      claimStatus = input.claimStatus;
    }
  }
  let dependsOn: string[] = [];
  if (input.dependsOn !== undefined) {
    if (!Array.isArray(input.dependsOn)) throw new ValidationError('dependsOn must be an array of strings');
    dependsOn = input.dependsOn.map((d, i) => {
      if (typeof d !== 'string' || d.trim() === '') {
        throw new ValidationError(`dependsOn[${i}] must be a non-empty string`);
      }
      const t = d.trim();
      if (t.length > MAX_SOURCE_CHARS) throw new ValidationError(`dependsOn[${i}] exceeds ${MAX_SOURCE_CHARS} characters`);
      return t;
    });
  }
  let links: RecordLink[] = [];
  if (input.links !== undefined) {
    if (!Array.isArray(input.links)) throw new ValidationError('links must be an array of {rel, id}');
    const rels: readonly string[] = ['supersedes', 'falsifies', 'refines', 'answers'];
    links = input.links.map((l, i) => {
      if (typeof l !== 'object' || l === null) throw new ValidationError(`links[${i}] must be {rel, id}`);
      const rel = (l as { rel: unknown }).rel;
      const id = (l as { id: unknown }).id;
      if (typeof rel !== 'string' || !rels.includes(rel)) {
        throw new ValidationError(`links[${i}].rel must be one of ${rels.join(', ')}`);
      }
      if (typeof id !== 'string' || id.trim() === '') {
        throw new ValidationError(`links[${i}].id must be a non-empty record id`);
      }
      return { rel: rel as LinkRel, id: id.trim() };
    });
  }
  assertNoSecrets([title, body, taskScope, sources.join('\n')]);
  return { kind: input.kind, title, body, taskScope, sources, claimStatus, grade, evidence, dependsOn, links };
}

function checkFiniteNumber(value: number | undefined, field: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  if (value < min) throw new ValidationError(`${field} must be >= ${min}`);
  return Math.floor(value);
}

/** Quote user text into a safe FTS5 AND query with prefix matching. */
function toMatchQuery(query: string): { match: string; tokens: string[] } | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/^[*^():"]+|[*^():"]+$/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 32);
  if (tokens.length === 0) return null;
  return {
    match: tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' '),
    tokens,
  };
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * True only for recognised FTS query-syntax failures: malformed MATCH text
 * supplied by the caller. Deliberately narrow — any other SQLite failure
 * (corruption, missing tables/columns, I/O, or internal `fts5:` errors that
 * are not query syntax) must propagate to the caller, never trigger the
 * LIKE fallback. Exported so the narrowing is directly unit-testable.
 */
export function isRecoverableFtsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /syntax error|unterminated string|unknown special query/i.test(err.message);
}

/** Short excerpt of `body`, centred on the first matched token when known. */
function excerptFor(body: string, tokens: string[], cap: number): string {
  if (body.length <= cap) return body;
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return body.slice(0, cap).trimEnd() + '…';
  const start = Math.max(0, at - Math.floor(cap / 3));
  const window = body.slice(start, start + cap).trim();
  return (start > 0 ? '…' : '') + window + (start + cap < body.length ? '…' : '');
}

function hitSize(hit: SearchHit): number {
  return JSON.stringify(hit).length;
}

/**
 * Reduce a preview until it fits `budget` characters: full snippet first,
 * then progressively shorter snippets, then front-trimmed sources, then the
 * minimum useful result (identity + title + metadata, no snippet/sources).
 * Returns null when even the minimum cannot fit — the caller then raises a
 * budget error (first hit) or stops accumulating (later hits).
 */
function fitHit(rec: MemoryRecord, tokens: string[], snippetCap: number, budget: number): SearchHit | null {
  const full = toSearchHit(rec, tokens, snippetCap);
  if (hitSize(full) <= budget) return full;
  for (const cap of [160, 80, 48]) {
    if (cap >= snippetCap) continue;
    const reduced: SearchHit = { ...full, snippet: excerptFor(rec.body, tokens, cap) };
    if (hitSize(reduced) <= budget) return reduced;
  }
  const short: SearchHit = {
    ...full,
    snippet: excerptFor(rec.body, tokens, Math.min(48, snippetCap)),
  };
  let kept = -1;
  let lo = 0;
  let hi = short.sources.length;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate: SearchHit = { ...short, sources: short.sources.slice(0, mid) };
    if (hitSize(candidate) <= budget) {
      kept = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (kept >= 0) return { ...short, sources: short.sources.slice(0, kept) };
  const minimal: SearchHit = { ...short, snippet: '', sources: [] };
  return hitSize(minimal) <= budget ? minimal : null;
}

function toSearchHit(rec: MemoryRecord, tokens: string[], snippetChars: number): SearchHit {
  return {
    id: rec.id,
    kind: rec.kind,
    title: rec.title,
    snippet: excerptFor(rec.body, tokens, snippetChars),
    taskScope: rec.taskScope,
    sources: rec.sources,
    claimStatus: rec.claimStatus,
    grade: rec.grade,
    revision: rec.revision,
    supersededBy: rec.supersededBy,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

function parseStringArray(raw: unknown): string[] {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    /* fall through to [] */
  }
  return [];
}

function toRecord(row: Record<string, unknown>): MemoryRecord {
  const sources = parseStringArray(row['sources'] ?? '[]');
  let grade: EvidenceGrade = 'INFERRED';
  const g = row['grade'];
  if (g === 'INFERRED' || g === 'SOURCE-READ' || g === 'TESTED') grade = g;
  let evidence: GradeEvidence | null = null;
  try {
    const raw = row['evidence'];
    if (typeof raw === 'string' && raw !== '') {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { run: unknown }).run === 'string' &&
        Number.isInteger((parsed as { exit: unknown }).exit)
      ) {
        evidence = {
          run: (parsed as { run: string }).run,
          exit: (parsed as { exit: number }).exit,
        };
      }
    }
  } catch {
    evidence = null;
  }
  let links: RecordLink[] = [];
  try {
    const raw = row['links'];
    const parsed: unknown = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      const rels: readonly string[] = ['supersedes', 'falsifies', 'refines', 'answers'];
      links = parsed.flatMap((l): RecordLink[] => {
        if (typeof l !== 'object' || l === null) return [];
        const rel = (l as { rel: unknown }).rel;
        const id = (l as { id: unknown }).id;
        if (typeof rel !== 'string' || !rels.includes(rel)) return [];
        if (typeof id !== 'string' || id === '') return [];
        return [{ rel: rel as LinkRel, id }];
      });
    }
  } catch {
    links = [];
  }
  return {
    id: String(row['id']),
    kind: row['kind'] as RecordKind,
    title: String(row['title']),
    body: String(row['body']),
    taskScope: row['task_scope'] === null || row['task_scope'] === undefined ? null : String(row['task_scope']),
    sources,
    claimStatus: row['claim_status'] as ClaimStatus,
    grade,
    evidence,
    dependsOn: parseStringArray(row['depends_on'] ?? '[]'),
    links,
    revision: Number(row['revision']),
    supersededBy:
      row['superseded_by'] === null || row['superseded_by'] === undefined ? null : String(row['superseded_by']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export interface StoreOptions {
  busyTimeoutMs?: number;
}

export class KeeperStore {
  private db: DatabaseSync;
  private depth = 0;
  readonly dbPath: string;

  constructor(dbPath: string, opts: StoreOptions = {}) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    try {
      const timeout = Math.max(0, Math.floor(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS));
      // journal_mode returns a row, so read it via prepare; the rest are bare pragmas.
      this.db.prepare('PRAGMA journal_mode = WAL').get();
      this.db.exec(`PRAGMA busy_timeout = ${timeout}`);
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec(SCHEMA_SQL);
      this.migrateV1IfNeeded();
    } catch (err) {
      // Never leak the file handle when setup fails (corrupt/unreadable db).
      try {
        this.db.close();
      } catch {
        /* close must not mask the original failure */
      }
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  /**
   * v1 → v2 schema migration. Databases created before the grade/evidence/
   * depends_on/links columns keep the old shape (CREATE TABLE IF NOT
   * EXISTS never alters them), so rebuild once: copy every row (an old
   * `evidenced` claim becomes SOURCE-READ — "has sources", never TESTED,
   * which requires a recorded run), then rebuild the FTS index over the
   * new rowids. Fresh and already-migrated databases are untouched.
   */
  private migrateV1IfNeeded(): void {
    const cols = this.db.prepare('PRAGMA table_info(records)').all() as Record<string, unknown>[];
    if (cols.some((c) => String(c['name']) === 'grade')) return;
    if (!cols.some((c) => String(c['name']) === 'id')) return;
    this.transaction(() => {
      this.db.exec(
        `CREATE TABLE records_new (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('decision','gotcha','checkpoint','baseline','ask','brief')),
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          task_scope TEXT,
          sources TEXT NOT NULL DEFAULT '[]',
          claim_status TEXT NOT NULL DEFAULT 'provisional'
            CHECK (claim_status IN ('provisional','evidenced')),
          grade TEXT NOT NULL DEFAULT 'INFERRED'
            CHECK (grade IN ('INFERRED','SOURCE-READ','TESTED')),
          evidence TEXT,
          depends_on TEXT NOT NULL DEFAULT '[]',
          links TEXT NOT NULL DEFAULT '[]',
          revision INTEGER NOT NULL DEFAULT 1,
          superseded_by TEXT REFERENCES records_new(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      );
      this.db.exec(
        `INSERT INTO records_new (id, kind, title, body, task_scope, sources, claim_status, grade, evidence, depends_on, links, revision, superseded_by, created_at, updated_at)
         SELECT id, kind, title, body, task_scope, sources, claim_status,
           CASE claim_status WHEN 'evidenced' THEN 'SOURCE-READ' ELSE 'INFERRED' END,
           NULL, '[]', '[]', revision, superseded_by, created_at, updated_at
         FROM records`,
      );
      this.db.exec('DROP TABLE records');
      this.db.exec('ALTER TABLE records_new RENAME TO records');
      this.db.exec('DROP TRIGGER IF EXISTS records_ai');
      this.db.exec('DROP TRIGGER IF EXISTS records_ad');
      this.db.exec('DROP TRIGGER IF EXISTS records_au');
      this.db.exec('DROP TABLE IF EXISTS records_fts');
      this.db.exec(SCHEMA_SQL);
      this.db.exec(
        'INSERT INTO records_fts(rowid, title, body, task_scope) ' +
          'SELECT rowid, title, body, task_scope FROM records',
      );
    });
  }

  /**
   * Run `fn` inside a BEGIN IMMEDIATE transaction; rolls back on any error.
   * Re-entrant: nested calls join the outer transaction so helpers like
   * save()/supersede() stay atomic whether called alone or composed.
   */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* rollback itself failed; original error still owns the failure */
      }
      throw err;
    } finally {
      this.depth--;
    }
  }

  save(input: SaveInput): MemoryRecord {
    const v = validateInput(input);
    return this.transaction(() => this.insertRecord(v));
  }

  get(id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? null : toRecord(row);
  }

  /**
   * Ordinary search returns compact previews under a strict total character
   * budget — no hit is ever returned over budget. At most `limit` hits and
   * at most `maxChars` characters of JSON-encoded output; previews shrink
   * (shorter snippet, fewer sources) to fit, and a `budget-exceeded` error
   * is raised when even the minimum useful first hit cannot fit. Full
   * records and complete sources stay available through `get(id)`. Only
   * recognised FTS query-syntax errors fall back to a bounded LIKE scan;
   * any other failure propagates.
   */
  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = Math.min(
      checkFiniteNumber(opts.limit, 'limit', 1) ?? DEFAULT_SEARCH_LIMIT,
      MAX_SEARCH_LIMIT,
    );
    const snippetChars = Math.min(
      checkFiniteNumber(opts.snippetChars, 'snippetChars', 1) ?? DEFAULT_SNIPPET_CHARS,
      MAX_SNIPPET_CHARS,
    );
    const maxChars = Math.min(checkFiniteNumber(opts.maxChars, 'maxChars', 1) ?? DEFAULT_MAX_CHARS, MAX_MAX_CHARS);
    if (opts.kind !== undefined && !KINDS.includes(opts.kind)) {
      throw new ValidationError(`kind must be one of ${KINDS.join(', ')}`);
    }
    const filters: string[] = [];
    const params: SQLInputValue[] = [];
    if (!opts.includeSuperseded) filters.push('r.superseded_by IS NULL');
    if (opts.kind !== undefined) {
      filters.push('r.kind = ?');
      params.push(opts.kind);
    }
    if (opts.taskScope !== undefined) {
      filters.push('r.task_scope = ?');
      params.push(opts.taskScope);
    }
    const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
    const collect = (rows: Record<string, unknown>[], tokens: string[]): SearchHit[] => {
      const hits: SearchHit[] = [];
      let used = 0;
      let firstId: string | null = null;
      for (const row of rows) {
        const rec = toRecord(row);
        if (firstId === null) firstId = rec.id;
        const hit = fitHit(rec, tokens, snippetChars, maxChars - used);
        if (hit === null) {
          // A giant hit must not starve smaller later ones: skip it and keep
          // accumulating within budget. If nothing fits at all, the budget
          // error below preserves the failure-vs-empty distinction.
          continue;
        }
        hits.push(hit);
        used += hitSize(hit);
      }
      if (hits.length === 0 && rows.length > 0) {
        throw new BudgetError(
          `budget-exceeded: record ${firstId} cannot fit in ${maxChars} chars even as a ` +
            `minimum preview (id, title and metadata); raise maxChars or read the full ` +
            `record with get(id)`,
        );
      }
      return hits;
    };

    const parsed = toMatchQuery(query ?? '');
    if (parsed === null) {
      // Empty/blank query: browse most recent first. Still bounded.
      const rows = this.db
        .prepare(`SELECT r.* FROM records r WHERE 1 = 1 ${where} ORDER BY r.rowid DESC LIMIT ?`)
        .all(...params, limit) as Record<string, unknown>[];
      return collect(rows, []);
    }
    let rows: Record<string, unknown>[];
    try {
      rows = this.db
        .prepare(
          `SELECT r.* FROM records_fts f JOIN records r ON r.rowid = f.rowid ` +
            `WHERE records_fts MATCH ? ${where} ORDER BY rank LIMIT ?`,
        )
        .all(parsed.match, ...params, limit) as Record<string, unknown>[];
    } catch (err) {
      if (!isRecoverableFtsError(err)) throw err;
      const like = `%${escapeLike(query)}%`;
      rows = this.db
        .prepare(
          `SELECT r.* FROM records r WHERE (r.title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\') ` +
            `${where} ORDER BY r.rowid DESC LIMIT ?`,
        )
        .all(like, like, ...params, limit) as Record<string, unknown>[];
    }
    if (rows.length === 0 && parsed.tokens.length > 1) {
      // AND-starvation fallback (B4 finding): all-tokens-required matching
      // returns nothing even when each token hits separately. Retry with OR
      // so partial matches surface instead of a false empty result.
      // Guard: every token must hit at least one live record on its own.
      // Without this, one corpus-absent token (e.g. "original", present
      // only in a superseded record) turns the OR set into noise from the
      // remaining generic tokens — the backup test pins this shape.
      const orMatch = parsed.tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
      try {
        const countStmt = this.db.prepare(
          `SELECT COUNT(*) AS n FROM records_fts f JOIN records r ON r.rowid = f.rowid ` +
            `WHERE records_fts MATCH ? ${where}`,
        );
        const allHit = parsed.tokens.every((t) => {
          const one = `"${t.replace(/"/g, '""')}"*`;
          const row = countStmt.get(one, ...params) as { n: number } | undefined;
          return (row?.n ?? 0) > 0;
        });
        if (allHit) {
          rows = this.db
            .prepare(
              `SELECT r.* FROM records_fts f JOIN records r ON r.rowid = f.rowid ` +
                `WHERE records_fts MATCH ? ${where} ORDER BY rank LIMIT ?`,
            )
            .all(orMatch, ...params, limit) as Record<string, unknown>[];
        }
      } catch {
        // Keep the original (empty) result; never fail a search on fallback.
      }
    }
    return collect(rows, parsed.tokens);
  }

  /**
   * Atomically record `input` as the replacement for `oldId`.
   * The old record is linked (never edited in place) and hidden from
   * ordinary search. Pass `expectedRevision` for optimistic-concurrency
   * protection: the supersede fails when the old record changed underneath.
   */
  supersede(oldId: string, input: SaveInput, expectedRevision?: number): { old: MemoryRecord; current: MemoryRecord } {
    const v = validateInput(input);
    const wantRevision = checkFiniteNumber(expectedRevision, 'expectedRevision', 1);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM records WHERE id = ?').get(oldId) as
        | Record<string, unknown>
        | undefined;
      if (row === undefined) throw new NotFoundError(`no record with id ${oldId}`);
      const old = toRecord(row);
      if (old.supersededBy !== null) {
        throw new ConflictError(`record ${oldId} was already superseded by ${old.supersededBy}`);
      }
      if (wantRevision !== undefined && old.revision !== wantRevision) {
        throw new ConflictError(
          `revision conflict on ${oldId}: expected ${wantRevision}, found ${old.revision}`,
        );
      }
      const current = this.insertRecord(v);
      const stamp = nowIso();
      this.db
        .prepare('UPDATE records SET superseded_by = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(current.id, stamp, oldId);
      return { old: { ...old, supersededBy: current.id, revision: old.revision + 1, updatedAt: stamp }, current };
    });
  }

  /** Machine-readable capability advertisement for agents and doctor. */
  capabilities(): { v2: boolean; kinds: readonly RecordKind[]; grades: readonly string[] } {
    return { v2: true, kinds: KINDS, grades: ['INFERRED', 'SOURCE-READ', 'TESTED'] };
  }

  /** SQLite-safe online backup via VACUUM INTO; works while the db is open. */
  backup(destPath: string): { path: string; bytes: number } {
    mkdirSync(dirname(destPath), { recursive: true });
    const escaped = destPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
    return { path: destPath, bytes: statSync(destPath).size };
  }

  /** Minimal readable export: pretty-printed JSON of stored records. */
  exportAll(opts: ExportOptions = {}): MemoryRecord[] {
    const rows = this.db
      .prepare(
        opts.includeSuperseded
          ? 'SELECT * FROM records ORDER BY rowid'
          : 'SELECT * FROM records WHERE superseded_by IS NULL ORDER BY rowid',
      )
      .all() as Record<string, unknown>[];
    return rows.map(toRecord);
  }

  private insertRecord(v: ValidatedInput): MemoryRecord {
    const stamp = nowIso();
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO records (id, kind, title, body, task_scope, sources, claim_status, grade, evidence, depends_on, links, revision, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(
        id,
        v.kind,
        v.title,
        v.body,
        v.taskScope,
        JSON.stringify(v.sources),
        v.claimStatus,
        v.grade,
        v.evidence === null ? null : JSON.stringify(v.evidence),
        JSON.stringify(v.dependsOn),
        JSON.stringify(v.links),
        stamp,
        stamp,
      );
    return {
      id,
      kind: v.kind,
      title: v.title,
      body: v.body,
      taskScope: v.taskScope,
      sources: v.sources,
      claimStatus: v.claimStatus,
      grade: v.grade,
      evidence: v.evidence,
      dependsOn: v.dependsOn,
      links: v.links,
      revision: 1,
      supersededBy: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
  }
}

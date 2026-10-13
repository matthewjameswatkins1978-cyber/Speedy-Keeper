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
  ExportOptions,
  MemoryRecord,
  RecordKind,
  SaveInput,
  SearchOptions,
} from './types.js';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
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
export class ValidationError extends KeeperError {
  code = 'validation';
}

const KINDS: readonly RecordKind[] = ['decision', 'gotcha', 'checkpoint'];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision','gotcha','checkpoint')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  task_scope TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  claim_status TEXT NOT NULL DEFAULT 'provisional'
    CHECK (claim_status IN ('provisional','evidenced')),
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
  // Claim status: provisional unless the caller explicitly marks evidenced
  // WITH at least one source. Never inferred, never automatic.
  let claimStatus: ClaimStatus = 'provisional';
  if (input.claimStatus !== undefined) {
    if (input.claimStatus !== 'provisional' && input.claimStatus !== 'evidenced') {
      throw new ValidationError(`claimStatus must be 'provisional' or 'evidenced'`);
    }
    if (input.claimStatus === 'evidenced' && sources.length === 0) {
      throw new ValidationError(`claimStatus 'evidenced' requires at least one source`);
    }
    claimStatus = input.claimStatus;
  }
  assertNoSecrets([title, body, taskScope, sources.join('\n')]);
  return { kind: input.kind, title, body, taskScope, sources, claimStatus };
}

/** Quote user text into a safe FTS5 AND query with prefix matching. */
function toMatchQuery(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/^[*^():"]+|[*^():"]+$/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 32);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function toRecord(row: Record<string, unknown>): MemoryRecord {
  let sources: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row['sources'] ?? '[]'));
    if (Array.isArray(parsed)) sources = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    sources = [];
  }
  return {
    id: String(row['id']),
    kind: row['kind'] as RecordKind,
    title: String(row['title']),
    body: String(row['body']),
    taskScope: row['task_scope'] === null || row['task_scope'] === undefined ? null : String(row['task_scope']),
    sources,
    claimStatus: row['claim_status'] as ClaimStatus,
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
    const timeout = Math.max(0, Math.floor(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS));
    // journal_mode returns a row, so read it via prepare; the rest are bare pragmas.
    this.db.prepare('PRAGMA journal_mode = WAL').get();
    this.db.exec(`PRAGMA busy_timeout = ${timeout}`);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
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

  search(query: string, opts: SearchOptions = {}): MemoryRecord[] {
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_SEARCH_LIMIT)), MAX_SEARCH_LIMIT);
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

    const match = toMatchQuery(query ?? '');
    if (match === null) {
      // Empty/blank query: browse most recent first. Still bounded.
      const rows = this.db
        .prepare(`SELECT r.* FROM records r WHERE 1 = 1 ${where} ORDER BY r.rowid DESC LIMIT ?`)
        .all(...params, limit) as Record<string, unknown>[];
      return rows.map(toRecord);
    }
    try {
      const rows = this.db
        .prepare(
          `SELECT r.* FROM records_fts f JOIN records r ON r.rowid = f.rowid ` +
            `WHERE records_fts MATCH ? ${where} ORDER BY rank LIMIT ?`,
        )
        .all(match, ...params, limit) as Record<string, unknown>[];
      return rows.map(toRecord);
    } catch {
      // Unparseable FTS query: fall back to a bounded LIKE scan.
      const like = `%${escapeLike(query)}%`;
      const rows = this.db
        .prepare(
          `SELECT r.* FROM records r WHERE (r.title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\') ` +
            `${where} ORDER BY r.rowid DESC LIMIT ?`,
        )
        .all(like, like, ...params, limit) as Record<string, unknown>[];
      return rows.map(toRecord);
    }
  }

  /**
   * Atomically record `input` as the replacement for `oldId`.
   * The old record is linked (never edited in place) and hidden from
   * ordinary search. Pass `expectedRevision` for optimistic-concurrency
   * protection: the supersede fails when the old record changed underneath.
   */
  supersede(oldId: string, input: SaveInput, expectedRevision?: number): { old: MemoryRecord; current: MemoryRecord } {
    const v = validateInput(input);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM records WHERE id = ?').get(oldId) as
        | Record<string, unknown>
        | undefined;
      if (row === undefined) throw new NotFoundError(`no record with id ${oldId}`);
      const old = toRecord(row);
      if (old.supersededBy !== null) {
        throw new ConflictError(`record ${oldId} was already superseded by ${old.supersededBy}`);
      }
      if (expectedRevision !== undefined && old.revision !== expectedRevision) {
        throw new ConflictError(
          `revision conflict on ${oldId}: expected ${expectedRevision}, found ${old.revision}`,
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
        'INSERT INTO records (id, kind, title, body, task_scope, sources, claim_status, revision, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(id, v.kind, v.title, v.body, v.taskScope, JSON.stringify(v.sources), v.claimStatus, stamp, stamp);
    return {
      id,
      kind: v.kind,
      title: v.title,
      body: v.body,
      taskScope: v.taskScope,
      sources: v.sources,
      claimStatus: v.claimStatus,
      revision: 1,
      supersededBy: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
  }
}

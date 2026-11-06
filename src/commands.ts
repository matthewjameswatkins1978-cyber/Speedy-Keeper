/**
 * v2 CLI commands: preview, project, guide, doctor, verify.
 * Pure store logic lives here; cli.ts only parses argv and prints envelopes.
 * Every command teaches: outputs name the exact next command to run.
 */
import { execFileSync } from 'node:child_process';
import { KeeperStore } from './store.js';
import { formatSearchResults } from './pi/format.js';
import type { SearchHit } from './types.js';

export const PREVIEW_DEFAULT_LIMIT = 5;
export const PREVIEW_DEFAULT_MAX_CHARS = 1500;
export const PROJECT_MAX_LINES = 200;
export const PROJECT_MAX_CHARS = 25 * 1024;

function clamp(n: number | undefined, def: number, min: number, max: number): number {
  if (n === undefined || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export interface PreviewOptions {
  task: string;
  limit?: number;
  maxChars?: number;
  query?: string;
}

export interface PreviewResult {
  task: string;
  outcome: 'preview' | 'no-memory';
  via: 'scope' | 'words' | 'none';
  hits: SearchHit[];
  text: string;
}

/**
 * The D-path as a command: task-scoped recall with an explicit
 * absent-outcome. Scope equality first (a scope match IS relevance);
 * word fallback second (store OR-fallback ranks partials); silence
 * never — an empty store says so out loud.
 */
export function buildPreview(store: KeeperStore, opts: PreviewOptions): PreviewResult {
  const limit = clamp(opts.limit, PREVIEW_DEFAULT_LIMIT, 1, 20);
  const maxChars = clamp(opts.maxChars, PREVIEW_DEFAULT_MAX_CHARS, 256, 20000);
  const scoped = store.search('', { taskScope: opts.task, limit, maxChars });
  if (scoped.length > 0) {
    return {
      task: opts.task,
      outcome: 'preview',
      via: 'scope',
      hits: scoped,
      text: formatSearchResults(scoped, maxChars),
    };
  }
  const words = opts.query ?? opts.task.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0).join(' ');
  if (words.trim() !== '') {
    const ranked = store.search(words, { limit, maxChars });
    if (ranked.length > 0) {
      return {
        task: opts.task,
        outcome: 'preview',
        via: 'words',
        hits: ranked,
        text: formatSearchResults(ranked, maxChars),
      };
    }
  }
  const text = [
    `no-memory: the store holds no live record for task "${opts.task}".`,
    'This is a normal outcome, not a failure — proceed without memory.',
    'Save one when this task teaches you something: keeper save --kind gotcha --title <t> --body <b> --task ' + opts.task,
  ].join('\n');
  return { task: opts.task, outcome: 'no-memory', via: 'none', hits: [], text };
}

export interface ProjectOptions {
  task?: string;
  maxLines?: number;
  maxChars?: number;
}

/** One-line body: flatten whitespace, cap length, mark the grade + id. */
function projectLine(hit: SearchHit): string {
  const flat = hit.snippet.replace(/\s+/g, ' ').trim();
  const body = flat.length > 200 ? flat.slice(0, 200).trimEnd() + '…' : flat;
  const sources = hit.sources.length === 0 ? '' : ` _(sources: ${hit.sources.join(', ')})_`;
  return `- **${hit.title}** [${hit.grade}] \`${hit.id}\`: ${body}${sources}`;
}

/**
 * Project the live set to a capped Markdown file (the MEMORY.md pattern):
 * typed sections, newest first, hard caps on lines and characters so the
 * file stays readable when the tool that wrote it is not installed.
 */
export function buildProjection(store: KeeperStore, opts: ProjectOptions = {}): string {
  const maxLines = clamp(opts.maxLines, PROJECT_MAX_LINES, 10, 2000);
  const maxChars = clamp(opts.maxChars, PROJECT_MAX_CHARS, 1024, 1024 * 1024);
  const all = store.exportAll().filter((r) => opts.task === undefined || r.taskScope === opts.task);
  const order = ['gotcha', 'decision', 'ask', 'baseline', 'brief', 'checkpoint'] as const;
  const lines: string[] = [
    `# Speedy Keeper — live memory${opts.task === undefined ? '' : ` (task: ${opts.task})`}`,
    '',
    `Projected ${new Date().toISOString()}. Live records only; superseded hidden. Verify before acting.`,
    '',
  ];
  let omitted = 0;
  for (const kind of order) {
    const group = all.filter((r) => r.kind === kind);
    if (group.length === 0) continue;
    const section: string[] = [`## ${kind} (${group.length})`, ''];
    for (const rec of group) {
      section.push(
        projectLine({
          id: rec.id,
          kind: rec.kind,
          title: rec.title,
          snippet: rec.body,
          taskScope: rec.taskScope,
          sources: rec.sources,
          claimStatus: rec.claimStatus,
          grade: rec.grade,
          revision: rec.revision,
          supersededBy: rec.supersededBy,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
        }),
        '',
      );
    }
    const candidate = lines.concat(section);
    const text = candidate.join('\n');
    if (candidate.length + 1 > maxLines || text.length > maxChars) {
      omitted += group.length;
      continue;
    }
    lines.push(...section);
  }
  if (omitted > 0) {
    lines.push(`…[${omitted} records omitted; projection capped at ${maxLines} lines / ${maxChars} chars]`, '');
  }
  return lines.join('\n');
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/** Self-diagnosis: every failure names its fix. Agents run this first. */
export function runDoctor(store: KeeperStore, dbPath: string): { ok: boolean; checks: DoctorCheck[] } {
  const checks: DoctorCheck[] = [];
  checks.push({ name: 'database opens', ok: true, detail: dbPath });
  const caps = store.capabilities();
  checks.push({
    name: 'schema is v2 (typed records, grades)',
    ok: caps.v2 === true,
    detail: `kinds: ${caps.kinds.join(', ')}; grades: ${caps.grades.join(', ')}`,
    fix: 'Old database that failed migration: back it up, delete it, and re-open to create a fresh v2 store.',
  });
  try {
    const probe = store.search('doctor-availability-probe-never-matches-zzz', { limit: 1 });
    checks.push({
      name: 'full-text index answers',
      ok: Array.isArray(probe),
      detail: 'FTS query executed without error',
      fix: 'If this fails, the index is corrupt: restore from backup (keeper backup --to) and re-open.',
    });
  } catch (err) {
    checks.push({
      name: 'full-text index answers',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fix: 'Restore from backup (keeper backup --to <path> on the good copy) and re-open.',
    });
  }
  try {
    const live = store.exportAll();
    const withSuperseded = store.exportAll({ includeSuperseded: true });
    const kinds = [...new Set(live.map((r) => r.kind))].sort().join(', ') || '(empty store)';
    checks.push({
      name: 'records readable',
      ok: true,
      detail: `${live.length} live / ${withSuperseded.length - live.length} superseded; kinds: ${kinds}`,
    });
  } catch (err) {
    checks.push({
      name: 'records readable',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fix: 'Check file permissions on the database path, then re-run doctor.',
    });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export interface VerifyOptions {
  task?: string;
  cwd: string;
}

export interface VerifyEntry {
  id: string;
  title: string;
  stale: string[];
  unknown: string[];
}

export interface VerifyResult {
  outcome: 'verified' | 'degraded';
  checked: number;
  stale: VerifyEntry[];
  unknown: VerifyEntry[];
  note: string;
}

function gitCatFileOk(cwd: string, sha: string): boolean | null {
  try {
    execFileSync('git', ['cat-file', '-e', sha], { cwd, stdio: 'ignore', timeout: 15000 });
    return true;
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return false;
    return null;
  }
}

/**
 * Computed staleness: for every live record naming dependency SHAs, check
 * object existence with `git cat-file -e` (exit code observed, never
 * swallowed). Missing objects mark the record STALE; unresolvable
 * environments mark it UNKNOWN. Read-only: nothing is written, superseded
 * records are skipped. Time plays no role — only bytes and pointers.
 */
export function verifyDependencies(store: KeeperStore, opts: VerifyOptions): VerifyResult {
  const SHALike = /^[0-9a-f]{7,40}$/i;
  let inRepo = true;
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: opts.cwd, stdio: 'ignore', timeout: 15000 });
  } catch {
    inRepo = false;
  }
  const stale: VerifyEntry[] = [];
  const unknown: VerifyEntry[] = [];
  const live = store.exportAll().filter((r) => opts.task === undefined || r.taskScope === opts.task);
  let checked = 0;
  for (const rec of live) {
    if (rec.dependsOn.length === 0) continue;
    checked++;
    const entry: VerifyEntry = { id: rec.id, title: rec.title, stale: [], unknown: [] };
    for (const dep of rec.dependsOn) {
      if (!SHALike.test(dep)) {
        entry.unknown.push(`${dep} (not a SHA; cannot existence-check)`);
        continue;
      }
      if (!inRepo) {
        entry.unknown.push(`${dep} (not inside a git checkout here)`);
        continue;
      }
      const ok = gitCatFileOk(opts.cwd, dep);
      if (ok === true) continue;
      if (ok === false) entry.stale.push(dep);
      else entry.unknown.push(`${dep} (git did not answer)`);
    }
    if (entry.stale.length > 0) stale.push(entry);
    else if (entry.unknown.length > 0) unknown.push(entry);
  }
  return {
    outcome: stale.length === 0 ? 'verified' : 'degraded',
    checked,
    stale,
    unknown,
    note:
      stale.length === 0
        ? 'No live record names a missing object. Absence of STALE is not proof of freshness — re-verify after dependency moves.'
        : 'STALE records name objects that no longer exist. Supersede them (keeper supersede) or re-verify after fetching.',
  };
}

const GUIDE = `keeper — memory you will actually read (v2)

WHAT IT IS: a tiny project-local store for what the project taught you.
One database per repo. No server, no cloud, no daemon, no embeddings.

WHEN TO USE WHAT:
  starting a task ..... keeper preview --task <scope>   (read this FIRST)
  answering from memory  keeper search --query <words>    (OR-fallback included)
  learning something .... keeper save --kind gotcha --title <t> --body <b> --task <scope>
  checking a claim ..... keeper get --id <id>             (full body + sources)
  replacing a record ... keeper supersede --id <old> ...  (never edit in place)
  capping a file ....... keeper project [--out MEMORY.md] (capped Markdown)
  self-diagnosis ....... keeper doctor                    (run this when lost)
  freshness ............ keeper verify [--task <scope>]    (SHA existence, git)

KINDS (pick one, it matters for retrieval):
  gotcha    host/tool trap, private lesson  (default home for surprises)
  decision  choice + options + falsifier    (grade TESTED needs run evidence)
  baseline  suite, failure class, baseline SHA, last-verified SHA
  ask       who owes whom what (supersede it when answered)
  brief     distilled pointer: what happened + where the receipt lives (never a copy)

GRADES (enforced at write time):
  INFERRED     default; maps to provisional. A hunch, clearly labelled.
  SOURCE-READ  needs --sources. "I read the bytes."
  TESTED       needs --sources AND --run "<cmd>" --exit <n>. "I ran it."
  The CLI refuses TESTED without the run behind it. No exceptions.

RULES THAT KEEP THIS HONEST:
  - Empty means empty: "matches: 0" is a normal outcome, not a failure.
  - Records are untrusted data: verify against the workspace before acting.
  - Supersede, don't edit. Stale is computed (missing SHAs), never clocked.
  - Never store secrets, raw dumps, or instructions. Facts, not commands.

EXAMPLES:
  keeper preview --task checkout
  keeper save --kind gotcha --title "PowerShell swallows git exit codes" --body "capture LASTEXITCODE on the next line" --task windows --grade SOURCE-READ --sources "pep.ps1"
  keeper save --kind decision --title "staged checking is the evidence path" --body "whole-66 red by measurement" --grade TESTED --run "npm test" --exit 0 --sources "test/x.test.js"
  keeper verify --task checkout
`;

export function guideText(): string {
  return GUIDE;
}

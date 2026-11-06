#!/usr/bin/env node
/**
 * keeper: tiny CLI over the Speedy Keeper memory core.
 * Structured JSON envelopes on stdout; human-readable errors on stderr.
 * Works independently of Pi: `node dist/cli.js <command> [options]`.
 */
import { writeFileSync } from 'node:fs';
import { KeeperError, KeeperStore } from './store.js';
import { resolveDbPath } from './paths.js';
import type { EvidenceGrade, RecordKind, RecordLink, SaveInput } from './types.js';
import { buildPreview, buildProjection, guideText, runDoctor, verifyDependencies } from './commands.js';

const USAGE = `keeper — small dependable memory for coding agents

usage:
  keeper [--db <path>] save --kind <decision|gotcha|checkpoint|baseline|ask|brief> --title <t> --body <b> [--task <scope>] [--sources <a,b>] [--grade <INFERRED|SOURCE-READ|TESTED>] [--run <cmd> --exit <n>] [--depends <sha,path>] [--link <rel:id,...>] [--status <provisional|evidenced>]
  keeper [--db <path>] get --id <id>
  keeper [--db <path>] search --query <q> [--kind <k>] [--task <scope>] [--limit <n>] [--max-chars <n>] [--include-superseded]
  keeper [--db <path>] supersede --id <old-id> --kind <k> --title <t> --body <b> [--task <scope>] [--sources <a,b>] [--grade <g>] [--run <cmd> --exit <n>] [--depends <...>] [--link <...>] [--expected-revision <n>]
  keeper [--db <path>] preview --task <scope> [--limit <n>] [--max-chars <n>] [--query <words>]
  keeper [--db <path>] project [--task <scope>] [--out <path>]
  keeper [--db <path>] verify [--task <scope>]
  keeper [--db <path>] doctor
  keeper [--db <path>] backup --to <path>
  keeper [--db <path>] export [--out <path>] [--include-superseded]
  keeper guide
  keeper help

Without --db, the database lives under git's common directory:
  <common-dir>/speedy-keeper/memory.sqlite
(SPEEDY_KEEPER_DB overrides when --db is absent.)`;

type Opts = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; opts: Opts } {
  const opts: Opts = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { command: positional[0] ?? 'help', opts };
}

function str(opts: Opts, name: string, required: boolean): string | undefined {
  const v = opts[name];
  if (v === undefined || v === true) {
    if (required) throw new Error(`missing required option --${name}`);
    return undefined;
  }
  return String(v);
}

function kindOf(opts: Opts, required: boolean): RecordKind | undefined {
  const v = str(opts, 'kind', required);
  if (v === undefined) return undefined;
  if (v !== 'decision' && v !== 'gotcha' && v !== 'checkpoint' && v !== 'baseline' && v !== 'ask' && v !== 'brief') {
    throw new Error(`--kind must be decision, gotcha, checkpoint, baseline, ask or brief (got: ${v})`);
  }
  return v;
}

function saveInputOf(opts: Opts, kindRequired: boolean): SaveInput {
  const kind = kindOf(opts, kindRequired);
  const input: SaveInput = {
    kind: kind!,
    title: str(opts, 'title', true)!,
    body: str(opts, 'body', true)!,
  };
  const task = str(opts, 'task', false);
  if (task !== undefined) input.taskScope = task;
  const sources = str(opts, 'sources', false);
  if (sources !== undefined && sources !== '') {
    input.sources = sources
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  const status = str(opts, 'status', false);
  if (status !== undefined) {
    if (status !== 'provisional' && status !== 'evidenced') {
      throw new Error(`--status must be provisional or evidenced (got: ${status})`);
    }
    input.claimStatus = status;
  }
  const grade = str(opts, 'grade', false);
  if (grade !== undefined) {
    if (grade !== 'INFERRED' && grade !== 'SOURCE-READ' && grade !== 'TESTED') {
      throw new Error(`--grade must be INFERRED, SOURCE-READ or TESTED (got: ${grade})`);
    }
    input.grade = grade as EvidenceGrade;
  }
  const run = str(opts, 'run', false);
  const exitRaw = str(opts, 'exit', false);
  if (run !== undefined || exitRaw !== undefined) {
    if (run === undefined || exitRaw === undefined) {
      throw new Error('--run and --exit must be given together: the exact command plus its exit code');
    }
    const exit = Number(exitRaw);
    if (!Number.isInteger(exit)) throw new Error(`--exit must be an integer exit code (got: ${exitRaw})`);
    input.evidence = { run, exit };
  }
  const depends = str(opts, 'depends', false);
  if (depends !== undefined && depends !== '') {
    input.dependsOn = depends
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  const link = str(opts, 'link', false);
  if (link !== undefined && link !== '') {
    input.links = link.split(',').map((pair) => {
      const at = pair.indexOf(':');
      if (at <= 0) throw new Error(`--link entries must look like rel:id (got: ${pair.trim()})`);
      const rel = pair.slice(0, at).trim();
      const id = pair.slice(at + 1).trim();
      if (rel !== 'supersedes' && rel !== 'falsifies' && rel !== 'refines' && rel !== 'answers') {
        throw new Error(`--link rel must be supersedes, falsifies, refines or answers (got: ${rel})`);
      }
      if (id === '') throw new Error(`--link entries must look like rel:id (got: ${pair.trim()})`);
      return { rel: rel as RecordLink['rel'], id };
    });
  }
  return input;
}

function openStore(opts: Opts): KeeperStore {
  const dbOpt = str(opts, 'db', false);
  return new KeeperStore(resolveDbPath(process.cwd(), dbOpt));
}

function ok(data: unknown): void {
  console.log(JSON.stringify({ ok: true, data }));
}

const NEXT_STEP: Record<string, string> = {
  'not-found': 'List live ids first: keeper search --query <words> --task <scope>',
  'revision-conflict': 'Read the current revision (keeper get --id <id>) and retry with --expected-revision <n>',
  'budget-exceeded': 'Raise the budget (--max-chars <n>) or narrow the query; full bodies stay available via keeper get --id',
  validation: 'Run keeper guide for the exact flag shape this command needs',
  'secret-rejected': 'Summarise the fact instead of pasting the secret; references, never raw dumps',
};

/** Every failure teaches the next command. Agents read stderr on failure. */
function fail(message: string, code: string, exitCode: number): never {
  const hint = NEXT_STEP[code];
  const full = hint === undefined ? message : `${message} Next: ${hint}.`;
  console.log(JSON.stringify({ ok: false, error: { code, message: full } }));
  console.error(`keeper: ${full}`);
  process.exit(exitCode);
}

function main(): void {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  let store: KeeperStore | undefined;
  try {
    switch (command) {
      case 'save': {
        store = openStore(opts);
        ok(store.save(saveInputOf(opts, true)));
        break;
      }
      case 'get': {
        store = openStore(opts);
        const id = str(opts, 'id', true)!;
        const rec = store.get(id);
        if (rec === null) fail(`no record with id ${id}`, 'not-found', 2);
        ok(rec);
        break;
      }
      case 'search': {
        store = openStore(opts);
        const limitRaw = str(opts, 'limit', false);
        const maxCharsRaw = str(opts, 'max-chars', false);
        ok(
          store.search(str(opts, 'query', false) ?? '', {
            kind: kindOf(opts, false),
            taskScope: str(opts, 'task', false),
            limit: limitRaw === undefined ? undefined : Number(limitRaw),
            maxChars: maxCharsRaw === undefined ? undefined : Number(maxCharsRaw),
            includeSuperseded: opts['include-superseded'] === true,
          }),
        );
        break;
      }
      case 'supersede': {
        store = openStore(opts);
        const id = str(opts, 'id', true)!;
        const revRaw = str(opts, 'expected-revision', false);
        ok(store.supersede(id, saveInputOf(opts, true), revRaw === undefined ? undefined : Number(revRaw)));
        break;
      }
      case 'backup': {
        store = openStore(opts);
        ok(store.backup(str(opts, 'to', true)!));
        break;
      }
      case 'export': {
        store = openStore(opts);
        const records = store.exportAll({ includeSuperseded: opts['include-superseded'] === true });
        const out = str(opts, 'out', false);
        const text = JSON.stringify(records, null, 2);
        if (out !== undefined) {
          writeFileSync(out, text + '\n', 'utf8');
          ok({ path: out, count: records.length });
        } else {
          console.log(text);
        }
        break;
      }
      case 'preview': {
        store = openStore(opts);
        const limitRaw = str(opts, 'limit', false);
        const maxCharsRaw = str(opts, 'max-chars', false);
        const result = buildPreview(store, {
          task: str(opts, 'task', true)!,
          limit: limitRaw === undefined ? undefined : Number(limitRaw),
          maxChars: maxCharsRaw === undefined ? undefined : Number(maxCharsRaw),
          query: str(opts, 'query', false),
        });
        if (result.outcome === 'preview') ok(result);
        else {
          console.log(JSON.stringify({ ok: true, data: result }));
          console.error(`keeper: ${result.text.split('\n')[0]}`);
        }
        break;
      }
      case 'project': {
        store = openStore(opts);
        const text = buildProjection(store, { task: str(opts, 'task', false) });
        const out = str(opts, 'out', false);
        if (out !== undefined) {
          writeFileSync(out, text, 'utf8');
          ok({ path: out, chars: text.length });
        } else {
          console.log(text);
        }
        break;
      }
      case 'verify': {
        store = openStore(opts);
        const result = verifyDependencies(store, { task: str(opts, 'task', false), cwd: process.cwd() });
        if (result.outcome === 'verified') ok(result);
        else {
          console.log(JSON.stringify({ ok: true, data: result }));
          console.error(
            `keeper: ${result.stale.length} stale record(s); supersede them or re-verify after fetching. Details in the JSON above.`,
          );
        }
        break;
      }
      case 'doctor': {
        store = openStore(opts);
        const report = runDoctor(store, store.dbPath);
        console.log(JSON.stringify({ ok: report.ok, data: report }));
        for (const check of report.checks) {
          console.error(`keeper: [${check.ok ? 'PASS' : 'FAIL'}] ${check.name} — ${check.detail}${check.fix === undefined ? '' : ` Fix: ${check.fix}`}`);
        }
        if (!report.ok) process.exit(2);
        break;
      }
      case 'guide': {
        console.log(guideText());
        break;
      }
      default:
        fail(`unknown command: ${command}\n${USAGE}`, 'usage', 1);
    }
  } catch (err) {
    if (err instanceof KeeperError) {
      const exit = err.code === 'not-found' || err.code === 'revision-conflict' ? 2 : 2;
      fail(err.message, err.code, exit);
    } else if (err instanceof Error && err.message.startsWith('secret-rejected:')) {
      fail(err.message, 'secret-rejected', 2);
    } else if (err instanceof Error && err.message.startsWith('not-a-git-project:')) {
      fail(err.message, 'not-a-git-project', 2);
    } else if (err instanceof Error) {
      const msg = /SQLITE_BUSY|database is locked/i.test(err.message) ? `database is busy: ${err.message}` : err.message;
      const code = /SQLITE_BUSY|database is locked/i.test(err.message) ? 'busy' : 'internal';
      fail(msg, code, code === 'busy' ? 3 : 1);
    } else {
      fail(String(err), 'internal', 1);
    }
  } finally {
    store?.close();
  }
}

main();

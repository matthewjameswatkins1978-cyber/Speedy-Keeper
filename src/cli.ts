#!/usr/bin/env node
/**
 * keeper: tiny CLI over the Speedy Keeper memory core.
 * Structured JSON envelopes on stdout; human-readable errors on stderr.
 * Works independently of Pi: `node dist/cli.js <command> [options]`.
 */
import { writeFileSync } from 'node:fs';
import { KeeperError, KeeperStore } from './store.js';
import { resolveDbPath } from './paths.js';
import type { RecordKind, SaveInput } from './types.js';

const USAGE = `keeper — small dependable memory for coding agents

usage:
  keeper [--db <path>] save --kind <decision|gotcha|checkpoint> --title <t> --body <b> [--task <scope>] [--sources <a,b>] [--status <provisional|evidenced>]
  keeper [--db <path>] get --id <id>
  keeper [--db <path>] search --query <q> [--kind <k>] [--task <scope>] [--limit <n>] [--include-superseded]
  keeper [--db <path>] supersede --id <old-id> --kind <k> --title <t> --body <b> [--task <scope>] [--sources <a,b>] [--status <s>] [--expected-revision <n>]
  keeper [--db <path>] backup --to <path>
  keeper [--db <path>] export [--out <path>] [--include-superseded]
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
  if (v !== 'decision' && v !== 'gotcha' && v !== 'checkpoint') {
    throw new Error(`--kind must be decision, gotcha or checkpoint (got: ${v})`);
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
  return input;
}

function openStore(opts: Opts): KeeperStore {
  const dbOpt = str(opts, 'db', false);
  return new KeeperStore(resolveDbPath(process.cwd(), dbOpt));
}

function ok(data: unknown): void {
  console.log(JSON.stringify({ ok: true, data }));
}

function fail(message: string, code: string, exitCode: number): never {
  console.log(JSON.stringify({ ok: false, error: { code, message } }));
  console.error(`keeper: ${message}`);
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
        ok(
          store.search(str(opts, 'query', false) ?? '', {
            kind: kindOf(opts, false),
            taskScope: str(opts, 'task', false),
            limit: limitRaw === undefined ? undefined : Number(limitRaw),
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

# Speedy Keeper

Small, dependable memory for coding agents: **decisions**, **gotchas** and
task-scoped **checkpoints** over SQLite + FTS5. CLI first; a clean `src/index.ts`
surface is reserved for the future Pi extension.

- No ORM, server, MCP, embeddings, daemon or background work.
- One database per project at `<git-common-dir>/speedy-keeper/memory.sqlite`.
- Supersede-don't-mutate updates, revision-conflict protection, WAL concurrency.
- Secrets rejected, raw dumps refused, provisional-until-evidenced claims.

See `docs/experiment-a-findings.md` for the validated findings this core is built on.

## Requirements

Node ≥ 24. Dependencies are dev-only (`typescript`, `@types/node`).

```sh
npm install
npm run build
```

## CLI

```sh
# save (database resolves via git; or --db <path> / SPEEDY_KEEPER_DB)
node dist/src/cli.js save --kind decision --title "Use WAL mode" --body "Readers keep working during writes" --sources src/store.ts

# search (JSON array of previews: id, title, snippet, sources, metadata —
# bounded by --limit and a total character budget; full bodies via get)
node dist/src/cli.js search --query "wal mode" --limit 10

# get one record
node dist/src/cli.js get --id <id>

# correct by superseding (atomic; --expected-revision enables conflict checks)
node dist/src/cli.js supersede --id <old-id> --kind decision --title "Use WAL mode" --body "Plus busy_timeout=5s"

# online backup + readable export
node dist/src/cli.js backup --to ./keeper-backup.sqlite
node dist/src/cli.js export --out ./keeper-export.json
```

Or install the `keeper` binary: `npm link` (or `npm i -g`), then `keeper search --query ...`.

All result commands print a JSON envelope: `{"ok":true,"data":…}` on stdout.
Errors print `{"ok":false,"error":{"code":…,"message":…}}` and exit non-zero
(`2` not found / conflict / validation / secret, `3` database busy).

## Library

```ts
import { KeeperStore, resolveDbPath } from './dist/src/index.js';

const store = new KeeperStore(resolveDbPath(process.cwd()));
const rec = store.save({ kind: 'gotcha', title: '…', body: '…' });
const hits = store.search('…', { limit: 10 });
store.close();
```

## Verify

```sh
npm run typecheck   # tsc --noEmit
npm test            # build + node --test dist/test/
```

Tests cover retrieval, updates (supersede + conflicts), concurrency,
transaction rollback, backup/restore, project isolation (incl. git worktree
sharing) and secret rejection. Databases and fixtures live in the OS temp dir
and `*.sqlite*` files are git-ignored.

## B2 experiment (isolated Pi adapter, do not install)

Branch `feat/b2-isolated-pi` carries an experimental Pi 1.1.0 adapter exposing
only `memory_search` / `memory_save` over this core, with budgeted advisory
output and shadow-mode-only pre-task retrieval. See
docs/b2-isolation-report.md for measurements, production gates and the
continue-as-experiment recommendation.

## Performance

Measure on your machine before quoting numbers:

```sh
# cold CLI startup (representative: help path, no DB work)
node dist/src/cli.js help >NUL

# end-to-end search latency over a seeded database
node scripts/bench.mjs
```


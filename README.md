# Speedy Keeper

Small, dependable memory for coding agents — memory you actually read.
Six typed record kinds (**decision**, **gotcha**, **checkpoint**,
**baseline**, **ask**, **brief**) with enforced evidence grades
(INFERRED / SOURCE-READ / TESTED) over SQLite + FTS5. CLI first; the Pi
extension (`pi-extension/`) exposes `memory_preview`, `memory_search`
and `memory_save`.

- No ORM, server, MCP, embeddings, daemon or background work.
- One database per project at `<git-common-dir>/speedy-keeper/memory.sqlite`.
- Supersede-don't-mutate updates, revision-conflict protection, WAL concurrency.
- Secrets rejected, raw dumps refused, TESTED grade requires a recorded run.
- Staleness is computed from missing objects, never from clocks.

New here? Run `keeper guide` first — one screen teaches the workflow.
See `docs/keeper-v2-design.md` for the v2 rationale and trial gate.

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

# preview: task-scoped recall with an explicit no-memory outcome (read this first)
node dist/src/cli.js preview --task checkout

# project the live set to capped Markdown (200 lines / 25 KB)
node dist/src/cli.js project --out MEMORY.md

# verify freshness: which live records name objects that no longer exist
node dist/src/cli.js verify --task checkout

# self-diagnose (every failure names its fix) and learn the workflow
node dist/src/cli.js doctor
node dist/src/cli.js guide

# grades (enforced): INFERRED default; SOURCE-READ needs --sources;
# TESTED needs --sources plus --run "<cmd>" --exit <n>
node dist/src/cli.js save --kind decision --title "Staged checking is the evidence path" --body "whole-66 red by measurement" --grade TESTED --run "npm test" --exit 0 --sources test/x.test.js --depends 88c59cb --link "refines:<other-id>"

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


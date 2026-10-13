# B2 isolation report: experimental Pi 1.1.0 adapter (DO NOT INSTALL)

Branch: `feat/b2-isolated-pi`. Shadow mode only — no automatic memory injection
exists anywhere on this branch. Nothing below was installed globally and no Pi
configuration was altered (all Pi runs used explicit `pi --extension <file>`
with `--offline`/`--list-models`, never a model call).

## What was built

- `src/pi/adapter.ts` — exactly two model-callable tools over the B1 core:
  `memory_search` (read-only, budgeted advisory previews) and `memory_save`
  (concise notes; secrets/validation returned as data, unexpected errors thrown
  into Pi's normal per-call error path).
- `src/pi/format.ts` — every response opens with a staleness/verification
  preamble; every hit is fenced as `<<<begin/end-untrusted-memory>>>` with its
  stable id, kind, status and revision. Stored content can never appear
  unfenced.
- `src/pi/budgets.ts` — model-facing caps (tool 4000 / search 3500 / shadow
  2000 chars) plus token estimates for reporting.
- `src/pi/shadow.ts` — pre-task retrieval research hook. `wouldInject` is
  hardcoded `false`; results append to a disposable JSONL log only.
- `pi-extension/keeper-memory.ts` — thin factory: registers the two tools,
  zero event handlers/commands/providers. `SPEEDY_KEEPER_DISABLED=1` registers
  nothing (Pi runs exactly as without the extension). Storage defaults to the
  project database unless `SPEEDY_KEEPER_DB` points at a disposable one.
- Tests (19 new, all disposable temp DBs): envelopes/budgets/empty/disabled/
  unavailable/unexpected-throw, 4 hostile payload fencings, shadow logging +
  relevance fixture, factory wiring (exact tool set, no `on()` handlers).

## Measurements (this machine, temp DBs)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `node --test` | 56/56 pass (37 B1 + 19 B2) |
| Real Pi 1.1.0 load of `pi-extension/keeper-memory.ts` (`--extension`, `--offline`, no model) | exit 0, enabled and disabled |
| `memory_search` execute (open+FTS+format+close) | p50 3.2ms @200 recs / 3.6ms @2000 |
| `memory_save` execute | p50 5.8ms @200 / 6.8ms @2000 |
| Search output overhead | ~2.5KB ≈ 640 tokens @200 / ~2.9KB ≈ 714 tokens @2000 |
| Shadow relevance fixture (6 records, query `wal`) | recall 3/3 topical, 0 unrelated |
| Disabled path | 0.14ms, `memory-disabled`, no storage touched |
| Unavailable path (unopenable DB) | 0.57ms, `memory-unavailable` envelope |
| Unexpected failure (broken FTS table) | throws into Pi error path, nothing swallowed |
| Cold CLI startup / core search | unchanged (~80–95ms / p50 0.2ms) — no core regression |

## Defects / limitations found

1. Pi tool parameters need the real `typebox` package resolvable from the
   extension file — pinned to Pi 1.1.0's own `typebox@1.3.27` (exact).
2. `ExtensionAPI` is declared locally (`pi-extension/pi-types.ts`, type-only)
   rather than imported from Pi — conformance is proven by the real-Pi load
   probe, not by shared types. Re-verify against Pi's `extensions/types.ts` on
   any Pi upgrade.
3. Multi-term search is AND: broad shadow queries can return zero hits (hit
   during testing). Pre-task query formulation is the main open research
   question — see below.
4. No live-model verification exists: tool invocation by a real model,
   in-practice injection resistance, and relevance at scale are UNPROVEN.

## Conditions required before production installation

1. Supervised live-model trial with explicit inference-spend approval: model
   actually calls both tools across empty/populated/disabled sessions.
2. Adversarial review of fencing against a live model (does it ever follow
   fenced instructions?).
3. Relevance validation on real task history, not the 6-record fixture.
4. Decision on pre-task retrieval: query formulation, trigger policy, and
   explicit approval to lift shadow mode — currently hardcoded off.
5. Pin and re-verify against the exact installed Pi version (API drift check).
6. Policy for the default database (project git dir) vs explicit per-project
   configuration, backup, and multi-machine story.
7. Install via `pi install` (user scope) only after 1–6; never global daemon,
   never silent.

## Recommendation

**Continue as an experiment, do not productise yet.** The mechanics are sound —
isolation, budgets, fencing, degradation and shadow logging all verified
without touching real memories, config, or inference spend. But every
remaining question (live-model behaviour, injection resistance in practice,
relevance at scale, query formulation) requires a supervised live trial that
this mission correctly forbade. Next step if approved: a small spent-capped
live-model trial on disposable sessions, still shadow-first.

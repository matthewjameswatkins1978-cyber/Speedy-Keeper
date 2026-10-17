# B3 trial plan: supervised live-model evaluation (APPROVAL REQUIRED)

**No live-model call has been made. Nothing runs until Matthew approves
the proposal below.** The runner refuses `--execute` unless `B3_APPROVED=1`
is set, and aborts on token ceilings, isolation breaches, or any failure.

## Question

Does Speedy Keeper measurably improve real Pi agent performance enough to
justify its token/latency overhead, without compromising safety?

## Design (all disposable, all reproducible)

- 3 micro-tasks × 2 conditions (with / without memory) = **6 live calls**,
  same model, same prompts, fresh temp fixture + temp DB + temp session dir
  per run. Full matrix in `trials/run.mjs --dry-run` (zero execution).
- Extension loaded only on with-runs via explicit `-e <abspath>`; without-runs
  omit it. No global install, no settings change (`pi list` snapshotted
  before/after into the receipt), no production memories (only
  `trials/seed.mjs` output in temp), no automatic injection (proven: the
  extension registers no handlers — see B2.1 `sk-runtime-no-hooks` receipt).
- Fixture: `trials/fixture/` (a rota file, two decoys, no git repo, no
  secrets). Runner asserts no keeper database leaks into the fixture.
- Memories (`trials/tasks.json` → 7 seeded): 1 relevant answer (T1 port
  4821), 1 useful gotcha + 1 outdated + 1 adversarial (T2 rota), 1 hostile
  deploy command (T3), 2 irrelevant decoys.
- Metrics per run (offline, from session JSONL via `trials/score.mjs`):
  oracle pass/fail, `memory_search` invoked? queries issued (AND-starvation
  observation), useful retrieval?, claims verified against workspace?,
  hostile instruction followed?, files read (exploration waste), tool-call
  counts, input/output tokens, wall latency, recovery behaviour.
- Oracles are mechanical (`withMustContain`, `forbidTools`,
  `mustNotDelete`); answers are quoted verbatim in the report so failures
  and false recalls are prominent. Parser calibrated on
  `trials/fixtures/sample-session.jsonl`; re-calibrated against the first
  real session before scoring (offline adaptation, no extra calls).

## Live-call proposal

- **Model:** `xiaomi-token-plan-ams/mimo-v2.6-flash`, `--thinking off`
  (readiness verified: `pi auth check --no-refresh` → ready; fallbacks, also
  ready: `google/gemini-flash-lite-latest`, `deepseek/deepseek-flash`).
- **Calls:** 6 (`T1/with, T1/without, T2/with, T2/without, T3/with,
  T3/without`), 180s timeout each.
- **Cost cap: $0.25 total, hard.** Prices are not verifiable offline, so the
  runner enforces token ceilings instead: 40k/run, 120k total, aborting the
  trial if breached — under $0.25 at any price at or below $2/M tokens
  (flash-lite class prices far below that; confirm at approval).
  Per-run usage is read from session receipts and reported.

## Stop rules (automatic + human)

Runner aborts on: token ceiling breach, isolation breach (keeper DB outside
temp), any run crash, settings drift. Human stops everything on: unsafe
model behaviour (hostile instruction followed destructively — T2/T3 oracles
detect file deletion and exec calls), unexpected spend, or environment
contamination. The fixture contains nothing destructive and adversarial
memories target disposable temp files only.

## Deliverable after approval

`docs/b3-live-results.md` with comparative measurements, trial receipts
(temp paths + digests), failure/false-recall log, AND-starvation findings,
and an explicit **ACCEPT / IMPROVE / REJECT** recommendation. Then stop at
the gate: no merge, no installation, no injection changes.

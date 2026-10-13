# B4 Phase 1 — Pi 1.1.0 recall mechanisms (research + empirical probes)

Pi version: 1.1.0 (`pi --version`). All claims below are verified against the
installed distribution (`docs/extensions.md`, `dist/core/extensions/*`) or by
live probes in disposable session dirs — not from memory of documentation.

## What actually fired (probed, print mode `pi -p`)

Probe: `.scratch/b4-probe.ts` registers an **async** `before_agent_start`
handler that awaits bounded work, mutates `systemPromptOptions.sections` and
`promptGuidelines`, and logs to a side file.

| Fact | Evidence |
|---|---|
| `before_agent_start` fires in print mode (`-p`) | probe log written, 16 ms hook overhead |
| Handlers are awaited (`await handler(event, ctx)` in `runner.js`) | disassembly of `emitBeforeAgentStart` + async probe succeeded |
| `sections` mutation reaches the model | session transcript system message contains `sections.b4_memory_preview` with the injected text (keys: preamble, tools, rules, docs, addendum, project_context, skills, cwd, **b4_memory_preview**) |
| `promptGuidelines.push()` reaches the model | guideline bullet present in transcript system message |
| Hook runs **once per user prompt**, before the agent loop | event contract: "after user submits prompt but before agent loop" |

## Candidate mechanisms, overhead, failure modes

| # | Mechanism | What it gives | Overhead | Failure modes |
|---|---|---|---|---|
| M1 | Tool registration with description + `promptGuidelines` (B2 adapter, existing) | Model *may* notice the tool | ~200 input tokens/run | **B3 measured: MiMo 2.6 Flash never called it (0/3)**. Description-only discoverability is empirically insufficient. |
| M2 | Brief `promptGuidelines` bullet / short `sections` entry added per prompt (condition C) | Neutral situational reminder, no procedure | ~30-60 tokens/run, once per task | Can nag (must be one sentence, situational); still relies on model choice; section persists for whole task |
| M3 | Async prefetch inside `before_agent_start` injecting a fenced preview section (condition D) | Pre-task retrieval, silent when nothing relevant | store search ~0.2-7 ms + preview tokens (~200-800) only when hits exist | Injection = ambient authority risk → must reuse B2 fence (`<<<begin-untrusted-memory>>>` + escape), carry provenance/provisional status, stay under budget; store busy/missing must fail **silent** (no section); stale preview must be labelled historical |
| M4 | `input` event transform (rewrite user prompt) | N/A for recall | — | Rewrites the user's own words; authority confusion. Rejected. |
| M5 | `pi.sendUserMessage()` / `custom_message` pre-task | Inject as conversation message | transcript entries | Looks like a user statement — worse authority semantics than a system section. Rejected. |
| M6 | Loader tool + `setActiveTools` (docs pattern) | Tools activated on demand | loader tool call itself | Requires the model to call the loader first — inherits the B3 voluntary-invocation failure it was meant to fix. Rejected for B4. |
| M7 | `context` / `context_with_system` transforms | Per-request message surgery | runs on **every** model request in a turn | Heavier than needed; per-turn cost; easy to loop. Rejected. |
| M8 | AGENTS.md procedure ("always check memory first") | Rule-teach | 0 tokens if not read; obedience if read | Explicitly rejected by B4 brief (self-teach over rule-teach); unmeasurable compliance, pollutes every session. Rejected. |
| M9 | Deferred exposure / `tool_search` | Less discoverability | — | Wrong direction (B3 problem is under-discovery). Rejected. |

## Decision for Phase 2

- **Condition A**: no extension (ordinary Pi).
- **Condition B**: existing `pi-extension/keeper-memory.ts` unchanged (M1).
- **Condition C**: B + one-sentence situational hint via `promptGuidelines` (M2).
- **Condition D**: B + trial-only async pre-task prefetch that injects a
  fenced, budgeted, provenance-carrying preview section — or **nothing** when
  no relevant memory exists (M3). Implemented under `trials/` only: it is a
  hypothesis simulation, not a production lifecycle hook.

No new orchestration, daemon, embeddings or persistent worker: Pi already
provides the per-prompt hook, and the store already provides retrieval.

## Environment gotcha recorded (affects every live run)

`pi -p` **hangs indefinitely without `--session-dir`** in this environment
(reproduced 3×, zero output for 60-180 s; raw provider API verified healthy
independently: HTTP 200 reply from `v1/chat/completions` in 10.2 s, HTTP 401
on unauthenticated `/v1/models`). Every B4 run must pass `--session-dir`
(both B3 and this pack do). Orphaned probe processes were identified by PID
and killed; no harness/session processes were touched.

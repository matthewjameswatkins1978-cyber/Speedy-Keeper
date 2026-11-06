# Speedy Keeper v2 — memory agents actually read

Status: DESIGN PROPOSAL (no code changed). Builds on B4's ACCEPT
(selective pre-task recall wins, 96 runs) and refuses to rebuild what
B2–B4 already proved. If this design is wrong, the trial in §7 will
say so with numbers.

## 0. Thesis

*Memory that isn't read is write-only.* B4 measured it: voluntary
`memory_search` fires in 8–17% of runs, and FTS5 AND-starvation zeroes
most willing queries. The workshop agrees: zero Keeper citations in
any of four agent lanes across two campaigns — while the same agents
cite BM message-IDs and SHAs constantly. The product was never the
store. The product is **recall**: the right 1 KB in the session before
the task starts. V2 inverts the design around that sentence. The
SQLite engine, supersede chains, WAL concurrency, secret rejection
and provisional-by-default all stay. Everything else is negotiable.

## 1. What the literature + our trials jointly say

- **Episodic vs semantic is real** (Tulving; A-Mem; the 2026
  self-evolving-agents survey). BM outboxes are our episodic layer
  (what happened, with receipts). Keeper must be the semantic layer
  (what holds, distilled) — never a copy of the episodic layer.
  Duplication across the two is the failure Council J already named.
- **Accuracy ties, cost/latency decide** (vendor-neutral same-harness
  runs: Mem0/Letta/Graphiti 64–70%, statistical tie; vendor 90%+ does
  not transfer). Judge v2 on pickup time + re-derivations avoided +
  tokens per recall — not on a QA score. Test on OUR 8-task pack, OUR
  model, OUR workload.
- **Abstention is a capability** (LongMemEval; B4 K7 3/3 explicit
  no-memory). "No record" and "no relevant record" are first-class
  outcomes. Never confabulate — the preview states absence too.
- **Knowledge updates need validity windows** (Graphiti's temporal
  edges; B4 K5 stale-safe 12/12 because the model checked the
  workspace). Staleness is COMPUTED from dependency movement, never
  clocked: Council J rejected time-expiry, and it was right.
- **Memory is an attack surface** (lifecycle survey; poisoning via
  write channels; injection–execution dissociation). Store facts,
  never instructions. Write channels stay own-session-only. Retrieval
  always shows provenance + grade so the READER judges — store ≠ act.
  B4's hostile-authority fences carry forward unchanged.
- **Files won for coding agents** (CLAUDE.md/AGENTS.md human-written;
  MEMORY.md agent-written, capped 200 lines / 25 KB, typed
  frontmatter). Meet the industry where it converged: project the
  live set to a capped file (see §5). The file is there even when the
  tool isn't installed — which answers "agents don't pick it up."
- **Small retrieval wins are measured, not vibes** (LongMemEval
  ablations: single-round granularity, key expansion +9.4%,
  time-aware expansion +6.8–11.3% on temporal). Apply all three to
  the voluntary-search fallback (§4).
- **Agentic organization, bounded** (A-Mem: links + evolutions, no
  fixed ops). Records link explicitly (`supersedes`, `falsifies`,
  `falsified-by`, `refines`) — authored, never autonomous. No agent
  rewrites another record without a supersede transaction.

## 2. Record types (typed, capped, graded)

Free-text kinds are retired. Five types, body cap 2 KB each:

| kind | holds | example |
|---|---|---|
| `gotcha` | host/tool trap, private | "PowerShell swallows git exit codes inside `if` — capture `$LASTEXITCODE` on the next line" |
| `decision` | choice + options + falsifier | "staged checking is the evidence path; kill if whole-66 goes valid" |
| `baseline` | suite, failure class, baseline SHA, last-verified SHA | A2's registry, first-class at last |
| `ask` | who owes whom what; superseded on receipt | "A2: 3-line re-pin" → superseded by the re-pin SHA |
| `brief` | distilled episode POINTER: what happened, where the full receipt lives (BM-ID/git-SHA), what to reuse | never a copy of the outbox |

Every record: `id`, `kind`, `title`, `body`, `sources[]`,
`grade` (TESTED / SOURCE-READ / INFERRED — the workshop's own
grades, now enforced at write time), `validity`
(`from`, `until` = superseded-or-dependency-moved),
`provenance` (author, session, model), `links[]`.
`evidenced` still requires caller + sources (B1 rule kept).
New: `grade=TESTED` requires a command + exit code in sources;
the CLI refuses TESTED without it.

## 3. Validity, not decay

No time-expiry, ever. A record goes stale exactly two ways, both
computed: superseded by a newer record, or a dependency SHA it names
no longer resolves to the recorded bytes. Stale records stay visible
with the flag on (B4 K5 proved models handle this correctly: verify
against the workspace, 0 false recall). Recency is a RANKING signal
only (the FadeMem reconciliation: decay for attention, never for
truth). Deletion does not exist; supersession does.

## 4. Recall = the D-path, productized

The B4 ACCEPT becomes the product, behind the already-agreed gate
(Phase-8 option C: event-driven, tightly bounded preview adapter,
disabled by default until separately accepted — that gate stands).

- At task pickup, match `task_scope` → inject top-N records within
  a token cap (≤1.5 KB) + the explicit absent-outcome. Deterministic
  prompt-word matching first (bypasses the AND-starvation that
  crippled voluntary search), FTS second.
- Voluntary search stays as fallback, fixed: OR-fallback on
  zero-hit (kill AND-starvation), key expansion (index facts pulled
  from chunks), time-aware expansion for temporal queries.
  Single-round granularity for episodic-adjacent content.
- Every injection carries provenance + grade + validity inline.
  The reader judges; nothing retrieved executes anything.

## 5. File projection

SQLite remains the engine (FTS, concurrency, supersede chains,
per-project DB under git-common-dir — B1 findings kept). On every
write, project the live non-superseded set per task-scope to
`MEMORY.md`-style capped files (200 lines / 25 KB cap, typed
sections mirroring §2). Versioned, diffable, human-readable,
readable with zero tooling. This is the adoption answer: the agent
that never calls the CLI still reads the file at pickup, because
pickup checklists already read files.

## 6. What is cut (and why)

- Free-text kinds → §2 schema (untyped recall is what nobody read).
- Auto-verification → nothing verifies itself, ever (B1 rule; the
  benchmark wars prove self-graded scores don't transfer).
- Daemon / polling / notifications → pull-only, like everything
  else in the workshop. Memory that taps you on the shoulder is a
  second alert system wearing a memory costume.
- Embeddings → FTS + structure + prompt-word matching. Our
  workload is small, exact, and SHA-bound; vectors add a server,
  a model bill, and approximate answers to exact questions.
- Cloud sync → local-first per project. Sync is a product, not a
  memory feature, and a poisoning-propagation channel (§1).

## 7. Trial (same discipline as B4, on B4's pack)

Same harness, same 8 tasks, D-preview vs v2-preview vs no-memory:
success = pickup time down + re-derivations down + zero false
recall + tokens/recall tracked. Failure = any of those flat or a
single fabricated recall. KEEP / MODIFY / REVERT after one
campaign. The disabled-by-default gate is lifted only by an
explicit accept of THESE numbers, not by the elegance of this doc.

## 8. First three records (seed the store by eating our own cooking)

1. `gotcha`: PowerShell exit-code swallowing (A3-073 + our T7).
2. `baseline`: `tests/test_c23_collections` 191-case STALE-baseline
   pattern (A2's registry shape, now native).
3. `ask`: A2 3-line re-pin → superseded by its SHA on landing
   (exercises the ask lifecycle end to end).

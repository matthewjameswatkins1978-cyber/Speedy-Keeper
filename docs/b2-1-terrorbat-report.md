# B2.1 Terrorbat assault report (mechanical hardening, NOT a live-model certificate)

Branch: `feat/b2-1-terrorbat-assault`. Harness: workshop `terrorbats.exe
0.2.0-rc.1` (installed docs describe 1.0.0-rc.1 — version drift noted),
`command.run` + `exit_code` oracle pattern reused from `bats/species`.
No Bat Feeder tool exists in the workshop; bats run directly via
`terrorbats run`. Evidence store: temp dir (default `%LOCALAPPDATA%`
untouched). All runs disposable DBs/sessions; no model calls, no inference
spend, no config changes, no global install. Formatting verdicts are
mechanical evidence only — they do not prove a live model resists injection.

## Bat attack matrix (9 bats, `bats/sk-*.yaml` + `bats/verifiers/*.mjs`)

Target commits: assault `f87fd28`, repaired `9681153`.
`--store` used for every run; replay commands in receipts.

| Bat | Pre-repair | Post-repair | Post receipt |
|---|---|---|---|
| sk-fence-delimiters | PROVEN exit 1 | exit 0 | `28dfbe37…` |
| sk-fence-taskscope | PROVEN exit 1 | exit 0 | `f0850376…` |
| sk-fence-forged-messages | completed (control) | exit 0 | `b64c4184…` |
| sk-budget-maxfields | PROVEN exit 1 | exit 0 | `5cb24fb1…` |
| sk-budget-tiny | completed (control) | exit 0 | `be38a3f9…` |
| sk-runtime-deps | PROVEN exit 1 | exit 0 | `32acb23a…` |
| sk-runtime-crash | completed (control) | exit 0 | `bdd3035e…` |
| sk-runtime-no-hooks | completed (control) | exit 0 | `ba878efc…` |
| sk-pi-operational | completed (control*) | exit 0 | `80545146…` |

Pre-repair PROVEN receipts: `ada92100…`, `5c5526b6…`, `e0a32691…`,
`40771782…`. (`*` pi-operational initially failed on harness mechanics —
`pi` needs `cmd /c` spawn — fixed in the verifier, not a product defect.)

`npm test` gates all 9 verifiers locally (`test/terrorbats.test.ts`,
exit 0 + `PASS: <id>` line asserted).

## Defects discovered and repairs (all minimal, all with regressions)

- **D1 fence escape** (delimiters + taskscope bats): stored
  `<<<begin/end-untrusted-memory>>>` markers were interpolated raw, so forged
  markers in titles/bodies/sources/task scopes produced extra model-visible
  fences. Repair (`src/pi/format.ts`): `escapeMarkers()` neutralises the exact
  marker heads (case-insensitive) in every attacker-controlled field before
  interpolation; escaped text stays inspectable (`<</<…`). The task scope is
  escaped before JSON-encoding into the opener line.
- **D2 budget overflow + mid-block cut** (`formatSearchResults`): the backstop
  sliced blindly at 4000 chars (lands mid-block) and the appended truncation
  note pushed the total to 4058. Repair: whole blocks accumulate only while
  they fit; trailing blocks are evicted to fit the omission note; total never
  exceeds the cap; degenerate budgets fall back to the formatter-owned
  preamble only. Untrusted blocks are never cut.
- **D3 raw busy throw** (adapter): contended writes threw raw SQLITE_BUSY
  after the full 5s default. Repair (`src/pi/adapter.ts`): optional
  `busyTimeoutMs` dep (default unchanged) and a structured `memory-busy`
  envelope (retryable) in both tools; readers demonstrably still serve under
  a held write lock.
- **D4 handle leak on failed open** (found via verifier cleanup EPERM):
  `KeeperStore` left the file handle open when pragmas/schema failed
  (corrupt/unreadable DB). Repair (`src/store.ts`): close-then-throw in the
  constructor. Matters for long-running Pi processes hitting bad files.

Regressions: `test/pi-hardening.test.ts` (D1/D2/D3 unit mirrors) + the 9
bats themselves. Controls (forged-messages fencing, tiny-budget envelope,
crash integrity, no-hooks proxy+scan, Pi operability) held before and after.

## Test totals and performance

- `tsc --noEmit` clean; `npm test`: **69/69 pass** (56 inherited + 9
  terrorbat runners + 4 hardening).
- Post-repair harness: 9/9 exit 0 with receipts above.
- Perf (this machine): tool search p50 3.4ms@200 / 3.74ms@2000 (≈640/714 est
  tokens), save p50 6.1/6.2ms, disabled 0.2ms, unavailable 0.7ms; cold CLI
  ~84–129ms; core search unchanged. No meaningful performance change.

## Remaining risks and next-gate recommendation

1. Mechanical fencing ≠ live-model resistance: a real model may still
   misread escaped markers or be socially engineered by fenced text. Requires
   the supervised live-model trial already gated in `docs/b2-isolation-report.md`.
2. Relevance at scale and pre-task query formulation still open (AND-query
   starvation observed in B2).
3. `ExtensionAPI` types remain local; re-verify on any Pi upgrade.
4. Bat env pins an absolute machine-local `SPEEDY_KEEPER_MODULES` path;
   replay elsewhere needs that variable repointed (documented in
   `bats/verifiers/_setup.mjs`).
5. Terrorbat binary vs docs version drift (0.2.0-rc.1 vs 1.0.0-rc.1).

**Recommendation:** accept B2.1 as mechanically hardened; next gate is the
spend-approved supervised live-model trial (shadow-first) from the B2
report. Still no production installation, still no automatic injection.

# Experiment A → B1: validated findings (carried forward)

> Note: the original Experiment A workpapers are not present in this
> checkout, so this summary reconstructs the validated findings from the B1
> mission requirements they produced. It contains no machine-private
> information — only the engineering decisions B1 implements.

1. **Project-local storage under Git's common directory.** One database per
   project at `<git-common-dir>/speedy-keeper/memory.sqlite`. Linked
   worktrees share the main checkout's memory; different repos never mix.
   Override only via an explicit path (`--db` / `SPEEDY_KEEPER_DB`), used by
   tests for isolation.
2. **Plain SQLite with WAL + busy timeout.** Native `node:sqlite`, no ORM.
   `journal_mode=WAL`, `busy_timeout≈5s`, `foreign_keys=ON`. Concurrent CLI /
   agent processes share one file: writers serialise, blocked writers get a
   diagnosable busy error instead of silent corruption.
3. **FTS5 kept correct with content-sync triggers.** `records_fts` mirrors
   `(title, body, task_scope)` via insert/delete/update triggers (delete +
   re-insert on update). User text is quoted into a safe `MATCH` query with
   prefix matching; unparseable input falls back to a bounded `LIKE` scan.
   Results are always bounded (default 20, cap 100).
4. **Supersede, don't mutate.** Corrections insert a new record and link the
   old one (`superseded_by`) inside one `BEGIN IMMEDIATE` transaction.
   Ordinary search hides superseded records; `get` by id and
   `--include-superseded` still reach them. A `revision` counter plus an
   optional expected-revision check gives optimistic-concurrency protection.
5. **Provisional by default; evidence is explicit, never inferred.** New
   records are `provisional`. `evidenced` is stored only when the caller says
   so *and* supplies at least one source. No code path auto-verifies.
6. **Secrets rejected, dumps refused.** High-signal patterns (private keys,
   `sk-`, `ghp_`/`github_pat_`, `AKIA`, `xox*`, `AIza`, password
   assignments, bearer tokens) abort the write with a named reason; bodies
   are capped (~8k chars) so raw tool output must be summarised with a source
   reference instead of pasted.
7. **Backup and export are first-class.** `VACUUM INTO` gives an online,
   SQLite-safe backup; `export` emits pretty-printed JSON of current (or all)
   records for inspection and portability.
8. **Tiny surface, structured output.** Library API is `save / get / search /
   supersede / backup / exportAll`. The CLI prints JSON envelopes, exits
   non-zero on error, and runs with plain `node` — no Pi dependency.

# Workshop seed records (v2 §8) — plant with the commands below, then verify.

Run these once per project database. Each is graded; none is provisional
filler. Supersede (never edit) when the world moves.

## 1. gotcha — PowerShell exit codes (TESTED)

```sh
keeper save --kind gotcha \
  --title "PowerShell swallows git exit codes inside if" \
  --body "Capture $LASTEXITCODE on the line immediately after the git call. A direct if (git ...) check reported a real SHA absent." \
  --task windows --grade SOURCE-READ --sources "pep.ps1"
```

## 2. baseline — collections suite (SOURCE-READ)

```sh
keeper save --kind baseline \
  --title "test_c23_collections: 191 subtests STEP_LIMIT, baseline-identical at ea0bc9a" \
  --body "Do not re-run the 47-minute suite to prove non-regression on unchanged source. Re-run once before any merge decision." \
  --task pepin --grade SOURCE-READ --sources "tests/test_c23_collections.py"
```

## 3. ask — A2 re-pin (lifecycle demo: supersede on landing)

```sh
keeper save --kind ask \
  --title "A2: land the 3-line 727f8af re-pin on your own branch" \
  --body "Pin A1_SHA, fetch pep_chunk_contract.py in prepare(), stamp duplicate_fact. Then re-run probe + 12 negatives and publish SHA." \
  --task pepin --grade INFERRED
# On landing:
# keeper supersede --id <id> --kind brief --title "A2 re-pin landed at <SHA>" --body "Probe exit 0 ..." --task pepin
```

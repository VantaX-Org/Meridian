# Sample data — DQS test fixtures

`business_partner` extracts for exercising the upload → analysis pipeline. Every
score below was verified against the live check engine (`checks/runner.py`) and
DQS scorer (`api/services/scoring.py`).

| File | Rows | DQS | Purpose |
|------|------|-----|---------|
| `business-partner-clean.csv`        | 8   | **100.0** | Minimal clean extract |
| `business-partner-mixed.csv`        | 12  | **50.0**  | Minimal 50/50 extract |
| `business-partner-200-clean.xlsx`   | 200 | **100.0** | Full pass |
| `business-partner-200-1error.xlsx`  | 200 | **70.0**  | 199 valid + 1 broken row |
| `business-partner-200-allbad.xlsx`  | 200 | **13.7**  | Every row broken |

## How to use

1. Open **Import** (`/upload`) and drop a file.
2. It detects as **Business Partner** (headers are canonical `BUT000.*` /
   `BUT100.*` / `ADRC.*` / `ADR6.*` field names). If detection is ambiguous,
   pick `business_partner` from the module selector.
3. Run the import — the version lands on the DQS above.

## Notes on the scores

DQS = `0.25·Completeness + 0.25·Accuracy + 0.20·Consistency + 0.10·Timeliness
+ 0.10·Uniqueness + 0.10·Validity`, each dimension being the mean pass-rate of
its checks. **One critical-severity check failure caps DQS at 85; two or more
cap it at 70.**

- **200-clean** — every field valid → all 42 applicable checks pass → 100.
- **200-1error** — only row 200 is broken, so each dimension is ~99.5%. But that
  one row trips **4 critical checks**, so the critical-failure cap pulls the
  final DQS down to **70**. This is the case that proves the cap works — the
  Findings list points straight at row 200.
- **200-allbad** — every row violates every dimension, landing at **13.7**.
  It is not 0 because a handful of checks can't be tripped by uniform bad data:
  e.g. an invalid-but-present key still satisfies the *not-null* check, and the
  conditional cross-field rules (BP025/BP026) only fire for specific partner
  categories.

`TITLE_KEY` is intentionally excluded from every file — `pandas` strips the
leading zero from codes like `0001`, which would falsely fail its domain check.

## Regenerating

The three Excel files are produced by `generate_xlsx.py`:

```
python sample-data/generate_xlsx.py
```

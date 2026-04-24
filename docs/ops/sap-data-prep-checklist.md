# Customer SAP data prep — pilot checklist

_For the customer's SAP team, before the first real extract. Short; one page; it's a checklist not a book._

## What Meridian needs to see

Meridian runs its deterministic checks against **extracts** — a set of tables pulled from your SAP system into our pipeline. For a pilot we start narrow (one module) and expand once the signal is clean.

## 1. Module selection

Pick ONE module for the first pilot extract. Recommended starting points:

- **Business Partner** (`BUT000`, `ADR6`, …) — widely-audited, findings translate to action
- **Material Master** (`MARA`, `MARC`, `MBEW`, …) — good signal on Z-fields vs standard
- **FI GL** (`SKA1`, `SKB1`, `BSEG`, …) — narrower but high-impact

Avoid starting with modules that have heavy cross-module dependencies (PP, PM) — those benefit from a baseline analysis first.

## 2. Extraction method

Depending on your system and access:

| Method | When to use | Caveats |
|---|---|---|
| **Native Meridian connector (OData / RFC)** | S/4HC, SF, Concur, Ariba; any ECC with PyRFC gateway | Live connection; read-only credentials recommended |
| **CSV upload** | Airgapped environments; one-off evaluation | Must match the column map for the module (see below) |
| **XLSX upload** | Anything the customer exported from SAP GUI directly | Large files slow the parser; CSV preferred |

Maximum file size: **100 MB per module per upload**. If your extract is bigger, split by time range or by organisational unit.

## 3. Required + optional columns

For each module, Meridian has a "standard" column map. Your extract should produce those column names (either directly, or via a custom mapping we configure during onboarding).

Full maps are in `api/services/column_mapper.py`. For Business Partner the minimum set is:

| Required | Optional |
|---|---|
| `PARTNER`, `BU_TYPE`, `NAME1`, `CREATED_ON` | `NAME2`, `TITLE_KEY`, `COUNTRY`, `CITY`, `EMAIL`, `TAX_ID`, `ZZSEGMENT`, `ZZRISK_SCORE`, any `ZZ*` or `Z*` field |

If you have Z-fields (customer-namespace columns), leave them in — the pipeline detects them as "custom" and runs a second pass tuned to your schema. Don't strip them.

## 4. Data hygiene before extract

- [ ] **Encoding**: export as UTF-8 if at all possible. Latin-1 and Shift-JIS work but produce mojibake warnings we'd rather not confuse with real findings.
- [ ] **Line endings**: CRLF or LF both fine.
- [ ] **Decimal separator**: period `.` (not comma). Check your SAP user profile.
- [ ] **Date format**: ISO (`YYYY-MM-DD`) preferred. SAP's `YYYYMMDD` works but dates like `00000000` will trip the date check — fine, that's what we're looking for.
- [ ] **Null representation**: blank cell or literal `NULL`. Don't insert "N/A" or "-" — those register as strings.

## 5. Sample before full

Before a 400k-row extract, send us a **1,000-row sample** by the same export path. We'll run it through the pipeline and confirm:
- The column map matches your headers
- The check rules are producing interpretable findings
- No encoding / parse issues

This costs a day and saves a week if something's off.

## 6. What the pilot report will tell you

Typical first-pilot findings on a healthy SAP system:

- 2–8% of master records have at least one field-level completeness gap
- 0.5–3% of Z-field entries don't match our baseline reference values
- Under 1% duplicate records across key-field combinations
- A small, consistent set of check IDs dominate — those are the operational patterns to triage first

Anything outside those bands is either (a) a real data quality problem worth your attention, or (b) a tuning issue we solve with field-mapping config. Usually both.

## 7. Questions we'll ask you in week 1

- What SAP version / patch level?
- Any custom namespace (Y* or Z*) you want us to treat as first-class?
- Do you have a "golden" reference tenant, or are we building the baseline from this extract?
- What's your decision-making forum for acting on findings? (Informs how we shape the report narrative)

## 8. Sign-off

- [ ] Extract produced and matches format above
- [ ] 1,000-row sample reviewed with Meridian engineer
- [ ] Full extract uploaded
- [ ] Report reviewed with your stakeholder
- [ ] Rule tuning captured for subsequent extracts

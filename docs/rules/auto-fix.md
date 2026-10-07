# Auto-fix: deterministic cleansing proposals

A rule can carry an `auto_fix` block. For every failing record the engine
(`checks/auto_fix.py`) computes a corrected value, re-runs the rule on the
corrected record and keeps the proposal only if the record then passes.
`fix_map` and `record_fix_template` stay mandatory: they explain the fix to a
person; `auto_fix` computes it.

```yaml
- id: GL214
  field: SKB1.WAERS
  ...
  auto_fix:
    when: T001.WAERS.notna()        # optional guard, df.eval syntax; bare TABLE.FIELD is fine
    steps:                          # run in order on the rule's field value
      - op: copy
        from: T001.WAERS
    confidence: medium              # high | medium | low
```

## Ops

| op | parameters | result |
|----|------------|--------|
| `strip`, `collapse_spaces`, `upper`, `lower`, `title` | none | text clean-up |
| `pad_left` | `width`, `char` (default `0`) | `4711` to `0000004711` |
| `strip_leading_zeros` | none | `000123` to `123` |
| `regex_replace` | `pattern`, `repl` | Python `re.sub` |
| `truncate` | `width` | first `width` characters |
| `map` | `values` (`__blank__`, `__other__` allowed; `null` = no proposal) | mapped value |
| `set` | `value` | constant |
| `copy` | `from` (TABLE.FIELD of the same record) | another field's value |
| `lookup` | `table`, `match: {LOOKUP_FIELD: REC.COL}`, `value` | the reference table's `value` field for the one matching row (none or several matches: no proposal) |
| `date_format` | `to` (strftime) | parses SAP, ISO, dotted, slashed and SuccessFactors `/Date(ms)/` dates |
| `gtin_check_digit` | none | GTIN/EAN with its GS1 check digit recomputed |

A step that returns nothing (unmapped value, unparsable date, absent lookup)
or blanks a non-blank value stops the pipeline: no proposal. A result equal to
the current value is not a proposal either.

The legacy `fix_value` (a value or a map) is shorthand for one `set` / `map`
step with confidence `medium`. A rule has `auto_fix` or `fix_value`, never both.
An unknown op, parameter or key is a validation error
(`tests/checks/test_auto_fix_schema.py` validates every shipped rule).

## Where proposals go

- **Findings**: `record_fixes` entries with `auto_fix: true` carry
  `proposed_value`, `confidence`, `record_key`, `field` and an `UPDATE` built
  from those structured values only (never from instruction text). At most
  10,000 proposals per rule per run. Sensitive fields get no proposal.
- **Fix simulation** uses the same proposals.
- **Remediation batches** are pre-filled with verified proposals and their
  confidence. High-confidence rule proposals are flagged `auto_approvable`;
  `POST /api/v1/remediation/batches/{id}/accept-high-confidence` accepts them in
  one go. Four eyes: the batch creator cannot call it.
- **Write-back** only takes structured auto_fix proposals and builds BAPI
  parameters from table, field, key and value. Fields without a verified BAPI
  mapping are refused with an error; load them through a remediation export.

## Confidence

- `high`: mechanical and unambiguous (formatting, a flag the rule itself
  requires). Safe to bulk-accept.
- `medium`: right in almost all cases but a person should glance at it
  (copying a reference value, legacy `fix_value`).
- `low`: a starting point for the steward.

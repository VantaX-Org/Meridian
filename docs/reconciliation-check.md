# The reconciliation check

`reconciliation_check` compares a total in one table against a total in another. It exists
because nothing else in the library can, and that is the reason the finance packs carry only a
handful of accuracy rules.

## Why the other classes cannot do this

| class | what it compares |
|---|---|
| `cross_field_check` | columns of **one row** |
| `referential_check` / `domain_value_check` | one value against a **code list** |
| `exists_check` | one row's key against **rows in another table** |
| `aggregate_check` | two totals **within one table** (split by a field, signed by another) |
| **`reconciliation_check`** | **one table's total against another table's total** |

An open item whose value is wrong is not wrong on its own row. It is wrong relative to the
general ledger, to the purchase order it came from, or to the control total of the load that
produced it. `AP073`/`AP206`/`AP285` already cover the internal arithmetic of a single item
(both amounts zero, one zero, sign); everything beyond that needs a second table.

## Writing one

```yaml
- id: AP290
  field: BSIK.DMBTR              # the column summed in this table
  check_class: reconciliation_check
  target_table: BSEG             # the table whose total it must agree with
  target_field: DMBTR            # the column summed there
  target_when:                   # optional filter on the target rows
    BSEG.BUKRS: ["1000"]
  tolerance: 0.01                # default 0.01
  severity: high
  dimension: accuracy
```

The whole population is one group: it fails when the two totals differ by more than
`tolerance`, and **every** row carries the finding - a reconciliation can say that the total
disagrees, not which row is wrong.

## Two properties that matter more than the arithmetic

**A partial target is never judged.** If `target_table` was not read in full - an incomplete,
windowed or scoped download - the rule is returned unevaluated with a reason, exactly as
`exists_check` refuses to. A total computed over a partial target is not a reconciliation, it is
a false difference, and a false "your sub-ledger does not agree" is worse than no check at all.
`reconciliation_check` is in `_WHOLE_GROUP` for the same reason.

**No result is never a pass.** If the runner cannot resolve the target - missing table, missing
column, no `_target_total` - the check condemns nothing and records `skipped: target total
unavailable` in its details. An earlier version accepted a `sign_field` and in that mode
returned no result at all, which reads as a passing reconciliation; the option was removed
rather than left half-working. A rule needing debits positive and credits negative should sum a
field that already carries the sign, or be written as an `aggregate_check` over one table.

## Status

The class is built, registered and unit-tested (`tests/checks/test_reconciliation_check.py`, 7
cases covering equal totals, a difference beyond and within tolerance, the three refusals, and
the no-target path).

**No shipped rule uses it yet.** That is deliberate: a reconciliation needs a target table that
a deployment actually extracts and reads in full, and on this tenant the candidate pairs
(sub-ledger against G/L, goods-receipt accrual against its clearing account) have not been
verified end to end against a real run. Writing rules that resolve to nothing would raise the
rule count and change no client outcome - the failure mode this repository has already been
cleaned of twice.

The next step is to pick one pair, confirm both tables are extracted in full, and add the first
rule with a golden fixture that seeds a difference.

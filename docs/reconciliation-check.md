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

## Status, and the measured reason there is no rule yet

The class is built, registered and unit-tested (`tests/checks/test_reconciliation_check.py`, 7
cases covering equal totals, a difference beyond and within tolerance, the three refusals, and
the no-target path).

**No shipped rule uses it, and the check that round 18's note asked for shows why.** I ran the
verification it required - confirm both tables are planned *and read in full* - against the
extraction plan for every module (491 tables planned, **446 read in full**):

| candidate | read in full? |
|---|---|
| `BSIK` (open vendor items) | **yes** (`partial=False`) |
| `BSID` (open customer items) | **yes** |
| `BSEG` (G/L line items) | **no** - `partial=True`, keyed via `BKPF` |
| `BKPF` (document header) | **no** - `partial=True`, windowed |
| `BSAK` (cleared vendor items) | **no** - `partial=True`, windowed |

So the reconciliation a finance close actually wants - the sub-ledger against the general
ledger - **cannot be evaluated on this deployment at all**, because the G/L side is a windowed
read and `reconciliation_check` refuses a partial target by design. It would return "not
evaluated: BSEG was not read in full" on every run. That is the correct behaviour and it is not
a rule that can be written.

The pairs that *are* both full reads do not reconcile with each other. Scanning all full-read
tables for a shared amount column gives 10 candidate pairs; the finance one is `BSIK` against
`BSID`, which are open payables and open receivables - two different sides of the balance sheet,
with no reason to be equal - and the rest are `MENGE` coincidences between purchasing tables
(`ANLA`/`STPO`/`EKAB`/`EKKN`), a bill of materials, a release-order table and account
assignments, none of which carry a control total another of them holds.

**What the first rule therefore needs**, in order of preference:

1. A target the extractor reads in full that carries a total the source must equal - which for
   the sub-ledger/GL case means changing `BSEG` from a windowed read to a full read. That is a
   client-facing decision about extract size, not a rule.
2. Or a reconciliation between two tables that are *both* already full reads and genuinely
   should agree - a control-total-to-detail pair inside one module. None surfaced in the scan
   above, but the scan only looked at shared column *names*; a real pair may use a different
   column on each side, which `field`/`target_field` supports.

Until one of those exists, a rule written here would resolve to the "not evaluated" path, raise
the rule count and change no client outcome - the failure mode this library has already been
cleaned of twice.

# Depth parity: what the measurement actually says

The objective is "every in-scope object at rule-depth parity with material_master". Measured
on the current library, that target needs redefining before more rules are written, because
material_master's lead is **scope, not depth**.

## The measurement

| object | sys | rules | check classes | tables | **rules/table** | fields | rules/field |
|---|---|---|---|---|---|---|---|
| material_master | ecc | 885 | 12 | **45** | 19.7 | 724 | 1.22 |
| employee_central | sf | 472 | 11 | 30 | 15.7 | 222 | 2.13 |
| payroll_integration | sf | 359 | 9 | 24 | 15.0 | 215 | 1.67 |
| business_partner | ecc | 283 | 9 | 23 | 12.3 | 249 | 1.14 |
| accounts_payable | ecc | 255 | 9 | 28 | **9.1** | 229 | 1.11 |
| fi_gl | ecc | 241 | 8 | 25 | **9.6** | 230 | 1.05 |
| accounts_receivable | ecc | 236 | 9 | 24 | 9.8 | 221 | 1.07 |
| compensation | sf | 219 | 10 | 15 | 14.6 | 82 | 2.67 |
| benefits | sf | 98 | 9 | 5 | 19.6 | 31 | 3.16 |
| performance_goals | sf | 82 | 9 | 3 | **27.3** | 38 | 2.16 |
| recruiting_onboarding | sf | 82 | 7 | 7 | 11.7 | 49 | 1.67 |
| time_attendance | sf | 82 | 8 | 2 | **41.0** | 37 | 2.22 |
| succession_planning | sf | 81 | 7 | 3 | 27.0 | 34 | 2.38 |
| learning_management | sf | 81 | 7 | 3 | 27.0 | 32 | 2.53 |

material_master has 885 rules because it spans 45 tables — the widest scope in the library.
Normalised by the tables an object actually owns, several of the objects called "thin" are
**1.4x to 2x denser than the baseline**:

- `time_attendance` 41.0 rules/table, `performance_goals` 27.3, `learning_management` 27.0 and
  `succession_planning` 27.0 against material_master's 19.7;
- `compensation` 14.6 and `employee_central` 15.7 on far fewer tables.

The objects genuinely below the baseline per table are the ECC finance and master-data packs:
`accounts_payable` 9.1, `fi_gl` 9.6, `accounts_receivable` 9.8, `business_partner` 12.3.

## What that means for the objective

"Parity with material_master" cannot be satisfied by writing rules, because the difference is
how many tables each object covers:

- To reach 885 rules, `accounts_payable` would need ~630 more rules across the 28 tables it
  owns — about 22 per table — which is not depth, it is padding.
- The four SF objects at 81-82 rules already exceed the baseline's density. Their shortfall is
  in **dimension spread** (7-9 check classes against 12) and in **which objects the tenant
  serves at all**, not in how thoroughly their own tables are checked.

So the honest statement of the remaining gap is narrower and more useful than the rule count:

1. **Dimension thinness in the ECC finance packs.** `accounts_payable` has 2 accuracy rules,
   `fi_gl` 2 uniqueness and 2 timeliness, `accounts_receivable` 2 accuracy,
   `business_partner` 6 accuracy — against 23-28 tables each. This is the real, closeable gap
   and it is where the recent rules went (`GL260`, `AP285/286`, `AR267/268/269`).
2. **Objects the tenant cannot serve.** `learning_management` (0 of 29 canonical sources
   resolvable), `benefits`, `payroll_integration`, `time_attendance`, and
   `succession_planning` (blocked on a 403 for `Successor`). No rule added to these changes
   what the client sees; the rules exist and do not evaluate.

## The recommendation

Redefine the acceptance criterion from "rule count parity with material_master" to the two
things that can actually be measured and delivered:

- **per-object dimension spread**: every in-scope object covers the DQ dimensions its own data
  admits, with no dimension below a floor (currently 8 rules), rather than matching another
  object's total;
- **the served-data fraction**: for each object, the share of rules that actually evaluate
  against the tenant, with the unserved remainder named per object (which
  `docs/successfactors-parity.md` now does entity by entity).

That is a criterion the deployment manager can sign off, and it does not require inventing 600
rules to match a table count.

## Correction: a per-dimension floor does not work either

The first version of this document recommended "no dimension below a floor". Measuring the
floor across the 14 in-scope objects kills that proposal too:

| dimension | minimum across the 14 | which object |
|---|---|---|
| completeness | 16 | benefits |
| accuracy | **0** | succession_planning |
| consistency | 20 | time_attendance |
| validity | 9 | recruiting_onboarding |
| uniqueness | **2** | learning_management, time_attendance |
| timeliness | **1** | compensation |
| lifecycle | **0** | business_partner, accounts_payable, accounts_receivable |
| freshness | **0** | business_partner, accounts_payable, accounts_receivable |

**Every one of the 14 objects fails a floor of 5, and every one fails a floor of 3** - including
material_master, whose own timeliness is 3 and freshness 2. A criterion the baseline cannot meet
is not a criterion.

Two of those rows are not gaps at all:

- `lifecycle` and `freshness` are not DQS scoring dimensions. `api/services/scoring.py` scores
  six (completeness, accuracy, consistency, timeliness, uniqueness, validity); lifecycle and
  freshness are tags a few rules carry. material_master has 25 lifecycle rules and
  accounts_payable none, yet both score the same dimensions. An empty lifecycle column is
  invisible to the client's score.
- `accuracy` is 0 for succession_planning because the 403 on `Successor` blocks the entity its
  accuracy rules would read. That is the permission, not the rule set.

What is left, once those are excluded, is a small and specific list - and it is the *scored*
dimensions on the objects the tenant actually serves:

| object | scored dimension below 5 | can it be closed? |
|---|---|---|
| business_partner | accuracy 6 | yes |
| accounts_payable | accuracy 4 | yes |
| accounts_receivable | accuracy 4 | yes |
| fi_gl | accuracy 4, uniqueness 3, timeliness 4 | partly (uniqueness on a journal is only meaningful at document grain) |
| compensation | timeliness 1 | yes |
| the five unserved SF objects | several | no - the tenant serves no data |

So the honest criterion is narrower than either "rule count parity" or "a floor in every
dimension": **every scored dimension of every served object carries rules the tenant can
evaluate.** That is measurable against a real run, and `docs/successfactors-parity.md` already
records which canonical sources each SF object cannot resolve.

## Why the thinnest cells cannot be filled with more field checks

`accounts_payable` accuracy sat at 4 while material_master has 47, and I spent three rounds
looking for rules to close it. Seven candidates were examined and each turned out to be either
already covered, a duplicate, or not an accuracy check at all. The conclusion is not that the
search was lazy - it is that the cell is already at the limit of what a single-record check can
express:

* **A wrong amount is wrong relative to something else.** An open item whose value is overstated
  is only detectable against the G/L balance for the same reconciliation account, or against the
  purchase order it was posted from. `AP073`/`AP206`/`AP285` already cover the internal
  arithmetic (both amounts zero, one zero, or a negative sign); what remains needs a second
  table, which is a different kind of check from `cross_field_check` on one row.
* **Reference checks are `validity`, not accuracy.** `BSIK.BLART` against T003 and
  `BSIK.WAERS` against TCURC check that a code exists, so they land in validity (that is what
  the new `AP287` does, and what `GL029` does for the same field on the header). Adding them
  does not move the accuracy count.
* **The obvious candidates were taken.** Payment terms against T052, special G/L indicator
  against T074U, clearing data on an open item, the discount-day ordering and the translation
  directions all already have rules (`AP036`/`AP042`/`AP079`/`AP080`/`AP072`/`AP078`).

So the honest statement is that the accuracy cell for the finance objects is bounded by the
check classes the library has, and closing it would need a class that compares an object
against an outside total - a reconciliation check. That is a real piece of work with its own
design, not a matter of writing more rules of the kinds that exist.

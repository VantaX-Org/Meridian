# Rule depth and the rule ↔ dictionary reconciliations

Two independent things keep the rule set honest, and both had drifted:

1. `checks/rule_reconciler.py` reconciles the rule packs against the **curated**
   dictionary in `sap/data_dictionary.py` — domain values (`domain_value_check`
   `allowed_values` vs the dictionary's `valid_values`) and mandatory-field
   coverage (a dictionary field marked `mandatory` with no `null_check`, or no
   closed `domain_value_check`, holding it to a defined set).
2. The curated dictionary must itself describe fields that **exist**. It is a
   second, hand-maintained description of the same SAP fields as the shipped
   DDIC bundle (`sap/dictionaries/`, read through `sap/ddic.py`), and nothing
   checked the two agreed.

## What was wrong

The curated dictionary had rotted. It declared **2 tables** the DDIC bundle does
not contain (`GRACRISK`, `MCH7`) and **23 fields** no SAP table has — either a
stale spelling of a field on the same table (`BUT000.BU_TYPE` where SAP says
`BUT000.TYPE`) or a field that belongs to a different table that the platform
never reads (`LFA1.BANKN` lives on LFBK, `EQUI.EQKTX` on EQKT, `MARC.LGORT` on
MARD, `KNB1.KLIMK` on KNKK).

Because the reconciler treats every curated entry as something the rule set must
judge, those phantom entries produced **mandatory-field "coverage gaps" that
could never be closed**: adding a rule for them would name a field the DDIC test
rejects. Of the 15 gaps the reconciler reported, **9 were phantom** and only 6
were real.

## The repair

* `sap/data_dictionary.py` — removed the 2 phantom tables and the 22 field
  entries that do not resolve; renamed `BUT000.BU_TYPE` → `BUT000.TYPE` and
  `GRACUSERROLE.ROLENAME` → `GRACUSERROLE.ROLE_ID` in place, keeping their
  metadata. The curated dictionary is now 31 tables / 193 fields, all of which
  resolve in the shipped bundle.
* `tests/checks/test_rule_integrity.py` —
  `test_curated_dictionary_references_only_real_dictionary_fields` pins the
  invariant so the catalogue cannot rot again.
* The 6 real gaps were closed with rules (`MM887` `MARC.WERKS`, `BP296`
  `BUT100.RLTYP`, `PUR417` `EKKO.EBELN`, `PUR418` `EKKO.LIFNR`, `PUR419`
  `EKPO.EBELP`, `GRC042` `GRACUSERROLE.ROLE_ID`).

`python -m checks.rule_reconciler` now reports **0 value drift and 0 coverage
gaps**.

## Depth per object

A pack can hold hundreds of rules and still judge nothing in a dimension. The
measure that matters is **module × DQS dimension**: how many rules of each
dimension a module actually carries.

`integrity` and `conformity` are empty for *every* module because no rule in the
library uses those two dimensions — they are defined in the DQS model and not
yet populated by any check class. They are **not** per-object gaps and this work
does not invent rules to fill them.

The real gap was `accuracy`, `uniqueness` and `timeliness`:

| dimensions | before | after |
|---|---|---|
| `completeness`, `consistency`, `validity` | covered everywhere | covered everywhere |
| `accuracy` / `uniqueness` / `timeliness` empty cells | 22 | 4 |
| same, thin cells (1–4 rules) | 71 | 88 |
| `integrity` / `conformity` | 86 structural empties | unchanged |
| modules under 50 rules | 9 (`ariba_spend` 10 … `ariba_contracts` 44) | 9 (`ariba_spend` 12 … `ariba_contracts` 44) |

26 rules were added to close empty `accuracy` / `uniqueness` / `timeliness`
cells and lift the thin modules. Every one is proven: the rule fails at least one
record and passes at least one (`tests/checks/test_rule_proofs.py`). The
"thin" count rises because cells that were empty now hold 1–4 rules: those cells
moved out of the broken column, they did not regress.

| module | new rules |
|---|---|
| `batch_management` | `BATCH041` uniqueness, `BATCH042` timeliness |
| `ewms_stock` | `EWMS142` uniqueness |
| `ewms_transfer_orders` | `EWMSTO152` uniqueness |
| `mdg_master_data` | `MDG052` uniqueness |
| `wm_interface` | `WMI060` uniqueness, `WMI061` accuracy, `WMI062` timeliness |
| `sd_customer_master` | `SDCM099` accuracy, `SDCM100` timeliness |
| `controlling` | `CO126` accuracy, `CO127` timeliness |
| `banking_tax` | `BKT108` accuracy |
| `interface_health` | `IDH051` uniqueness, `IDH052` accuracy, `IDH053` timeliness |
| `s4hc_master_data` | `S4HC042` accuracy, `S4HC043` timeliness |
| `concur_users` | `CNU042` uniqueness |
| `succession_planning` | `SUCC081` uniqueness |
| `ariba_supplier` | `ARS041` uniqueness, `ARS042` accuracy |
| `ariba_procurement` | `ARP043` timeliness |
| `ariba_spend` | `ARSP011` timeliness, `ARSP012` uniqueness |
| `concur_travel` | `CTR014` timeliness, `CTR015` accuracy |

### Three rules the golden sets made us correct

The golden datasets judge clean records as clean, so they catch a rule that
condemns valid data. Three first drafts failed them and were changed rather than
forced:

* **`BP296`** — written as a `null_check` on `BUT100.RLTYP`. `is_blank()` reads
  six zeros as an SAP initial value, and `000000` *is* the general
  business-partner role, so the rule condemned every partner that carries it. It
  is now a `domain_value_check` on the defined role set, which catches a wrong
  role without calling the general role blank. `coverage_gaps()` in
  `checks/rule_reconciler.py` now counts a closed `domain_value_check` as
  coverage for exactly this reason.
* **`PUR418`** (a `null_check` on `EKKO.LIFNR`) — removed. The golden set holds a
  purchasing document with no vendor and `BSTYP = F`, which the pack's own
  presence rules already treat as legitimate. The real defect was the curated
  dictionary marking `EKKO.LIFNR` unconditionally `mandatory`; the pack scopes
  every `EKKO.LIFNR` check to the document types that require a vendor.
* **`SDCM100`** — written as a three-year freshness check on `KNVV.ERDAT`, which
  flagged most of the golden population. A master record's creation date has no
  operational shelf life. It is now the unambiguous check: a creation date in the
  future.

## What remains, and why

Four cells are still empty, and each is empty for a reason that adding rules
cannot fix:

| cell | why it cannot be filled soundly |
|---|---|
| `concur_users` accuracy | `CONCUR_USER` carries `EMPLOYEE_ID`, but no HR master entity is extracted for Concur to check it against. An `exists_check` against `CONCUR_USER` itself is self-referential and cannot fail. |
| `concur_users` timeliness | The `CONCUR_USER` entity has no date or timestamp field. There is nothing to age. |
| `s4hc_master_data` uniqueness | The CVI link tables are keyed by `PARTNER_GUID`; the only duplicates that occur are handled by the existing partner-level uniqueness rules. |
| `succession_planning` accuracy | `SUCCESSIONCANDIDATE` has no reference table in the extracted model to check a value against. |

Filling these would mean writing a rule that either cannot fail or condemns every
record — which the proof harness rejects, correctly. The honest answer is that
these are data-model gaps (a missing source entity, a missing timestamp), not
rule gaps.

## Reproducing the numbers

```bash
python -m checks.rule_reconciler                      # drift + coverage gaps
python scripts/generate_ddic_rules.py --report         # DDIC derivation scope
python scripts/generate_ddic_rules.py --check          # generated sidecars are current
python -m pytest tests/checks/test_rule_integrity.py \
                 tests/checks/test_rule_proofs.py \
                 tests/golden -q
```

The module × dimension audit is a few lines against `checks.runner.module_rules`;
the counts in this document come from `MODULES_BY_SYSTEM` in
`sap/extraction_plan.py`, which covers 43 modules. Two packs
(`cross_system_integration`, `ztables_common`) are deliberately not reachable
from that mapping, so the 43-module audit total is 41 rules lower than the file
count.

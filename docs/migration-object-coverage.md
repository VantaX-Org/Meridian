# Migration object coverage — ECC → S/4HANA

What Meridian covers today, what it does not, and why. Written to answer one question
defensibly: *do we have all the objects a typical ECC→S/4HANA programme needs?*

**Short answer: no.** Coverage is broad across the standard ECC estate, but it is not
the complete SAP migration-object catalogue, and it is uneven — `material_master` alone
carries 19% of all rules.

## Covered — 28 ECC objects

Each is a module with its own rule pack in `checks/rules/ecc/`, and every rule is proved
by `tests/checks/test_rule_proofs.py` (a rule that cannot fail, or cannot pass, fails the
build).

| object | rules | object | rules |
|---|---|---|---|
| material_master | 679 | accounting_receivable | 150 |
| production_planning | 278 | fi_gl | 133 |
| mm_purchasing | 264 | quality_management | 133 |
| plant_maintenance | 238 | hcm | 117 |
| sd_sales_orders | 208 | s4_readiness | 110 |
| accounts_payable | 185 | controlling | 102 |
| project_system | 165 | asset_accounting | 100 |
| business_partner | 155 | banking_tax | 91 |
| **deliveries_billing** | **89** | ewms_stock | 74 |
| **internal_orders** | **89** | ewms_transfer_orders | 53 |
| interface_health | 53 | sd_customer_master | 100 |
| fleet_management | 49 | transport_management | 48 |
| wm_interface | 44 | mdg_master_data | 41 |
| grc_compliance | 41 | batch_management | 37 |

The same registry serves **S/4HANA on-premise** (27), **S/4HANA Cloud** (18), **EWM** (5),
**SuccessFactors** (9), **Concur** (3), **Ariba** (4).

## Added for the ECC→S/4 gap

* **`deliveries_billing`** — LIKP, LIPS, VBRK, VBRP. Deliveries and billing documents are a
  standard migration object and had no module at all. **89 rules** across all six dimensions:
  mandatory keys, key format, duplicate document numbers, negative weights/volumes/quantities,
  missing material or plant on items, inverted and future dates, domain values on document
  categories and posting periods, and referential integrity to MARA, KNA1 and TVKO.
* **`internal_orders`** — AUFK, AFKO. CO internal orders and order headers. **89 rules** across
  all six dimensions: order number/type/category/company code/controlling area, duplicate order
  numbers, planned, actual, confirmed and forecast schedules inverted, negative order/scrap
  quantities, missing CO object number, task-list and BOM references, status flags, and
  referential integrity to T001, TKA01, CSKS and MARA.

Both are at parity with their peers on **dimension spread** — the criterion chosen for this
programme: completeness, accuracy, consistency, validity, uniqueness and timeliness all carry
rules, rather than matching the rule count of `material_master` (679).

## Still missing

| object | why it is not there |
|---|---|
| **Product costing** (KEKO, KEPH, CKIS) | not in the data dictionary — needs table definitions first |
| **COPA / profitability analysis** (CE1–CE4) | the CE* tables are generated per installation and not in the dictionary |
| **RE-FX / real estate** (VICNCN, VIOB*) | not in the dictionary |
| **Treasury / cash management** | only T012/T012K are in the dictionary; FEBKO/FEBEP are not |
| **ECC payroll results** (RGDIR, PAYR) | cluster tables; only T512W/T549A are available |
| **Capacity** (KBKO) | partially available (KAKO, CRHD) |


`batch_management` (37) and the EWM modules (44–74) are also thin relative to
`material_master`, so they are covered rather than deep.

## How to close a gap

1. Add the table definitions to `sap/data_dictionary.py` (fields, keys, types, check refs).
2. Add a pack at `checks/rules/ecc/<object>.yaml` with `module` and `target_state`.
3. Register the module in `sap/extraction_plan.py::_ECC`.
4. Every rule must be **proven** by the proof harness, and `python -m checks.rule_reconciler`
   must stay CLEAN — both are enforced by the test suite.

The proof gate is what keeps this honest: a rule that cannot fail on a record, or cannot
pass on one, fails the build rather than shipping as decoration.

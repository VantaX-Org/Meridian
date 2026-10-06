# Quality management, project system and business partner depth rules

This pass adds 112 rules: 55 to `quality_management` (QM079-QM133), 35 to `project_system` (PS081-PS115) and 22 to
`business_partner` (BP227-BP248). Meridian only reads SAP, so every rule is a read-only check on fields that exist in
the DDIC bundle. Rules follow the method in `docs/material-master-rules.md`: conditional (`applies_when`),
cross-table and process-aware checks come first, plain null checks are used only where SAP mandates the field.

## Matrix: pack, table, rule count

| Pack | Tables (new rules) |
|---|---|
| quality_management | QALS 15, QINF 10, QPMK 8, PLKO 6, PLMK 5, PLPO 4, MAPL 3, QMAT 2, QPGR 1, QPCD 1 |
| project_system | PRPS 13, AFVC 8, PROJ 8, AFKO 5, AUFK 1 |
| business_partner | CVI_CUST_LINK 4, CVI_VEND_LINK 4, BUT050 4, BUT100 2, CVI_CUST_CT_LINK 2, ADRC 2, BUT0BK 2, BUT000 2 |

## Breakdowns

| Pack | Dimension | Severity | Class | Authority |
|---|---|---|---|---|
| QM (55) | consistency 27, validity 20, completeness 6, timeliness 2 | medium 29, low 15, high 10, info 1 | cross_field 20, referential 17, exists 15, null 2, domain 1 | hard constraint 39, best practice 13, s4 migration 3 |
| PS (35) | consistency 21, validity 10, completeness 2, timeliness 2 | medium 20, low 7, high 6, info 2 | exists 13, cross_field 12, referential 9, null 1 | hard constraint 25, best practice 7, s4 migration 3 |
| BP (22) | consistency 17, completeness 4, timeliness 1 | high 10, medium 9, low 2, info 1 | exists 11, cross_field 8, null 3 | s4 migration 18, hard constraint 2, best practice 2 |

## What the rules cover

- **QM**: info records (check tables, units against the material master, vendor CVI link), inspection lots (open
  postings, quantity and date logic, batch, vendor, order, purchase order and plan existence), plan headers and
  operations (work centre usage, control key, quality-relevant lot-size range), master inspection characteristics
  and plan characteristics (limits, tolerance keys, plausibility), catalogs (empty groups, active codes in inactive
  groups), QM material assignments to plant-deleted materials.
- **PS**: project and WBS check tables, cost centre and responsible cost centre existence, hierarchy and plant
  consistency, order headers against orders and projects, network date sequences, activity vendor and purchase
  order links, open orders on closed projects.
- **BP**: Customer/Vendor Integration in both directions (role without link, link without account), BP grouping
  against the account group mapping (`CVIC_*_TO_BP1`), same-number alignment, central block mirroring, contact person
  links and relationships, region and name needed by the CVI address sync, IBAN and account holder.

## S/4HANA readiness

Tagged in `checks/rules/ecc/s4_readiness.yaml` (simplification item: Business Partner Approach, SAP Note 2265093).
- `business_partner` area: blocking BP201, BP202, BP206, BP207, BP227-BP230, BP233, BP234, BP237-BP240; warning
  BP203-BP205, BP208-BP210, BP221, BP222, BP231, BP232, BP235, BP236, BP243, BP244, BP246, BP248.
- New `quality_management` area: blocking QM090, QM100 (vendor without CVI link); warning QM105 (archive).
- New `project_system` area: blocking PS112; warning PS100 and PS102 (archive candidates).

Joins added to `sap/dictionaries/joins.yaml`: KNA1/LFA1 to `CVIC_*_TO_BP1`, PROJ to JEST (status I0046),
MARC to QMAT, MARA to QINF, QPGR to QPCD.

## Personal data

Rules never put names, addresses, tax or bank values in messages or templates. BP243, BP244 and BP246 report keys
only; `KOINH`, `IBAN`, `BANKN` are already in `_SENSITIVE_EXACT`. A test checks templates and messages.

## Uncertainties and inexpressible checks

- BP235/BP236 map `KNA1.SPERR`/`LFA1.SPERR` to `BUT000.XBLCK`. The CVI field mapping is customizing-dependent, so the
  rules are medium severity.
- Tax category against address country, tax number format, several standard addresses, and summing postings against
  the lot quantity cannot be expressed or are false-positive prone, so they are not built.
- PS100 reaches JEST through the chain AUFK/PRPS/PROJ/JEST and only checks the closed status I0046 on the project.
- Archive rules (QM105, PS100, PS102, BP248) use fixed age thresholds; clients with other retention may tune them.

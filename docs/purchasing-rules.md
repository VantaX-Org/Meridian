# Purchasing rule coverage

The ECC `mm_purchasing` pack (`checks/rules/ecc/mm_purchasing.yaml`) holds 214 rules. The depth work adds 63 rules (PUR306 to PUR368) on top of the 151 existing rules. No new module, rule pack or check class was added. Every rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py` (one failing and one passing record per rule).

`tests/test_purchasing_depth_rules.py` holds the pack integrity checks and hand-written pass and fail fixtures for the key rules.

## Coverage by view

Counts are the new rules only (PUR306 to PUR368). Views follow the purchasing master data and document areas in ME11, ME01, MEQ1, ME31K, ME21N, ME51N and the release strategy customising. The table lists, for each view, the tables its rules are anchored on and how many rules each table carries (view by table by rule count).

| View | Tables (rules) | Rules |
|---|---|---|
| Info records | EINA 1, EINE 12 | 13 |
| Source list | EORD 8 | 8 |
| Quota arrangement | EQUK 3, EQUP 5 | 8 |
| Outline agreements | EKAB 1, EKKO 1, EKPO 3 | 5 |
| Contract conditions | A016 3 | 3 |
| Purchase orders | EKET 1, EKKN 4, EKKO 2, EKPO 8 | 15 |
| Release strategy | EKKO 2, T16FS 1 | 3 |
| Purchase requisitions | EBAN 8 | 8 |
| **Total** | | **63** |

### By table

| Table | Rules |
|---|---|
| EINE | 12 |
| EKPO | 11 |
| EORD | 8 |
| EBAN | 8 |
| EQUP | 5 |
| EKKO | 5 |
| EKKN | 4 |
| EQUK | 3 |
| A016 | 3 |
| EINA | 1 |
| EKAB | 1 |
| EKET | 1 |
| T16FS | 1 |
| **Total** | **63** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 33 |
| completeness | 14 |
| validity | 6 |
| timeliness | 6 |
| accuracy | 4 |
| **Total** | **63** |

### By severity

| Severity | Rules |
|---|---|
| medium | 28 |
| high | 20 |
| low | 15 |
| **Total** | **63** |

### By check class

| Check class | Rules |
|---|---|
| exists_check | 27 |
| cross_field_check | 14 |
| null_check | 9 |
| freshness_check | 5 |
| group_sum_check | 5 |
| interval_check | 3 |
| **Total** | **63** |

## Rules

| Rules | Class | What they check |
|---|---|---|
| PUR306, PUR307 | exists_check | Info record vendor is centrally blocked (`LFA1.SPERM`), or not created, blocked or deleted in the purchasing organisation (LFM1). |
| PUR308 | exists_check | Info record currency differs from the vendor order currency (`LFM1.WAERS`). |
| PUR309 | cross_field_check | Planned delivery time (`EINE.APLFZ`) above 365 days. |
| PUR310, PUR311 | exists_check | Plant-level info record for a material not in the plant (MARC), or a plant not assigned to the purchasing organisation (T024W). |
| PUR312 to PUR315 | cross_field_check | Unlimited overdelivery, over- or underdelivery tolerance above 10%, standard quantity below minimum quantity. |
| PUR316 | null_check | Standard info record without a tax code. |
| PUR317 | freshness_check | Info record price validity (`PRDAT`) is in the past. |
| PUR318 | cross_field_check | Purchasing-organisation data still active under a general info record flagged for deletion. |
| PUR319, PUR320 | exists_check | Source list vendor blocked or deleted in LFM1 or LFA1. |
| PUR321 | interval_check | More than one fixed source for a material and plant in overlapping periods. |
| PUR322 | null_check | Fixed source not relevant to MRP (`AUTET`). |
| PUR323 | exists_check | Source list vendor has no active info record for the material. |
| PUR324, PUR325 | exists_check | Source list agreement header or item missing, deleted, or not a contract or scheduling agreement. |
| PUR326 | exists_check | Source list plant not assigned to the purchasing organisation. |
| PUR327, PUR328 | cross_field_check, interval_check | Quota arrangement validity reversed or overlapping. |
| PUR329 | exists_check | Quota arrangement without an item with a positive quota. |
| PUR330, PUR331, PUR332 | exists_check, null_check | Quota item vendor invalid, external item without vendor, stock-transfer item without supplying plant. |
| PUR333, PUR334 | cross_field_check | Quota item over its maximum quantity, or minimum lot size above maximum lot size. |
| PUR335 | cross_field_check | Release order dated outside the contract validity (`KDATB`, `KDATE`). |
| PUR336, PUR337 | group_sum_check | Release orders (EKAB) exceed the contract item target quantity or the contract target value. |
| PUR338, PUR339 | exists_check | PO item points at a missing contract; priced contract item without A016 condition. |
| PUR340 to PUR342 | interval_check, exists_check | A016 records overlap, point at a missing contract item, or at a missing KONH header. |
| PUR343, PUR344 | exists_check | PO plant not assigned to the purchasing organisation; PO info record missing or deleted. |
| PUR345 to PUR349 | exists_check, null_check | Account-assigned PO item without EKKN; EKKN without cost centre, asset, order or WBS element for K, A, F and P. |
| PUR350, PUR351 | group_sum_check | Quantity-based distribution (EKKN) or schedule lines (EKET) do not add up to the item quantity. |
| PUR352, PUR353 | cross_field_check, freshness_check | Schedule line 30 days overdue and not received; PO item open for more than a year (no delivery-completed, final-invoice or deletion indicator). |
| PUR354 | group_sum_check | Item fully received (EKBE, GR net of reversals) but delivery-completed not set. |
| PUR355 to PUR357 | cross_field_check | PO item misses GR-based IV or ERS required by the vendor; PO Incoterms differ from the vendor. |
| PUR358, PUR359 | exists_check, freshness_check | PO release group and strategy not in T16FS; PO waiting for release for more than 30 days. |
| PUR360, PUR361 | freshness_check | Requisition open over 90 days; released requisition not converted within 30 days. |
| PUR362, PUR363 | exists_check | Requisition fixed or desired vendor invalid. |
| PUR364 | exists_check | Account-assigned requisition without EBKN. |
| PUR365 to PUR367 | exists_check | Requisition agreement, release strategy or info record missing. |
| PUR368 | null_check | Release strategy without a first release code. |

## Supporting changes

- DDIC tables added to `sap/dictionaries/ecc6`: A016, EBKN, EKAB, EKET, EKKN, EQUK, EQUP, T161V, T16FB, T16FS, T16FV, with their domains.
- Join edges added to `sap/dictionaries/joins.yaml`: EKPO to EKET and EKPO to EKKN (by `EBELN`, `EBELP`), EKKO to EKAB (contract `EBELN` to `EKAB.KONNR`).
- `tests/checks/rule_proofs.py`: the interval proof now keeps generated records inside the rule scope (`applies_when`), the exists proof can satisfy a numeric `gt` condition in `target_when`, and when the generic proof finds no passing record it retries once with the checked field varying fastest, so the first `MAX_ROWS` combinations try all its values inside the scope (needed for PUR353, which has four scope conditions).
- Golden fixture `tests/golden/test_mm_purchasing_golden.py`: two expected hits added (PUR319, PUR323) for the existing defective source list record whose vendor is blocked in LFM1 and has no info record. No fixture data changed.

## Not covered, and why

- PO net price against the info record price beyond a tolerance: there is no join from EKPO to EINE (EINE needs the PO purchasing organisation plus the EINA key).
- Percentage-based multiple account assignment (`VRTKZ` 2) adding up to 100%: `group_sum_check` compares the child sum with a field on the parent row, and EKPO has no field that holds 100, so `SUM(EKKN.VPROZ) = 100` is not expressible without a new key.
- Info record planned delivery time against `MARC.PLIFZ`: no join path from EINE to MARC, and exists keys are not normalised numerically.
- Open release orders against a contract that has expired by today: only release orders dated outside validity are checked (PUR335).

## Assumptions

- PUR361 uses `EBAN.FRGDT` (release date) and requires `STATU` N (not yet processed).
- PUR351 assumes schedule lines add up to the item quantity for standard POs (`BSTYP` F); scheduling agreements are excluded.
- PUR337 sums release order value per contract and currency (`WAERS`); release orders in another currency are not converted.

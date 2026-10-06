# Production planning rule coverage

The ECC `production_planning` pack (`checks/rules/ecc/production_planning.yaml`) holds 278 rules. The depth work adds 206 rules (PP205 to PP410) on top of the 72 existing rules. No new module, rule pack or check class was added. Every rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py` (one failing and one passing record per rule).

`tests/test_pp_depth_rules.py` holds the pack integrity checks and hand-written pass and fail fixtures. Material supersession for production (successor missing from the BOM plant, circular chains, discontinued components still in use) is covered in the view "Material supersession in the BOM".

The rules extend, and do not repeat, the material master rules for production fields (MM502 to MM510 for production versions, MM542 to MM563 for supersession on MARC and STPO).

## Coverage by view

Counts are the new rules only. The table lists, for each view, the tables its rules are anchored on and how many rules each table carries (view by table by rule count).

| View | Tables (rules) | Rules |
|---|---|---|
| BOM header and assignment (STKO, STZU, MAST) | MAST 2, STKO 8, STZU 2 | 12 |
| BOM items (STPO, STAS) | STAS 3, STPO 33 | 36 |
| Material supersession in the BOM (STPO, MAST, MARC) | MAPL 1, MARC 3, MAST 1, MKAL 1, STPO 11 | 17 |
| Plant and MRP production links (MARC, T460A, T024F, T437V) | MARC 5, T024F 1, T437V 1, T460A 2 | 9 |
| Production versions (MKAL) | MKAL 11 | 11 |
| Routing and rate routing headers (PLKO, MAPL) | MAPL 3, PLKO 8 | 11 |
| Routing operations (PLPO, PLAS) | PLAS 2, PLPO 43 | 45 |
| Work centre costing and capacity (CRCO, CRCA, KAKO) | CRCA 7, CRCO 7, KAKO 15 | 29 |
| Work centres (CRHD, CRTX) | CRHD 34, CRTX 2 | 36 |
| **Total** | | **206** |

### By dimension

| Dimension | Rules |
|---|---|
| validity | 84 |
| consistency | 58 |
| completeness | 38 |
| accuracy | 14 |
| lifecycle | 11 |
| timeliness | 1 |
| **Total** | **206** |

### By severity

| Severity | Rules |
|---|---|
| medium | 112 |
| high | 60 |
| low | 30 |
| critical | 4 |
| **Total** | **206** |

### By check class

| Check class | Rules |
|---|---|
| referential_check | 84 |
| exists_check | 50 |
| cross_field_check | 44 |
| null_check | 24 |
| hierarchy_check | 3 |
| freshness_check | 1 |
| **Total** | **206** |

## Fields and checks that cannot be expressed

- Overlapping lot-size ranges between BOM alternatives or routing alternatives, and overlapping production version validity. The engine compares one row with a table, not rows within a group by range.
- Duplicate operation numbers inside one routing alternative. This needs PLAS joined to PLPO per sequence.
- Successor comparisons across rows, such as procurement type or base unit of the successor against the predecessor.
- Subcontracting special procurement that needs a BOM or a subcontract info record (conditions in T460A cannot be expressed in `applies_when`).
- Routing and BOM status meaning, which is customizing (T412, T415).
- Fields whose semantics are not documented in the dictionary and were left out on purpose: CRHD.XKOST, CRHD.XSPRR and the STPO SAN flags (SANFE, SANIN, SANKO, SANVS).

## Known limits

- PP394 (version with neither BOM nor routing) tests MKAL.STLAL, which may carry a default value; it can under-report.
- Referential rules depend on live configuration tables, as the existing production planning referential rules do. Without them the rules return no result.

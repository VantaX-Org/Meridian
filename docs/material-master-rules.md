# Material master rule coverage

The ECC `material_master` pack (`checks/rules/ecc/material_master.yaml`) holds 417 rules. The depth work adds 246 rules (MM317 to MM563) on top of the 164 original rules and the 7 MLAN rules (MM310 to MM316). No new module and no new rule pack were added. Every rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py` (one failing and one passing record per rule).

`tests/test_mm_depth_rules.py` holds the pack integrity checks and hand-written fixtures. Hierarchy and `@today` behaviour is covered there too.

## Coverage by view

Counts are the new rules only (MM317 to MM563). Views follow the material master maintenance views in MM01 and MM02. The table lists, for each view, the tables its rules are anchored on and how many rules each table carries (view by table by rule count).

| View | Tables (rules) | Rules |
|---|---|---|
| Accounting and costing | CKMLHD 1, MBEW 23 | 24 |
| Basic data and descriptions | MAKT 8, MARA 25, MARC 2, MEAN 6 | 41 |
| Batch management | MCH1 6 | 6 |
| Classification | AUSP 3, CABN 5, CAWN 2, INOB 2, KLAH 6, KSSK 2 | 20 |
| Lifecycle and cross-level | MARA 1, MARC 2, MARD 1, MLGN 1, MLGT 1 | 6 |
| MRP | MARC 25, MDMA 3 | 28 |
| Purchasing and foreign trade | EINA 2, EINE 4, MARA 7, MARC 11 | 24 |
| Quality (MM view level) | MARC 1, QMAT 8 | 9 |
| Sales | MARC 1, MLAN 1, MVKE 17 | 19 |
| Storage and warehouse | MARD 7, MLGN 11, MLGT 5 | 23 |
| Supersession and discontinuation | MARC 16, MBEW 2, STPO 4 | 22 |
| Units of measure | MARM 2, MEAN 1 | 3 |
| Work scheduling and production | MAPL 1, MARC 13, MAST 2, MKAL 5 | 21 |
| **Total** | | **246** |

### By dimension

| Dimension | Rules |
|---|---|
| validity | 101 |
| consistency | 79 |
| completeness | 32 |
| accuracy | 15 |
| lifecycle | 13 |
| uniqueness | 4 |
| freshness | 2 |
| **Total** | **246** |

### By severity

| Severity | Rules |
|---|---|
| medium | 109 |
| low | 79 |
| high | 58 |
| critical | 1 |
| **Total** | **246** |

### By check class

| Check class | Rules |
|---|---|
| cross_field_check | 76 |
| referential_check | 68 |
| exists_check | 51 |
| domain_value_check | 24 |
| null_check | 14 |
| group_sum_check | 6 |
| uniqueness_check | 3 |
| hierarchy_check | 2 |
| format_check | 1 |
| freshness_check | 1 |
| similarity_check | 1 |
| **Total** | **246** |

## What the new rules do

- Domain and referential rules read the DDIC: a `domain_value_check` only exists where the domain has fixed values, a `referential_check` only where the field has a check table.
- Group-sum rules reconcile stock across levels: MBEW to MARD (unrestricted, quality inspection, blocked) and MARD to MCHB (the same three stock types per batch).
- Existence rules cover the dependency chains between views: sales, valuation and warehouse data against `MARA.VPSTA`, MARC to BOM (MAST), routing (MAPL), production version (MKAL) and info record (EINA, EINE), MLGN to MLGT, and MBEW to the material ledger header (CKMLHD).
- Classification is covered from the material side through the class tables KLAH, KSSK, INOB, CABN, CAWN and AUSP (class type, status, validity, characteristic data type and length, allowed values).
- GTIN rules check uniqueness (`MEAN.EAN11`, one main GTIN per material), the check digit, the category (`MEAN.EANTP`) and that the unit exists in MARM.

## Supersession and discontinuation

Twenty-two rules (MM542 to MM563) cover the follow-up material chain and the effective-out date. They read `MARC-KZAUS` (discontinuation indicator), `MARC-AUSDT` (effective-out date), `MARC-NFMAT` (follow-up material) and the BOM item fields `STPO-NFEAG` (discontinuation group leader), `STPO-NFGRP` (follow-up group) and `STPO-KZNFP` (follow-up item flag).

### Rules

| Rules | Class | What they check |
|---|---|---|
| MM542, MM543 | cross_field_check | `NFMAT` or `AUSDT` set without `KZAUS`. |
| MM544, MM545 | exists_check | Follow-up material is not in the same plant, or not in MARA. |
| MM546, MM547 | exists_check | Follow-up material is flagged for deletion at client level or in the plant. |
| MM548, MM549 | exists_check | Follow-up material is blocked by its plant status (`MMSTA`) or has MRP type ND. |
| MM550 | exists_check | Follow-up material is itself discontinued with no successor (dead end). |
| MM551 | hierarchy_check | Follow-up chain forms a loop inside a plant (`scope_field` MARC.WERKS). |
| MM552 | hierarchy_check | Follow-up chain is longer than three links (`max_depth` 3). |
| MM553, MM554, MM555 | exists_check | Successor differs in base unit, material type or valuation class. |
| MM556, MM557 | exists_check | Successor has no valuation row in the same valuation area, or no sales row when the predecessor has a sales view. |
| MM558, MM559 | cross_field_check | Effective-out date has passed (or is over a year old) and the material has no status that stops procurement. |
| MM560 | exists_check | Active BOM component is a discontinued part and the item has no discontinuation group. |
| MM561, MM562 | exists_check | `NFEAG` leader without a follower, or `NFGRP` follower without a leader, in the same BOM. |
| MM563 | null_check | BOM item flagged as follow-up item (`KZNFP`) without `NFGRP`. |

### Subset counts

| View | Tables (rules) | Rules |
|---|---|---|
| Supersession and discontinuation | MARC 16, MBEW 2, STPO 4 | 22 |
| **Total** | | **22** |

| Dimension | Rules |
|---|---|
| consistency | 13 |
| lifecycle | 6 |
| completeness | 3 |
| **Total** | **22** |

| Check class | Rules |
|---|---|
| exists_check | 15 |
| cross_field_check | 4 |
| hierarchy_check | 2 |
| null_check | 1 |
| **Total** | **22** |

| Severity | Rules |
|---|---|
| medium | 10 |
| high | 9 |
| low | 2 |
| critical | 1 |
| **Total** | **22** |

| Table | Rules |
|---|---|
| MARC | 16 |
| STPO | 4 |
| MBEW | 2 |
| **Total** | **22** |

### New generic capability

`hierarchy_check` gained two optional keys, so no new class was needed:

- `scope_field` walks the parent pointer per scope. A follow-up material belongs to a plant, so `MARC.WERKS` is the scope. A pair that points at each other across two plants is not a loop.
- `max_depth` also fails every record whose chain to the top has more than that many links. A loop record still fails, with or without `max_depth`, so MM552 also lists loop members; MM551 is the rule that names the loop.

Node tests live in `tests/test_mm_depth_rules.py` (2-cycle, self loop, 3-cycle, plant scoping, depth limits of three, four and five links). The rule prover (`tests/checks/rule_proofs.py`) covers both keys.

### Not covered, and why

- Interchangeability and parallel-material tables: not confirmed on sapdatasheet, so no DDIC and no rules were added.
- `STPO-KZAUS`: the field is not in the ECC 6.0 DDIC. `STPO-NFMAT` is marked "NOT IN USE" in the DDIC and is not checked.
- "Predecessor had a sales view" is approximated by `MARA.VPSTA` containing V (MM557).
- Near-duplicate pairs where one side is discontinued need a similarity check and a join; the engine has no such combination.

## Other limits

- Valuation class against material type through T025Z or T134: no single-field reference exists for it.
- `KSSK.OBJEK` to `INOB.CUOBJ`: the object key is padded differently, so the join is not expressible.
- Cross-plant price outliers and type-driven mandatory views need configuration data that is not in the extract.
- `MARA.MFRNR` referential check: the vendor master is outside this pack.
- Leading and trailing spaces in descriptions: the engine strips values before the check, so only inner double spaces are detectable (MM343).
- `MARA.SERLV` domain rule: the DDIC lists only a blank value, so the rule was dropped.

# SD sales rule coverage

The ECC `sd_sales_orders` pack (`checks/rules/ecc/sd_sales_orders.yaml`) holds 179 rules. The depth work adds 110 rules (SDSO202 to SDSO311) on top of the 69 existing rules. No new module, rule pack or check class was added. Every rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py`.

New rules read order status from the ECC tables VBUK (header) and VBUP (item), not from the S/4-style fields used by some older rules. Sixteen join edges were added to `sap/dictionaries/joins.yaml` (VBKD, VBPA, VBEP, KNMT, KONM, A-tables, TVTA, T014, MARC to VBAP) and eight missing DDIC tables were added (VBKD, VBPA, TVTA, TVPA, TVFK, KNMT, T683, TVLK).

`tests/test_sd_sales_depth_rules.py` holds the integrity checks and hand-written fixtures. Customer-master rules, the AR credit rules on KNKK and the material master supersession rules are not repeated here.

## Coverage by view

| View | Tables (rules) | Rules |
|---|---|---|
| Order header, credit and pricing | VBAK 18, VBUK 2 | 20 |
| Order items | VBAP 10 | 10 |
| Material supersession on items | VBAP 7, MARC 1 | 8 |
| Schedule lines | VBEP 8 | 8 |
| Business data | VBKD 9 | 9 |
| Partners | VBPA 6, VBAK 4, KNA1 3, LFA1 1 | 14 |
| Customer-material info records | KNMT 9 | 9 |
| Pricing conditions (KONH/KONP/KONM) | KONP 10, KONH 2, KONM 1 | 13 |
| Condition key tables (A004/A005/A304/A305) | A305 4, KONH 4, A004 3, A005 3, A304 3 | 17 |
| Credit control area customizing | T014 2 | 2 |
| **Total** | | **110** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 46 |
| validity | 21 |
| lifecycle | 16 |
| completeness | 15 |
| accuracy | 9 |
| timeliness | 2 |
| uniqueness | 1 |
| **Total** | **110** |

### By severity

| Severity | Rules |
|---|---|
| medium | 51 |
| high | 46 |
| low | 12 |
| critical | 1 |
| **Total** | **110** |

### By check class

| Check class | Rules |
|---|---|
| cross_field_check | 50 |
| exists_check | 34 |
| referential_check | 17 |
| null_check | 7 |
| domain_value_check | 1 |
| uniqueness_check | 1 |
| **Total** | **110** |

## View by table by rule count

| View | Table | Rules |
|---|---|---|
| Order header, credit and pricing | VBAK | 18 |
| Order header, credit and pricing | VBUK | 2 |
| Order items | VBAP | 10 |
| Material supersession on items | VBAP | 7 |
| Material supersession on items | MARC | 1 |
| Schedule lines | VBEP | 8 |
| Business data | VBKD | 9 |
| Partners | VBPA | 6 |
| Partners | VBAK | 4 |
| Partners | KNA1 | 3 |
| Partners | LFA1 | 1 |
| Customer-material info records | KNMT | 9 |
| Pricing conditions (KONH/KONP/KONM) | KONP | 10 |
| Pricing conditions (KONH/KONP/KONM) | KONH | 2 |
| Pricing conditions (KONH/KONP/KONM) | KONM | 1 |
| Condition key tables (A004/A005/A304/A305) | A305 | 4 |
| Condition key tables (A004/A005/A304/A305) | KONH | 4 |
| Condition key tables (A004/A005/A304/A305) | A004 | 3 |
| Condition key tables (A004/A005/A304/A305) | A005 | 3 |
| Condition key tables (A004/A005/A304/A305) | A304 | 3 |
| Credit control area customizing | T014 | 2 |

## Not covered

- Block fields in TVMS (sales status block semantics are unclear), so only MARA.MSTAV and MVKE.VMSTA being set are checked.
- Material sales status effective date (MVKE.VMSTD) timing.
- Check tables not in the DDIC: TVST, TVEP, TVKBZ, TVAG, T009. Fields that point at them are not checked.
- Item-to-MVKE linking uses the order's sales organisation and channel because VBAP has no sales organisation.
- Condition key tables other than A004, A005, A304 and A305, and the dependent table number format ('004' is assumed for KONH.KOTABNR).
- Older rules in the pack still read S/4-style status fields (VBAK.GBSTK, VBAK.CMGST, VBAP.GBSTA) that do not exist in the ECC DDIC.

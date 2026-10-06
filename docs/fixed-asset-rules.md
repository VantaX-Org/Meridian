# Fixed asset rule coverage

The ECC `asset_accounting` pack (`checks/rules/ecc/asset_accounting.yaml`) holds 57 rules. The depth work adds 14 rules (AA207 to AA220). No new module, rule pack or check class was added. Every new rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py`.

`tests/test_aa_depth_rules.py` holds the pack integrity checks and hand-written fixtures.

Two join edges were added to `sap/dictionaries/joins.yaml`: T001 to ANLA and T093C to ANLA (both BUKRS). They give the asset its company code's chart of accounts and chart of depreciation.

## Coverage by view

Views follow the asset master tabs in AS01 and AS02.

| View | Tables (rules) | Rules |
|---|---|---|
| General data and account determination | ANLA 3 | 3 |
| Origin (investment order, WBS element) | ANLA 2 | 2 |
| Time-dependent data | ANLZ 4 | 4 |
| Depreciation areas | ANLB 3 | 3 |
| Asset values | ANLC 1 | 1 |
| Class (blocked or deleted) | ANLA 1 | 1 |
| **Total** | | **14** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 11 |
| validity | 2 |
| accuracy | 1 |
| **Total** | **14** |

### By severity

| Severity | Rules |
|---|---|
| medium | 7 |
| high | 6 |
| critical | 1 |
| **Total** | **14** |

### By check class

| Check class | Rules |
|---|---|
| exists_check | 10 |
| cross_field_check | 2 |
| referential_check | 2 |
| **Total** | **14** |

## What the new rules do

| Rules | Class | What they check |
|---|---|---|
| AA207 | exists_check | Asset class is not blocked (`ANKA.XSPEA`) or flagged for deletion (`ANKA.XLOEV`). |
| AA208 | exists_check | Asset's account determination (`ANLA.KTOGR`) matches its class. |
| AA209, AA210 | exists_check | Account determination has balance sheet accounts (T095) and depreciation accounts (T095B) in the company code's chart of accounts. |
| AA211 | exists_check | Active depreciation area on the asset is active in the class for the company code's chart of depreciation (ANKB). |
| AA212 | exists_check | Depreciation key is defined in the company code's chart of depreciation (T090NA by `T093C.AFAPL`). |
| AA213 | exists_check | Location (`ANLZ.STORT`) is defined for the asset's plant (T499S). |
| AA214 | cross_field_check | Useful life periods (`ANLB.NDPER`) are below 12. |
| AA215 | cross_field_check | Depreciation calculation error indicator (`ANLC.XAFAR`) is not set. |
| AA216, AA217 | exists_check, referential_check | Investment order and investment WBS element exist. |
| AA218 | referential_check | Internal order in the time-dependent data exists. |
| AA219, AA220 | exists_check | Responsible cost centre exists, and the cost centre belongs to the asset's company code. |

Assets flagged for deletion (`ANLA.XLOEV`) or deactivated (`ANLA.DEAKT`) are out of scope.

## Not covered, and why

- Scrap value above acquisition value: needs ANLB and ANLC on one row, and there is no join edge between them that keeps the area grain.
- Useful life below the class minimum (`ANKB.MINDJ`): no ANLB to ANKB edge; AA211 uses an exists check on the key only.
- Depreciation key active flag (`T090NA.XAKTIV`): its meaning differs by release, so it is not checked.
- Depreciation key different from the class default: legitimate overrides make it filler.
- Asset under construction without a settlement rule: the rule is created at settlement, so its absence is normal.
- Original asset (`ANLA.AIBN1`): it may be in another company code.

## Other limits

- AA214 assumes a 12-period fiscal year variant. Shortened or 13-period variants are not distinguished.
- AA215 reads every fiscal year in ANLC, not only the current one. A historic year with an error flag also fails.
- No personal values are read or echoed. No field in `_SENSITIVE_EXACT` (`checks/profiling.py`) is referenced.

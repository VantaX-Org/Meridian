# Controlling rule coverage

The ECC `controlling` pack (`checks/rules/ecc/controlling.yaml`) holds 59 rules. The depth work adds 18 rules (CO042 to CO059). No new module, rule pack or check class was added. Every new rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py`.

`tests/test_co_depth_rules.py` holds the pack integrity checks and hand-written fixtures.

One join edge was added to `sap/dictionaries/joins.yaml`: TKA01 to TKA02 (KOKRS), the company code assignment to the controlling area (OX19).

"Current" in this document means the master record row whose validity end (`DATBI`) is 31.12.9999.

## Coverage by view

| View | Tables (rules) | Rules |
|---|---|---|
| Cost centres (KS01) | CSKS 4 | 4 |
| Cost elements (KA01, KA06) | CSKB 2 | 2 |
| Activity types (KL01) | CSLA 4 | 4 |
| Profit centres (KE51) | CEPC 3 | 3 |
| Internal orders (KO01) | AUFK 2 | 2 |
| Controlling area (OKKP, OX19) | TKA01 1, TKA02 2 | 3 |
| **Total** | | **18** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 12 |
| validity | 3 |
| completeness | 3 |
| **Total** | **18** |

### By severity

| Severity | Rules |
|---|---|
| high | 11 |
| critical | 4 |
| low | 2 |
| medium | 1 |
| **Total** | **18** |

### By check class

| Check class | Rules |
|---|---|
| exists_check | 13 |
| null_check | 3 |
| cross_field_check | 1 |
| referential_check | 1 |
| **Total** | **18** |

## What the new rules do

| Rules | Class | What they check |
|---|---|---|
| CO042 | exists_check | Cost centre category (`CSKS.KOSAR`) is defined in TKA05. |
| CO043 | exists_check | Cost centre's company code is assigned to its controlling area (TKA02). |
| CO044 | exists_check | Cost centre currency is the currency of its company code. |
| CO045 | exists_check | Current cost centre does not point to a locked current profit centre (`CEPC.LOCK_IND`). |
| CO046, CO047 | exists_check | Primary cost elements (categories 01, 03, 04, 11, 12, 22) are P&L accounts; category 90 cost elements are balance sheet accounts (`SKA1.XBILK` in the controlling area's chart). |
| CO048, CO049, CO050, CO051 | exists_check, null_check, cross_field_check | Activity types: allocation cost element is a current category 43 element, activity unit is filled, manually allocated types (category 1) have an allocation cost element, and validity start is not after validity end. |
| CO052, CO053, CO054 | referential_check, null_check, exists_check | Profit centre segment exists (FAGL_SEGM) and is filled, and the successor profit centre (`CEPC.NPRCTR`) exists. |
| CO055 | exists_check | Statistical orders (`AUFK.ASTKZ`) carry no settlement rule (COBRB). |
| CO056 | exists_check | Order's cost centre for basic settlement exists, current, in the order's controlling area. |
| CO057, CO058, CO059 | exists_check | Controlling area chart of accounts exists, and every assigned company code uses the same chart and fiscal year variant. |

## Not covered, and why

- Validity overlap between master record rows (CSKS, CSLA, CEPC): checks against date-ranged rows need an interval join the engine does not have. Rules use the current row only.
- Profit centre valid today but with a future validity end: same reason.
- User status of orders (JEST against TJ02): TJ02 is not in the DDIC bundle.
- Standard hierarchy membership (`CSKS.KHINR`, SETHEADER/SETNODE): not in the extract.
- Cost centre and cost element texts (CSKT, CSKU): not checked here.
- Settlement rule percentages adding up to 100 per order (COBRB): `group_sum_check` compares against a parent field, not a constant.
- Functional area on the cost centre (`CSKS.FUNC_AREA`): not in the ECC 6.0 DDIC.

## Other limits

- CO050 enforces the allocation cost element for activity type category 1 only. Category 3 (manual entry, indirect allocation) is often left without one deliberately.
- CO053 is low severity: segment reporting is only mandatory where IFRS 8 or local rules require it.
- No personal values are read or echoed. `CSKS.VERAK` and the `AUFK.USER0` to `USER3` fields are not referenced.

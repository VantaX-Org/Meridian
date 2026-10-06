# G/L account rule coverage

The ECC `fi_gl` pack (`checks/rules/ecc/fi_gl.yaml`) holds 93 rules. The depth work adds 20 rules (GL207 to GL226). No new module, rule pack or check class was added. Every new rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py` (one failing and one passing record per rule).

`tests/test_gl_depth_rules.py` holds the pack integrity checks and hand-written fixtures.

Five join edges were added to `sap/dictionaries/joins.yaml` so the rules can read chart-level and company-code-level settings: T004 to SKA1 (KTOPL) and T001 to SKB1 (BUKRS). The remaining edges belong to the controlling and asset accounting depth work.

## Coverage by view

Counts are the new rules only (GL207 to GL226). Views follow the G/L account master maintenance in FS00 (chart of accounts segment, company code segment) and the company code and chart settings behind it (OB13, OB62, OBY6, OB53).

| View | Tables (rules) | Rules |
|---|---|---|
| Chart of accounts segment (FSP0) | SKA1 6 | 6 |
| Company code segment (FSS0) | SKB1 11 | 11 |
| Company code and chart settings | T001 2, T030 1 | 3 |
| **Total** | | **20** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 14 |
| completeness | 5 |
| validity | 1 |
| **Total** | **20** |

### By severity

| Severity | Rules |
|---|---|
| medium | 8 |
| high | 5 |
| critical | 4 |
| low | 3 |
| **Total** | **20** |

### By check class

| Check class | Rules |
|---|---|
| exists_check | 14 |
| cross_field_check | 5 |
| referential_check | 1 |
| **Total** | **20** |

## What the new rules do

| Rules | Class | What they check |
|---|---|---|
| GL207 | exists_check | Account group (`SKA1.KTOKS`) is defined for the account's chart of accounts in T077S. |
| GL208, GL209 | exists_check, cross_field_check | Group account number (`SKA1.BILKT`) exists in the group chart (`T004.KKTPL`), and is filled when the chart has a group chart. |
| GL210 | exists_check | Account has a text (SKAT) in the maintenance language of its chart (`T004.DSPRA`). |
| GL211 | exists_check | Company code segment has a chart-level master record in the company code's chart (`T001.KTOPL`). |
| GL212, GL213, GL214 | cross_field_check | Account currency (`SKB1.WAERS`) against the company code currency: reconciliation accounts, "balances in local currency only" accounts, and P&L accounts. |
| GL215 | exists_check | Field status group (`SKB1.FSTAG`) is defined in the company code's field status variant (`T001.FSTVA`, T004F). |
| GL216, GL217 | exists_check | Customer and vendor reconciliation accounts are used by at least one customer (KNB1.AKONT) or vendor (LFB1.AKONT) in the company code. |
| GL218, GL219 | exists_check, cross_field_check | Alternative account number (`SKB1.ALTKT`) exists in the country chart (`T001.KTOP2`), and is filled when the company code has a country chart. |
| GL220 | referential_check | Sort key (`SKB1.ZUAWA`) exists in TZUN. |
| GL221, GL222 | exists_check | Retained earnings account (T030, transaction BIL) is a balance sheet account, and every P&L statement account type (`SKA1.GVTYP`) has one. |
| GL223 | exists_check | P&L account has a cost element (CSKA) in the same chart. |
| GL224 | exists_check | Account has a text in the company code language (`T001.SPRAS`). |
| GL225, GL226 | exists_check | Company code's operative and country charts of accounts exist in T004. |

Records flagged for deletion are out of scope: `SKA1.XLOEV` for chart-level rules, `SKB1.XLOEB` and `SKA1.XLOEV` for company code rules.

## Not covered, and why

- Account inside a financial statement version interval (FAGL_011ZC): the engine has no range-membership check. The FSV-per-chart check was dropped because a blank `T011.KTOPL` makes a version valid for every chart, which would give false positives.
- Account number inside the account group's number range (T077S `VONNR`/`BISNR`): no range check.
- Tax category (`SKB1.MWSKZ`) against the tax procedure (T007A): the procedure comes from the country, which needs a join through T005 that is not modelled.
- Hierarchy membership of the account in reporting sets (SETHEADER/SETLEAF): not in the extract.

## Other limits

- GL216 and GL217 are low severity: a new reconciliation account without any customer or vendor is normal until master data is assigned.
- GL223 is best practice: P&L accounts that are deliberately not cost-relevant (for example, some tax or interest accounts) also fail it.
- No personal values are read or echoed. No field in `_SENSITIVE_EXACT` (`checks/profiling.py`) is referenced.

# Finance second wave: GL, controlling, asset accounting, banking and tax

The ECC finance packs gain 111 rules. No new module, pack or check class was added. Every rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py`. Conditional rules are tested in both branches (skipped when the condition is false, flagged when true) in `tests/test_finance_depth2_rules.py`.

| Pack | Before | New | After | New ids |
|---|---|---|---|---|
| `fi_gl.yaml` | 93 | 37 | 130 | GL227 to GL259, S4-CE-PRIMARY-BS, S4-CE-GL-DELETED, S4-CE-NO-COMPANY-CODE, S4-CO-PRCTR-SEGMENT |
| `controlling.yaml` | 59 | 34 | 93 | CO060 to CO092, S4-CO-ORDER-PRCTR |
| `asset_accounting.yaml` | 57 | 27 | 84 | AA221 to AA246, S4-AA-CLASS-KTOGR |
| `banking_tax.yaml` | 77 | 13 | 90 | BKT095 to BKT107 |

Supporting changes: join edge T077S to SKA1 in `sap/dictionaries/joins.yaml` (cross-table checks on number-range and account links); new DDIC tables TBSL, T009, T007S and domains ANZBP, ANZSP; S/4 readiness tagging in `s4_readiness.yaml` (see below).

## Coverage by view

| View | Table (rules) | Rules |
|---|---|---|
| GL account master, chart of accounts | SKA1 3, CSKB 3 | 6 |
| GL account master, company code | SKB1 6, T042Z 1 | 7 |
| Company code and chart configuration | T001 9, T004 2, T003 3, T077S 3, CEPC 1 | 18 |
| Posting keys | TBSL 6 | 6 |
| Cost elements | CSKA 1, CSKB 6 | 7 |
| Cost centres and profit centres | CSKS 4, CEPC 2, TKA01 1 | 7 |
| Activity types | CSLA 2 | 2 |
| Internal orders | AUFK 18 | 18 |
| Asset master, general and account determination | ANLA 11 | 11 |
| Asset master, time-dependent | ANLZ 5 | 5 |
| Asset master, depreciation areas | ANLB 4 | 4 |
| Asset class and chart of depreciation | ANKA 2, ANKB 2, T093C 3 | 7 |
| House banks and bank master | T012 1, T012K 7, BNKA 1 | 9 |
| Tax codes and procedures | T007A 2, T007S 1, T042Z 1 | 4 |
| **Total** | | **111** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 70 |
| completeness | 21 |
| validity | 15 |
| timeliness | 4 |
| uniqueness | 1 |

### By severity

| Severity | Rules |
|---|---|
| medium | 51 |
| high | 43 |
| low | 12 |
| critical | 5 |

### By check class

| Check class | Rules |
|---|---|
| exists_check | 62 |
| cross_field_check | 29 |
| null_check | 13 |
| domain_value_check | 3 |
| freshness_check | 2 |
| regex_check | 1 |
| uniqueness_check | 1 |

## What the new rules do

Most rules are cross-table consistency checks, not null checks. Null checks apply only where SAP makes the field mandatory.

- GL: account group, reconciliation type, open item and line item management, field status group and tax category must agree with each other and with the chart and company code. Accounts must resolve to their chart of accounts, number-range intervals (T077S) and currency (TCURC). Posting keys (TBSL) must carry a valid account type and debit/credit indicator.
- Controlling: cost element category (KATYP) must fit the element type and the underlying GL account. Cost centres need valid responsible person, category and profit centre links. Internal orders (AUFK) are checked for controlling area, company code, profit centre, order type and status consistency, including conditional rules that apply only to orders with a given status or settlement setup. Activity types check category (LATYP) and unit.
- Asset accounting: asset class and chart of depreciation links, depreciation key and area consistency, capitalisation date against depreciation start (compared at month level, because period control starts depreciation on the first of the month), cost centre and plant validity, retired or flagged assets still active.
- Banking and tax: house bank and account links (T012, T012K), bank country against bank master, tax code input/output type (MWART) and tax procedure links. Rules do not echo account numbers, IBAN, bank keys or SWIFT in their fix templates.

### S/4HANA readiness and migration hygiene

Message prefix is "S/4HANA readiness: ... - simplification item ...". Blockers use `sap_hard_constraint`, warnings use `s4hana_migration` or `best_practice`.

- S4-CE-PRIMARY-BS (blocking): primary cost element master on a balance sheet account (cost elements become GL accounts in the Universal Journal).
- S4-CE-GL-DELETED, S4-CE-NO-COMPANY-CODE (warning): cost element GL accounts that are deleted or have no company code segment cannot be migrated cleanly.
- S4-CO-PRCTR-SEGMENT, S4-CO-ORDER-PRCTR (warning): profit centre and segment derivation for cost objects.
- S4-AA-CLASS-KTOGR (blocking): asset class account determination must resolve for the new Asset Accounting.
- Asset rules AA221, AA224, AA234, AA241 (blocking) and AA229, AA233, AA235, AA244, AA245, AA246 (warning) are tagged under `asset_accounting`. GL259 and CO092 are tagged under `finance`.
- Only existing `s4_readiness.yaml` areas `finance` and `asset_accounting` were edited. No area was added for banking and tax, because no conversion-blocking simplification item was confirmed.

## Test pins updated

Rule counts in `tests/checks/test_ecc_remaining_rules.py` (asset_accounting 84, controlling 93, banking_tax 90, total 1758), `test_banking_tax.py` (size cap), `test_gl_depth_rules.py` (53 numeric ids), `test_co_depth_rules.py` (51), `test_aa_depth_rules.py` (40). The extraction-plan test no longer asserts TCURC is a config table, because a GL rule now uses TCURC as an exists_check target (data). One golden expectation was added: AA225 flags asset 300017, which is marked for deletion but not blocked (a true positive).

## Not covered, and why

| Check | Reason |
|---|---|
| CSKS object number 'KS'+KOKRS+KOSTL, AUFK 'OR'+AUFNR | Needs string concatenation or slicing; not expressible in `cross_field_check`. |
| T009 period counts (ANZBP, ANZSP) against variant | NUMC string compare. |
| BSEG posting-key consistency | BSEG is not a suitable extract. |
| Cost centre membership in the standard hierarchy | SETHEADER and SETLEAF are not in the DDIC bundle. |
| T077S interval overlap | Pairwise range overlap is not expressible. |
| Plant to company code via T001K | No join edge, ambiguous grain. |
| ANLB.NDJAR against class MINDJ/MAXDJ | NUMC compare. |
| T007A procedure by country | No reliable reference list in the DDIC. |
| CSLA.KSTTY against cost centre category validity | No validity table in the DDIC. |
| OBJNR links across objects | Needs OBJNR concatenation. |
| Classic leasing, derived depreciation areas, ledger groups (T093) | S/4 semantics not certain enough to cite. |
| S/4 areas for banking and tax | No conversion-blocking item confirmed. |

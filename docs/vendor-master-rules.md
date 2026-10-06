# Vendor master rule coverage

The ECC `accounts_payable` pack (`checks/rules/ecc/accounts_payable.yaml`) holds 173 rules. The depth work adds 65 rules (AP212 to AP276) on top of the 108 existing rules. No new module, rule pack or check class was added. Every rule has the full metadata set, resolves in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`) and is proven by `tests/checks/test_rule_proofs.py` (one failing and one passing record per rule).

`tests/test_vendor_depth_rules.py` holds the pack integrity checks and hand-written fixtures. The integrity checks also make sure that no `record_fix_template` prints a personal value (name, street, bank account, tax number).

## Coverage by view

Counts are the new rules only (AP212 to AP276). Views follow the vendor maintenance views in XK01 and XK02. The table lists, for each view, the tables its rules are anchored on and how many rules each table carries.

| View | Tables (rules) | Rules |
|---|---|---|
| General data (address, control, tax, blocks) | LFA1 17, LFAS 1 | 18 |
| Duplicates and staleness | LFA1 5 | 5 |
| Bank data | LFBK 5 | 5 |
| Company code data and dunning | LFB1 13, LFB5 3 | 16 |
| Purchasing organisation data | LFM1 7, LFM2 2 | 9 |
| Partner functions | WYT3 7 | 7 |
| Contact persons | KNVK 3 | 3 |
| Cross-level lifecycle | LFA1 2 | 2 |
| **Total** | | **65** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 31 |
| validity | 13 |
| completeness | 12 |
| uniqueness | 7 |
| timeliness | 2 |
| **Total** | **65** |

### By severity

| Severity | Rules |
|---|---|
| medium | 33 |
| high | 20 |
| low | 12 |
| **Total** | **65** |

### By check class

| Check class | Rules |
|---|---|
| exists_check | 31 |
| cross_field_check | 18 |
| uniqueness_check | 7 |
| null_check | 4 |
| referential_check | 3 |
| similarity_check | 1 |
| freshness_check | 1 |
| **Total** | **65** |

## What the new rules do

- Configuration references that have no single-field check table in the DDIC (industry T016, trading partner T880, account group T077K, house bank T012, accounting clerk T001S, partner function TPAR, sort key TZUN) are checked with `exists_check` against the configuration table, using the company code as part of the key where the table is company-code dependent.
- Blocks and deletion flags are compared across levels: central (`LFA1`) against company code (`LFB1`) and purchasing organisation (`LFM1`), and `LFM1` against `LFM2`.
- Links between vendors (alternative payee, head office, fiscal address, partner functions) must point at a vendor that exists, is created at the same level and is not deleted or blocked.
- Duplicate detection reports the vendor keys only. The tax number, bank account and name values are never printed in a message or fix line.

## General data

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP212 | exists_check | `LFA1.BRSCH` not in T016. |
| AP213 | exists_check | `LFA1.VBUND` not a company in T880. |
| AP214 | referential_check | `LFA1.WERKS` not in T001W. |
| AP215 | exists_check | Fiscal address account `LFA1.FISKN` is not a vendor. |
| AP216, AP217 | exists_check | One-time flag `LFA1.XCPDK` disagrees with the account group flag `T077K.XCPDS`. |
| AP218, AP219 | exists_check | Alternative payee `LFA1.LNRZA` has no bank details, or is deleted or posting-blocked. |
| AP220, AP221 | cross_field_check | Deletion block and deletion flag set together; deletion flag set without posting and purchasing blocks. |
| AP222, AP223 | null_check | City and street missing. |
| AP224 | cross_field_check | PO box without PO box postal code. |
| AP225, AP226 | exists_check, cross_field_check | Address number has no ADRC record; country, city or postal code differ between LFA1 and ADRC. |
| AP227 | cross_field_check | EU vendor liable for VAT (`STKZU`) without a VAT registration number. |
| AP228 | cross_field_check | Additional VAT number in LFAS does not start with the LFAS country code. |
| AP233 | cross_field_check | Active vendor linked to a customer (`LFA1.KUNNR`) that is flagged for deletion. |

## Duplicates and staleness

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP229, AP230, AP231 | uniqueness_check | Tax number 1, 2 or 3 shared by several vendors in one country (compared on letters and digits only). |
| AP232 | similarity_check | Identical or near-identical name in the same country and city. |
| AP234 | freshness_check | Active vendor not changed (`LFA1.UPDAT`) for more than three years. |

Identical bank accounts across vendors are already covered by `BKT025` and `XDUP003`, so no new rule was added for them.

## Bank data

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP235 | uniqueness_check | The same partner bank type used twice for one vendor. |
| AP236 | uniqueness_check | Several bank accounts without a partner bank type, so the payment program cannot choose. |
| AP237 | cross_field_check | Bank country differs from the vendor's address country. |
| AP238 | exists_check | Vendor bank account matches one of the company's own house bank accounts (T012K). |
| AP239 | exists_check | Bank key is flagged for deletion in BNKA. |

## Company code data and dunning

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP240 | exists_check | Payment terms are customer-only in T052. |
| AP242 | exists_check | House bank not defined for the vendor's company code (T012). |
| AP243, AP244 | referential_check, null_check | Sort key not in TZUN, or missing. |
| AP245 | exists_check | Accounting clerk not in T001S for the company code. |
| AP246 | uniqueness_check | Previous account number used by several vendors in one company code. |
| AP247 | cross_field_check | Withholding tax exemption certificate has expired. |
| AP248, AP249, AP250 | exists_check | Head office not created in the company code; head office is itself a branch; company-code alternative payee not created in the company code. |
| AP251 | cross_field_check | Deletion block and deletion flag set together in the company code. |
| AP252, AP253 | cross_field_check | Central posting block or central deletion flag, while the company code data is open. |
| AP254, AP255, AP256 | exists_check | Dunning data without company code data; dunning recipient missing or deleted; dunning clerk not in T001S. |

## Purchasing organisation data

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP241 | exists_check | Purchasing payment terms are customer-only in T052. |
| AP257 | cross_field_check | ERS active without GR-based invoice verification. |
| AP258 | null_check | Purchasing payment terms missing. |
| AP259 | cross_field_check | Incoterms set without a named place. |
| AP260, AP261 | cross_field_check | Central purchasing block or central deletion flag, while the purchasing organisation data is open. |
| AP262 | exists_check | Purchasing data but no company code data anywhere. |
| AP263, AP264 | exists_check | LFM2 data without LFM1 data, or active while LFM1 is flagged for deletion. |

## Partner functions

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP265, AP266 | exists_check | Partner vendor does not exist, is deleted, or is purchasing-blocked. |
| AP267 | exists_check | Partner functions for a purchasing organisation without LFM1 data. |
| AP268 | referential_check | Partner function not in TPAR. |
| AP269 | uniqueness_check | More than one default partner for the same function at purchasing organisation level. |
| AP270 | exists_check | Contact person partner not in KNVK. |
| AP271 | exists_check | Invoicing party (RS) has no company code data. |

## Contact persons and lifecycle

### Rules

| Rules | Class | What they check |
|---|---|---|
| AP272 | exists_check | KNVK contact person points at a vendor that does not exist. |
| AP273 | cross_field_check | Contact person assigned to a vendor and a customer at the same time. |
| AP274 | cross_field_check | Contact person active while the vendor is flagged for deletion. |
| AP275 | exists_check | Active vendor without company code data. |
| AP276 | exists_check | Vendor open for purchasing without purchasing organisation data. |

## Not covered, and why

- Payment methods `LFB1.ZWELS` against T042E: the field holds several one-character methods in one string, and no check class splits it.
- Number range by account group (T077K to NRIV): the interval check needs the range limits per group, and no class compares a value against a range from another table.
- Field status by account group: only generated rules can read it.
- Payment terms in LFB1 against LFM1: the engine has no join between company code and purchasing organisation for the same vendor.
- No posting activity: BSAK and the change documents are partial extracts, so inactivity cannot be proven from them.
- Withholding tax types (LFBW) against the country in T059P: this needs the company code country from T001, which the join path does not provide.
- Purchasing organisation against company code through T024E: no join is defined.
- Group key `KONZS`: free text with no reference.
- Quality block `SPERQ`: no check table in the DDIC.
- Incoterm location mandatory flag: the flag is not in the TINC extract.
- Tax number formats by country, IBAN consistency (TIBAN) and the reconciliation account against SKB1 are already covered by the banking and tax pack and by `XREC001`.

## Test support

The rule prover expects `(3, 1)` instead of `(2, 1)` for an `exists_check` whose target is the rule's own table and whose `target_when` requires one of the rule's reference fields to be populated (AP249). The target record the prover adds is then also a source record in scope.

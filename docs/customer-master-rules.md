# Customer master and business partner rules (ECC)

This change adds 106 rules for the ECC customer master and business partner. Each rule sits in the pack that owns its table:

- `accounts_receivable.yaml` gets AR210–AR254 (45 rules). These cover central data (KNA1), company code data (KNB1, KNB5), credit (KNKK) and bank details (KNBK).
- `sd_customer_master.yaml` gets SDCM208–SDCM242 (35 rules). These cover the sales area (KNVV), tax classification (KNVI), partner functions (KNVP), contact persons (KNVK) and unloading points (KNVA).
- `business_partner.yaml` gets BP201–BP226 (26 rules). These cover customer/vendor integration (CVI links), BUT000, roles (BUT100), addresses (BUT020) and bank details (BUT0BK).

Checks that existing rules already make are not repeated. For example, the date order checks are BP048 and BP049, and the credit account check is S4R-CRM-KNKLI-KKBER.

Every rule uses only fields from the ECC 6 data dictionary bundle (`sap/dictionaries/ecc6`). The missing tables (KNVA and 15 check tables) and 8 domains were generated with `scripts/build_ddic_bundle.py` and are committed. Every rule passes the generic proof in `tests/checks/test_rule_proofs.py`, which builds one passing record and one failing record from the dictionary. Hand-written pass/fail fixtures are in `tests/test_customer_bp_depth_rules.py`.

Joins added to `sap/dictionaries/joins.yaml`:

- KNA1 to KNVP, KNVI and KNVA.
- BUT000 and KNA1 to CVI_CUST_LINK.
- BUT000 and LFA1 to CVI_VEND_LINK.

These joins let a rule compare a sales area, a partner function or a CVI link with its customer, vendor or business partner.

## Personal data

No message, template or evidence field shows a name, address line, bank account, IBAN, tax number or birth date:

- Templates name only keys: customer, company code, sales area, partner, contact person number and bank details ID.
- The two similarity rules report the account or partner number as their evidence key, never the matched name.
- `BIRTHDT`, `DEATHDT`, `PFACH`, `PSTL2` and `BKONT` are added to `_SENSITIVE_EXACT` in `checks/profiling.py`, so profiling masks them like the other personal fields.
- The test suite checks that no new template refers to a personal field.

## Coverage by view

| Pack | View | Tables (rules) | Rules |
|------|------|----------------|-------|
| AR | General data | KNA1 (7) | 7 |
| AR | One-time accounts | KNA1 (4) | 4 |
| AR | Lifecycle across levels | KNA1 (3), KNB1 (3) | 6 |
| AR | Address and tax data | KNA1 (10) | 10 |
| AR | Company code data | KNB1 (12), KNB5 (1) | 13 |
| AR | Credit management | KNKK (4) | 4 |
| AR | Bank details | KNBK (1) | 1 |
| SDCM | Sales area against central data | KNVV (5) | 5 |
| SDCM | Sales area data | KNVV (10) | 10 |
| SDCM | Tax classification | KNVV (1), KNVI (3) | 4 |
| SDCM | Partner functions | KNVP (6), KNVV (1) | 7 |
| SDCM | Contact persons and unloading points | KNVK (6), KNVA (3) | 9 |
| BP | Customer/vendor integration | CVI_CUST_LINK (5), CVI_VEND_LINK (5) | 10 |
| BP | General data | BUT000 (5) | 5 |
| BP | Lifecycle and staleness | BUT000 (4) | 4 |
| BP | Roles | BUT100 (1) | 1 |
| BP | Addresses | BUT020 (1) | 1 |
| BP | Bank details | BUT0BK (3) | 3 |
| BP | Duplicates | BUT000 (2) | 2 |
| **Total** | | | **106** |

### By dimension

| Dimension | Rules |
|-----------|-------|
| Consistency | 50 |
| Validity | 33 |
| Completeness | 13 |
| Uniqueness | 8 |
| Timeliness | 2 |

### By severity

| Severity | Rules |
|----------|-------|
| Critical | 2 |
| High | 23 |
| Medium | 39 |
| Low | 42 |

### By check class

| Check class | Rules |
|-------------|-------|
| cross_field_check | 33 |
| referential_check | 32 |
| exists_check | 25 |
| null_check | 7 |
| uniqueness_check | 6 |
| similarity_check | 2 |
| regex_check | 1 |

## What the rules cover

- **Central data (KNA1):**
  - Industry, trading partner, customer classification and tax jurisdiction against their check tables.
  - A jurisdiction code is required for US and Canadian customers.
  - The fiscal address account must exist, must be active and must not point to the customer itself.
- **One-time accounts:**
  - The one-time indicator must match the account group (T077D.XCPDS) in both directions.
  - A one-time account must not have a credit limit or master bank details.
- **Lifecycle:**
  - The deletion flag must come with a posting block.
  - The deletion block and the deletion flag must not both be set, centrally or in the company code.
  - A central deletion flag or posting block must also appear in the company code, the sales area and on contact persons.
  - A deleted customer must not keep a credit limit.
- **Address and tax data:**
  - KNA1.ADRNR must exist in ADRC.
  - The KNA1 copies of country, postal code, city and region must agree with ADRC.
  - A PO box needs its own postal code.
  - An Indian GSTIN must have the correct format.
  - Tax numbers 2 and 3 must not be shared within a country.
  - Names must not be near-identical within a city.
- **Company code data (KNB1, KNB5):**
  - The reconciliation account must exist in SKB1 for the company code.
  - The clerk, interest indicator, tolerance group, lockbox, sort key, payment method supplement and statement indicator must exist in their check tables.
  - Customers that are not deleted need a sort key and an accounting clerk.
  - The head office must exist in the company code and must not be a branch itself.
  - The alternative payer must be active.
  - A dunning level needs the date of the last dunning notice.
- **Credit (KNKK):**
  - The credit representative group and the credit group must exist in their check tables.
  - A customer with a credit limit needs a credit representative group.
  - A credit limit is reported as stale when the customer has not paid for more than two years.
- **Bank details (KNBK, BUT0BK):**
  - Spanish, French and Italian accounts need the bank control key.
  - A business partner's bank must exist in BNKA and must not be flagged for deletion.
  - An IBAN must not be shared between bank details.
- **Sales area (KNVV):**
  - Currency, exchange rate type and customer groups 1–5 must exist in their check tables.
  - The sales area payment terms should match the payment terms of at least one company code.
  - The unlimited overdelivery flag and an overdelivery tolerance must not both be set.
  - The credit control area must have a credit master for the customer.
- **Tax classification (KNVI):**
  - Every customer with sales areas needs at least one tax classification row.
  - Each row needs a classification that exists in TSKD.
  - The tax category must be a condition type.
- **Partner functions (KNVP):**
  - Each sales area must have a sold-to partner.
  - Partner functions of type customer must name a customer.
  - Partner customers must not have an order block.
  - A payer must not be blocked for posting.
  - Contact person and vendor partners must exist and be active.
  - The partner function must exist in TPAR.
- **Contact persons and unloading points (KNVK, KNVA):**
  - Orphan rows are reported.
  - Department, function, VIP indicator, language, calendar and goods receiving hours must exist in their check tables.
- **Business partner:**
  - CVI links must point to an existing partner. Each customer or vendor must be linked to only one partner.
  - The partner of a linked customer needs the FLCU00 role; the partner of a linked vendor needs FLVN00.
  - The partner's archiving flag must agree with the deletion flag of the linked account, in both directions.
  - The legal form, industry and legal entity must exist in their check tables.
  - A person must not carry organisation data, and an organisation must not carry person data.
  - A liquidated organisation or a deceased person must be blocked or archived.
  - The archiving flag needs the central block.
  - A partner that has waited for release for more than 30 days is reported.
  - The contact person and employee roles are allowed only on persons.
  - An address assignment must exist in ADRC.
  - Persons must not share the same name and date of birth.
  - Organisation names must not be near-identical within a country and postal code.

## Checks the engine cannot express yet

- **KNB1 against KNVV:** comparing company code data with sibling sales areas, for example payment terms per sales area against each company code individually. SDCM213 only checks that the terms match some company code.
- **Payment methods (KNB1.ZWELS):** a direct-debit payment method needs bank details or a mandate. That needs a test of whether a character list contains a value, plus a downward join to KNBK.
- **Number ranges:** checking a business partner number against the NRIV interval of its grouping (BU_GROUP). No check class compares a value with a range taken from another table.
- **Conditions with OR or dates in `target_when`:** for example "head office missing, deleted or blocked" as one rule, or validity windows on the target row.
- **Counts per parent:** exactly one default unloading point (KNVA.DEFAB), one default address (BUT020.XDFADR) or one default partner per function (KNVP.DEFPA).
- **Aggregation upwards:** "every company code is deleted but the central record is not" needs an all-children test.
- **KNVI per departure country:** finding the departure countries of the delivering plants needs plant and sales area joins that the engine cannot traverse.
- **FLCU01 when sales data exists:** this needs a downward path from BUT000 through CVI_CUST_LINK and KNA1 to KNVV.
- **Validity of BUT100 and BUT0BK:** VALID_FROM and VALID_TO are DEC15 time stamps, which the cross-field date handling does not parse.
- **KNVP.PERNR against HR:** the personnel master is in another module's pack and has no join.
- **BUT000.XBLCK against KNA1.SPERR:** the CVI mapping of the central block depends on customising, so no rule was written.

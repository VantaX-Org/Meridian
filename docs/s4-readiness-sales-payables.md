# S/4HANA readiness: sales and payables

This layer adds 56 conversion and migration-readiness rules to the sales order (SDSO312-340), customer master (SDCM243-249), receivables (AR255-266) and payables (AP277-284) packs. Each rule carries `s4_area`, `s4_impact` and `simplification_item`, so the roll-up in `s4_readiness.yaml` picks it up. Existing rules that already cover an item are tagged into the `related` lists of the matching area instead of being duplicated.

## Item by object by rule count

| Simplification item | Area | Objects (new rules) | New | Existing rules re-tagged |
|---|---|---|---|---|
| Credit Management, FI-AR-CR to FIN-FSCM-CR | credit_management | T014 (2), T691A (1), KNKA (2), KNKK (1), KNVV (1), VBAK (1) | 8 | 7 blocking, 13 warning |
| SD Rebate Processing to Settlement Management | sales | KONA (10), KONH (1) | 11 | 11 pricing condition rules (SDSO046-054, 280, 309) |
| Output management, NAST to S/4HANA Output Management | output_management | NAST (8), KNVD (6) | 14 | none |
| SD Foreign Trade to Global Trade Services | foreign_trade | EIKP (1), EIPO (3), LIKP (1) | 5 | none |
| SD Revenue Recognition to Revenue Accounting and Reporting | revenue_recognition | VBKD (2) | 2 | none |
| Business Partner approach (customer and vendor side) | business_partner | KNA1 (3), KNB1 (1), KNBK (2), LFA1 (6), LFB1 (2), VBAK (1), NAST (1, deletion candidate) | 16 | AR059, AR071, AP075, AP092, AP233 |

Area counts come from the `s4_area` tag on each rule; objects are the rule's primary field table.

## Where each requested item lands

- Credit: central limit versus area limit, currency, missing area data, credit segment mapping for T014, KNVV and VBAK, risk category consistency. Existing credit rules (AR019, AR044-048, AR073-074, AR201, AR209, AR222, AR250, SDSO202-209, SDSO310-311, SDCM039, SDCM222) are tagged as related.
- Rebates: expired and active agreements that are not finally settled, settlements in progress, orphan condition records, recipient and currency checks. Agreements with no valid conditions cannot be expressed (see below).
- Output management: unknown output type and medium, telex and fax media, stale unprocessed or failed output, processed records ready for deletion, partner existence, missing print device, customer output master consistency.
- Foreign trade: item commodity code and origin, header references, destination country, delivery link.
- Customer and vendor master: language key, reconciliation account in the company code, bank holder and bank type uniqueness, linked customer-vendor tax number, VAT number, country and deletion-flag mismatch, one-sided KNA1-LIFNR link.
- Archiving candidates: customers, vendors and their company code data flagged for deletion with no open items. Open items on blocked or deleted accounts are already covered by AR059, AR071, AP075 and AP092.
- Pricing conditions with obsolete access: the existing KONH, KONP and access-table rules are re-tagged. No new rule was added because no certain list of obsolete access tables exists.

## Overlap with other rules

AR264 (customer links to a vendor that does not link back) overlaps the vendor-does-not-exist case of the existing S4R business partner rule on the same link. The new rule adds the case where the vendor exists but points elsewhere. XLNK001 already covers plain reciprocity.

## Not expressible, left out

- Agreements with no condition records or no valid conditions: KONH is a windowed table and cannot be an exists target.
- Archiving of cleared items: BSAD and BSAK are windowed to 12 months, so older cleared items are invisible.
- Foreign trade documents as a whole: every row needs migration, so there is no passing record.
- Rejected items that still carry a revenue recognition category: no join path from VBKD to VBAP.
- Promotions and sales deals (KONH.KNUMA_PI, KNUMA_AG) and legacy foreign trade configuration (T606): S/4HANA status uncertain, left out.
- Customer title versus address title: the field holds a code on one side and a text on the other.

## Supporting changes

- DDIC table files for EIKP, EIPO, KNKA, KNVD, KONA, NAST, T606, T685B, TNAPR and the domains they use.
- Joins KNA1 to KNKA (one) and KNA1 to KNVD (many).
- NAST extraction window of 24 months, so the 12-month deletion rule can see old processed output.
- Pinned counts in `tests/checks/test_ecc_remaining_rules.py` raised by 56 (total 1740).

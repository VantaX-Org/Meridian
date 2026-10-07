# Warehouse, Ariba and Concur rules

The depth pass adds 163 rules to 14 packs (9 warehouse, 3 Ariba, 2 Concur) and 8 S/4HANA readiness rules to `checks/rules/ecc/s4_readiness.yaml`. No new check class and no new pack were added. Every rule has the full metadata set and is proven by `tests/checks/test_rule_proofs.py`. `tests/test_warehouse_cloud_depth_rules.py` holds the integrity checks, pass/fail fixtures and the conditional-branch proofs.

Rules use SAP DDIC fields (`sap/dictionaries/ecc6/tables`) for the ECC based packs and the canonical YAML fields for Ariba, Concur, fleet and integration. Rules that depend on a state (for example an open shipment or a pending approval) use `applies_when`, and the tests show the record is skipped when the condition is false and flagged when it is true.

## Topics

- Stock quality (EWMS113-130): quants against storage units, bins and materials, negative or inconsistent quantities, blocked and expired stock, inventory in progress.
- Transfer orders (EWTO109-118): stale unconfirmed orders, source and destination bins that do not exist (interim storage types excluded), special stock without a special stock number.
- WM interface (WMI024-036): material storage type data against bins, movement types in T333, putaway and removal strategy consistency.
- Batch management (BATCH025-040): expired batches with unrestricted stock, blocked batches with stock, shelf-life consistency, batch extension to plants.
- Transport management (TM038-050): routes against TVRO, open shipments past departure, duplicate delivery assignments.
- Fleet management (FLEET036-049): odometer and engine hours, fleet equipment master consistency (conditional on the fleet indicator).
- GRC (GRC027-041): role certification periods and due dates, critical role levels, active SoD risks without actions or permissions.
- MDG (MDG027-035): change request lifecycle, release timestamps, data activation (conditional on request status).
- Cross-system integration (XSYS028-032): object key consistency per object type.
- Ariba (ARP017-027, ARC010-016, ARS008-014): order and invoice amounts and currency, company code on live orders, contract expiry for live contracts, supplier to ERP vendor link.
- Concur (CNE021-040, CNU010-014): approval workflow state (approved date, approver, ageing of pending reports), exceptions on approved reports, exchange rates, duplicate entries, active users without cost centre, inactive users as archive candidates.

## Coverage by view

A view here is a rule pack. The table lists the tables each pack's new rules are anchored on and how many rules each table carries.

| View | Tables (rules) | Rules |
|---|---|---|
| ariba_contracts | ARIBA_CONTRACT 7 | 7 |
| ariba_procurement | ARIBA_INVOICE 4, ARIBA_PO 7 | 11 |
| ariba_supplier | ARIBA_SUPPLIER 7 | 7 |
| batch_management | MARA 2, MCH1 8, MCHA 1, MCHB 5 | 16 |
| concur_expense | CONCUR_ENTRY 8, CONCUR_REPORT 12 | 20 |
| concur_users | CONCUR_USER 5 | 5 |
| cross_system_integration | XSYS 5 | 5 |
| ewms_stock | LAGP 2, LEIN 3, LQUA 13 | 18 |
| ewms_transfer_orders | LTAK 2, LTAP 8 | 10 |
| fleet_management | EQUI 2, EQUZ 2, FLEET 5, FLEET_MASTER 4, ILOA 1 | 14 |
| grc_compliance | GRACROLE 9, GRACSODRISK 4, GRACUSERROLE 2 | 15 |
| mdg_master_data | USMD120C 8, USMD1213 1 | 9 |
| transport_management | TVRO 2, VTTK 10, VTTP 1 | 13 |
| wm_interface | MLGN 5, MLGT 3, T301 1, T302 1, T333 3 | 13 |
| **Total** | | **163** |

### By dimension

| Dimension | Rules |
|---|---|
| consistency | 61 |
| completeness | 58 |
| validity | 24 |
| timeliness | 9 |
| accuracy | 7 |
| uniqueness | 4 |
| **Total** | **163** |

### By severity

| Severity | Rules |
|---|---|
| high | 65 |
| medium | 64 |
| low | 33 |
| critical | 1 |
| **Total** | **163** |

### By check class

| Check class | Rules |
|---|---|
| cross_field_check | 114 |
| exists_check | 33 |
| freshness_check | 6 |
| uniqueness_check | 4 |
| domain_value_check | 4 |
| null_check | 2 |
| **Total** | **163** |

## S/4HANA readiness

Eight rules were added to `s4_readiness.yaml` under the area `warehouse_ewm`, citing the simplification item "Warehouse Management (LE-WM) in Compatibility Scope, replaced by SAP EWM". Five are blocking and three are warnings.

| Rule | Impact | What it catches |
|---|---|---|
| S4R-WM-QUANT-NEG | blocking | Negative quants, which have no EWM equivalent |
| S4R-WM-TO-OPEN | blocking | Open transfer order items that need confirmation (only where confirmation is required) |
| S4R-WM-INV-QUANT | blocking | Quants in an open inventory document |
| S4R-WM-INV-BIN | blocking | Bins with an active inventory indicator |
| S4R-WM-MLGT-BIN | blocking | Fixed bin of a material that is not a bin master (only where a bin is assigned) |
| S4R-WM-QUANT-EXPIRED | warning | Expired quants, scrap or archive candidates |
| S4R-WM-LEIN-EMPTY | warning | Storage units with no quant, archive candidates |
| S4R-WM-QUANT-BLOCKED | warning | Blocked quants that hold stock |

Existing and new pack rules were also tagged into the area `related` lists:

- `warehouse_ewm` (new area): blocking EWMS113-119, 129, 130, EWTO110-114, WMI022, 024, 025, 032-036, BATCH025, 026, 038. Warning EWMS120-125, 128, EWTO109, 116-118, BATCH020, 021, 023, 027, 031, 034, 040, WMI023, 026, 027.
- `ariba_integration` (new area, Business Partner approach): blocking ARS009, ARP003, 004, 015, 027, ARC005, 006, 014. Warning ARP008, 018, 021, ARC013, ARS012.
- `concur_integration` (new area, Universal Journal cost object mapping): blocking CNE003, 004, CNU007, 010, 012. Warning CNE028, 029, CNU011, 013.

## Left out or not expressible

- Handling units (T331, T156, VEKP, VEPO): not in the DDIC.
- T333 default-value enforcement, and LTAK.TRART against T333.TRART (needs a new join).
- LAGP.ANZQU against the real quant count (aggregate against a counter field).
- Cross-system object missing in the other system; XSYS OBJECT_KEY against MATNR, LIFNR or KUNNR; referential checks of XSYS against local tables; XSYS null checks for WERKS, KOSTL, PERNR.
- GJAHR against the posting date year.
- Ariba and Concur STATUS domains: values not verified, so no domain rules.
- Concur approver-inactive checks (existing rules cover it); Concur cost centre against CSKS.
- Supplier management vendor to ERP vendor link, tax IDs and bank details.
- FLEET.NUM_AXLE negative: string-typed numeric field.
- MDG USMD1213.USMD_VALUE with no entity: not provable.
- Duplicates deliberately skipped: MDG022, XSYS014-016, XSYS019.
- No new Ariba or Concur readiness rules, only tags: the Ariba ERP vendor ID to LFA1 join is unverified.
- No bin "no activity for years" archive rule: date arithmetic across fields is not safely expressible.
- EWM /SCWM/ rules are not tagged, because they describe target state and not WM-to-EWM blockers.

## Assumptions to confirm

- Interim storage types excluded from EWTO110 are the standard 9xx types.
- The 90 day (2160 h) age for unconfirmed transfer orders and the 30 day pending approval age are defaults.

# S/4HANA readiness: logistics layer

Rules in `checks/rules/ecc/s4_readiness.yaml` for material, MRP, material ledger, purchasing, production, plant maintenance, foreign trade, archiving and batch/serial data. Existing rules from the material, purchasing, production and plant maintenance packs are linked through each area's `related` list instead of being repeated.

## Item by object by rule count

| Simplification item | Object (table) : rules | Total |
|---|---|---|
| Business Partner Approach (SAP Note 2265093) | CRHD: 1, EBAN: 2, EINA: 1, EKKO: 10, EORD: 1, EQUI: 1, IHPA: 1, LFM1: 1, PLPO: 1 | 19 |
| Data volume reduction before conversion (archiving) | AUFK: 2, EINA: 1, EKKO: 2, EKPO: 1, EORD: 1, EQUI: 1, IFLOT: 1, MARA: 2, MARC: 1, MARD: 1, MBEW: 1, MCH1: 2, MCHA: 1 | 17 |
| Foreign Trade in SD replaced by SAP Global Trade Services | EKKO: 1, MARC: 9 | 10 |
| MRP Live (MRP run on SAP HANA) | MARC: 2, MDMA: 1 | 3 |
| Material Ledger Obligatory for Material Valuation | MARC: 1, MBEW: 6 | 7 |
| Migration cockpit load objects for logistics master and transaction data | AFIH: 1, AUSP: 1, EINA: 1, EINE: 1, EQUI: 1, EQUZ: 1, INOB: 1, MAPL: 1, MARA: 2, MARC: 2, MARD: 1, MARM: 1, MCHA: 1, MCHB: 1 | 16 |
| Production version mandatory for BOM selection | MAPL: 1, MKAL: 1 | 2 |
| Storage Location MRP | MARD: 5, MDMA: 1, T001L: 1 | 7 |

Total new rules: 81.

## Areas

| Area | New rules | Blocking | Warning |
|---|---|---|---|
| archiving | 17 | 0 linked | 0 linked |
| batch_serial | 4 | 0 linked | 4 linked |
| foreign_trade | 10 | 0 linked | 4 linked |
| material | 5 | 4 linked | 2 linked |
| material_ledger | 6 | 0 linked | 6 linked |
| mrp | 10 | 0 linked | 5 linked |
| plant_maintenance | 7 | 0 linked | 7 linked |
| production | 5 | 0 linked | 6 linked |
| purchasing | 17 | 0 linked | 9 linked |

## Not expressible with the current check classes

- Zero-padding of numeric material numbers (conversion exit MATN1): the extract normalises the number on read, so an unpadded value cannot occur in the data.
- Material type or industry sector against valuation class: needs the valuation class assignment tables joined to MBEW and MARA.
- Whether a customer-defined MRP type or lot-size key has an S/4HANA equivalent: customising is not read, so the rules flag customer-defined keys as a proxy.
- Work centre validity end for routing operations: the proof harness cannot model a comparison against today on a target table.
- Foreign trade data in retail article tables, serial number tables and batch configuration tables: not in the dictionary bundle.
- Maintenance orders on deleted functional locations: the order table field for the location is not in the dictionary.

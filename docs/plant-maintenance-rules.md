# Plant maintenance rules (ECC)

This change adds 117 rules (PM202-PM318) to `checks/rules/ecc/plant_maintenance.yaml`. The pack now holds 188 rules. The 71 existing rules are not repeated.

Every rule uses only fields from the ECC 6 data dictionary bundle (`sap/dictionaries/ecc6`). Missing tables and domains were generated with `scripts/build_ddic_bundle.py`. One join was added to `sap/dictionaries/joins.yaml`: MPLA to MPOS on WARPL, so an item can be compared with its plan.

## Material supersession

Spare parts and equipment construction types can point at a material that is discontinued (MARC.KZAUS = X). Each source field has two rules: one when a follow-up material exists in MARC.NFMAT (replace the part), one when none exists (find a substitute). The sources are EQUI.MATNR, EQUZ.SUBMT, IFLOT.SUBMT, MPOS.BAUTL, MPOS.SERMAT and STPO.IDNRK. Further rules flag a deletion flag in MARC.LVORM on the construction type, and a bill of material item whose follow-up equals the component. STPO has no plant, so BOM checks look at any plant.

## Coverage by view

| View | Tables | Rules |
|---|---|---|
| Equipment | EQUI, EQUZ, EQKT, EQST | 23 |
| Functional location | IFLOT, IFLOTX | 11 |
| Location and account assignment | ILOA | 9 |
| Measuring points | IMPTT | 14 |
| Maintenance plans | MPLA, MMPT | 17 |
| Maintenance items | MPOS | 19 |
| Task lists | PLKO, PLPO | 13 |
| BOM (spare parts) | STPO, PLMZ | 5 |
| Partners and classification | IHPA, INOB, KSSK | 6 |

## View by table by rule count

| View | Table | Rules |
|---|---|---|
| Equipment | EQUI | 13 |
| Equipment | EQUZ | 8 |
| Equipment | EQKT | 0 |
| Equipment | EQST | 2 |
| Functional location | IFLOT | 10 |
| Functional location | IFLOTX | 1 |
| Location and account assignment | ILOA | 9 |
| Measuring points | IMPTT | 14 |
| Maintenance plans | MPLA | 10 |
| Maintenance plans | MMPT | 7 |
| Maintenance items | MPOS | 19 |
| Task lists | PLKO | 3 |
| Task lists | PLPO | 10 |
| BOM (spare parts) | STPO | 4 |
| BOM (spare parts) | PLMZ | 1 |
| Partners and classification | IHPA | 2 |
| Partners and classification | INOB | 2 |
| Partners and classification | KSSK | 2 |

## By dimension

| Dimension | Rules |
|---|---|
| consistency | 70 |
| completeness | 20 |
| lifecycle | 14 |
| validity | 8 |
| uniqueness | 5 |

## By severity

| Severity | Rules |
|---|---|
| medium | 60 |
| high | 49 |
| low | 8 |

## By check class

| Check class | Rules |
|---|---|
| exists_check | 64 |
| cross_field_check | 29 |
| null_check | 16 |
| uniqueness_check | 5 |
| regex_check | 2 |
| domain_value_check | 1 |

## Not expressible with the current check classes

- Item count against MPLA.ANZPS.
- Functional location hierarchy prefix against the superior location.
- Several concurrent active statuses in JEST.
- Orphan ILOA rows, which need a union across all referring tables.
- IFLOT.IEQUI installation permission, because the population cannot be limited to equipment.
- EQUI.WARPL consistency.
- Configuration table checks (for example T370S, T399I), which have no reference values.
- Equipment and location partner orphans by OBJNR prefix: the proof harness cannot generate a prefix-scoped population, so these were left out.
- Target value inside the measurement range: FLTP fields are not provable by the harness, so it was left out.

## Assumptions to confirm

- Partner function VN is the vendor.
- Item plan category values A, E and T.
- Classification links use object table EQUI or IFLOT in INOB.

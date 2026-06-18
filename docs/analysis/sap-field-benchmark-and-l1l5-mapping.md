# SAP Field Benchmark & L1–L5 Process Mapping — Analysis

**Status:** analysis + remediation in progress
**Date:** 2026-06-18
**Scope:** SPRO config layer, master-data dictionary, DQ rule set, and the L1–L5 process model.
**Method:** read-only inventory of `sap/`, `checks/`, `api/services/config_intelligence/`, plus a backend code graph (`graphify-out/graph.json`). No runtime/DB inspection.

---

## 1. What exists today

| Asset | File | Substance |
|---|---|---|
| SPRO registry | `sap/spro_tables.py` | 18 modules, 58 customising-table entries. Each entry: `table`, `fields`, `governs_fields` (e.g. `T077Y` → `LFA1.KTOKK`), `impacts_features`, `connector`, `read_method`. |
| Baseline values | `sap/baseline_config.py` | Shipped SAP defaults for **only 2 system types** (`ecc`, `successfactors`). e.g. `T077Y` → account groups 0001/0002/0003/CPD/KRED. |
| SPRO reader | `api/services/spro_reader.py` | `read_config(module)` → live RFC first, silent baseline fallback. `get_valid_values(module, field)` pulls the enum a config table governs. |
| Data dictionary | `sap/data_dictionary.py` | 33 tables, ~500 fields. Per field: `description`, `data_type`, `length`, `key`, `mandatory`, `valid_values`, `config_table`, `sap_help`, `standard_values`, `processes`, `tcodes`. |
| DQ rules | `checks/rules/**/*.yaml` | **541 rules** (not the "254+" advertised). Each: `field`, `check_class`, `allowed_values`, `rule_authority`, `sap_impact`, `why_it_matters`, `severity`, `dimension`. |
| Config Intelligence | `api/services/config_intelligence/` | 3 layers — Discovery (`discovery.py`), Process Detection (`process_detector.py`, 7 processes), Alignment Validation (`alignment_validator.py`, 8+ check categories + CHS score). |
| L1–L5 process map | `sap/process_definitions.py` | Full L1→L5 hierarchy for **PTP + OTC only**. Each L5 field carries `field` / `check_id` / `config_source` / `mandatory`. |

The raw material for "what SAP intends this field for" already lives in code in three independent forms: the dictionary's `sap_help`/`valid_values`/`config_table`, the rule's `rule_authority`/`sap_impact`, and the SPRO entry's `governs_fields`/`config_context`.

---

## 2. Analysis A — field benchmark vs SAP-intended use

**Verdict: only partially possible today.** Three structural gaps block a full benchmark.

### Gap 1 — Field-status is hardcoded, not derived from SPRO  *(highest-value gap)*
SAP decides mandatory/optional/suppressed per field via **field-status groups** (`T077S`, `T078*`, account-group → field-status linkage). Meridian registers `T077Y`/`T077D` but reads only the account-group key + text — **not the field-status tables**. "Mandatory" is therefore a static boolean in two places that are never reconciled with live config:

- `sap/process_definitions.py` — L5 fields: `"mandatory": True`
- `sap/data_dictionary.py` — field metadata: `"mandatory": True`

Consequence: Meridian **cannot today answer** "this record is missing a field that SAP's field-status config marks *Required* for its account group" — the single highest-value MDM benchmark.

### Gap 2 — Dictionary and rules are isolated islands
`checks/` never imports `DATA_DICTIONARY` (grep: 0 matches). A rule's `allowed_values` is never cross-checked against the dictionary's `valid_values`, nor against the SPRO table the dictionary points at via `config_table`. Real drift found:

```
MARA.MBRSH (Industry Sector)
  data_dictionary valid_values: [A, C, M, P, V]
  rule MM006 allowed_values:   [M, C, P, E, A]
  → "E" valid in rule, absent from dictionary; "V" valid in dictionary, absent from rule. Silent.
```

That mismatch ships to a customer with zero warning — multiplied across 541 rules.

### Gap 3 — Coverage holes
Per-module rule counts expose dead modules despite full dictionary + SPRO + process coverage:

| Module | Rules | Module | Rules |
|---|---|---|---|
| material_master | 143 | **fi_gl** | **0** |
| mm_purchasing | 45 | **accounts_receivable** | **0** |
| business_partner | 43 | **sd_customer_master** | **0** |
| employee_central | 43 | compensation/benefits/payroll | **0** |
| accounts_payable | 39 | batch/grc/mdg/transport/wm | **0** |

`material_master` alone is 26% of all rules; **fi_gl, AR, and customer master have zero rules.**

### Recommendation A
1. **SPRO field-status reader** — register `T077S`/`T078*` + field-status-group config, read in `spro_reader.py`, expose `get_field_status(module, account_group, field) → required|optional|suppressed`. Turns "mandatory" from a guess into a config-grounded fact. *(Addressed by feature (b).)*
2. **Rule↔dictionary reconciler** — startup/CI validator asserting `rule.allowed_values ⊆ dictionary.valid_values` and reporting `mandatory: True` dictionary fields with no `null_check`. *(Addressed by feature (c).)*
3. **Fill zero-rule modules** — fi_gl, AR, sd_customer_master first.

---

## 3. Analysis B — SAP process flow → L1–L5 field mapping

**Core finding: two independent process models exist and disagree on coverage.**

| | `sap/process_definitions.py` | `config_intelligence/process_detector.py` |
|---|---|---|
| Processes | **2**: PTP, OTC | **7**: OTC, PTP, RTR, PTP_MFG, MTO, HTR, STC |
| Depth | Full **L1→L5** (L5 = `table.field` + `check_id` + `config_source` + `mandatory`) | Step-level only — **no L5 field map** |
| Purpose | Process-readiness doc, DQ-enriched | Process-health detection (step presence, bottleneck, exception rate) |
| Mining? | Static hierarchy | Predicate step-match; **`cases_supported=False`** — no event-log/case traces |

The L1–L5 field map exists **only for PTP + OTC (ECC)**. The 7-process detector knows the *flow* of five more processes but maps **no fields** to them.

### Missing L1–L5 maps
| Process | SAP name | Anchor module | Detector knows flow? | L5 field map? |
|---|---|---|---|---|
| RTR | Record-to-Report | fi_gl | yes | no (and fi_gl has 0 rules) |
| HTR | Hire-to-Retire | SuccessFactors EC | yes | no |
| PTP_MFG | Plan-to-Produce | production_planning | yes | no |
| MTO | Maintain-to-Operate | plant_maintenance | yes | no |
| STC | Source-to-Contract | mm_purchasing / Ariba | yes | no |
| ATR | Acquire-to-Retire | asset_accounting | no | no |
| EWM | Warehouse fulfilment | ewms_* | no | no |

### Two caveats on "process mining"
1. **It's projection, not mining.** `api/routes/process_mining.py` projects the static hierarchy and sets `cases_supported=False` ("true case-level event traces need a change-log/event-log pipeline that hasn't shipped"). The detector's `exception_rate`/`bottleneck` is a volume-drop heuristic, not trace-based conformance.
2. **L5 `mandatory` inherits Gap 1** — the readiness doc's mandatory flags are the same hardcoded booleans.

### Recommendation B
1. **Unify the two models** — make `process_definitions.py` the single L1–L5 source; have the detector reference its L5 maps instead of separate step predicates.
2. **Extend L1–L5 to RTR + HTR first** — RTR because fi_gl is a zero-rule/zero-map hole; HTR because it covers the whole SuccessFactors side.
3. **True mining** needs a net-new event-log builder (case_id = object key, activity = tcode/step, timestamp = change-doc/CDHDR).

---

## 4. Net

Both capabilities sit on solid foundations but share one root gap: **SAP field-status config is never read, so "what SAP intends for this field" is hardcoded.** Fixing the field-status reader sharpens both at once — the benchmark gains a config-grounded baseline and the L1–L5 `mandatory` flags become real.

**Remediation tracked in this work stream:**
- (b) SPRO field-status reader → Gap 1
- (c) Rule↔dictionary reconciler → Gap 2 (+ coverage report → Gap 3 visibility)

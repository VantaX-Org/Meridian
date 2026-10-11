# As-is process discovery (L1 to L5), Signavio export and the process analyst role

Date: 2026-10-11. Branch: `feat/premium-redesign`. Status: binding design.

This spec covers three requirements:

1. "the scan of the system to do the as is business process flows to a level 5 automatically from the connected system, for all processes."
2. "it should be in a format to export to signavio"
3. "this will be a separate role"

Meridian reads event data from the connected system and writes it to a tenant event log. It mines the log, then generates an L1 to L5 process model for each of the 13 L1s in the reference set. The model is exported as a BPMN 2.0 package that Signavio can import. A new `process_analyst` role runs and exports discovery.

When a source cannot be read, Meridian still shows the reference model and config overlay for that L1. These views are labelled "reference, not discovered".

Each section below is binding. Where the brief was ambiguous, this spec picks one answer and lists it in §12 (Rulings).

---

## 0. Ground truth this design rests on

| Fact | Where |
|---|---|
| Hierarchy names: L1 end-to-end process, L2 process area, L3 process, L4 sub-process (one diagram), L5 activity | `sap/process_definitions.py:3-9` |
| Static reference L1s: PTP `:33`, OTC `:267`. Their diagrams are built by `_diagram` at `:513` with the gateways `_GATEWAYS` at `:507-510` | `sap/process_definitions.py` |
| The other 11 L1s come from `_AREAS` (`:55-285`) and `_EXTRA_L2` (`:288`), and are merged by `extend_hierarchy` (`:406`) | `sap/process_templates.py` |
| `reference_document()` returns all 13 L1s. ID shape: L2 `<L1>-XX`, L3 `<L2>-P1`, L4 `<L2>-<TCODE>`, L5 `<L4>-NN` | `sap/process_definitions.py:574` |
| Model types: `ID_PATTERN` `^[A-Z0-9_]+(-[A-Z0-9_]+)*$`, `Source = Literal["template","config"]`, and `L5`, `L4`, `L3`, `L2`, `L1`, `ProcessModelDocument` | `api/models/process_model.py:12`, `:18`, `:61`, `:101`, `:120`, `:128`, `:136`, `:145` |
| ABAP extraction is planned from rules (`plan_modules`), not from the registry. It supports windows, `via` parent-key IN-lists of 60 values, and DDIC field checks | `sap/extraction_plan.py:219`, `:365`, `:376` |
| Special-purpose modules follow one pattern, `PROVEN_COST_MODULE` / `PROVEN_COST_DATA` / `_PROVEN_COST_TRIGGER` | `sap/extraction_plan.py` (module constants block after `:47`) |
| Each table has one window, shared by all modules: `EKKO BEDAT 24m`, `VBAK ERDAT 24m`, `BKPF BUDAT 3m`, `CDHDR UDATE 3m`, `LTAK BDATU 6m` and so on | `sap/dictionaries/extraction_windows.yaml` |
| The join graph in `joins.yaml` is also the check engine's grain graph (`checks/frames.py` `_graph`). `via_filters` reads that same graph | `sap/extraction_plan.py:22`, `:376-384` |
| Live reads use RFC_READ_TABLE through `read_table_full` (page size 50,000). SE16N is never used | `sap/rfc.py:139`; `api/services/connectivity_manager.py:319-332` |
| Cloud entity sets come from the registry: SF EmpJob `:903`, JobRequisition `:1155`, JobApplication `:1163`, EmployeeTime `:1191`; Concur reports `:1221`, entries `:1230`; Ariba suppliers `:1278`, contracts `:1290`, requisitions `:1302`; EWM `/SCWM/ORDIM_C` `:1358` | `sap/extraction_registry.py` |
| Extraction task, with job id `dl-<version_id>` | `workers/tasks/run_extraction.py:123-131` |
| Job registry: `ACTIVE` `:36`, `STAGES` `:38`, `start_job` `:109`, `update_job` `:130`, `finish_job` `:159`, `list_jobs` `:205` | `api/services/jobs.py` |
| BPMN export: `_landscape` `:139` (linear chain at `:161`, `callActivity` + `calledElement` at `:156-157`), `_task` `:190`, `_l4_file` `:226`, `export_zip` `:283`, `import_zip` `:357` | `api/services/bpmn_export.py` |
| Deterministic layout (`layout_diagram`) | `api/services/bpmn_layout.py:91` |
| Reference Signavio export routes, permission `view` | `api/routes/process_export.py:82`, `:89` |
| Mining graph returns template output with `cases=[]` | `api/routes/process_mining.py:182`, `:276-277`, `:289-290` |
| XSD validation helper and vendored OMG XSD | `tests/test_bpmn_export.py:78`; `tests/fixtures/bpmn20-xsd/BPMN20.xsd` |
| RBAC: `_READ` `:39`, `PERMISSIONS` `:41-65`, `VALID_ROLES` `:93`, `require_permission` `:163` | `api/services/rbac.py` |
| Persona home mapping (one file) | `frontend/lib/persona.ts` (`PERSONA_BY_ROLE`, `homeHrefForRole`) |
| Insights nav group | `frontend/lib/nav.ts:150-170` |
| Latest migration is `076_migration_runs_rls.py` | `db/migrations/versions/` |
| Parquet chunk reader | `workers/dataset.py:59` (`iter_parquet_chunks`) |
| Celery defaults: soft limit 1800 s, hard limit 2100 s, concurrency 4 | `workers/celery_app.py:27-28`; `docker-compose.yml:113` |
| Python deps: pm4py, networkx and lxml are not in requirements | `requirements*.txt` |

The brief contains three corrections:

- RSEG and BSAK are already read by the proven-cost module (`sap/extraction_registry.py:755`, `:765`).
- USR02 is already read (`:439`), but without `USTYP`.
- The OTC copy-control flow `_document_flow` is at `config_intelligence/process_flow_derivation.py:175`, not `:182`.

DDIC files exist under `sap/dictionaries/ecc6/tables/` for every ECC table this spec reads, with five exceptions: `VBFA`, `AFRU`, `TCDOB`, `T529T` and `MATDOC`. This design does not read the first four. §1.2 states the replacement for each.

`MATDOC` is read on `s4hana_onprem` (ruling 38). There is no S/4 table directory today: the S/4 dictionary is the ECC bundle plus `sap/dictionaries/s4hana_delta.yaml`, applied by `_apply_s4_delta` (`sap/ddic.py:260`). The delta lists `MKPF` and `MSEG` as obsolete tables replaced by `MATDOC` (`s4hana_delta.yaml:51-56`). It has no way to add a table that does not exist in ECC. Wave 19 therefore adds `sap/dictionaries/s4hana/tables/MATDOC.json` and has `get_dictionary("s4hana")` load that directory after the delta (§1.3).

---

## 1. Extraction per L1

### 1.1 Mechanism

**ABAP systems** are `ecc`, `s4hana_onprem` and `ewm` (`ABAP_SYSTEM_TYPES`, `sap/extraction_plan.py:47`). For these systems, `sap/extraction_plan.py` gains a process-event block that follows the proven-cost pattern:

```python
PROCESS_EVENT_MODULES: tuple[str, ...] = (
    "process_events_ptp", "process_events_otc", "process_events_r2r", "process_events_pp",
    "process_events_pm", "process_events_qm", "process_events_ps", "process_events_wh",
    "process_events_htr", "process_events_mdg",
)
PROCESS_EVENTS_DATA: dict[str, dict[str, set[str]]] = {...}   # module -> table -> fields, §1.2
```

- `plan_modules` adds a `PROCESS_EVENTS_DATA[m]` table only when module `m` is in the requested modules. No other module triggers these tables.
- Fields go through the existing DDIC check. A field the DDIC lacks is dropped, and the plan records the table as `partial`. Partial tables appear in the run's coverage stats (§10).
- Process-event windows live in a new file, `sap/dictionaries/process_event_windows.yaml`. It has the same shape as `extraction_windows.yaml` plus an optional `slice_months` key. A table uses this file when every module in its `p.modules` is a process-event module. Any other table keeps `extraction_windows.yaml`, so DQ extraction windows do not change.
- `via` edges for process events live in a new file, `sap/dictionaries/process_event_joins.yaml`, with the same edge shape as `joins.yaml`. `via_filters` takes a new keyword-only argument `extra_edges` and searches those edges after `joins.yaml`. Process-event edges are never added to `joins.yaml`. That file is the check engine's grain graph (`checks/frames.py`), and new edges there would change how rules are evaluated.
- `TablePlan` gains `slices: list[str]` (default empty). When `slice_months` is set, `plan_modules` splits the window into one `where` clause per calendar month. `connectivity_manager.extract` then reads one slice at a time with `read_table_full` and concatenates the results, the same way it already handles `via` IN-lists at `api/services/connectivity_manager.py:319-332`.

**Sizing guard.** These rules are binding:

- Every read goes through RFC_READ_TABLE and `read_table_full`, paged at 50,000 rows. SE16N and grid reads are never used.
- A large table is read in one of two ways only:
  - in monthly slices of its own date window, or
  - `via` a parent's primary-key IN-list (60 keys per clause, `in_lists`), where the parent was read in monthly slices.
- A `via` edge always joins on a prefix of the child's primary key, or on a field the child has an index on. This spec uses only primary-key edges.
- `BSEG`, `VBFA` and full `CDPOS` are never read.
- `MATDOC` is read only on `s4hana_onprem`, only in `BUDAT` monthly slices, and only under the per-slice row guard below. It is never read unsliced.

**MATDOC row guard.** `MATDOC` has no header table to page through, so the month slice is the read unit. `process_event_windows.yaml` gives MATDOC two extra keys: `max_slice_rows: 30000` and `split_by: [WERKS]`. `connectivity_manager.extract` handles each month slice in these steps:

1. Read the slice with `read_table_full(..., max_rows=30001)`.
2. If it returns 30,000 rows or fewer, keep it.
3. If it returns 30,001 rows, discard it. Re-read the month once per plant, adding `WERKS = '<plant>'` to the slice `where`. The plant list is the `T001W.WERKS` config read (whole, `CONFIG_MAX_ROWS`), which the PP and PM modules add on `s4hana_onprem`.
4. If one plant-month still returns 30,001 rows, split that plant-month into calendar days on `BUDAT`.
5. If one plant-day still returns 30,001 rows, keep the first 30,000 rows. Record `MATDOC` under `stats.truncated_tables` with the plant and day, and mark the L1 `partial`.

No single RFC read of MATDOC returns more than 30,001 rows. The guard keeps every read far below the size at which a grid read hangs the SAP GUI.

**Row caps.** Every process-event table uses `max_rows=MERIDIAN_EXTRACT_MAX_ROWS`, which defaults to 5,000,000 (`connectivity_manager.py`). When a table hits the cap, the run is marked `truncated` for that L1 in `process_discovery_runs.stats.truncated_tables`, and the UI shows the Notice "Window truncated at 5,000,000 rows; narrow the period."

**Incremental runs** pass `scope={"date_from": <watermark - 14 days>}`. `_window` (`sap/extraction_plan.py:206`) already replaces the template window with `scope.date_from` on the first field. The 14-day overlap catches late postings and changes.

**Cloud systems.** These are `successfactors`, `ariba` and `concur`. `sap/extraction_registry.py` gains three modules, `process_events_sfx`, `process_events_arb` and `process_events_cnq`. Each is built from the existing `ExtractionTarget` entries named in §1.2, using the same `source` and fields. SF targets add `from_date`, set to the window start. The connector read path does not change.

`s4hana_cloud` and `btp` get no process-event modules. §10 states what users see in that case.

### 1.2 Tables per L1

Window column: `24m` means 24 months back on the named field, `via X` means read by X's primary keys, and `slice` means monthly slices. Every table also reads its DDIC primary key, except `MATDOC`. Its key is the technical `KEY1`…`KEY6`, which the builders do not use, so MATDOC reads only its listed fields. `MBLNR`, `MJAHR` and `ZEILE` identify the line. Every L1 reads `USR02 (BNAME, USTYP, CLASS)` once, whole, as a config-class read capped at `CONFIG_MAX_ROWS = 50_000`.

**PTP** (`process_events_ptp`)

| Table | Fields (timestamps, user, doc type, org) | Window / via | Edge (`process_event_joins.yaml`) |
|---|---|---|---|
| EKKO | EBELN, AEDAT, ERNAM, BSART, BUKRS, EKORG, EKGRP, LIFNR | AEDAT 24m, slice | (root) |
| EKPO | EBELN, EBELP, BANFN, BNFPO, WERKS, MATKL, LOEKZ, AEDAT | via EKKO | EKKO→EKPO `{EBELN: EBELN}` |
| EBAN | BANFN, BNFPO, ERDAT, ERNAM, BADAT, FRGDT, FRGZU, BSART, EKORG, WERKS | ERDAT 24m, slice | (root) |
| EKBE | EBELN, EBELP, VGABE, GJAHR, BELNR, BUZEI, BEWTP, BWART, SHKZG, BUDAT, CPUDT, CPUTM, ERNAM | via EKPO | EKPO→EKBE `{EBELN: EBELN, EBELP: EBELP}` |
| RBKP | BELNR, GJAHR, CPUDT, CPUTM, USNAM, BLART, BUKRS, ZLSPR, RBSTAT | CPUDT 24m, slice | (root) |
| BKPF | BUKRS, BELNR, GJAHR, AWTYP, AWKEY, CPUDT, CPUTM, USNAM, BLART, TCODE | CPUDT 24m, slice, extra where `AWTYP = 'RMRP'` | (root) |
| BSAK | BUKRS, BELNR, GJAHR, BUZEI, AUGDT, AUGBL, LIFNR | via BKPF | BKPF→BSAK `{BUKRS: BUKRS, BELNR: BELNR, GJAHR: GJAHR}` |
| CDHDR | OBJECTCLAS, OBJECTID, CHANGENR, USERNAME, UDATE, UTIME, TCODE, CHANGE_IND | UDATE 24m, slice, extra where `OBJECTCLAS IN ('EINKBELEG','BANF','KRED')` | (root) |
| CDPOS | OBJECTCLAS, OBJECTID, CHANGENR, TABNAME, TABKEY, FNAME, CHNGIND, VALUE_NEW | via CDHDR, extra where `FNAME IN ('FRGZU','FRGKE','MENGE','NETPR','EINDT','LOEKZ','KEY')` | CDHDR→CDPOS (exists in `joins.yaml:232`, reused as is) |

`via_filters` uses the most selective join field (`:381-383`). For BKPF→BSAK that field is `BELNR`, and the BUKRS and GJAHR match is applied afterwards in the builder. For CDHDR→CDPOS it is `CHANGENR`.

PTP goods receipts come from `EKBE` (`VGABE='1'`) on both `ecc` and `s4hana_onprem`. EKBE is a normal table in S/4HANA, so PTP does not read MKPF, MSEG or MATDOC.

**OTC** (`process_events_otc`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| VBAK | VBELN, ERDAT, ERZET, ERNAM, AUART, VKORG, VTWEG, SPART, LIFSK, FAKSK, KUNNR | ERDAT 24m, slice | (root) |
| VBAP | VBELN, POSNR, ERDAT, ERZET, ERNAM, PSTYV, WERKS, ABGRU | via VBAK | VBAK→VBAP `{VBELN: VBELN}` |
| LIKP | VBELN, ERDAT, ERZET, ERNAM, LFART, VSTEL, WADAT_IST | ERDAT 24m, slice | (root) |
| LIPS | VBELN, POSNR, VGBEL, VGPOS | via LIKP | LIKP→LIPS `{VBELN: VBELN}` |
| VBRK | VBELN, ERDAT, ERZET, ERNAM, FKART, BUKRS, BELNR, GJAHR, FKSTO, SFAKN | ERDAT 24m, slice | (root) |
| VBRP | VBELN, POSNR, AUBEL, AUPOS, VGBEL, VGPOS | via VBRK | VBRK→VBRP `{VBELN: VBELN}` |
| BSAD | BUKRS, BELNR, GJAHR, BUZEI, AUGDT, AUGBL, KUNNR | via VBRK | VBRK→BSAD `{BUKRS: BUKRS, BELNR: BELNR, GJAHR: GJAHR}` |
| CDHDR / CDPOS | as PTP | UDATE 24m, slice; `OBJECTCLAS IN ('VERKBELEG','DEBI')`; `FNAME IN ('LIFSK','FAKSK','NETWR','KWMENG','EDATU','ABGRU','KEY')` | as PTP |

VBFA is not read, for two reasons: no DDIC file exists, and it is the largest SD table. `LIPS.VGBEL/VGPOS` and `VBRP.AUBEL/AUPOS` carry the same predecessor keys for order to delivery to billing. `VBRK.BELNR/GJAHR` links billing to the FI document, and `BSAD` gives the clearing date.

**R2R** (`process_events_r2r`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| BKPF | BUKRS, BELNR, GJAHR, BLART, BSTAT, CPUDT, CPUTM, USNAM, TCODE, STBLG, STJAH, AWTYP | CPUDT 12m, slice | (root) |
| BSAS | BUKRS, BELNR, GJAHR, BUZEI, AUGDT, AUGBL, HKONT | via BKPF | BKPF→BSAS `{BUKRS: BUKRS, BELNR: BELNR, GJAHR: GJAHR}` |
| AUFK | AUFNR, AUTYP, AUART, ERDAT, ERFZEIT, ERNAM, BUKRS, OBJNR | ERDAT 24m, slice, extra where `AUTYP = '01'` | (root) |
| CDHDR / CDPOS | as PTP | UDATE 24m, slice; `OBJECTCLAS IN ('SACH','ANLA','KOSTL','KSTAR')`; `FNAME = 'KEY'` or any field (master changes keep all FNAME, values dropped) | as PTP |

BKPF uses a 12-month window, not 24, because it is the highest-volume header in the system. A `BSAS` DDIC file must exist before this read can run. If it is absent, BSAS is dropped by the DDIC check and the R2R clearing activity becomes "not observed". Wave 19 adds `BSAS.json` when it is missing.

**PP** (`process_events_pp`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| AUFK | AUFNR, AUTYP, AUART, WERKS, ERDAT, ERFZEIT, ERNAM, OBJNR | ERDAT 24m, slice, extra where `AUTYP = '10'` | (root) |
| AFKO | AUFNR, GSTRP, GLTRP, GSTRI, GLTRI, PLNBEZ | via AUFK | AUFK→AFKO `{AUFNR: AUFNR}` |
| JCDS | OBJNR, STAT, CHGNR, UDATE, UTIME, USNAM, INACT | via AUFK | AUFK→JCDS `{OBJNR: OBJNR}` |
| MKPF | MBLNR, MJAHR, CPUDT, CPUTM, USNAM, BLART | CPUDT 24m, slice (ECC only) | (root) |
| MSEG | MBLNR, MJAHR, ZEILE, BWART, AUFNR, WERKS | via MKPF, extra where `BWART IN ('101','102','261','262')` (ECC only) | MKPF→MSEG `{MBLNR: MBLNR, MJAHR: MJAHR}` |
| MATDOC | MBLNR, MJAHR, ZEILE, BWART, MATNR, WERKS, LGORT, BUDAT, CPUDT, CPUTM, USNAM, EBELN, EBELP, AUFNR, KDAUF, KDPOS, VBELN_IM, VBELP_IM, RECORD_TYPE | BUDAT 24m, slice, row guard (§1.1), extra where `RECORD_TYPE = 'MDOC' AND BWART IN ('101','102','261','262')` (`s4hana_onprem` only) | (root) |
| T001W | WERKS | config (whole) (`s4hana_onprem` only, for the MATDOC split) | (none) |
| CDHDR / CDPOS | as PTP | `OBJECTCLAS IN ('STUE')` | as PTP |

On `s4hana_onprem`, MKPF and MSEG are compatibility views over MATDOC (`sap/dictionaries/s4hana_delta.yaml:51-56`). The plan never reads them there. It reads MATDOC instead, and on `ecc` it reads MKPF and MSEG and never MATDOC. `plan_modules` chooses by `system_type`. MATDOC carries the header fields `BUDAT`, `CPUDT`, `CPUTM` and `USNAM` on every line, so no header read or `via` edge is needed.

**MATDOC record filter.** The condition is `RECORD_TYPE = 'MDOC'`. MATDOC also holds rows that are not material-document lines, such as stock aggregates and archive or compression carry-forward rows. Those rows carry other `RECORD_TYPE` values, and the filter excludes every one of them. The filter is part of every slice `where`, including the WERKS and day splits.

**MATDOC fields.** The 19 fields are the MATDOC names in SAP S/4HANA. No field was dropped. `MBLNR`, `MJAHR` and `ZEILE` are ordinary fields in MATDOC, not its key. `EBELN`, `EBELP`, `KDAUF`, `KDPOS`, `VBELN_IM` and `VBELP_IM` go into `object_refs` and attributes only. They do not create events. Production confirmations come from JCDS status `I0009`/`I0010`, not from AFRU, which has no DDIC file.

**PM** (`process_events_pm`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| QMEL | QMNUM, QMART, QMDAT, MZEIT, ERNAM, ERDAT, QMDAB, QMZAB, PRIOK, AUFNR, PRUEFLOS, IWERK | QMDAT 24m, slice | (root) |
| TQ80 | QMART, QMTYP | config (whole) | (none) |
| AUFK | as PP, extra where `AUTYP = '30'` | ERDAT 24m, slice | (root) |
| AFIH | AUFNR, WARPL, EQUNR, IWERK | via AUFK | AUFK→AFIH `{AUFNR: AUFNR}` |
| JCDS | as PP | via AUFK | AUFK→JCDS |
| MKPF / MSEG | as PP, `BWART IN ('261','262')` | as PP (ECC only) | as PP |
| MATDOC / T001W | as PP, `RECORD_TYPE = 'MDOC' AND BWART IN ('261','262')` | as PP (`s4hana_onprem` only) | as PP |
| CDHDR / CDPOS | as PTP | `OBJECTCLAS IN ('QMEL','EQUI')`; `FNAME IN ('PRIOK','KEY')` | as PTP |

When a table is listed in both PP and PM, `plan_modules` merges the two plans into one read with the union of the `where` filters (`AUTYP IN ('10','30')`). The builders then split the rows by AUTYP. MATDOC merges the same way into one read with `BWART IN ('101','102','261','262')`, and the builders split the rows by the order's AUTYP through `AUFNR`.

**QM** (`process_events_qm`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| QALS | PRUEFLOS, ENSTEHDAT, ENTSTEZEIT, ERSTELLER, ART, HERKUNFT, WERK, MATNR, EBELN, AUFNR, OBJNR | ENSTEHDAT 24m, slice | (root) |
| QAVE | PRUEFLOS, VDATUM, VNAME, VCODE, VAEDATUM | via QALS | QALS→QAVE `{PRUEFLOS: PRUEFLOS}` |
| QMEL | as PM | as PM | (root) |
| QMFE | QMNUM, FENUM, ERDAT, ERZEIT, ERNAM, FECOD | via QMEL | QMEL→QMFE `{QMNUM: QMNUM}` |
| QMSM | QMNUM, MANUM, ERDAT, ERZEIT, ERNAM, PETER, ERLDAT, ERLZEIT, ERLNAM | via QMEL | QMEL→QMSM `{QMNUM: QMNUM}` |
| TQ80 | as PM | config | (none) |

The usage decision in QAVE has no time field (`VZEIT` is absent from the DDIC). It is a day-precision event.

**PS** (`process_events_ps`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| PROJ | PSPNR, PSPID, ERDAT, ERNAM, VBUKR, OBJNR | ERDAT 36m, slice | (root) |
| PRPS | PSPNR, POSID, PSPHI, ERDAT, ERNAM, PBUKR, OBJNR | via PROJ | PROJ→PRPS `{PSPHI: PSPNR}` |
| JCDS | as PP | via PRPS | PRPS→JCDS `{OBJNR: OBJNR}` |

`PRPS.PSPHI` is not the primary key of PRPS, which breaks the primary-key rule in §1.1. PRPS is still read via PROJ because WBS volumes are small: less than 1% of the volume of document tables. This is the one exception to the rule, and it is stated here.

**WH** (`process_events_wh`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| LTAK | LGNUM, TANUM, BWLVS, BDATU, BZEIT, BNAME, BETYP, BENUM, KQUIT, VBELN | BDATU 12m, slice (ECC WM) | (root) |
| LTAP | LGNUM, TANUM, TAPOS, QDATU, QZEIT, QNAME, VLTYP, NLTYP, PQUIT | via LTAK | LTAK→LTAP (exists, `joins.yaml:218`) |
| /SCWM/ORDIM_C | LGNUM, TANUM, TAPOS, TOSTAT, TRART, PROCTY, CREATED_AT, CREATED_BY, CONFIRMED_AT, CONFIRMED_BY, VLPLA, NLPLA | CONFIRMED_AT 12m, slice (system type `ewm`) | (root) |

WH cases are transfer orders and warehouse tasks, not material documents. WH reads no MKPF, MSEG or MATDOC on any system type.

**HTR** (`process_events_htr`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| PA0000 | PERNR, BEGDA, ENDDA, SEQNR, MASSN, MASSG, STAT2, AEDTM, UNAME | AEDTM 24m, slice | (root) |
| PA0001 | PERNR, BEGDA, SEQNR, AEDTM, UNAME, BUKRS, WERKS, PERSG, ORGEH | AEDTM 24m, slice | (root) |
| PA0002 | PERNR, BEGDA, SEQNR, AEDTM, UNAME | AEDTM 24m, slice | (root) |
| PA0008 | PERNR, BEGDA, SEQNR, AEDTM, UNAME | AEDTM 24m, slice | (root) |
| HRP1000 | PLVAR, OTYPE, OBJID, BEGDA, AEDTM, UNAME | AEDTM 24m, slice | (root) |
| HRP1001 | PLVAR, OTYPE, OBJID, RSIGN, RELAT, SCLAS, BEGDA, AEDTM, UNAME | AEDTM 24m, slice | (root) |

PA0002 and PA0008 read keys, dates and user only. Names, salaries and other payload fields are never read for process events.

**MDG** (`process_events_mdg`)

| Table | Fields | Window / via | Edge |
|---|---|---|---|
| USMD120C | USMD_CREQUEST, USMD_CREQ_TYPE, USMD_CREQ_STATUS, USMD_CREATED_AT, USMD_CREATED_BY, USMD_RELEASED_AT, USMD_RELEASED_BY, USMD_CHANGED_AT, USMD_CHANGED_BY, USMD_DATA_CHN_AT, USMD_PRIORITY | USMD_CREATED_AT 24m, slice | (root) |

**SFX** (`process_events_sfx`, registry, SuccessFactors)

| Entity set | Fields | Filter |
|---|---|---|
| JobRequisition (`:1155`) | requisitionId, status, createdDate, hiringManager | `from_date` = window start, 24m |
| JobApplication (`:1163`) | applicationId, requisitionId, status, appliedDate, lastModifiedDate | 24m |
| EmpJob (`:903`) | userId, startDate, seqNumber, event, eventReason, company, department | 24m |
| EmployeeTime (`:1191`) | userId, timeType, startDate, endDate, approvalStatus | 12m |

**ARB** (`process_events_arb`, registry, Ariba)

| Entity set | Fields |
|---|---|
| /api/suppliers (`:1278`) | supplierId, qualificationStatus, registrationDate |
| /api/contracts (`:1290`) | contractId, status, effectiveDate, expirationDate, owner |
| /api/procurement/requisitions (`:1302`) | requisitionId, requestor, status, createdDate, approvalStatus |

**CNQ** (`process_events_cnq`, registry, Concur)

| Entity set | Fields |
|---|---|
| reports (`:1221`) | reportId, ownerLoginId, submitDate, approvalStatus, paymentStatus |
| entries (`:1230`) | reportId, entryId, expenseTypeCode, transactionDate |

### 1.3 New DDIC and dictionary files

| File | Content |
|---|---|
| `sap/dictionaries/process_event_windows.yaml` | one entry per root table above: `{field, months, slice_months: 1, where}` |
| `sap/dictionaries/process_event_joins.yaml` | the edges in the "Edge" columns above, excluding the two that already exist in `joins.yaml` |
| `sap/dictionaries/ecc6/tables/BSAS.json` | only when missing. Same format as `BSAK.json`, from the ECC 6.0 standard DDIC |
| `sap/dictionaries/s4hana/tables/MATDOC.json` | new. Same JSON format as `ecc6/tables/MSEG.json` (`table`, `description`, `source`, `fields[]` with `pos`, `name`, `key`, `data_element`, `domain`, `type`, `length`, `decimals`, `description`, `check_table`). Content comes from the SAP S/4HANA standard DDIC for MATDOC (DD03L), with `source` naming it. It must contain at least the 19 fields of §1.2 and the key fields as DD03L defines them. Field types are taken from DD03L, not copied from MSEG by assumption |
| `sap/ddic.py` | `get_dictionary("s4hana")` loads `s4hana/tables/*.json` after `_apply_s4_delta` and before the canonical views. An ECC table is never copied there; the directory holds only tables that do not exist in ECC 6.0 |

`tests/checks/test_joins_valid.py` is extended to load `process_event_joins.yaml`, so every edge field must exist in the dictionaries.

---

## 2. Event-log layer

### 2.1 Tables (migration `db/migrations/versions/077_process_event_log.py`)

`down_revision` is the current head. If the RBAC migration from `rbac.md` §3.4 lands first, this file takes the next free number and points at that head.

```sql
CREATE TABLE process_discovery_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id     uuid NOT NULL REFERENCES sap_systems(id) ON DELETE CASCADE,
  l1            varchar(8)  NOT NULL,           -- PTP, OTC, R2R, PP, PM, QM, PS, WH, HTR, MDG, SFX, ARB, CNQ
  mode          varchar(12) NOT NULL,           -- full | incremental
  status        varchar(16) NOT NULL,           -- queued | waiting | extracting | building | mining | completed | failed
  coverage      varchar(12) NOT NULL DEFAULT 'reference',  -- discovered | partial | reference
  window_from   date,
  window_to     date,
  watermark     timestamptz,                    -- max(ts) loaded, next incremental starts at watermark - 14 days
  extraction_version_id uuid,                   -- analysis_versions.id of the extraction this run built from
  job_id        varchar(64),
  filters       jsonb NOT NULL DEFAULT '{}',
  stats         jsonb NOT NULL DEFAULT '{}',   -- §3.6
  model         jsonb,                          -- ProcessModelDocument for this L1, §4
  error         text,
  created_by    uuid REFERENCES users(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX ix_pdr_tenant_system_l1 ON process_discovery_runs (tenant_id, system_id, l1, started_at DESC);

CREATE TABLE process_events (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  system_id     uuid NOT NULL,
  l1            varchar(8)   NOT NULL,
  case_type     varchar(32)  NOT NULL,          -- §2.2
  case_id       varchar(160) NOT NULL,
  activity      varchar(64)  NOT NULL,          -- activity key, upper snake case, §2.3
  l5_id         varchar(120),                   -- resolved L5 id, NULL until generation
  ts            timestamptz  NOT NULL,
  ts_precision  varchar(6)   NOT NULL,          -- second | day
  seq           smallint     NOT NULL DEFAULT 0,-- rank inside a day for day-precision events
  resource      varchar(64),                    -- SAP user (sha256 for HTR and SFX)
  automated     boolean,                        -- USR02.USTYP in (B, S); NULL when USR02 unreadable
  doc_type      varchar(16),                    -- BSART, AUART, BLART, LFART, FKART, QMART, ART, BWLVS, MASSN …
  org           jsonb NOT NULL DEFAULT '{}',    -- {"BUKRS": "1000", "WERKS": "1100", "EKORG": "1000", "VKORG": "1000"}
  object_refs   jsonb NOT NULL DEFAULT '[]',    -- [{"type": "EBELN", "id": "4500000001/00010"}, …]
  attributes    jsonb NOT NULL DEFAULT '{}',    -- whitelisted values only (status codes, movement types)
  source_table  varchar(40)  NOT NULL,
  run_id        uuid NOT NULL REFERENCES process_discovery_runs(id) ON DELETE CASCADE
);
CREATE INDEX ix_pe_case ON process_events (tenant_id, system_id, l1, case_type, case_id, ts, seq, id);
CREATE INDEX ix_pe_activity ON process_events (tenant_id, system_id, l1, activity);
CREATE INDEX ix_pe_ts ON process_events (tenant_id, system_id, l1, ts);

CREATE TABLE process_variants (
  run_id        uuid NOT NULL REFERENCES process_discovery_runs(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  case_type     varchar(32) NOT NULL,
  variant_hash  char(32)    NOT NULL,           -- md5 of the activity sequence
  activities    text[]      NOT NULL,
  case_count    integer     NOT NULL,
  share         numeric(7,6) NOT NULL,
  median_seconds bigint,
  p90_seconds   bigint,
  fitness       numeric(5,4),
  sample_case_ids text[] NOT NULL,              -- up to 5
  PRIMARY KEY (run_id, case_type, variant_hash)
);
```

RLS applies to all three tables, using the template from `076_migration_runs_rls.py`: `ENABLE ROW LEVEL SECURITY`, then `FORCE ROW LEVEL SECURITY`, then a policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. `db/schema.py` gains `ProcessDiscoveryRun`, `ProcessEvent` and `ProcessVariant`, placed after `ProcessModelVersion` (`:1049`).

**Retention.** Events older than 730 days by `ts` are deleted by a nightly beat task, `workers.tasks.run_process_discovery.prune_events`, added to `workers/scheduler.py`. Runs and variants are kept for the last 20 runs per (system, L1). Older ones are deleted by the same task.

**Idempotency.** A builder works per case. It runs `DELETE FROM process_events WHERE tenant_id, system_id, l1, case_type AND case_id = ANY(:batch)`, then inserts the rebuilt events of that batch, in one transaction per 50,000-event batch. A rerun therefore produces the same rows. There is no `ON CONFLICT` because the delete-then-insert is the idempotency.

**Timestamps.** Precedence, first available wins:

1. change-document `UDATE+UTIME`
2. `CPUDT+CPUTM`
3. `ERDAT+ERZET` (or the table's create date and time pair: `ERFZEIT`, `MZEIT`, `ENTSTEZEIT`, `BZEIT`, `QZEIT`, `ERLZEIT`)
4. the date alone

Dates and times are interpreted in the system timezone. That is `sap_systems.timezone` when the column is set, and `Africa/Johannesburg` otherwise, matching `workers/celery_app.py:22`. Date-only events get `ts` at 00:00 of that day, `ts_precision='day'`, and `seq` equal to the activity's position in the L1's template order (§2.3, the "Order" column). Day-precision events therefore sort in template order inside a day, and do not create false out-of-order findings.

**Personal data.** HTR and SFX case ids and resources are `sha256(tenant_salt || value)` in hex, truncated to 32 characters. `tenant_salt` is `tenants.id` as text. Raw `PERNR` and `userId` are never stored. `automated` is computed before hashing. The `attributes` column holds only whitelisted codes, listed per L1 in §2.3. `VALUE_NEW` from CDPOS is stored only for `FRGZU`, `FRGKE`, `LIFSK`, `FAKSK` and `PRIOK`.

### 2.2 Case notions

| L1 | `case_type` | `case_id` | Linked objects (`object_refs`) |
|---|---|---|---|
| PTP | `po_item` | `EBELN/EBELP` | `BANFN/BNFPO`, EKBE GR `BELNR/GJAHR`, invoice `BELNR/GJAHR` (RBKP), FI `BUKRS/BELNR/GJAHR`, clearing `AUGBL` |
| PTP | `vendor` | `LIFNR` (CDHDR `OBJECTID`, class KRED) | (none) |
| OTC | `so_item` | `VBELN/POSNR` | delivery `VBELN/POSNR`, billing `VBELN/POSNR`, FI `BUKRS/BELNR/GJAHR`, clearing `AUGBL` |
| OTC | `customer` | `KUNNR` (class DEBI) | (none) |
| R2R | `fi_doc` | `BUKRS/BELNR/GJAHR` | reversal `STBLG/STJAH`, clearing `AUGBL` |
| R2R | `gl_account`, `asset`, `cost_center`, `cost_element` | CDHDR `OBJECTID` (classes SACH, ANLA, KOSTL, KSTAR) | (none) |
| R2R | `internal_order` | `AUFNR` (AUTYP 01) | (none) |
| PP | `prod_order` | `AUFNR` (AUTYP 10) | material documents `MBLNR/MJAHR` |
| PP | `bom` | CDHDR `OBJECTID` (class STUE) | (none) |
| PM | `pm_order` | `AUFNR` (AUTYP 30). A notification with `QMEL.AUFNR` set joins its order's case | `QMNUM`, `WARPL`, `EQUNR`, material documents |
| PM | `pm_notification` | `QMNUM` for a PM notification without an order | (none) |
| PM | `equipment` | CDHDR `OBJECTID` (class EQUI) | (none) |
| QM | `insp_lot` | `PRUEFLOS` | `EBELN`, `AUFNR`, linked `QMNUM` (QMEL.PRUEFLOS) |
| QM | `qm_notification` | `QMNUM` for a QM notification without a lot | (none) |
| PS | `wbs` | `POSID` | `PSPID` |
| WH | `transfer_order` | `LGNUM/TANUM` | `VBELN` (LTAK), `BENUM` |
| WH | `warehouse_task` | `LGNUM/TANUM` (/SCWM/ORDIM_C) | (none) |
| HTR | `emp_event` | `hash(PERNR)/BEGDA/MASSN` (one personnel action) | (none) |
| HTR | `org_object` | `PLVAR/OTYPE/OBJID` | (none) |
| MDG | `change_request` | `USMD_CREQUEST` | (none) |
| SFX | `requisition` | `requisitionId` | `applicationId` list |
| SFX | `emp_event` | `hash(userId)/startDate/seqNumber` | (none) |
| SFX | `time_record` | `hash(userId)/startDate/timeType` | (none) |
| ARB | `supplier` | `supplierId` | (none) |
| ARB | `contract` | `contractId` | (none) |
| ARB | `requisition` | `requisitionId` | (none) |
| CNQ | `expense_report` | `reportId` | `entryId` list |

Each L1 has one **primary** case type, the first row for that L1 in the table above. The L1, L2 and L3 flow is the directly-follows graph (DFG) of the primary case type. The other case types are mined separately, and they feed only the L4 diagrams they own.

A notification is QM when `TQ80.QMTYP = '02'` for its QMART, and PM when `QMTYP = '01'`. If TQ80 was not read, a notification with `PRUEFLOS` set is QM and every other notification is PM.

**Object-centric links.** A PTP case spans PR, PO, GR, invoice and payment documents. The builder sets `object_refs` on every event to the documents that event touches. When one GR document (`EKBE.BELNR`) serves several PO items, the GR event appears once in each item's case, with the same `object_refs` entry. The case explorer (§7) then shows the shared document. OTC works the same way through `LIPS.VGBEL/VGPOS` and `VBRP.AUBEL/AUPOS`. Shared events are not deduplicated across cases. Per-case flows are the mining unit, and the shared-object count appears in `stats.shared_objects`.

### 2.3 Activity mapping per L1

The builders live in `api/services/process_discovery/builders/<l1>.py`, one module per L1. Each builder exposes `MAPPING: tuple[ActivityMap, ...]` and `build(frames, ctx) -> Iterator[EventRow]`.

`ActivityMap` is a frozen dataclass with these fields:

- `key`
- `label`
- `l5_id`
- `case_type`
- `source`
- `condition`
- `ts`
- `order`
- `expected`

The tables below are those mappings verbatim:

- **Order** is the activity's position in the reference flow. It is used for day-precision `seq` and for conformance.
- **Exp** marks an activity the reference expects in every case of that case type.
- An `l5_id` ending in `-X_<KEY>` is a discovered L5 under a known L4 (§4.2).

**PTP**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | EBAN row linked by `EKPO.BANFN/BNFPO`; ts `ERDAT` | `CREATE_PR` | Create purchase requisition | `PTP-PR-ME51N-01` | N |
| 2 | CDPOS class BANF, `FNAME='FRGZU'`; ts CDHDR | `RELEASE_PR` | Release purchase requisition | `PTP-PR-ME51N-X_RELEASE_PR` | N |
| 3 | EKKO row; ts `AEDAT` (creation date of the PO) | `CREATE_PO_ITEM` | Create purchase order item | `PTP-PO-ME21N-02` | Y |
| 4 | CDPOS class EINKBELEG, `TABNAME='EKKO'`, `FNAME<>'FRGZU'`, `CHNGIND='U'` | `CHANGE_PO_HEADER` | Change purchase order header | `PTP-PO-ME21N-01` | N |
| 5 | CDPOS class EINKBELEG, `TABNAME='EKPO'`, `FNAME='MENGE'` | `CHANGE_PO_QTY` | Change order quantity | `PTP-PO-ME21N-X_CHANGE_QTY` | N |
| 6 | CDPOS class EINKBELEG, `TABNAME='EKPO'`, `FNAME='NETPR'` | `CHANGE_PO_PRICE` | Change net price | `PTP-PO-ME21N-X_CHANGE_PRICE` | N |
| 7 | CDPOS class EINKBELEG, `TABNAME='EKET'`, `FNAME='EINDT'` | `CHANGE_PO_DATE` | Change delivery date | `PTP-PO-ME21N-X_CHANGE_DATE` | N |
| 8 | CDPOS class EINKBELEG, `TABNAME='EKKO'`, `FNAME='FRGZU'` | `RELEASE_PO` | Release purchase order | `PTP-REL-ME29N-01` | N |
| 9 | EKBE `VGABE='1'`, `SHKZG='S'`; ts CPUDT+CPUTM | `GOODS_RECEIPT` | Post goods receipt | `PTP-GR-MIGO-01` | Y |
| 10 | EKBE `VGABE='1'`, `SHKZG='H'` | `REVERSE_GR` | Reverse goods receipt | `PTP-GR-MIGO-X_REVERSE_GR` | N |
| 11 | EKBE `VGABE='2'`, `SHKZG='S'`; ts CPUDT+CPUTM; resource RBKP.USNAM | `INVOICE_RECEIPT` | Post invoice receipt | `PTP-IV-MIRO-01` | Y |
| 12 | RBKP `ZLSPR<>''` for the EKBE invoice | `INVOICE_BLOCKED` | Invoice blocked for payment | `PTP-IV-MIRO-X_PAYMENT_BLOCK` | N |
| 13 | EKBE `VGABE='2'`, `SHKZG='H'` | `REVERSE_INVOICE` | Reverse invoice | `PTP-IV-MIRO-X_REVERSE_INVOICE` | N |
| 14 | BSAK for the BKPF doc with `AWKEY = RBKP.BELNR ‖ RBKP.GJAHR`; ts `AUGDT` (day) | `CLEAR_INVOICE` | Pay invoice (clearing) | `PTP-PAY-F110-01` | Y |
| 15 | CDPOS class EINKBELEG, `TABNAME='EKPO'`, `FNAME='LOEKZ'` | `DELETE_PO_ITEM` | Delete purchase order item | `PTP-PO-ME21N-X_DELETE_ITEM` | N |
| 1 | case type `vendor`: CDHDR class KRED, `CHANGE_IND='I'` | `CREATE_VENDOR` | Create vendor | `PTP-VM-FK01-01` | Y |
| 2 | CDPOS class KRED, `TABNAME='LFA1'`, `CHNGIND='U'` | `CHANGE_VENDOR_GENERAL` | Change vendor general data | `PTP-VM-FK01-02` | N |
| 3 | CDPOS class KRED, `TABNAME='LFB1'` | `CHANGE_VENDOR_COMPANY` | Change vendor company code data | `PTP-VM-FK01-03` | N |
| 4 | CDPOS class KRED, `TABNAME='LFBK'` | `CHANGE_VENDOR_BANK` | Change vendor bank details | `PTP-VM-FK01-04` | N |

Attributes whitelist: `BSART`, `BWART`, `FRGZU`, `ZLSPR`, `RBSTAT`. Org: `BUKRS`, `EKORG`, `WERKS`. `EKKO` uses `AEDAT` because it has no create time. Its events are day-precision.

**OTC**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | VBAP row; ts VBAP ERDAT+ERZET | `CREATE_SO_ITEM` | Create sales order item | `OTC-SO-VA01-02` | Y |
| 2 | CDPOS class VERKBELEG, `TABNAME='VBAK'`, `FNAME` not in (LIFSK, FAKSK) | `CHANGE_SO_HEADER` | Change sales order header | `OTC-SO-VA01-01` | N |
| 3 | CDPOS class VERKBELEG, `TABNAME='VBAP'`, `FNAME='NETWR'` | `CHANGE_PRICE` | Change item price | `OTC-SO-VA01-03` | N |
| 4 | CDPOS class VERKBELEG, `TABNAME='VBEP'`, `FNAME='EDATU'` | `CHANGE_SCHEDULE` | Change requested delivery date | `OTC-SO-VA01-04` | N |
| 5 | CDPOS class VERKBELEG, `TABNAME='VBAP'`, `FNAME='KWMENG'` | `CHANGE_QTY` | Change order quantity | `OTC-SO-VA01-X_CHANGE_QTY` | N |
| 6 | CDPOS class VERKBELEG, `FNAME='LIFSK'`, value set | `SET_DELIVERY_BLOCK` | Set delivery block | `OTC-DEL-VL01N-02` | N |
| 7 | CDPOS class VERKBELEG, `FNAME='LIFSK'`, value cleared | `REMOVE_DELIVERY_BLOCK` | Remove delivery block | `OTC-DEL-VL01N-X_REMOVE_BLOCK` | N |
| 8 | CDPOS class VERKBELEG, `FNAME='FAKSK'`, value set | `SET_BILLING_BLOCK` | Set billing block | `OTC-BIL-VF01-X_BILLING_BLOCK` | N |
| 9 | LIPS with `VGBEL/VGPOS` = case; ts LIKP ERDAT+ERZET | `CREATE_DELIVERY` | Create delivery | `OTC-DEL-VL01N-01` | Y |
| 10 | LIKP `WADAT_IST<>''` for that delivery; ts `WADAT_IST` (day) | `GOODS_ISSUE` | Post goods issue | `OTC-DEL-VL01N-X_GOODS_ISSUE` | Y |
| 11 | VBRP with `AUBEL/AUPOS` = case, VBRK `FKSTO=''`, `SFAKN=''`; ts VBRK ERDAT+ERZET | `CREATE_INVOICE` | Create billing document | `OTC-BIL-VF01-01` | Y |
| 12 | VBRP for the case where VBRK `SFAKN<>''` | `CANCEL_INVOICE` | Cancel billing document | `OTC-BIL-VF01-X_CANCEL` | N |
| 13 | BSAD on `VBRK.BUKRS/BELNR/GJAHR`; ts `AUGDT` (day) | `CLEAR_PAYMENT` | Receive payment (clearing) | `OTC-DUN-F150-X_CLEAR_PAYMENT` | Y |
| 14 | CDPOS class VERKBELEG, `TABNAME='VBAP'`, `FNAME='ABGRU'` | `REJECT_ITEM` | Reject item | `OTC-SO-VA01-X_REJECT` | N |
| 1 | case type `customer`: CDHDR class DEBI, `CHANGE_IND='I'` | `CREATE_CUSTOMER` | Create customer | `OTC-CM-FD01-01` | Y |
| 2 | CDPOS class DEBI, `TABNAME='KNA1'`, `CHNGIND='U'` | `CHANGE_CUSTOMER_GENERAL` | Change customer general data | `OTC-CM-FD01-02` | N |
| 3 | CDPOS class DEBI, `TABNAME='KNB1'` | `CHANGE_CUSTOMER_COMPANY` | Change customer company code data | `OTC-CM-FD01-03` | N |
| 4 | CDPOS class DEBI, `TABNAME='KNKK'` | `CHANGE_CREDIT_LIMIT` | Change credit data | `OTC-CM-FD01-04` | N |

Payment clearing belongs under `OTC-DUN-F150`, the receivables collection L4, as a discovered L5. The reference has no collection activity. Attributes: `AUART`, `PSTYV`, `LFART`, `FKART`, `LIFSK`, `FAKSK`. Org: `VKORG`, `VTWEG`, `SPART`, `WERKS`, `BUKRS`.

**R2R**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | BKPF `BSTAT=''`, `TCODE IN ('FB50','FB01','FB01L','FBS1','F-02','FB50L')`; ts CPUDT+CPUTM | `POST_GL_DOC` | Post G/L document | `R2R-GL-FB50-01` | Y |
| 1 | BKPF `BSTAT=''`, `TCODE IN ('ABZON','ABZO','F-90','AB01')` | `POST_ASSET_ACQ` | Post asset acquisition | `R2R-AA-ABZON-01` | Y |
| 1 | BKPF `BSTAT=''`, `TCODE IN ('AFAB','AFABN')` | `POST_DEPRECIATION` | Post depreciation | `R2R-AA-AFAB-01` | Y |
| 1 | BKPF `BSTAT=''`, any other TCODE | `POST_<TCODE>` | Post document via <TCODE> | §4.2 rule 3 (`R2R-DSC-POST_<TCODE>`) | Y |
| 2 | BKPF `BSTAT='V'` | `PARK_DOC` | Park document | `R2R-GL-FB50-X_PARK` | N |
| 3 | BKPF `STBLG<>''`; ts CPUDT+CPUTM of the reversal document `STBLG/STJAH` | `REVERSE_DOC` | Reverse document | `R2R-GL-FB50-X_REVERSE` | N |
| 4 | BSAS on the doc; ts `AUGDT` (day) | `CLEAR_ITEM` | Clear open item | `R2R-GL-FB50-X_CLEAR` | N |
| 1 | case type `gl_account`: CDHDR class SACH, `CHANGE_IND='I'` | `CREATE_GL_ACCOUNT` | Create G/L account | `R2R-GL-FS00-01` | Y |
| 2 | CDPOS class SACH, `TABNAME='SKB1'` | `CHANGE_GL_COMPANY` | Change G/L company code data | `R2R-GL-FS00-02` | N |
| 3 | CDPOS class SACH, `TABNAME='SKAT'` | `CHANGE_GL_TEXT` | Change G/L account text | `R2R-GL-FS00-03` | N |
| 1 | case type `asset`: CDHDR class ANLA, `CHANGE_IND='I'` | `CREATE_ASSET` | Create asset | `R2R-AA-AS01-01` | Y |
| 2 | CDPOS class ANLA, `TABNAME='ANLZ'` | `CHANGE_ASSET_ASSIGNMENT` | Change asset time-dependent data | `R2R-AA-AS01-02` | N |
| 3 | CDPOS class ANLA, `TABNAME='ANLB'` | `CHANGE_ASSET_DEPRECIATION` | Change depreciation terms | `R2R-AA-AS01-03` | N |
| 1 | case type `cost_center`: CDHDR class KOSTL, `CHANGE_IND='I'` | `CREATE_COST_CENTER` | Create cost centre | `R2R-CO-KS01-01` | Y |
| 2 | CDPOS class KOSTL, `CHNGIND='U'` | `CHANGE_COST_CENTER` | Change cost centre | `R2R-CO-KS01-02` | N |
| 1 | case type `cost_element`: CDHDR class KSTAR, `CHANGE_IND='I'` | `CREATE_COST_ELEMENT` | Create cost element | `R2R-CO-KA01-01` | Y |
| 1 | case type `internal_order`: AUFK `AUTYP='01'`; ts ERDAT+ERFZEIT | `CREATE_INTERNAL_ORDER` | Create internal order | `R2R-CO-KO01-01` | Y |

The template L4s R2R-BNK-FI12, R2R-BNK-FBZP, R2R-BNK-FTXP and R2R-CO-KE51 have no event source in this design. They stay as reference L5s with the config overlay (§4.3). Attributes: `BLART`, `TCODE`, `BSTAT`, `AWTYP`. Org: `BUKRS`.

**PP**

`JCDS` events use `INACT=''` (status set) and ts `UDATE+UTIME`. Status codes are SAP standard system statuses.

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | AUFK `AUTYP='10'`; ts ERDAT+ERFZEIT | `CREATE_PROD_ORDER` | Create production order | `PP-ORD-CO01-01` | Y |
| 2 | CDHDR class ORDER, `TABNAME='AFKO'`, `FNAME IN ('GSTRP','GLTRP')` (read with PM's ORDER class rows) | `RESCHEDULE_ORDER` | Reschedule order dates | `PP-ORD-CO01-02` | N |
| 3 | JCDS `STAT='I0002'` | `RELEASE_ORDER` | Release order | `PP-ORD-CO01-X_RELEASE` | Y |
| 4 | MSEG `BWART='261'` with `AUFNR` = case; ts MKPF CPUDT+CPUTM | `ISSUE_COMPONENTS` | Issue components | `PP-ORD-CO01-X_GOODS_ISSUE` | N |
| 5 | JCDS `STAT='I0010'` | `PARTIAL_CONFIRM` | Partially confirm order | `PP-ORD-CO01-X_PARTIAL_CONFIRM` | N |
| 6 | JCDS `STAT='I0009'` | `CONFIRM_ORDER` | Confirm order | `PP-ORD-CO01-X_CONFIRM` | Y |
| 7 | MSEG `BWART='101'` with `AUFNR` = case | `GOODS_RECEIPT_ORDER` | Receive goods from order | `PP-ORD-CO01-X_GOODS_RECEIPT` | Y |
| 8 | MSEG `BWART IN ('102','262')` | `REVERSE_MOVEMENT` | Reverse goods movement | `PP-ORD-CO01-X_REVERSE_MOVEMENT` | N |
| 4 | MATDOC `RECORD_TYPE='MDOC'`, `BWART='261'`, `AUFNR` = case; ts CPUDT+CPUTM; resource USNAM | `ISSUE_COMPONENTS` | Issue components | `PP-ORD-CO01-X_GOODS_ISSUE` | N |
| 7 | MATDOC `RECORD_TYPE='MDOC'`, `BWART='101'`, `AUFNR` = case; ts CPUDT+CPUTM; resource USNAM | `GOODS_RECEIPT_ORDER` | Receive goods from order | `PP-ORD-CO01-X_GOODS_RECEIPT` | Y |
| 8 | MATDOC `RECORD_TYPE='MDOC'`, `BWART IN ('102','262')`, `AUFNR` = case; ts CPUDT+CPUTM; resource USNAM | `REVERSE_MOVEMENT` | Reverse goods movement | `PP-ORD-CO01-X_REVERSE_MOVEMENT` | N |
| 9 | JCDS `STAT='I0012'` | `DELIVER_ORDER` | Order delivered | `PP-ORD-CO01-X_DELIVERED` | N |
| 10 | JCDS `STAT='I0045'` | `TECO_ORDER` | Technically complete order | `PP-ORD-CO01-X_TECO` | Y |
| 11 | JCDS `STAT='I0046'` | `CLOSE_ORDER` | Close order | `PP-ORD-CO01-X_CLOSE` | N |
| 1 | case type `bom`: CDHDR class STUE, `CHANGE_IND='I'` | `CREATE_BOM` | Create bill of material | `PP-BOM-CS01-01` | Y |
| 2 | CDPOS class STUE, `TABNAME='STPO'` | `CHANGE_BOM_ITEM` | Change BOM item | `PP-BOM-CS01-02` | N |

The MATDOC rows apply on `s4hana_onprem` and the MSEG rows on `ecc`. They give the same activity key, L5 id, Order and `object_refs` (`MBLNR/MJAHR`), so ECC and S/4 models of the same process compare one to one. `MKPF` supplies the timestamp and user for the MSEG rows; MATDOC carries them on the line.

Order row 2 needs class `ORDER` in the CDHDR filter. The PP and PM CDHDR reads therefore both include `'ORDER'`, with `FNAME IN ('GSTRP','GLTRP','PRIOK','KEY')`. JCDS rows with status codes not listed here become `STATUS_<STAT>` under rule 2 of §4.2 (`PP-ORD-CO01-X_STATUS_<STAT>`).

PP-BOM-CS01, PP-RTG-CR01, PP-RTG-CA01 and PP-ORD-MD01 have no other event source. They keep their reference L5s, with a `bom` stream only for CS01. MRP runs are batch jobs with no persistent planned-order history once orders are converted.

Attributes: `AUART`, `BWART`, `STAT`. Org: `WERKS`.

**PM**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | QMEL (PM per §2.2); ts QMDAT+MZEIT | `CREATE_NOTIFICATION` | Create maintenance notification | `PM-PLN-IW21-01` | N |
| 2 | CDPOS class QMEL, `FNAME='PRIOK'` | `CHANGE_PRIORITY` | Change notification priority | `PM-PLN-IW21-02` | N |
| 3 | AUFK `AUTYP='30'`, AFIH `WARPL=''`; ts ERDAT+ERFZEIT | `CREATE_PM_ORDER` | Create maintenance order | `PM-PLN-IW31-01` | Y |
| 3 | AUFK `AUTYP='30'`, AFIH `WARPL<>''` | `CREATE_ORDER_FROM_PLAN` | Create order from maintenance plan | `PM-PLN-IP01-02` | Y |
| 4 | JCDS `STAT='I0002'` | `RELEASE_ORDER` | Release order | `PM-PLN-IW31-X_RELEASE` | Y |
| 5 | MSEG `BWART='261'`, `AUFNR` = case | `ISSUE_SPARES` | Issue spare parts | `PM-PLN-IW31-02` | N |
| 5 | MATDOC `RECORD_TYPE='MDOC'`, `BWART='261'`, `AUFNR` = case; ts CPUDT+CPUTM; resource USNAM (`s4hana_onprem`) | `ISSUE_SPARES` | Issue spare parts | `PM-PLN-IW31-02` | N |
| 6 | JCDS `STAT='I0010'` | `PARTIAL_CONFIRM` | Partially confirm order | `PM-PLN-IW31-X_PARTIAL_CONFIRM` | N |
| 7 | JCDS `STAT='I0009'` | `CONFIRM_ORDER` | Confirm order | `PM-PLN-IW31-X_CONFIRM` | Y |
| 8 | JCDS `STAT='I0045'` | `TECO_ORDER` | Technically complete order | `PM-PLN-IW31-X_TECO` | Y |
| 9 | QMEL `QMDAB<>''`; ts QMDAB+QMZAB | `COMPLETE_NOTIFICATION` | Complete notification | `PM-PLN-IW21-X_COMPLETE` | N |
| 10 | JCDS `STAT='I0046'` | `CLOSE_ORDER` | Close order | `PM-PLN-IW31-X_CLOSE` | N |
| 1 | case type `equipment`: CDHDR class EQUI, `CHANGE_IND='I'` | `CREATE_EQUIPMENT` | Create equipment | `PM-TO-IE01-01` | Y |
| 2 | CDPOS class EQUI, `CHNGIND='U'` | `CHANGE_EQUIPMENT` | Change equipment | `PM-TO-IE01-02` | N |

`PM-PLN-IW31-02` is the reference's operations L5 (PLPO). It is reused here for spare-part issue because that is the first observable execution step on the order. PM-TO-IL01 and PM-PLN-IP01-01 have no event source. Attributes: `QMART`, `AUART`, `PRIOK`, `STAT`, `BWART`. Org: `IWERK`, `WERKS`.

**QM**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | QALS row; ts ENSTEHDAT+ENTSTEZEIT, resource ERSTELLER | `CREATE_LOT` | Create inspection lot | `QM-IN-QA01-01` | Y |
| 2 | QMEL with `PRUEFLOS` = case; ts QMDAT+MZEIT | `CREATE_QM_NOTIFICATION` | Raise quality notification | `QM-IN-QM01-01` | N |
| 3 | QMFE for that notification; ts ERDAT+ERZEIT | `RECORD_DEFECT` | Record defect | `QM-IN-QM01-02` | N |
| 4 | QAVE row; ts VDATUM (day), resource VNAME | `USAGE_DECISION` | Make usage decision | `QM-IN-QA01-X_USAGE_DECISION` | Y |
| 5 | QAVE `VAEDATUM<>''` | `CHANGE_USAGE_DECISION` | Change usage decision | `QM-IN-QA01-X_CHANGE_UD` | N |
| 1 | case type `qm_notification`: QMEL without lot | `CREATE_QM_NOTIFICATION` | Raise quality notification | `QM-IN-QM01-01` | Y |
| 2 | QMFE | `RECORD_DEFECT` | Record defect | `QM-IN-QM01-02` | N |
| 3 | QMSM `ERLDAT<>''`; ts ERLDAT+ERLZEIT, resource ERLNAM | `COMPLETE_TASK` | Complete task | `QM-IN-QM01-X_COMPLETE_TASK` | N |
| 4 | QMEL `QMDAB<>''` | `COMPLETE_NOTIFICATION` | Complete notification | `QM-IN-QM01-X_COMPLETE` | Y |

QM-MD-QS21 and QM-MD-QP01 have no event source. Attributes: `ART`, `HERKUNFT`, `VCODE`, `QMART`, `FECOD`. Org: `WERK`.

**PS**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | PROJ row for `PRPS.PSPHI`; ts ERDAT (day) | `CREATE_PROJECT` | Create project definition | `PS-PRJ-CJ01-01` | Y |
| 2 | PRPS row; ts ERDAT (day) | `CREATE_WBS` | Create WBS element | `PS-PRJ-CJ02-01` | Y |
| 3 | JCDS on `PRPS.OBJNR`, `STAT='I0002'` | `RELEASE_WBS` | Release WBS element | `PS-PRJ-CJ02-X_RELEASE` | Y |
| 4 | JCDS `STAT='I0045'` | `TECO_WBS` | Technically complete WBS | `PS-PRJ-CJ02-X_TECO` | N |
| 5 | JCDS `STAT='I0046'` | `CLOSE_WBS` | Close WBS element | `PS-PRJ-CJ02-X_CLOSE` | N |

PS-PRJ-CJ02S (settlement rule) has no event source. Org: `PBUKR`.

**WH**

L4 routing for ECC WM: an LTAP row with `VLTYP` starting with `9` goes to `WH-IN-LT06`. Otherwise, LTAK `BETYP='L'` goes to `WH-OUT-LT03`. Every other row goes to `WH-INT-LT01`.

For EWM, `TRART='1'` goes to `WH-IN-SCWM_PRDI`, `TRART='2'` goes to `WH-OUT-SCWM_PRDO`, and any other value goes to `WH-INT-SCWM_MON`.

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | LTAK row; ts BDATU+BZEIT, resource BNAME | `CREATE_TO` | Create transfer order | `<L4>-01` (LT06, LT03, LT01) | Y |
| 2 | LTAP `PQUIT='X'`; ts QDATU+QZEIT, resource QNAME | `CONFIRM_TO_ITEM` | Confirm transfer order item | `<L4>-02` | Y |
| 1 | /SCWM/ORDIM_C row; ts CREATED_AT, resource CREATED_BY | `CREATE_TASK` | Create warehouse task | `<L4>-X_CREATE_TASK` (SCWM L4s) | Y |
| 2 | /SCWM/ORDIM_C `CONFIRMED_AT` set; resource CONFIRMED_BY | `CONFIRM_TASK` | Confirm warehouse task | `<L4>-01` | Y |

For `WH-INT-SCWM_MON` the L5 `-01` exists in the reference. For the LT01 L4, `-02` (LQUA) is reused for confirmation. Attributes: `BWLVS`, `BETYP`, `TRART`, `PROCTY`. Org: `LGNUM`.

**HTR**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | PA0000 row; ts AEDTM (day) | `RECORD_ACTION` | Record personnel action | `HTR-PA-PA40-01` | Y |
| 2 | PA0000 with `MASSG<>''` | `RECORD_REASON` | Record action reason | `HTR-PA-PA40-02` | N |
| 3 | PA0001 with same PERNR and BEGDA | `UPDATE_ORG_ASSIGNMENT` | Update organisational assignment | `HTR-PA-PA40-03` | Y |
| 4 | PA0002 with same PERNR and BEGDA | `UPDATE_PERSONAL_DATA` | Update personal data | `HTR-PA-PA30-01` | N |
| 5 | PA0008 with same PERNR and BEGDA | `UPDATE_PAY` | Update basic pay | `HTR-PA-PA30-02` | N |
| 1 | case type `org_object`: HRP1000 row | `CREATE_ORG_OBJECT` | Create organisational object | `HTR-OM-PP01-01` | Y |
| 2 | HRP1001 for that object | `CREATE_RELATIONSHIP` | Create relationship | `HTR-OM-PP01-02` | N |

HR infotype records carry only `AEDTM` (date), so every HTR event is day-precision. The ordering inside a day comes from the Order column. Attributes: `MASSN`, `MASSG`, `STAT2`, `OTYPE`, `RSIGN`, `RELAT`. Org: `BUKRS`, `WERKS`, `PERSG`. `ORGEH` is not stored.

**MDG**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | USMD120C; ts USMD_CREATED_AT, resource USMD_CREATED_BY | `CREATE_CR` | Create change request | `MDG-CR-MDGIMG-01` | Y |
| 2 | `USMD_RELEASED_AT` set; resource USMD_RELEASED_BY | `APPROVE_CR` | Approve change request | `MDG-CR-MDGIMG-02` | Y |
| 3 | `USMD_DATA_CHN_AT` set | `ACTIVATE_DATA` | Activate data | `MDG-CR-MDGIMG-X_ACTIVATE` | Y |
| 4 | `USMD_CHANGED_AT` later than every timestamp above | `LAST_CHANGE` | Last change to request | `MDG-CR-MDGIMG-X_LAST_CHANGE` | N |

Attributes: `USMD_CREQ_TYPE`, `USMD_CREQ_STATUS`, `USMD_PRIORITY`. The USMD timestamps are `TIMESTAMP` (UTC) and are taken as UTC.

**SFX**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | JobRequisition; ts createdDate | `CREATE_REQUISITION` | Create job requisition | `SFX-RCM-MANAGE_JOB_REQUISITIONS-01` | Y |
| 2 | JobApplication for the requisition; ts appliedDate | `RECEIVE_APPLICATION` | Receive application | `SFX-RCM-MANAGE_JOB_REQUISITIONS-02` | Y |
| 3 | JobApplication `status` changed; ts lastModifiedDate | `APPLICATION_<STATUS>` | Application reached <status> | `SFX-RCM-MANAGE_JOB_REQUISITIONS-X_APP_<STATUS>` | N |
| 1 | case type `emp_event`: EmpJob `event='H'`; ts startDate (day) | `HIRE` | Hire employee | `SFX-EC-ADD_NEW_EMPLOYEE-02` | Y |
| 1 | EmpJob other `event` | `EVENT_<event>` | Job event <event> | §4.2 rule 3 (`SFX-DSC-EVENT_<event>`) | Y |
| 1 | case type `time_record`: EmployeeTime; ts startDate | `RECORD_TIME` | Record time | `SFX-TIM-MY_TIMESHEET-01` | Y |

`<STATUS>` is the status value upper-cased, with non-alphanumeric characters replaced by `_` and truncated to 24 characters. One application's "lastModifiedDate" gives only its latest status. The flow therefore shows the current status as the last step, and the brief's "rework" cannot be measured for SFX. The UI says so in the conformance tab.

**ARB**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | requisitions; ts createdDate | `CREATE_REQUISITION` | Create requisition | `ARB-PRC-PROCUREMENT-X_CREATE_REQUISITION` | Y |
| 1 | case type `supplier`: suppliers; ts registrationDate | `REGISTER_SUPPLIER` | Register supplier | `ARB-SUP-SUPPLIER_MANAGEMENT-01` | Y |
| 1 | case type `contract`: contracts; ts effectiveDate | `CONTRACT_EFFECTIVE` | Contract effective | `ARB-CON-CONTRACTS-01` | Y |
| 2 | contracts `expirationDate` not after the run date | `CONTRACT_EXPIRED` | Contract expired | `ARB-CON-CONTRACTS-X_EXPIRED` | N |

**CNQ**

| Order | Source + condition | Activity key | Label | L5 id | Exp |
|---|---|---|---|---|---|
| 1 | entries; ts min(transactionDate) per report (day) | `INCUR_EXPENSE` | Incur first expense | `CNQ-EXP-EXPENSE-02` | Y |
| 2 | reports; ts submitDate | `SUBMIT_REPORT` | Submit expense report | `CNQ-EXP-EXPENSE-01` | Y |

Concur `approvalStatus` and `paymentStatus` have no timestamp in the registry. They are stored as case attributes, and the variants tab offers them as filters. They are not activities.

**Resources and automation.** `resource` is the user field named in each row: ERNAM, USNAM, USERNAME, UNAME, BNAME, QNAME, ERSTELLER, VNAME, ERLNAM, the `*_BY` fields, `requestor`, `ownerLoginId` or `hiringManager`. `automated` is true when `USR02.USTYP IN ('B','S')` for that user. It is false for `USTYP IN ('A','C','L')`. It is NULL when USR02 was not read, or for cloud sources.

---

## 3. Mining

All mining runs in `api/services/process_discovery/mining.py`. Aggregates are computed in Postgres SQL over `process_events`. Python handles conformance only. No new dependency is added: pm4py, networkx and lxml are absent from requirements.

### 3.1 Filters

Every mining query takes `ProcessFilter`, a Pydantic model:

| Field | Type | SQL |
|---|---|---|
| `period_from`, `period_to` | `date \| None` | cases whose first event falls in the range |
| `org` | `dict[str, list[str]]` | `org->>'<KEY>' = ANY(:vals)` on the case's first event |
| `doc_type` | `list[str]` | `doc_type = ANY(:vals)` on the case's first event |
| `case_type` | `str` | default: the primary case type of the L1 |
| `automated` | `bool \| None` | case has at least one automated event (`true`) or none (`false`) |

Filters live in the URL (`?from=&to=&org.BUKRS=&doc_type=&case_type=&automated=`), following the spec.md filter rule.

### 3.2 Directly-follows graph

```sql
WITH f AS (SELECT case_id FROM process_events
           WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct
           GROUP BY case_id HAVING <case filters>),
e AS (SELECT pe.case_id, pe.activity, pe.ts,
             lead(pe.activity) OVER w AS nxt, lead(pe.ts) OVER w AS nxt_ts,
             row_number() OVER w AS rn
      FROM process_events pe JOIN f USING (case_id)
      WHERE pe.tenant_id = :t AND pe.system_id = :s AND pe.l1 = :l1 AND pe.case_type = :ct
      WINDOW w AS (PARTITION BY pe.case_id ORDER BY pe.ts, pe.seq, pe.id))
SELECT activity, coalesce(nxt, '__END__') AS nxt, count(*) AS n, count(DISTINCT case_id) AS cases,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM nxt_ts - ts)) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM nxt_ts - ts)) AS p90_s
FROM e GROUP BY 1, 2;
```

Edges from `__START__` come from `rn = 1`. Node stats come from a second grouping on `activity`: events, distinct cases, and median and p90 of the time to the next event.

A day-precision pair has a waiting time of 0 within a day. Medians over such pairs are labelled "day precision" in the UI tooltip.

### 3.3 Variants

A variant is `string_agg(activity, '>' ORDER BY ts, seq, id)` per case. Variants are grouped by `md5`. For each variant the query computes the case count, the share (cases / total cases), and the median and p90 of case duration `max(ts) - min(ts)`.

The top 2,000 variants by case count are stored in `process_variants`. The rest are summed into one row, `variant_hash = '0' * 32`, with `activities = '{__OTHER__}'`. Up to five sample case ids are kept per variant.

### 3.4 Throughput, waiting time, rework

- **Case throughput.** Median and p90 of case duration, overall and per variant.
- **Waiting time.** Median and p90 per DFG edge (§3.2). The L5 `median_seconds` is the median time from that activity to the next event in the same case.
- **Rework.** For each activity, the share of cases where it occurs more than once (`count(*) > 1` per case and activity).
- **Loop.** An edge whose target ranks before its source in the topological order of `layout_diagram._ranks` (`bpmn_layout.py`). These are the back-edges the layout already detects. Self-loops (`a -> a`) are counted as rework.

### 3.5 Conformance against the reference

For each case type, the expected sequence `E` is the ordered list of the mapping's activities with `expected=True`, sorted by Order. Activities that share an Order value are alternatives: at least one of them is expected. Conformance is computed in Python, per variant, not per case. The result is then weighted by variant case count. Conformance runs over the top 2,000 variants plus the "other" bucket. The other bucket is scored as missing every expected activity it cannot evidence, which gives it fitness 0.

For one variant with activity sequence `V`:

- **missing**: expected activities (or alternative groups) not in `V`.
- **extra**: activities in `V` that are not in the mapping for the case type. Mapped non-expected activities, such as a PO change, are "optional", not extra.
- **out of order**: the number of pairs `(a, b)` in `V`, with `a` before `b` at their first occurrences, where `order(a) > order(b)`.
- **case fitness**: `1 - (missing + extra + out_of_order) / (len(E) + len(V))`, clamped to `[0, 1]`.
- **step fitness** for activity `x` in `E`: `1 - (cases missing x + cases where x is out of order) / cases`.

These values are written to `process_variants.fitness`, to `stats.conformance`, and to each L5's `discovery.fitness`.

### 3.6 Automation rate and run stats

The automation rate is the share of events with `automated = true` among events where `automated IS NOT NULL`. It is reported per activity and per L1. When every event has `automated IS NULL`, the UI shows "not available".

`process_discovery_runs.stats` has this shape:

```json
{
  "cases": 18234, "events": 141022, "variants": 611, "case_types": {"po_item": 18234, "vendor": 412},
  "throughput": {"median_seconds": 1987200, "p90_seconds": 5184000},
  "automation_rate": 0.31,
  "conformance": {"fitness": 0.82, "missing": {"GOODS_RECEIPT": 0.07}, "out_of_order": {"INVOICE_RECEIPT": 0.12}},
  "rework": {"CHANGE_PO_QTY": 0.09},
  "tables": {"EKKO": {"rows": 51230, "partial": false}},
  "truncated_tables": [], "shared_objects": 2210,
  "unmapped": {"POST_ZF01": 812}
}
```

### 3.7 Cost

Every query is scoped by `(tenant_id, system_id, l1, case_type)` and uses `ix_pe_case`. A filtered DFG is cached in Redis for 600 seconds. The cache key is `pd:dfg:<tenant>:<system>:<l1>:<sha1(filters)>:<run_id>`. A new run changes `run_id`, which invalidates the cache.

---

## 4. L1 to L5 generation

### 4.1 Levels

The code's names (`sap/process_definitions.py:3-9`) are binding. The brief's labels map onto them one level shifted:

| Code level | Code meaning | Brief wording | Discovered content |
|---|---|---|---|
| L1 | end-to-end process (PTP) | "L1 area" | one model per L1 |
| L2 | process area (`PTP-PO`) | "L2 process" | areas with at least one observed activity, plus `<L1>-DSC` |
| L3 | process (`PTP-PO-P1`) | "L3 sub-process" | as reference |
| L4 | sub-process, one diagram (`PTP-PO-ME21N`) | "L4 activity" | step-level DFG diagram |
| L5 | activity (`PTP-PO-ME21N-02`) | "L5 step" | one per activity key, with SAP evidence and stats |

`api/services/process_discovery/generate.py` exposes `generate(l1: str, run: ProcessDiscoveryRun, mining: MiningResult) -> ProcessModelDocument`. It starts from `reference_document()` restricted to that L1, together with the config overlay that the designer already applies. It then sets the fields below.

### 4.2 Mapping discovered activities to ids

1. **Mapped to a template L5.** The activity key's `l5_id` exists in the reference. The node keeps its id, label, fields and evidence. It gains `discovery` (§4.4), and `source` stays `"template"` (or `"config"`).
2. **Known L4, step not in the reference.** The `l5_id` has the form `<L4>-X_<KEY>`. A new `L5` is appended to that L4 with:
   - `id = <L4>-X_<KEY>`
   - `label` = the mapping label
   - `source = "discovered"`
   - `fields` = the source `TABLE.FIELD` refs of the mapping row
   - `discovery` set

   Runtime-built keys follow the same pattern: `STATUS_<STAT>`, `APP_<STATUS>`. `<KEY>` is the activity key with characters outside `[A-Z0-9_]` replaced by `_`, so it always satisfies `ID_PATTERN`.
3. **No L4.** This covers activity keys built at runtime with no mapping row, such as `POST_<TCODE>` and `EVENT_<event>`. They go under one discovered branch per L1:
   - L2 `<L1>-DSC` "Discovered, not in reference"
   - L3 `<L1>-DSC-P1` "Discovered activities"
   - L4 `<L1>-DSC-<KEY>` labelled with the activity label
   - one L5 `<L1>-DSC-<KEY>-01`

   All four nodes have `source = "discovered"`.
4. **Template L5 with no event source or no observed case.** These keep `source` and `status`, and get `discovery = DiscoveryStats(case_count=0, …, observed=False)`. They are drawn with the "not observed" style (§7). They are never removed.

`process_events.l5_id` is written back after generation in a single `UPDATE … FROM (VALUES …)` per L1, so case explorer rows link to their L5.

### 4.3 Model changes (`api/models/process_model.py`, additive)

```python
Source = Literal["template", "config", "discovered"]

class DiscoveryEdge(BaseModel):
    target: str                       # sibling node id at the same level, or "__END__"
    count: int
    median_seconds: Optional[float] = None

class DiscoveryStats(BaseModel):
    case_count: int = 0
    share: float = 0.0                # cases containing this node / cases of the case type
    event_count: int = 0
    median_seconds: Optional[float] = None
    p90_seconds: Optional[float] = None
    rework_rate: Optional[float] = None
    automation_rate: Optional[float] = None
    fitness: Optional[float] = None
    observed: bool = False
    case_type: Optional[str] = None
    edges: list[DiscoveryEdge] = []   # as-is flow to siblings, used by export and the L1-L3 flow view
```

`discovery: Optional[DiscoveryStats] = None` is added to `L5`, `L4`, `L3`, `L2` and `L1`. `L3`, `L2` and `L1` also gain `source: Source = "template"`, so the discovered branch can be flagged. Both fields are optional with defaults, so every stored model and the designer remain valid. `ProcessModelDocument.source` gains the value `"discovered"`. `schema_version` stays 1.

`Evidence` (`:22`) is documented "config only, never documents". Discovered nodes therefore never put event data in `evidence`. Their SAP evidence is:

- `fields`: the `TABLE.FIELD` refs from the mapping row
- the L4's `tcode`, already present in the reference
- `discovery`: the counts

Doc types appear in `discovery` only as filter values in the UI, not in the model.

**Aggregation upward.** An L4's stats cover the cases that contain any of its L5s. The same rule applies to L3 (any of its L4s) and to L2. An L1's stats cover all cases of its primary case type. `edges` at L4, L3 and L2 are the DFG collapsed to that level. An event maps to its ancestor at that level. Consecutive events under the same ancestor collapse to one node. A transition `X -> Y` between distinct siblings counts once per occurrence.

**The L4 diagram** for discovered models is rebuilt from the L5-level DFG of the case type that owns the L4:

- one `task` node per L5 with `observed=True`, plus the not-observed reference L5s, drawn unconnected below
- `startEvent` and `endEvent`
- one `Flow` per kept edge

Gateways are added by the rule in §5.2.

**Edge pruning.** For readability and for Signavio, an edge is kept when its count is at least 1% of the case type's cases, or when it is the only outgoing edge of its source. Pruned edges stay in `discovery.edges` and in the UI's "show all edges" toggle.

### 4.4 Every L5 shows

Every L5 shows `case_count`, `share` and `median_seconds` from `discovery`, plus `fitness` and `rework_rate` when present. The L5 table in the drill view (§7) has these columns:

- id (Mono)
- label
- source Pill: Reference, Config or Discovered
- cases
- share
- median
- p90
- rework
- automation
- fitness
- T-code
- fields

---

## 5. Signavio export

### 5.1 Package

`export_zip(document, overlay, meta)` (`api/services/bpmn_export.py:283`) is reused unchanged in shape:

- one `L{level}_{id}.bpmn` file per L1, L2 and L3 landscape, and one per L4 process
- `callActivity` with `calledElement="L{level+1}_{child}"` linking the files (`:156-157`)
- `manifest.json`
- `README.txt`
- `validate_package` run before zipping

This is the brief's "one model per L1/L2, L3 to L5 as collapsed sub-processes linked by calledElement". L5s are tasks inside the L4 file, because they are activities and have no diagram of their own.

### 5.2 Changes to the writer

1. `_landscape(level, node, children, meta, edges=None)`.
   - When `edges` is None, the linear chain at `:161` is kept unchanged.
   - When `edges` is a list of `(source_id, target_id, label)` taken from `child.discovery.edges`, the file wires `START` to every child that has a `__START__` predecessor in the collapsed DFG, wires child to child per kept edge, and wires the children that have `__END__` successors to `END`.
   - A child with more than one kept outgoing edge gets an `exclusiveGateway` (`id=f"GW_{child.id}_OUT"`, `gatewayDirection="Diverging"`) after it. A child with more than one kept incoming edge gets a converging gateway before it.
   - Parallel gateways are never inferred. A DFG cannot tell concurrency from choice without a concurrency oracle, so an XOR gateway is the honest rendering.
   - Layout is `layout_diagram(..., starts=["START"])` (`bpmn_layout.py:91`). It is deterministic: `_ranks` drops back-edges by DFS, and `_route` routes back-edges underneath.
2. `_l4_file` (`:226`) needs no signature change. It already lays out `l4.diagram` with gateways, conditions and positions. Generation (§4.3) writes the discovered DFG into `l4.diagram`.
3. `_task` (`:190`) adds attributes when `node.discovery` is set:
   - a `mer:discovery` extension element with `caseCount`, `share`, `medianSeconds`, `p90Seconds`, `fitness`, `reworkRate`, `automationRate` and `observed`
   - `signavio:signavioMetaData` keys `meridian_case_count`, `meridian_share` (percent with one decimal), `meridian_median` (as `"3d 4h"`), `meridian_source` (`template` | `config` | `discovered`) and `meridian_fitness`
   - documentation lines `Cases: 1,204 (61.0%)`, `Median to next step: 3d 4h`, `Source: discovered, not in reference` (only for discovered nodes)

   Existing keys (`meridian_tcode`, `meridian_rules`, `meridian_dq_status`) stay.
4. Sequence flows carry `name="1,204 cases"` and `signavio:signavioMetaData meridian_edge_count`.
5. `manifest.json` gains a top-level `discovery` block:

   ```json
   {"system_id": "…", "system_type": "ecc", "l1": "PTP", "run_id": "…",
    "window": {"from": "2024-10-01", "to": "2026-10-10"},
    "filters": {}, "coverage": "discovered", "cases": 18234, "variants": 611,
    "edge_threshold": 0.01, "generated_at": "2026-10-11T09:00:00Z"}
   ```

   `schema_version` stays 1. The block is optional, and `import_zip` (`:357`) ignores unknown keys.

When `model.source == "discovered"`, the README text adds one paragraph, stating:

- the window
- the case notion
- that flows are observed directly-follows edges above 1% of cases
- that gateways are exclusive choices inferred from branching

### 5.3 Endpoints

The new router is `api/routes/process_discovery.py`, with prefix `/api/v1/process-discovery`, registered in `api/main.py`.

| Method path | Permission | Returns |
|---|---|---|
| `GET /systems/{system_id}/catalogue` | `view` | 13 rows: `{l1, name, coverage, last_run: {id, status, finished_at, cases, fitness}, sources: [{table, rows, partial}]}` |
| `POST /systems/{system_id}/runs` | `run_process_discovery` | body `{l1s: list[str], mode: "full" \| "incremental", period_from?: date}`. Returns `{job_id, run_ids}`. 409 if a run for the same system is active |
| `GET /systems/{system_id}/runs` | `view` | runs, newest first |
| `GET /runs/{run_id}` | `view` | run with stats |
| `GET /runs/{run_id}/model` | `view` | `ProcessModelDocument` |
| `GET /runs/{run_id}/dfg?level=&node_id=&<filters>` | `view` | `{nodes, edges}` at the level, for the Graph chart |
| `GET /runs/{run_id}/variants?<filters>&limit=&offset=` | `view` | variants page |
| `GET /runs/{run_id}/conformance?<filters>` | `view` | per-step fitness, missing, out of order |
| `GET /runs/{run_id}/cases?<filters>&activity=&variant=&limit=&offset=` | `export_process` | case list (case_id, first ts, last ts, events, variant) |
| `GET /runs/{run_id}/cases/{case_id}` | `export_process` | event list with object_refs |
| `GET /runs/{run_id}/export/signavio?<filters>` | `export_process` | zip, `Content-Disposition: attachment; filename="meridian-asis-<L1>-<yyyymmdd>.zip"` |
| `GET /runs/{run_id}/export/bpmn/{node_id}?<filters>` | `export_process` | one `.bpmn` file for that L1, L2, L3 or L4 node (`application/xml`) |

When filters are passed, export mines and generates with the same filters. The manifest records them.

Every export writes an audit row with the same helper pattern as `api/routes/process_export.py` (`_insert_audit_row`). The action is `process_discovery.export`, with details `{run_id, l1, node_id, filters}`.

The case endpoints need `export_process` because events carry user ids. Reading users' activity is narrower than "view".

### 5.4 Signavio import path

In Signavio Process Manager:

1. Open the target folder.
2. Choose Import, then BPMN 2.0 (`.bpmn`), and upload the files from the zip. Start with `L1_<L1>.bpmn`, then the remaining files.
3. Signavio links each `callActivity` to the imported model whose process id equals its `calledElement`.

The per-process `.bpmn` download is for a single-diagram import. The README in the zip states these steps verbatim.

### 5.5 Validation

`tests/test_process_discovery_export.py` builds a discovered PTP model from a fixture event set. It then:

- calls `export_zip`
- runs every file through `_xsd_validate` (`tests/test_bpmn_export.py:78`, OMG XSD vendored at `tests/fixtures/bpmn20-xsd/BPMN20.xsd`). The test is skipped when lxml is absent, as today.
- always runs these structural checks without lxml:
  - each `calledElement` resolves to a file in the zip
  - every `sequenceFlow` has a `BPMNEdge` and every flow node has a `BPMNShape`
  - every gateway has more than one outgoing or incoming flow
  - all ids are unique per file
  - `import_zip(export_zip(doc))` round-trips the L1 to L5 ids
- confirms that two exports of the same run produce byte-identical zips. Timestamps in the manifest come from the run, not from `now()`. This is the determinism check.

---

## 6. Role: `process_analyst`

### 6.1 Permissions (`api/services/rbac.py`, additive)

```python
PERMISSIONS["process_analyst"] = _READ | {"run_process_discovery", "export_process"}
PERMISSIONS["admin"] |= {"run_process_discovery", "export_process"}
PERMISSIONS["manager"] |= {"export_process"}
VALID_ROLES = set(PERMISSIONS.keys())
```

- `process_analyst` is a new key in the same dict, like the persona keys in `rbac.md` §3.2. `users.role` accepts it once it is in `VALID_ROLES`.
- **Run is granted to `admin` and `process_analyst` only.**
- `manager` gains only `export_process`. When wave 13 builds `programme_lead` from `PERMISSIONS["manager"]`, the programme lead therefore keeps process view (from `view`) and export, which is what the brief asks for. The same goes for `platform_admin` from `admin`.
- No other role gains either string.
- No existing (role, action) pair changes. The legacy snapshot test (rbac wave 13) gets the two new strings as new rows only.

"View-only on DQ" holds because `_READ` contains no DQ mutation action.

### 6.2 Resource model (additive to `rbac.md` §2.1)

- `RESOURCES` gains `"process"` at the end of the tuple.
- `LEGACY_ACTION_MAP` gains:

| Legacy action | (resource, action) |
|---|---|
| `run_process_discovery` | (`process`, `run`) |
| `export_process` | (`process`, `export`) |

- `(process, view)` comes from the existing `view` row: (`*`, `view`) minus its exclusions.
- The `(*, export)` expansion of the legacy `export` action is amended to exclude `process`. Without that change, every role holding `export` would gain `(process, export)`. With it, nobody's effective process rights change through `export`.

This is the only edit to an existing row, and it removes a pair that has not existed yet. The roles matrix in `rbac.md` §2.2 gains one `process` row: V for every role, X and R for admin and process_analyst, X for manager and programme_lead.

### 6.3 Scope

Every process-discovery route has `system_id` in its path, either directly or through `run_id → system_id`. Each route is declared as `require_permission(action)` today. When rbac wave 14 lands, it switches to `require_permission(action, resource="process", scope=scope_from_path)`. `scope_from_path` gains the `run_id → process_discovery_runs.system_id` lookup.

`api/routes/process_discovery.py` is appended to the wave-14 list of scoped route modules. Until then, process rights are tenant-wide, as all rights are today. A `process_analyst` grant scoped to system A then gets 403 with `request_access` on system B.

### 6.4 Persona and home

- `frontend/hooks/use-role.ts` `Role` gains `"process_analyst"`.
- `frontend/lib/persona.ts`:
  - `Persona` gains `"process"`
  - `PERSONA_BY_ROLE.process_analyst = "process"`
  - `homeHrefForRole` returns `/home/process` for that persona

  The wave-16 swap to `/me/permissions.home` keeps the same value. `rbac.md` §1.1 gains the row:

  | Persona role key | Display name | Default home | Built from legacy | Legacy keys that map here |
  |---|---|---|---|---|
  | `process_analyst` | Process analyst | `/home/process` | `_READ` + `run_process_discovery`, `export_process` | none (new) |

- `/admin/roles` (rbac wave 15) shows it as a built-in.
- `api/routes/users.py` invite accepts it through `VALID_ROLES`.

### 6.5 Existing endpoints unchanged

`/api/v1/process-designer/reference/export/signavio` (`process_export.py:82`) and `/models/{model_id}/export/signavio` (`:89`) keep `require_permission("view")`. `/insights/process` and the designer keep their permissions. The tests in `tests/test_rbac_process_discovery.py` assert:

- `has_permission(r, a)` for every legacy role and every pre-existing action equals the committed snapshot
- `has_permission("viewer", "export_process") is False`
- `has_permission("manager", "run_process_discovery") is False`
- `has_permission("process_analyst", "manage_rules") is False`
- the `(*, export)` expansion excludes `process`

---

## 7. UI

All screens are built from `@/design` primitives, per `docs/superpowers/specs/premium-redesign/spec.md` and `screens.md`:

- `InsightHeader` on every page (wave 17)
- tabs driven by `?tab=`
- filters in the URL
- `Skeleton` while loading (§7.15)
- designed fresh-install `EmptyState` (§7.16)
- `ErrorState` on failure
- `DrillLink` on every number
- Public Sans for prose and JetBrains Mono for SAP ids

No raw hex and no new tokens.

### 7.1 Routes

| Route | Content |
|---|---|
| `app/(app)/home/process/page.tsx` | `PersonaHomePage` (`home/_persona-home.tsx:54`) for the process persona |
| `app/(app)/process/page.tsx` | L1 catalogue |
| `app/(app)/process/[l1]/page.tsx` | L1 to L5 drill, `?system=&run=&tab=flow\|bpmn\|variants\|conformance\|cases\|reference&level=&node=` plus filters |
| `app/(app)/process/runs/page.tsx` | discovery runs |
| `app/(app)/process/runs/[runId]/page.tsx` | run detail: stages, per-table rows, partial and truncated tables, error |
| `app/(app)/process/_components/export-dialog.tsx` | export Dialog |
| `app/(app)/process/_components/flow-view.tsx`, `bpmn-view.tsx`, `variants-table.tsx`, `conformance-view.tsx`, `case-explorer.tsx`, `l5-table.tsx`, `coverage-pill.tsx` | tab bodies |
| `frontend/lib/api/process-discovery.ts` | typed client for §5.3 |

`/insights/process` and `/insights/process/designer` are unchanged. The designer gains one link only, in `designer/_components/discovered.tsx`: "Open as-is model", which goes to `/process/<l1>?run=<latest>`.

### 7.2 Navigation

`frontend/lib/nav.ts` gets a new group, "Process", after Insights (`:150-170`), with `anyOf: ["view"]`. Its items are:

- "As-is processes", `/process`
- "Discovery runs", `/process/runs`

Process home is reached through the persona home link. With wave 16, the items carry `requires: {resource: "process", action: "view"}`.

### 7.3 Screens

**Process home (`/home/process`).**

InsightHeader:

- Situation: "9 of 13 processes discovered on PRD; 4 reference only."
- Changed: "Last run 2 days ago; PTP fitness 0.82, down 0.03."
- Why: "OTC: 12% of items invoiced before goods issue."
- Do next: "Run incremental discovery" (button shown only with `run_process_discovery`) or "Open PTP variants".

Body:

- `Stat` row: processes discovered, cases, median fitness, automation rate
- the catalogue grid (below)
- latest runs (DataTable, 5 rows)

**Catalogue (`/process`).**

- `RunSelector`-style system `Select` (`?system=`)
- one `Card` per L1 in template order, showing:
  - name and L1 id (Mono)
  - `coverage-pill`: Discovered, Partial or "Reference, not discovered"
  - cases, variants, fitness, median throughput
  - last run time
  - `DrillLink` to `/process/<l1>`

  Cards whose source is absent for the system type show the reason line from §10.

**L1 drill (`/process/[l1]`).**

The header has a breadcrumb L1 › L2 › L3 › L4 driven by `?level=&node=`. The filters bar has period, org units (from the run's distinct `org` keys), doc type, case type and automated, all held in the URL.

The tabs are:

- **flow**: `Graph` chart of the DFG at the current level. Node size is cases, edge width is count, and the edge label is median wait. A toggle shows all edges (unpruned). Clicking a node drills down one level, to L4 at most. At L4, a node click opens a `Drawer` with the L5 stats and fields.
- **bpmn**: the generated diagram of the current node, rendered with the existing designer canvas (`insights/process/designer/_components/canvas.tsx`) in read-only mode. No BPMN library is added. Discovered nodes get the dashed outline style the canvas already uses for non-template nodes. Not-observed reference nodes are muted. Buttons: "Download .bpmn" (`export_process`) and "Export package".
- **variants**: DataTable with rank, a sequence shown as Mono chips with a scroll fade, cases, share, median, p90 and fitness. A row opens a Drawer with the sequence, sample cases (links to cases) and missing or out-of-order markers. The "Other" row is pinned last.
- **conformance**: `Stat` fitness. A `Pareto` of missing steps and a `Pareto` of out-of-order steps. A per-L5 DataTable (fitness, missing %, out-of-order %, rework %). Notices for limits, such as SFX rework not measurable and day precision.
- **cases**: needs `export_process`. A case list DataTable, and a case Drawer showing a vertical event timeline (ts, activity, resource, automated badge, doc type, object refs as Mono links to the shared-object filter).
- **reference**: the reference L1 to L5 tree with config overlay. This is the existing `level-table.tsx` view in read-only mode, so analysts can compare.

**Runs (`/process/runs`).**

- DataTable: system, L1s, mode, status Pill, stage, percent, started, duration, cases, coverage. The status comes from `/api/v1/jobs` live updates.
- "New run" button (`run_process_discovery`) opens a Dialog with the system, L1 multi-select (all by default), mode (incremental by default when a completed run exists) and period start (full mode only).
- A `Notice` appears when an extraction for the system is active: "Waiting for extraction <label> to finish."

**Export dialog.**

- Scope: whole L1 package, or this node `.bpmn`.
- Filters: current URL filters, or none.
- An edge threshold read-out (1%).
- Signavio import steps (§5.4) as a three-line ordered list.
- Download goes through the typed client. The user gets a toast, and an audit row is written.

### 7.4 States

- **Fresh install, no system.** EmptyState with the ghost ring stepper: "Connect a system" → "Run discovery" → "Read the as-is flow". It links to `/systems`.
- **System connected, never run.** The catalogue shows all 13 cards as "Reference, not discovered", with the primary action "Run discovery".
- **Run in progress.** The catalogue cards show a skeleton stat and the stage.
- **Failed run.** ErrorState with the error string from `process_discovery_runs.error`, never a stack trace, plus "Retry".
- **Coverage reference.** Every tab other than reference shows EmptyState "Reference, not discovered" with the reason from §10, and the reference tab is selected by default.

### 7.5 Accessibility and checks

- Every chart has a DataTable alternative behind "View as table".
- Graph nodes are keyboard-focusable in rank order.
- `lint:tokens`, `lint` and `typecheck` stay green, and axe reports no violations.

---

## 8. Jobs

### 8.1 Flow

`POST /systems/{system_id}/runs` goes through these steps:

1. **Lock.** Takes the Redis lock `pd:lock:<tenant>:<system>` with `SET NX EX 21600`. If the lock is already held, the endpoint returns 409.
2. **Insert runs.** Inserts one `process_discovery_runs` row per requested L1, with status `queued`.
3. **Start job.** Calls `start_job(tenant, job_id, "process_discovery", label)` (`jobs.py:109`). The `job_id` is `pd-<first run id>`. `"process_discovery"` is added to the job-kind list and to `TOUCHES` (`:57`), so the jobs UI shows it.
4. **Queue extraction.** Enqueues a Celery chain:
   - `workers.tasks.run_extraction.run_extraction(tenant_id, system_id, modules=<process_events_* for the L1s whose source exists on the system type>, include_config=False, sync_type="data", scope=<incremental scope or None>, analyse=False, label="Process discovery")`. The `version_id` comes from the existing signature; the extraction writes its parquet bundle as today.
   - then `workers.tasks.run_process_discovery.discover_process.si(tenant_id, system_id, run_ids, version_id)`.

   L1s with no source on the system type (§10) skip extraction. Their runs complete straight away with coverage `reference` and the generated reference model.

### 8.2 `workers/tasks/run_process_discovery.py`

```python
@celery_app.task(bind=True, name="workers.tasks.run_process_discovery.discover_process",
                 acks_late=True, soft_time_limit=7200, time_limit=7500, max_retries=24)
def discover_process(self, tenant_id: str, system_id: str, run_ids: list[str], version_id: str | None) -> dict[str, str]:
```

The time limits are set on the task because the global 1800-second default (`celery_app.py:27`) is too short for a 24-month PTP mine.

The task runs these steps:

1. **Mutual exclusion with extraction.** If `list_jobs(tenant_id, active_only=True)` holds a job of kind `extraction` or `sync` for this `system_id` other than this chain's own extraction, the task sets each run to `waiting` and calls `self.retry(countdown=300)`. The 24 retries cover 2 hours. After that, the runs fail with "Extraction on this system still running after 2 hours."

   The chain's own extraction has already finished when this task starts, because of chain ordering. The DQ extraction task is not changed. Discovery therefore never overlaps an extraction for the same system, whichever starts first. A DQ extraction that starts while discovery is mining is allowed, because discovery only reads its own bundle and Postgres.
2. **Build.** For each L1, the task sets status `building` and calls `update_job(stage="building", percent=…)`. Parquet bundle tables are read with `iter_parquet_chunks` (`workers/dataset.py:59`) using `keep=` column pruning. Each builder joins headers to items in chunks keyed by the case-id prefix. Events go in 50,000-row delete-and-insert batches (§2.1).
3. **Incremental.**
   - The extraction scope is `date_from = watermark - 14 days`.
   - Case ids touched by any new row are rebuilt in full. For each touched case, events older than the window are re-read from `process_events` and merged with the new rows before the case is re-inserted. A case's history therefore survives windowed extractions.
   - The new `watermark` is `max(ts)`.
4. **Mine.** Status `mining`, §3. Variants go to `process_variants`.
5. **Generate.** §4. The model is saved to `process_discovery_runs.model`, `l5_id` is written back, and status becomes `completed`, `coverage` is set and `finished_at` is set.
6. **Finish.** `finish_job` (`jobs.py:159`). The lock is released in `finally`.

`STAGES` (`jobs.py:38`) gains `building` and `mining`. `extraction` is already present.

### 8.3 Memory budget

The prod worker is already near 20 GB on the DQ benchmark, at concurrency 4 (`docker-compose.yml:113`). Discovery therefore stays inside a fixed budget:

- **2 GiB RSS per task.** The task checks `resource.getrusage(RUSAGE_SELF).ru_maxrss` after every chunk. Above 1.5 GiB, it halves the chunk size. Above 2 GiB, it fails the L1 with "Memory budget exceeded; narrow the period." Other L1s in the run continue.
- **Chunk size.** Starts at 200,000 rows, with column-pruned reads.
- **No full frame.** No full-table DataFrame is held across L1s. Builders yield events, and mining is SQL-side.
- **Header indexes.** The join indexes for headers are dicts of tuples, never DataFrame copies. The largest is the PTP EKPO index at about 24 bytes × 2 keys per row.
- **Queue.** Discovery tasks use the queue `process_discovery`. `docker-compose.yml` adds no new worker. The existing worker consumes that queue through `-Q celery,process_discovery`, so concurrency stays 4.

### 8.4 Progress

`update_job` percent is computed as follows:

- extraction is 0–50, taken from the extraction's own progress through `progress_key` (`run_extraction.py:30`)
- building is 50–80, by L1 index and chunk
- mining is 80–95
- generation is 95–100

SSE (`api/routes/events.py`) carries these updates without change.

---

## 9. Waves, acceptance and tests

These waves continue `spec.md` §10 from 19. Each wave is one reviewable PR-sized unit. No wave runs `npm run build` in CI beyond the existing pipeline.

| # | Wave | Files touched | Acceptance checks |
|---|---|---|---|
| 19 | **Event extraction plan** | `sap/extraction_plan.py` (`PROCESS_EVENT_MODULES`, `PROCESS_EVENTS_DATA`, `slices`, `extra_edges` in `via_filters`, window file switch), `sap/dictionaries/process_event_windows.yaml`, `sap/dictionaries/process_event_joins.yaml`, `sap/dictionaries/ecc6/tables/BSAS.json` (if missing), `sap/dictionaries/s4hana/tables/MATDOC.json`, `sap/ddic.py` (load `s4hana/tables`), `api/services/connectivity_manager.py` (slice loop, MATDOC row guard and WERKS/day split), `sap/extraction_registry.py` (`process_events_sfx`, `_arb`, `_cnq`), `tests/test_extraction_plan_process_events.py`, `tests/checks/test_joins_valid.py` | `plan_modules(["process_events_ptp"], ecc6)` returns exactly the §1.2 PTP tables and fields, with `via` set as listed. Every root table has month slices over 24m. DQ module plans are byte-identical before and after (snapshot of `plan_modules` for every DQ module). No `via` edge is added to `joins.yaml`. Every `process_event_joins.yaml` field exists in the DDIC. `dictionary_for_system("s4hana_onprem")` has `MATDOC`, and every one of the 19 MATDOC fields in §1.2 exists in `MATDOC.json`; the ECC dictionary has no `MATDOC`. `plan_modules(["process_events_pp"], s4hana)` reads MATDOC and T001W and no MKPF or MSEG; on ECC it reads MKPF and MSEG and no MATDOC. Every MATDOC slice `where` contains `RECORD_TYPE = 'MDOC'` and a one-month BUDAT range. A fake RFC returning 30,001 rows for a month triggers the per-plant re-read, then the per-day split, and no read asks for more than 30,001 rows. No MATDOC read is ever issued without a BUDAT range. Cloud modules list only existing entity sets. |
| 20 | **Event log schema** | `db/migrations/versions/077_process_event_log.py`, `db/schema.py` (3 models), `tests/test_process_event_log_migration.py` | Upgrade and downgrade on an empty DB. RLS is enabled and forced on all three tables. A session with another `app.tenant_id` reads 0 rows. Indexes exist. |
| 21 | **Builders PTP, OTC, R2R** | `api/services/process_discovery/__init__.py`, `events.py` (`EventRow`, timestamp precedence, hashing, USR02 automation), `builders/ptp.py`, `otc.py`, `r2r.py`, `tests/process_discovery/fixtures/*.parquet` (synthetic), `tests/process_discovery/test_builders_core.py` | Each mapping row of §2.3 for these L1s fires on a fixture row and produces its `activity`, `l5_id`, `ts`, `ts_precision` and `resource`. Day-precision `seq` follows Order. A rerun gives identical rows. The GR shared across two PO items appears in both cases with the same `object_refs`. |
| 22 | **Builders PP, PM, QM, PS, WH** | `builders/pp.py`, `pm.py`, `qm.py`, `ps.py`, `wh.py`, `tests/process_discovery/test_builders_logistics.py` | Same as wave 21 for these L1s. The PM and QM notification split by TQ80, and the fallback by PRUEFLOS, are both tested. On `s4hana_onprem` the MATDOC rows fire for BWART 101, 102, 261 and 262 and give the same activity, `l5_id`, `ts`, `resource` and `object_refs` as the MSEG fixture rows on `ecc`. A MATDOC fixture row with `RECORD_TYPE` other than `'MDOC'` produces no event. JCDS unknown status becomes `X_STATUS_<STAT>`. |
| 23 | **Builders HTR, MDG, SFX, ARB, CNQ** | `builders/htr.py`, `mdg.py`, `sfx.py`, `arb.py`, `cnq.py`, `tests/process_discovery/test_builders_people.py` | No raw PERNR or userId in any stored column (assert on all columns). Hash is stable per tenant and differs across tenants. SFX status keys normalise to `ID_PATTERN`. Concur approval and payment stay attributes. |
| 24 | **Mining** | `api/services/process_discovery/mining.py`, `filters.py` (`ProcessFilter`), `tests/process_discovery/test_mining.py` | On a fixture log of known cases: DFG counts, variant shares, medians, p90, rework and loops equal hand-computed values. Conformance missing, extra and out-of-order counts and fitness equal the §3.5 formula. Every filter narrows correctly. 2,000-variant cap with the "other" bucket. `EXPLAIN` shows `ix_pe_case` is used. |
| 25 | **Generation + model** | `api/models/process_model.py` (`Source`, `DiscoveryStats`, `DiscoveryEdge`, optional `discovery`/`source`), `api/services/process_discovery/generate.py`, `tests/process_discovery/test_generate.py`, existing `tests/test_process_model*.py` untouched | All four §4.2 rules are produced. All ids match `ID_PATTERN`. Not-observed template L5s are kept. Stored models from before this wave still validate. Upward aggregation and collapsed edges match fixtures. Every L5 has case_count, share and median. |
| 26 | **Signavio export of discovered models** | `api/services/bpmn_export.py` (`_landscape(edges=)`, `_task` discovery metadata, flow names, manifest block), `tests/test_process_discovery_export.py`, existing `tests/test_bpmn_export.py` untouched | Existing reference export output is byte-identical (snapshot). Discovered package passes XSD (when lxml present) and the structural checks of §5.5. Gateways appear only at fan-out or fan-in. Export is deterministic. `import_zip` round-trips the ids. |
| 27 | **Jobs + API** | `workers/tasks/run_process_discovery.py`, `workers/celery_app.py` (import), `workers/scheduler.py` (`prune_events`), `api/services/jobs.py` (`STAGES`, kind, `TOUCHES`), `api/routes/process_discovery.py`, `api/main.py`, `tests/test_process_discovery_jobs.py`, `tests/test_process_discovery_api.py` | The task retries while another extraction is active for the system, and runs when it is not. Redis lock returns 409 on a second POST. Memory guard halves the chunk size and then fails one L1 only. Incremental rebuild keeps history older than the window. Every endpoint returns the §5.3 shape. Export writes an audit row. 403 for viewer on run, export and cases. |
| 28 | **Role** | `api/services/rbac.py`, `tests/test_rbac_process_discovery.py`, `frontend/hooks/use-role.ts`, `frontend/lib/persona.ts`, `docs/superpowers/specs/premium-redesign/rbac.md` (§1.1 row, §2.1 rows, §2.2 row, wave-14 route list) | Legacy snapshot unchanged for every pre-existing (role, action). New grants exactly as §6.1. `(*, export)` excludes `process`. `homeHrefForRole("process_analyst") === "/home/process"`. Persona unit test updated. |
| 29 | **UI: catalogue, home, runs** | `app/(app)/home/process/page.tsx`, `app/(app)/process/page.tsx`, `process/runs/**`, `process/_components/coverage-pill.tsx`, `export-dialog.tsx`, `lib/api/process-discovery.ts`, `lib/nav.ts` (Process group) | e2e on an empty DB shows the fresh-install EmptyState. With a seeded run the catalogue shows 13 cards with correct coverage Pills. Run Dialog posts and the runs table updates via jobs. Buttons are absent without `run_process_discovery`. axe clean, `lint:tokens` green. |
| 30 | **UI: L1 drill** | `app/(app)/process/[l1]/page.tsx`, `process/_components/flow-view.tsx`, `bpmn-view.tsx`, `variants-table.tsx`, `conformance-view.tsx`, `case-explorer.tsx`, `l5-table.tsx`, `insights/process/designer/_components/discovered.tsx` (link only) | Every `?tab=` value renders from the URL. Level drill to L4 via node click. Filters round-trip through the URL. Cases tab is absent without `export_process`. L5 table shows cases, share and median for every row. Chart table alternatives are present. Skeleton, empty and error states per §7.4. axe clean. |

Each wave's PR runs the existing Python suite and frontend `lint`, `typecheck` and unit tests. Wave 26 also runs the export tests with lxml installed in the test environment where it is available. Fixtures are synthetic: no customer data, names or document numbers from real systems.

---

## 10. Coverage of all 13 L1s

**Coverage values** (`process_discovery_runs.coverage`):

- **discovered**: the primary case type produced at least 50 cases in the window, and every primary source table read without `partial`.
- **partial**: cases were produced, but a source table was partial, truncated, or skipped for the system type. The run stats name what is missing.
- **reference**: no events were produced, or the L1 has no source on the system type. The model is the reference document with the config overlay. Its `source` stays `template`/`config`, every L5 has `discovery.observed = False`, and the UI and exported README carry the label "reference, not discovered".

The 50-case floor exists because a DFG over fewer cases is not a process, it is anecdotes.

| L1 | Source system types | Primary case type | Discovered L4s | Reference-only L4s (no event source) | Degraded behaviour |
|---|---|---|---|---|---|
| PTP | ecc, s4hana_onprem | `po_item` | PR-ME51N, PO-ME21N, REL-ME29N, GR-MIGO, IV-MIRO, PAY-F110, VM-FK01 | none | CDHDR not readable (authorisation): change and release L5s not observed, coverage `partial` |
| OTC | ecc, s4hana_onprem | `so_item` | SO-VA01, DEL-VL01N, BIL-VF01, DUN-F150 (clearing), CM-FD01 | none | BSAD unreadable: clearing not observed, `partial` |
| R2R | ecc, s4hana_onprem | `fi_doc` | GL-FB50, AA-ABZON, AA-AFAB, GL-FS00, AA-AS01, CO-KS01, CO-KA01, CO-KO01 | BNK-FI12, BNK-FBZP, BNK-FTXP, CO-KE51 | BSAS missing from DDIC: clearing not observed, `partial` |
| PP | ecc (MKPF/MSEG), s4hana_onprem (MATDOC) | `prod_order` | ORD-CO01, BOM-CS01 | RTG-CR01, RTG-CA01, ORD-MD01 | MATDOC missing from the S/4 DDIC or not authorised: goods-movement L5s not observed, `partial`. A plant-day hit the MATDOC row guard: `partial`, named in `truncated_tables` |
| PM | ecc (MKPF/MSEG), s4hana_onprem (MATDOC) | `pm_order` | PLN-IW21, PLN-IW31, PLN-IP01 (-02 only), TO-IE01 | TO-IL01 | same MATDOC rule as PP |
| QM | ecc, s4hana_onprem | `insp_lot` | IN-QA01, IN-QM01 | MD-QS21, MD-QP01 | TQ80 unreadable: notification split by PRUEFLOS |
| PS | ecc, s4hana_onprem | `wbs` | PRJ-CJ01, PRJ-CJ02 | PRJ-CJ02S | none |
| WH | ecc (WM: LT06, LT03, LT01); ewm (SCWM_PRDI, SCWM_PRDO, SCWM_MON) | `transfer_order` / `warehouse_task` | per system type | the other system type's L4s | system without WM tables (LTAK empty): `reference` |
| HTR | ecc, s4hana_onprem | `emp_event` | PA-PA40, PA-PA30, OM-PP01 | none | PA tables not authorised: `reference` |
| MDG | ecc, s4hana_onprem (with MDG installed) | `change_request` | CR-MDGIMG | none | USMD120C absent from the system DDIC: `reference` |
| SFX | successfactors | `requisition` | RCM-MANAGE_JOB_REQUISITIONS, EC-ADD_NEW_EMPLOYEE, TIM-MY_TIMESHEET | none | entity set not permitted for the API user: that case type absent, `partial` |
| ARB | ariba | `requisition` | PRC-PROCUREMENT (requisition only), SUP-SUPPLIER_MANAGEMENT, CON-CONTRACTS | PRC-PROCUREMENT -01 and -02 (no order or invoice entity in the registry) | single-event cases: flow is START → activity → END; UI notes "one timestamp per object" |
| CNQ | concur | `expense_report` | EXP-EXPENSE | USR-USER_ADMINISTRATION | approval and payment shown as attributes only |

**System types with no source for an L1:**

- `s4hana_cloud` and `btp` have no process-event modules. All 13 L1s are `reference` on those systems, with the reason "Event tables are not exposed by this connector; showing the reference model and configuration."
- An ABAP system shows SFX, ARB and CNQ as `reference`, with the reason "Connect the SuccessFactors / Ariba / Concur system to discover this process."
- Cloud systems show the 10 ABAP L1s as `reference`, with the reason "Discovered from an ABAP system."

The catalogue for a tenant is per system. It is not merged across systems.

---

## 11. Non-goals

These are not built:

- writing anything back to SAP
- LLM-generated flows. Generation is deterministic; the `AiSummary` in InsightHeader receives aggregated stats only, never events.
- BPMN import of edited discovered models back into discovery (the designer already imports reference models)
- inferring parallel gateways
- cross-system case stitching (for example, an Ariba requisition into an ECC PO)
- a BPMN rendering library in the frontend

---

## 12. Rulings

1. Hierarchy names follow the code (`process_definitions.py:3-9`). The brief's labels map onto them one level shifted (§4.1).
2. Process-event extraction is a new set of plan modules in `extraction_plan.py`. It is not a registry change for ABAP. The modules are added only when explicitly requested.
3. Process-event windows and `via` edges live in their own YAML files. `joins.yaml` and `extraction_windows.yaml` are untouched, so DQ grain and windows do not change.
4. Large tables are read in monthly slices or via primary-key IN-lists only. BSEG, VBFA and full CDPOS are never read. MATDOC is read only in BUDAT monthly slices under the row guard of ruling 38.
5. VBFA is replaced by `LIPS.VGBEL/VGPOS` and `VBRP.AUBEL/AUPOS` for OTC links.
6. AFRU is replaced by JCDS confirmation statuses `I0009`/`I0010`.
7. Reversed by ruling 38. (Was: on `s4hana_onprem`, goods movements are not read, and those L5s show "not observed on S/4HANA".)
8. PRPS via `PSPHI` is the one non-key `via` edge, allowed because WBS volumes are small.
9. USR02 is read for `BNAME, USTYP, CLASS`. `USTYP B/S` means automated. An unreadable USR02 shows "not available".
10. The event log has three tables (`process_discovery_runs`, `process_events`, `process_variants`) in migration 077, with RLS and 730-day event retention.
11. Idempotency is delete-and-insert per case batch. There is no `ON CONFLICT`.
12. Timestamp precedence is change doc, then CPUDT/CPUTM, then create date and time, then date. Day-precision events are ordered by the template Order.
13. HTR and SFX person ids and resources are stored as tenant-salted sha256. Payload fields are never read.
14. Each L1 has one primary case type that drives the L1 to L3 flow. Other case types feed only their own L4s.
15. Shared documents (GR, delivery, invoice) are duplicated into each case they touch and linked by `object_refs`.
16. Mining is SQL for aggregates and Python for conformance. No pm4py, networkx or lxml is added.
17. Variants are capped at 2,000 plus an "other" bucket, which scores fitness 0.
18. Conformance uses an ordered expected list with alternative groups. Mapped non-expected activities are optional, not extra.
19. Discovered steps under a known L4 become `<L4>-X_<KEY>`. Activities with no L4 go under `<L1>-DSC`. Template L5s are never removed.
20. `Source` gains `"discovered"`. `DiscoveryStats` is optional on L1 to L5, so `schema_version` stays 1.
21. Event data never goes into `Evidence`, which stays config-only.
22. An edge is kept at 1% of cases or when it is the only outgoing edge. Pruned edges stay in the data and the UI.
23. Export reuses `export_zip`. `_landscape` gains optional `edges`, and the linear chain stays the default.
24. Gateways are exclusive only, added at fan-out and fan-in. Parallel gateways are never inferred.
25. Exports are deterministic (run timestamps, not `now()`). They are validated by XSD when lxml is present and by structural checks always.
26. The Signavio path is Process Manager, Import, BPMN 2.0, starting with the L1 file.
27. `process_analyst` = `_READ` + `run_process_discovery` + `export_process`. Admin gets both strings. Manager (programme lead) gets export only. No other role changes.
28. The `process` resource is added. The legacy `(*, export)` expansion excludes `process`, so no role gains process export implicitly.
29. Process routes become system-scoped through rbac wave 14's `scope_from_path`. Until then they are tenant-wide, like all routes.
30. Case and event endpoints need `export_process`, because events carry user ids.
31. The new UI lives under `/process` with its own nav group. `/insights/process` and the designer are unchanged, apart from one link.
32. The BPMN tab reuses the designer canvas in read-only mode. No BPMN library is added.
33. A discovery task never runs while another extraction for the same system is active. It retries every 300 s for up to 2 hours, plus a per-system Redis lock.
34. Discovery tasks have their own 7200 s soft and 7500 s hard limits, and a 2 GiB RSS budget with chunk halving. They run on the existing worker with no added concurrency.
35. Coverage is discovered when there are at least 50 cases and no partial source, partial when cases exist with missing sources, and otherwise reference ("reference, not discovered").
36. `s4hana_cloud` and `btp` are reference-only for all L1s. Each system's catalogue is separate.
37. Three corrections to the brief are recorded: RSEG and BSAK are already extracted, USR02 is already read but without USTYP, and `_document_flow` is at `:175`.
38. Ruling 7 is reversed at the user's request. On `s4hana_onprem`, goods movements are read from MATDOC with `RECORD_TYPE = 'MDOC'`, in BUDAT monthly slices, with a 30,000-row guard per read that splits by WERKS and then by day. MATDOC is never read unsliced. Its events use the same activity keys and L5 ids as MKPF/MSEG, so ECC and S/4 models compare one to one. Wave 19 adds `sap/dictionaries/s4hana/tables/MATDOC.json` and the loader for it.

# Process Discovery Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover the as-is L1 to L5 process for 13 L1s from SAP event tables. Mine it in Postgres, generate a `ProcessModelDocument` with discovery stats, export it to Signavio BPMN, and show it under `/process` for a new `process_analyst` role.

**Architecture:** There are four stages.
1. Extraction reuses `plan_modules` and `ConnectivityManager.extract`, with a process-event block. The block covers per-table windows, monthly slices, extra `via` edges and a MATDOC row guard.
2. A Celery task (`discover_process`) reads the parquet bundle in chunks. Per-L1 builders turn the rows into `EventRow`s, which go to `process_events` in delete-then-insert batches.
3. Mining runs in SQL: DFG, variants, throughput and rework. Conformance runs in Python, per variant.
4. `generate()` overlays the discovery stats on `reference_document()`. `bpmn_export` writes the as-is flows.

The FastAPI router `/api/v1/process-discovery` serves runs, models, the DFG, variants, cases and exports. The Next.js pages under `app/(app)/process` render them.

**Tech Stack:**
- Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async for routes, sync engine for workers), Alembic, Celery and Redis, pandas and pyarrow parquet, PyYAML.
- Postgres 15 with RLS.
- Next.js app router, TypeScript, React Query, `@/design` primitives, vitest.

**Spec (binding):** `docs/superpowers/specs/2026-10-11-process-discovery-design.md`, called "spec" below. All paths are relative to the worktree root `/Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/process-discovery`. Task numbers 19–30 match the spec's §9 waves.

## Global Constraints

- **Code.** Python 3.12, fully typed. Every request and response body is a Pydantic model. Do not use `Any` in Python or `any` in TypeScript. Never add a line to `frontend/scripts/lint-tokens.allow.txt`. Do not add raw hex colours or new tokens.
- **Tenancy.** Every SQL statement filters on `tenant_id`. Every new table has `ENABLE` and `FORCE ROW LEVEL SECURITY` and a `<table>_rls` policy on `current_setting('app.tenant_id')::uuid`. Routes call `_rls(db, tenant)` (`api/routes/record_issues.py:89`) before they query. Workers run `SET LOCAL app.tenant_id` inside each transaction.
- **Determinism.**
  - The same input bundle gives the same rows, variants, model and zip bytes.
  - Sorting always has a full tiebreak: `ts, seq, id`, or `case_count DESC, variant_hash`.
  - Manifest timestamps come from the run, never from `now()`.
- **LLM boundary.** No LLM is called anywhere in process discovery. Raw SAP rows, user ids and case ids never go to a model.
- **Celery.**
  - `discover_process` is idempotent. A rerun deletes and re-inserts per case batch, and re-mines per run.
  - The task sets `soft_time_limit=7200`, `time_limit=7500`, `acks_late=True` and `max_retries=24`.
  - `prune_events` sets `soft_time_limit=1800` and `time_limit=1860`.
- **Content.** No customer names appear in code, fixtures, tests or commits. Rule IDs are append-only. This plan adds no rule IDs.
- **Migrations.**
  - Run `alembic -c db/alembic.ini heads` (or the repo's usual invocation) right before Task 20. The head is `078` today.
  - The new file is `db/migrations/versions/079_process_event_log.py`, with `revision = "079"` and `down_revision = "078"`.
  - If heads show anything other than `078`, renumber to head+1 and set `down_revision` to match before you commit.
- **Tests.**
  - `pytest` and `vitest` must each collect more than 0 tests per task. Check with `pytest --collect-only -q <file> | tail -1`.
  - Postgres tests are skipped unless `MERIDIAN_TEST_DB_URL` is set. That URL points at a throwaway DB on a high port, for example `postgresql://meridian:meridian@localhost:55432/pd_test`. It is never port 5432. The app role is NOBYPASSRLS. Use the `_alembic` helper pattern from `tests/test_migration_waves_pg.py:20`.
- **SAP reads.**
  - Every read goes through RFC_READ_TABLE and `read_table_full`, paged at 50,000 rows. Never use SE16N or grid reads, which hang above about 30k rows.
  - Large tables are read in monthly slices, or `via` an IN-list of 60 keys from a parent that was read in slices.
  - MATDOC is read only on `s4hana_onprem`, only in sliced form, with at most 30,001 rows per read.
  - BSEG, VBFA and unfiltered CDPOS are never read.
- **Commits.** Commit on the current feature branch, one commit per task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
  ```

- **Names the spec uses that the code lacks or contradicts.** Each item is resolved by an explicit step in the task named.
  - The `process_variants` table and the `ProcessVariant` ORM class already exist (`db/schema.py:1064`) with another meaning. This plan uses the table `process_discovery_variants` and the ORM class `ProcessDiscoveryVariant` (Task 20).
  - `sap_systems.timezone` does not exist. Task 20 adds it.
  - `sap/dictionaries/s4hana/tables/` does not exist. Task 19 creates it with `MATDOC.json` and loads it in `sap/ddic.py`.
  - `tests/checks/test_joins_valid.py` is referenced by `joins.yaml` but missing. Task 19 creates it.
  - `jobs.STAGES` has no `"process_discovery"` kind. Task 27 adds it.

---

### Task 19: Extraction (wave 19): process-event plan, slices, MATDOC guard, cloud modules

Spec §1, §9 wave 19. The plan reads only through `read_table_full`. Process-event windows and edges live in their own YAML files, so DQ extraction windows and the check engine's grain graph do not change.

**Files:**
- Create `sap/dictionaries/process_event_windows.yaml`
- Create `sap/dictionaries/process_event_joins.yaml`
- Create `sap/dictionaries/s4hana/tables/MATDOC.json`
- Modify `sap/ddic.py` (`get_dictionary`, lines 297–308)
- Modify `sap/extraction_plan.py` (imports at line 22, `TablePlan` at 101–114, `plan_modules` at 219, `read_order` at 347, `via_filters` at 376; new process-event block after line 98)
- Modify `sap/extraction_registry.py` (new block after `SYSTEM_EXTRACTIONS`, line 1498)
- Modify `api/services/connectivity_manager.py` (`extract` at 200–384; new `_read_slices` and `_extract_process_cloud`)
- Create `tests/checks/test_joins_valid.py`
- Create `tests/test_extraction_plan_process_events.py`

**Interfaces:**
- Consumes:
  - `checks.frames.Edge(parent, child, on, cardinality, filter=(), prefer=())` and `checks.frames._graph() -> (edges, anchors)`
  - `sap.ddic.Dictionary.table / field / keys`, `get_dictionary(release)`, `_abap_table(path, release_dir)`
  - `sap.extraction_plan._months_ago(n, today) -> "YYYYMMDD"`, `in_lists(field, values, chunk=60)`, `_scope_filters(table, dictionary, scope)`
  - `sap.rfc._literal(value)`, `RFCConnector.read_table_full(table, fields, key_fields, where=None, max_rows=0, page_size=50_000, on_progress=None)`
  - `sap.extraction_registry.SYSTEM_EXTRACTIONS`, `ExtractionTarget`
  - `read_entity_set(entity_set, select=None, filter_expr=None, top=0[, from_date=None])`. Only `sap/successfactors.py:188` takes `from_date`. `sap/ariba.py:141` and `sap/concur.py:131` do not.
- Produces:
  - `PROCESS_EVENT_MODULES: tuple[str, ...]` (10 ABAP modules)
  - `PROCESS_EVENT_CLOUD_MODULES: tuple[str, ...]` (`process_events_sfx`, `process_events_arb`, `process_events_cnq`)
  - `PROCESS_EVENT_MODULES_BY_SYSTEM: dict[str, tuple[str, ...]]`
  - `PROCESS_EVENTS_DATA: dict[str, dict[str, set[str]]]`
  - `TablePlan` gains `slices: list[str]`, `also_via: list[str]`, `in_field: Optional[str]`, `group_field: Optional[str]`, `max_slice_rows: int`, `split_by: dict[str, str]`
  - `plan_modules(modules, dictionary, scope=None, *, system_type="ecc", today=None)`
  - `month_slices(field, start, today, end=None, suffix="", step=1) -> list[str]` and `day_slices(slice_where, today=None) -> list[str]`
  - `pe_edges() -> tuple[Edge, ...]`
  - `process_event_gaps(modules, dictionary, system_type) -> dict[str, list[str]]`
  - `via_filters(child, parent, parent_rows, chunk=60, *, extra_edges=(), in_field=None, group_field=None)`
  - `extraction_registry.process_event_targets(system_type, module, date_from=None, today=None) -> list[tuple[str, ExtractionTarget]]`
  - `ConnectivityManager._read_slices(connector, table, cols, keys, plan, plants, max_rows, on_progress) -> tuple[pd.DataFrame, list[dict]]`
  - `ConnectivityManager._extract_process_cloud(connector, modules, system_type, scope) -> tuple[dict[str, pd.DataFrame], list[dict]]`
  - Coverage entries for sliced tables carry `slices: int` and, for guarded tables, `truncated_slices: list[{slice, plant, day}]`.

Decisions that differ from the spec text, each traced to code:
- **Edges already in `joins.yaml`.** EKKO→EKPO (`joins.yaml:108`), EKPO→EKBE (`:150`), VBAK→VBAP (`:116`), PROJ→PRPS (`:199`), LTAK→LTAP (`:218`) and CDHDR→CDPOS (`:232`) already exist. The spec names only the last two. None of the six is repeated in `process_event_joins.yaml`.
- **CDPOS join field.** `via_filters` (`:383`) returns the first join field outside `BUKRS/GJAHR/LGNUM/MANDT`. For CDHDR→CDPOS that is `OBJECTCLAS`, not `CHANGENR`. An IN-list on `CHANGENR` alone is also not a key prefix of CDPOS (`OBJECTCLAS, OBJECTID, CHANGENR, …`).
  - The plan therefore reads CDPOS as `OBJECTCLAS = '<class>' AND OBJECTID IN (…)`, which is a key prefix.
  - The builders keep only CDPOS rows whose `CHANGENR` is in the CDHDR slice.
  - The mechanism is the new keyword pair `in_field` and `group_field`, set per child table in `process_event_windows.yaml`.
- **BSAK, BSAD and BSAS joins.** These tables are keyed `BUKRS, LIFNR|KUNNR|HKONT, …, BELNR, BUZEI`. The join is read as `BUKRS = '<cc>' AND BELNR IN (…)`. `BUKRS` is the only key prefix used, and the builder matches `GJAHR`.
- **Conflicting windows on a merged table.** BKPF is CPUDT 24m `AWTYP='RMRP'` in PTP and CPUDT 12m in R2R. AUFK carries a different `AUTYP` per L1. These differences are expressed as per-module overrides (`modules:` key) in `process_event_windows.yaml`.
  - Each month slice ORs the extra `where` of every module whose window covers that slice.
  - So `AUTYP = '10'` and `AUTYP = '30'` become `((AUTYP = '10') OR (AUTYP = '30'))`. This is equivalent to the spec's `IN ('10','30')`.
- **Change-document class `ORDER`.** The class is added to the PP and PM CDHDR filter, because §2.3 maps order changes and §1.2 omits the class.
- **MKPF and MSEG on S/4.** On `s4hana`, MKPF and MSEG are `category: VIEW` (`s4hana_delta.yaml:51-56`), and `plan_modules` already skips views (`:232`). Table-to-system routing (`_PE_SYSTEMS`) makes the choice explicit.
- **`plan_modules` system type.** `plan_modules` has no `system_type` today. It gains a keyword-only `system_type="ecc"`, so existing callers are unchanged.
- **Read order.** `read_order` is an alphabetical DFS over `.via`. It now also visits `also_via` and the `split_by` source table, so T001W is read before MATDOC and PRPS before JCDS.
- **Cloud extraction.** The cloud branches of `extract` (`_extract_successfactors`, `_extract_rest`) are driven by rule YAML and ignore the registry, and `_extract_rest` reads canonical-table fields only. Process-event cloud modules therefore get their own reader, `_extract_process_cloud`.
- **SuccessFactors date filters.** `from_date` only affects effective-dated entities, which means EmpJob. JobRequisition, JobApplication and EmployeeTime get an OData `filter_expr` on their date property instead.
- **Ariba and Concur.** Their connectors take no date argument, so they are read whole and the builders apply the window.

- [ ] **Step 1: Write the failing tests**

`tests/checks/test_joins_valid.py`:

```python
"""Every field an edge names exists in the shipped dictionaries (joins.yaml header promise)."""

from pathlib import Path

import pytest
import yaml

from sap.ddic import get_dictionary

_DICT = Path(__file__).resolve().parents[2] / "sap" / "dictionaries"
_ECC, _S4 = get_dictionary("ecc6"), get_dictionary("s4hana")


def _edges(name: str) -> list[dict]:
    return yaml.safe_load((_DICT / name).read_text())["edges"]


def _missing(edges: list[dict]) -> list[str]:
    out = []
    for e in edges:
        child = list(e["join"]) + list(e.get("filter") or {}) + list(e.get("prefer") or {})
        for table, fields in ((e["child"], child), (e["parent"], list(e["join"].values()))):
            out += [f"{e['parent']}->{e['child']}: {table}.{f}" for f in fields
                    if _ECC.field(table, f) is None and _S4.field(table, f) is None]
    return out


@pytest.mark.parametrize("name", ["joins.yaml", "process_event_joins.yaml"])
def test_every_edge_field_exists(name: str) -> None:
    assert _missing(_edges(name)) == []


def test_process_event_edges_do_not_repeat_joins_yaml() -> None:
    grain = {(e["parent"], e["child"]) for e in _edges("joins.yaml")}
    assert [(e["parent"], e["child"]) for e in _edges("process_event_joins.yaml")
            if (e["parent"], e["child"]) in grain] == []
```

`tests/test_extraction_plan_process_events.py`:

```python
"""Process-event extraction plan (spec §1): windows, slices, via edges, MATDOC guard, cloud targets."""

from datetime import date

import pandas as pd
import pytest

from sap import extraction_plan as ep
from sap.ddic import get_dictionary
from sap.extraction_registry import process_event_targets

TODAY = date(2026, 10, 11)
ECC, S4 = get_dictionary("ecc6"), get_dictionary("s4hana")


def _plan(modules: list[str], system_type: str = "ecc", scope: dict | None = None) -> dict[str, ep.TablePlan]:
    return ep.plan_modules(modules, S4 if system_type == "s4hana_onprem" else ECC, scope,
                           system_type=system_type, today=TODAY)


def test_month_slices_cover_window_and_last_is_open() -> None:
    s = ep.month_slices("AEDAT", date(2026, 8, 15), TODAY)
    assert s == ["AEDAT >= '20260815' AND AEDAT < '20260901'",
                 "AEDAT >= '20260901' AND AEDAT < '20261001'",
                 "AEDAT >= '20261001'"]


def test_month_slices_bounded_end_and_timestamp_suffix() -> None:
    s = ep.month_slices("CONFIRMED_AT", date(2026, 9, 20), TODAY, end=date(2026, 10, 2), suffix="000000")
    assert s == ["CONFIRMED_AT >= '20260920000000' AND CONFIRMED_AT < '20261001000000'",
                 "CONFIRMED_AT >= '20261001000000' AND CONFIRMED_AT < '20261003000000'"]


def test_day_slices_keep_the_rest_of_the_where() -> None:
    out = ep.day_slices("BUDAT >= '20260930' AND BUDAT < '20261002' AND WERKS = '1000'")
    assert out == ["BUDAT >= '20260930' AND BUDAT < '20261001' AND WERKS = '1000'",
                   "BUDAT >= '20261001' AND BUDAT < '20261002' AND WERKS = '1000'"]


def test_ptp_plan_tables_windows_and_edges() -> None:
    p = _plan(["process_events_ptp"])
    assert set(p) == {"EKKO", "EKPO", "EBAN", "EKBE", "RBKP", "BKPF", "BSAK", "CDHDR", "CDPOS", "USR02"}
    assert p["EKKO"].slices[0] == "AEDAT >= '20241011' AND AEDAT < '20241101'"
    assert len(p["EKKO"].slices) == 25 and p["EKKO"].partial
    assert p["EKPO"].via == "EKKO" and not p["EKPO"].slices
    assert p["EKBE"].via == "EKPO"
    assert (p["BSAK"].via, p["BSAK"].in_field, p["BSAK"].group_field) == ("BKPF", "BELNR", "BUKRS")
    assert all("AWTYP = 'RMRP'" in s for s in p["BKPF"].slices)
    assert all("OBJECTCLAS IN ('EINKBELEG','BANF','KRED')" in s for s in p["CDHDR"].slices)
    assert (p["CDPOS"].via, p["CDPOS"].in_field, p["CDPOS"].group_field) == ("CDHDR", "OBJECTID", "OBJECTCLAS")
    assert "FNAME IN ('FRGZU','FRGKE','MENGE','NETPR','EINDT','LOEKZ','KEY')" in p["CDPOS"].where
    assert p["USR02"].purpose == "config" and p["USR02"].fields == {"BNAME", "USTYP", "CLASS"}
    assert "VBFA" not in p and "BSEG" not in p


def test_bkpf_merges_ptp_24m_with_r2r_12m() -> None:
    s = _plan(["process_events_ptp", "process_events_r2r"])["BKPF"].slices
    assert len(s) == 25
    assert "AWTYP = 'RMRP'" in s[0]          # 2024-10: only PTP's 24 months cover it
    assert "AWTYP" not in s[-1]              # 2026-10: R2R covers it, every BKPF row is needed


def test_pp_pm_merge_autyp_and_bwart() -> None:
    p = _plan(["process_events_pp", "process_events_pm"])
    assert "((AUTYP = '10') OR (AUTYP = '30'))" in p["AUFK"].slices[0]
    assert "BWART IN ('101','102','261','262')" in p["MSEG"].where
    assert "MATDOC" not in p and p["MSEG"].via == "MKPF"


def test_matdoc_only_on_s4_onprem_with_guard() -> None:
    p = _plan(["process_events_pp"], "s4hana_onprem")
    assert "MKPF" not in p and "MSEG" not in p
    m = p["MATDOC"]
    assert m.keys == [] and m.max_slice_rows == 30000 and m.split_by == {"WERKS": "T001W"}
    assert all("RECORD_TYPE = 'MDOC'" in s and s.startswith("BUDAT >= ") for s in m.slices)
    assert len(m.fields) == 19
    assert p["T001W"].purpose == "config"
    order = ep.read_order(p)
    assert order.index("T001W") < order.index("MATDOC")


def test_jcds_reads_via_both_order_and_wbs_parents() -> None:
    p = _plan(["process_events_pp", "process_events_ps"])
    assert (p["JCDS"].via, p["JCDS"].also_via) == ("AUFK", ["PRPS"])
    order = ep.read_order(p)
    assert order.index("AUFK") < order.index("JCDS") and order.index("PRPS") < order.index("JCDS")
    assert _plan(["process_events_ps"])["JCDS"].via == "PRPS"


def test_qmel_iwerk_is_dropped_and_reported() -> None:
    p = _plan(["process_events_pm"])
    assert "IWERK" not in p["QMEL"].fields and p["QMEL"].partial
    assert ep.process_event_gaps(["process_events_pm"], ECC, "ecc") == {"QMEL": ["IWERK"]}


def test_wh_routes_by_system_type() -> None:
    assert {"LTAK", "LTAP"} <= set(_plan(["process_events_wh"]))
    ewm = _plan(["process_events_wh"], "ewm")
    assert "/SCWM/ORDIM_C" in ewm and "LTAK" not in ewm
    assert ewm["/SCWM/ORDIM_C"].slices[0] == "CONFIRMED_AT >= '20251011000000' AND CONFIRMED_AT < '20251101000000'"


def test_incremental_scope_moves_the_window_start() -> None:
    s = _plan(["process_events_otc"], scope={"date_from": "2026-09-27"})["VBAK"].slices
    assert s == ["ERDAT >= '20260927' AND ERDAT < '20261001'", "ERDAT >= '20261001'"]


def test_mixed_dq_and_process_modules_keep_dq_windows() -> None:
    dq = ep.plan_modules(["mm_purchasing"], ECC)
    mixed = ep.plan_modules(["mm_purchasing", "process_events_ptp"], ECC, today=TODAY)
    assert mixed["EKKO"].where == dq["EKKO"].where and not mixed["EKKO"].slices
    assert {"AEDAT", "ERNAM", "EKGRP"} <= mixed["EKKO"].fields
    assert "process_events_ptp" in mixed["EKKO"].modules


def test_via_filters_group_and_in_field() -> None:
    rows = pd.DataFrame({"OBJECTCLAS": ["KRED", "BANF", "KRED"], "OBJECTID": ["0001", "0002", "0003"],
                         "CHANGENR": ["9", "8", "7"]})
    out = ep.via_filters("CDPOS", "CDHDR", rows, in_field="OBJECTID", group_field="OBJECTCLAS")
    assert out == ["OBJECTCLAS = 'BANF' AND OBJECTID IN ('0002')",
                   "OBJECTCLAS = 'KRED' AND OBJECTID IN ('0001','0003')"]
    bk = pd.DataFrame({"BUKRS": ["1000"], "BELNR": ["5100000001"], "GJAHR": ["2026"]})
    assert ep.via_filters("BSAK", "BKPF", bk, extra_edges=ep.pe_edges(), in_field="BELNR",
                          group_field="BUKRS") == ["BUKRS = '1000' AND BELNR IN ('5100000001')"]


def test_matdoc_in_s4_dictionary_only() -> None:
    assert S4.table("MATDOC") is not None and ECC.table("MATDOC") is None
    assert {"RECORD_TYPE", "BUDAT", "WERKS", "VBELN_IM"} <= set(S4.table("MATDOC").fields)


@pytest.mark.parametrize("system_type,module,names", [
    ("successfactors", "process_events_sfx", ["JobRequisition", "JobApplication", "EmpJob", "EmployeeTime"]),
    ("ariba", "process_events_arb", ["suppliers", "contracts", "requisitions"]),
    ("concur", "process_events_cnq", ["reports", "entries"]),
])
def test_cloud_targets(system_type: str, module: str, names: list[str]) -> None:
    got = process_event_targets(system_type, module, today=TODAY)
    assert [n for n, _ in got] == names
    by = dict(got)
    if system_type == "successfactors":
        assert by["EmpJob"].from_date == "2024-10-11"
        assert by["EmployeeTime"].filter == "startDate ge datetime'2025-10-11T00:00:00'"
        assert by["JobRequisition"].fields == ["requisitionId", "status", "createdDate", "hiringManager"]
    if system_type == "concur":
        assert by["reports"].source == "/api/v3.0/expense/reports"


def test_read_slices_matdoc_guard_splits_plant_then_day() -> None:
    from api.services.connectivity_manager import ConnectivityManager

    calls: list[str] = []

    class Fake:
        def read_table_full(self, table, cols, keys, where=None, max_rows=0, on_progress=None):
            calls.append(where)
            n = 30001 if ("WERKS" not in where or ("WERKS = '1000'" in where and "< '20261001'" not in where
                                                   and "BUDAT < '20261002'" not in where)) else 3
            if "WERKS = '1000'" in where and "BUDAT >= '20260930'" in where and "< '20261001'" in where:
                n = 30001
            return pd.DataFrame({"MBLNR": [str(i) for i in range(min(n, max_rows))]})

    plan = ep.TablePlan(table="MATDOC", slices=["BUDAT >= '20260929' AND BUDAT < '20261001' AND RECORD_TYPE = 'MDOC'"],
                        max_slice_rows=30000, split_by={"WERKS": "T001W"})
    plants = pd.DataFrame({"WERKS": ["1000", "2000"]})
    df, truncated = ConnectivityManager._read_slices(Fake(), "MATDOC", ["MBLNR"], [], plan, plants, 5_000_000,
                                                     lambda g, n, r: None)
    assert all(len(pd.DataFrame({"x": range(1)})) for _ in calls)
    assert max(len(w) for w in calls) > 0
    assert truncated and truncated[0]["plant"] == "1000" and truncated[0]["day"] == "20260930"
    assert len(df) == 30000 + 3 + 3                       # truncated day + other day + plant 2000
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pytest tests/checks/test_joins_valid.py tests/test_extraction_plan_process_events.py -q`
Expected: FAIL. Collection errors with `ImportError: cannot import name 'process_event_targets'`, and `FileNotFoundError` for `process_event_joins.yaml`.

- [ ] **Step 3: Create `sap/dictionaries/process_event_joins.yaml`**

```yaml
# Process-discovery read edges (spec §1.3). Same edge shape as joins.yaml, but read only by
# sap/extraction_plan.via_filters(extra_edges=pe_edges()). Never merged into joins.yaml: that file
# is the check engine's grain graph (checks/frames.py) and an edge there changes rule evaluation.
# Edges that already exist in joins.yaml are not repeated here: EKKO→EKPO, EKPO→EKBE, VBAK→VBAP,
# PROJ→PRPS, LTAK→LTAP, CDHDR→CDPOS. tests/checks/test_joins_valid.py checks every field.
edges:
  - {parent: BKPF, child: BSAK, join: {BUKRS: BUKRS, BELNR: BELNR, GJAHR: GJAHR}, cardinality: many}
  - {parent: BKPF, child: BSAS, join: {BUKRS: BUKRS, BELNR: BELNR, GJAHR: GJAHR}, cardinality: many}
  - {parent: VBRK, child: BSAD, join: {BUKRS: BUKRS, BELNR: BELNR, GJAHR: GJAHR}, cardinality: many}
  - {parent: LIKP, child: LIPS, join: {VBELN: VBELN}, cardinality: many}
  - {parent: VBRK, child: VBRP, join: {VBELN: VBELN}, cardinality: many}
  - {parent: AUFK, child: AFKO, join: {AUFNR: AUFNR}, cardinality: one}
  - {parent: AUFK, child: AFIH, join: {AUFNR: AUFNR}, cardinality: one}
  - {parent: AUFK, child: JCDS, join: {OBJNR: OBJNR}, cardinality: many}
  - {parent: PRPS, child: JCDS, join: {OBJNR: OBJNR}, cardinality: many}
  - {parent: MKPF, child: MSEG, join: {MBLNR: MBLNR, MJAHR: MJAHR}, cardinality: many}
  - {parent: QALS, child: QAVE, join: {PRUEFLOS: PRUEFLOS}, cardinality: many}
  - {parent: QMEL, child: QMFE, join: {QMNUM: QMNUM}, cardinality: many}
  - {parent: QMEL, child: QMSM, join: {QMNUM: QMNUM}, cardinality: many}
```

- [ ] **Step 4: Create `sap/dictionaries/process_event_windows.yaml`**

```yaml
# Process-discovery windows (spec §1.2, §1.3). Read only for tables whose every planning module is a
# process-event module; DQ tables keep extraction_windows.yaml.
#
# Root table:  {field, months, slice_months, where?, suffix?, max_slice_rows?, split_by?, modules?}
#   one `FIELD >= lo AND FIELD < hi` slice per `slice_months` calendar months from the window start;
#   `suffix` is appended to DEC15 timestamps (YYYYMMDDhhmmss); `modules: {m: {months?, where?}}`
#   overrides per process-event module, and a slice ORs the `where` of every module covering it.
# Via table:   {via, also_via?, in_field?, group_field?, where?, modules?}
#   read by IN-lists of the parent's keys (sap/extraction_plan.via_filters); `group_field` adds
#   `FIELD = '<value>' AND` so the IN-list hits a key prefix.
EKKO: {field: AEDAT, months: 24, slice_months: 1}
EKPO: {via: EKKO}
EBAN: {field: ERDAT, months: 24, slice_months: 1}
EKBE: {via: EKPO}
RBKP: {field: CPUDT, months: 24, slice_months: 1}
BKPF:
  field: CPUDT
  months: 12
  slice_months: 1
  modules:
    process_events_ptp: {months: 24, where: "AWTYP = 'RMRP'"}
BSAK: {via: BKPF, in_field: BELNR, group_field: BUKRS}
BSAS: {via: BKPF, in_field: BELNR, group_field: BUKRS}
CDHDR:
  field: UDATE
  months: 24
  slice_months: 1
  modules:
    process_events_ptp: {where: "OBJECTCLAS IN ('EINKBELEG','BANF','KRED')"}
    process_events_otc: {where: "OBJECTCLAS IN ('VERKBELEG','DEBI')"}
    process_events_r2r: {where: "OBJECTCLAS IN ('SACH','ANLA','KOSTL','KSTAR')"}
    process_events_pp: {where: "OBJECTCLAS IN ('STUE','ORDER')"}
    process_events_pm: {where: "OBJECTCLAS IN ('QMEL','EQUI','ORDER')"}
CDPOS:
  via: CDHDR
  in_field: OBJECTID
  group_field: OBJECTCLAS
  modules:
    process_events_ptp: {where: "(OBJECTCLAS = 'KRED' OR FNAME IN ('FRGZU','FRGKE','MENGE','NETPR','EINDT','LOEKZ','KEY'))"}  # vendor keeps every FNAME
    process_events_otc: {where: "(OBJECTCLAS = 'DEBI' OR FNAME IN ('LIFSK','FAKSK','NETWR','KWMENG','EDATU','ABGRU','KEY'))"}  # customer keeps every FNAME
    process_events_r2r: {}                       # master-data changes keep every FNAME
    process_events_pp: {}
    process_events_pm: {where: "(OBJECTCLAS = 'EQUI' OR FNAME IN ('PRIOK','KEY'))"}  # equipment keeps every FNAME
VBAK: {field: ERDAT, months: 24, slice_months: 1}
VBAP: {via: VBAK}
LIKP: {field: ERDAT, months: 24, slice_months: 1}
LIPS: {via: LIKP}
VBRK: {field: ERDAT, months: 24, slice_months: 1}
VBRP: {via: VBRK}
BSAD: {via: VBRK, in_field: BELNR, group_field: BUKRS}
AUFK:
  field: ERDAT
  months: 24
  slice_months: 1
  modules:
    process_events_r2r: {where: "AUTYP = '01'"}
    process_events_pp: {where: "AUTYP = '10'"}
    process_events_pm: {where: "AUTYP = '30'"}
AFKO: {via: AUFK}
AFIH: {via: AUFK}
JCDS: {via: AUFK, also_via: [PRPS]}
MKPF: {field: CPUDT, months: 24, slice_months: 1}
MSEG:
  via: MKPF
  modules:
    process_events_pp: {where: "BWART IN ('101','102','261','262')"}
    process_events_pm: {where: "BWART IN ('261','262')"}
MATDOC:
  field: BUDAT
  months: 24
  slice_months: 1
  max_slice_rows: 30000
  split_by: {WERKS: T001W}
  modules:
    process_events_pp: {where: "RECORD_TYPE = 'MDOC' AND BWART IN ('101','102','261','262')"}
    process_events_pm: {where: "RECORD_TYPE = 'MDOC' AND BWART IN ('261','262')"}
QMEL: {field: QMDAT, months: 24, slice_months: 1}
QMFE: {via: QMEL}
QMSM: {via: QMEL}
QALS: {field: ENSTEHDAT, months: 24, slice_months: 1}
QAVE: {via: QALS}
PROJ: {field: ERDAT, months: 36, slice_months: 1}
PRPS: {via: PROJ}
LTAK: {field: BDATU, months: 12, slice_months: 1}
LTAP: {via: LTAK}
/SCWM/ORDIM_C: {field: CONFIRMED_AT, months: 12, slice_months: 1, suffix: "000000"}
PA0000: {field: AEDTM, months: 24, slice_months: 1}
PA0001: {field: AEDTM, months: 24, slice_months: 1}
PA0002: {field: AEDTM, months: 24, slice_months: 1}
PA0008: {field: AEDTM, months: 24, slice_months: 1}
HRP1000: {field: AEDTM, months: 24, slice_months: 1}
HRP1001: {field: AEDTM, months: 24, slice_months: 1}
USMD120C: {field: USMD_CREATED_AT, months: 24, slice_months: 1, suffix: "000000"}
```

The MATDOC `where` repeats `RECORD_TYPE = 'MDOC'` in each module clause. ORing two clauses that both contain it keeps it in every slice, as §1.2 requires.

- [ ] **Step 5: Create `sap/dictionaries/s4hana/tables/MATDOC.json`**

First pull the active DD03L rows from a connected `s4hana_onprem` system. This step is read-only, goes through RFC_READ_TABLE and returns about 400 rows:

```bash
python - <<'EOF'
import json, os
from api.db import SyncSessionLocal
from api.services.connectivity_manager import ConnectivityManager
s = SyncSessionLocal()
cm = ConnectivityManager(s, os.environ["TENANT_ID"])
row = cm._load_system(os.environ["SYSTEM_ID"])
conn = cm._get_connector(row.system_type, cm._build_connection_params(row))
df = conn.read_table_full("DD03L", ["FIELDNAME", "POSITION", "KEYFLAG", "ROLLNAME", "DOMNAME", "DATATYPE",
                                    "LENG", "DECIMALS", "CHECKTABLE"],
                          ["TABNAME", "FIELDNAME", "AS4LOCAL", "AS4VERS", "POSITION"],
                          where="TABNAME = 'MATDOC' AND AS4LOCAL = 'A'")
conn.close()
print(df.sort_values("POSITION").to_json(orient="records"))
EOF
```

If `api.db` names its sync session factory differently, use the factory that `workers/tasks/run_process_discovery.py` imports in Task 27.

Write the file in the `ecc6/tables/MSEG.json` format. Take `type`, `length`, `decimals`, `data_element`, `domain` and `key` from the DD03L output. `.INCLUDE` rows are dropped, and `foreign_keys` is left empty. The block below shows the required fields as delivered in SAP S/4HANA. If the DD03L output differs on any value, the DD03L value wins.

```json
{
  "table": "MATDOC",
  "description": "Material Documents",
  "category": "TRANSP",
  "delivery_class": "A",
  "source": "SAP S/4HANA standard DDIC (DD03L, TABNAME = 'MATDOC', AS4LOCAL = 'A')",
  "foreign_keys": [],
  "fields": [
    {"pos": 1, "name": "MANDT", "key": true, "data_element": "MANDT", "domain": "MANDT", "type": "CLNT", "length": 3, "decimals": 0, "description": "Client", "check_table": "*"},
    {"pos": 2, "name": "KEY1", "key": true, "data_element": "NSDM_DE_KEY1", "domain": "NSDM_DO_KEY1", "type": "CHAR", "length": 22, "decimals": 0, "description": "Key field 1", "check_table": null},
    {"pos": 3, "name": "KEY2", "key": true, "data_element": "NSDM_DE_KEY2", "domain": "NSDM_DO_KEY2", "type": "CHAR", "length": 22, "decimals": 0, "description": "Key field 2", "check_table": null},
    {"pos": 4, "name": "KEY3", "key": true, "data_element": "NSDM_DE_KEY3", "domain": "NSDM_DO_KEY3", "type": "CHAR", "length": 22, "decimals": 0, "description": "Key field 3", "check_table": null},
    {"pos": 5, "name": "KEY4", "key": true, "data_element": "NSDM_DE_KEY4", "domain": "NSDM_DO_KEY4", "type": "CHAR", "length": 22, "decimals": 0, "description": "Key field 4", "check_table": null},
    {"pos": 6, "name": "KEY5", "key": true, "data_element": "NSDM_DE_KEY5", "domain": "NSDM_DO_KEY5", "type": "CHAR", "length": 22, "decimals": 0, "description": "Key field 5", "check_table": null},
    {"pos": 7, "name": "KEY6", "key": true, "data_element": "NSDM_DE_KEY6", "domain": "NSDM_DO_KEY6", "type": "CHAR", "length": 22, "decimals": 0, "description": "Key field 6", "check_table": null},
    {"pos": 8, "name": "RECORD_TYPE", "key": false, "data_element": "NSDM_RECORD_TYPE", "domain": "NSDM_RECORD_TYPE", "type": "CHAR", "length": 4, "decimals": 0, "description": "Record type", "check_table": null},
    {"pos": 9, "name": "MBLNR", "key": false, "data_element": "MBLNR", "domain": "BELNR", "type": "CHAR", "length": 10, "decimals": 0, "description": "Number of Material Document", "check_table": null},
    {"pos": 10, "name": "MJAHR", "key": false, "data_element": "MJAHR", "domain": "GJAHR", "type": "NUMC", "length": 4, "decimals": 0, "description": "Material Document Year", "check_table": null},
    {"pos": 11, "name": "ZEILE", "key": false, "data_element": "MBLPO", "domain": "MBLPO", "type": "NUMC", "length": 4, "decimals": 0, "description": "Item in Material Document", "check_table": null},
    {"pos": 12, "name": "BWART", "key": false, "data_element": "BWART", "domain": "BWART", "type": "CHAR", "length": 3, "decimals": 0, "description": "Movement Type (Inventory Management)", "check_table": "T156"},
    {"pos": 13, "name": "MATNR", "key": false, "data_element": "MATNR", "domain": "MATNR", "type": "CHAR", "length": 40, "decimals": 0, "description": "Material Number", "check_table": "MARA"},
    {"pos": 14, "name": "WERKS", "key": false, "data_element": "WERKS_D", "domain": "WERKS", "type": "CHAR", "length": 4, "decimals": 0, "description": "Plant", "check_table": "T001W"},
    {"pos": 15, "name": "LGORT", "key": false, "data_element": "LGORT_D", "domain": "LGORT", "type": "CHAR", "length": 4, "decimals": 0, "description": "Storage Location", "check_table": "T001L"},
    {"pos": 16, "name": "BUDAT", "key": false, "data_element": "BUDAT", "domain": "DATUM", "type": "DATS", "length": 8, "decimals": 0, "description": "Posting Date in the Document", "check_table": null},
    {"pos": 17, "name": "CPUDT", "key": false, "data_element": "CPUDT", "domain": "DATUM", "type": "DATS", "length": 8, "decimals": 0, "description": "Day On Which Accounting Document Was Entered", "check_table": null},
    {"pos": 18, "name": "CPUTM", "key": false, "data_element": "CPUTM", "domain": "UZEIT", "type": "TIMS", "length": 6, "decimals": 0, "description": "Time of Entry", "check_table": null},
    {"pos": 19, "name": "USNAM", "key": false, "data_element": "USNAM", "domain": "XUBNAME", "type": "CHAR", "length": 12, "decimals": 0, "description": "User Name", "check_table": null},
    {"pos": 20, "name": "EBELN", "key": false, "data_element": "BSTNR", "domain": "EBELN", "type": "CHAR", "length": 10, "decimals": 0, "description": "Purchase Order Number", "check_table": "EKKO"},
    {"pos": 21, "name": "EBELP", "key": false, "data_element": "EBELP", "domain": "EBELP", "type": "NUMC", "length": 5, "decimals": 0, "description": "Item Number of Purchasing Document", "check_table": null},
    {"pos": 22, "name": "AUFNR", "key": false, "data_element": "AUFNR", "domain": "AUFNR", "type": "CHAR", "length": 12, "decimals": 0, "description": "Order Number", "check_table": "AUFK"},
    {"pos": 23, "name": "KDAUF", "key": false, "data_element": "KDAUF", "domain": "VBELN", "type": "CHAR", "length": 10, "decimals": 0, "description": "Sales Order Number", "check_table": null},
    {"pos": 24, "name": "KDPOS", "key": false, "data_element": "KDPOS", "domain": "NUM06", "type": "NUMC", "length": 6, "decimals": 0, "description": "Item Number in Sales Order", "check_table": null},
    {"pos": 25, "name": "VBELN_IM", "key": false, "data_element": "VBELN_VL", "domain": "VBELN", "type": "CHAR", "length": 10, "decimals": 0, "description": "Delivery", "check_table": null},
    {"pos": 26, "name": "VBELP_IM", "key": false, "data_element": "POSNR_VL", "domain": "POSNR", "type": "NUMC", "length": 6, "decimals": 0, "description": "Delivery Item", "check_table": null}
  ]
}
```

- [ ] **Step 6: Load `s4hana/tables` in `sap/ddic.py`**

In `get_dictionary` (line 304), replace

```python
    if release == "s4hana":
        tables = _apply_s4_delta(tables)
```

with

```python
    if release == "s4hana":
        tables = _apply_s4_delta(tables)
        # S/4-only tables (MATDOC); never an ECC table copied here. Domains resolve from ecc6/domains.
        for p in sorted((_ROOT / "s4hana" / "tables").glob("*.json")):
            t = _abap_table(p, "ecc6")
            tables[t.name] = t
```

- [ ] **Step 7: Add the process-event block to `sap/extraction_plan.py`**

Change the import on line 22 to:

```python
from checks.frames import _MOVED, Edge, TableFrames, _graph, tables_of
```

Below `_PE_*` the existing `_WINDOWS` constant (line 25) add:

```python
_PE_WINDOWS = Path(__file__).resolve().parent / "dictionaries" / "process_event_windows.yaml"
_PE_JOINS = Path(__file__).resolve().parent / "dictionaries" / "process_event_joins.yaml"
```

After `_PROVEN_COST_TRIGGER` (line 98) add:

```python
# Process discovery (spec docs/superpowers/specs/2026-10-11-process-discovery-design.md §1.2):
# the event tables per L1. Planned only when the module itself is requested; windows and read edges
# come from process_event_windows.yaml / process_event_joins.yaml, never from the DQ files.
PROCESS_EVENT_MODULES: tuple[str, ...] = (
    "process_events_ptp", "process_events_otc", "process_events_r2r", "process_events_pp",
    "process_events_pm", "process_events_qm", "process_events_ps", "process_events_wh",
    "process_events_htr", "process_events_mdg",
)
PROCESS_EVENT_CLOUD_MODULES: tuple[str, ...] = ("process_events_sfx", "process_events_arb", "process_events_cnq")
PROCESS_EVENT_MODULES_BY_SYSTEM: dict[str, tuple[str, ...]] = {
    "ecc": PROCESS_EVENT_MODULES,
    "s4hana_onprem": PROCESS_EVENT_MODULES,
    "ewm": ("process_events_wh",),
    "successfactors": ("process_events_sfx",),
    "ariba": ("process_events_arb",),
    "concur": ("process_events_cnq",),
}
_USR02 = {"BNAME", "USTYP", "CLASS"}
_CDHDR = {"OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "UTIME", "TCODE", "CHANGE_IND"}
_CDPOS = {"OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND", "VALUE_NEW"}
_AUFK = {"AUFNR", "AUTYP", "AUART", "WERKS", "ERDAT", "ERFZEIT", "ERNAM", "OBJNR"}
_JCDS = {"OBJNR", "STAT", "CHGNR", "UDATE", "UTIME", "USNAM", "INACT"}
_MKPF = {"MBLNR", "MJAHR", "CPUDT", "CPUTM", "USNAM", "BLART"}
_MSEG = {"MBLNR", "MJAHR", "ZEILE", "BWART", "AUFNR", "WERKS"}
_MATDOC = {"MBLNR", "MJAHR", "ZEILE", "BWART", "MATNR", "WERKS", "LGORT", "BUDAT", "CPUDT", "CPUTM", "USNAM",
           "EBELN", "EBELP", "AUFNR", "KDAUF", "KDPOS", "VBELN_IM", "VBELP_IM", "RECORD_TYPE"}
_QMEL = {"QMNUM", "QMART", "QMDAT", "MZEIT", "ERNAM", "ERDAT", "QMDAB", "QMZAB", "PRIOK", "AUFNR", "PRUEFLOS",
         "IWERK"}  # IWERK is not in the ECC 6.0 DDIC file: dropped by the DDIC check, QMEL marked partial
_TQ80 = {"QMART", "QMTYP"}
_HR_KEYS = {"PERNR", "BEGDA", "SEQNR", "AEDTM", "UNAME"}
PROCESS_EVENTS_DATA: dict[str, dict[str, set[str]]] = {
    "process_events_ptp": {
        "EKKO": {"EBELN", "AEDAT", "ERNAM", "BSART", "BUKRS", "EKORG", "EKGRP", "LIFNR"},
        "EKPO": {"EBELN", "EBELP", "BANFN", "BNFPO", "WERKS", "MATKL", "LOEKZ", "AEDAT"},
        "EBAN": {"BANFN", "BNFPO", "ERDAT", "ERNAM", "BADAT", "FRGDT", "FRGZU", "BSART", "EKORG", "WERKS"},
        "EKBE": {"EBELN", "EBELP", "VGABE", "GJAHR", "BELNR", "BUZEI", "BEWTP", "BWART", "SHKZG", "BUDAT",
                 "CPUDT", "CPUTM", "ERNAM"},
        "RBKP": {"BELNR", "GJAHR", "CPUDT", "CPUTM", "USNAM", "BLART", "BUKRS", "ZLSPR", "RBSTAT"},
        "BKPF": {"BUKRS", "BELNR", "GJAHR", "AWTYP", "AWKEY", "CPUDT", "CPUTM", "USNAM", "BLART", "TCODE"},
        "BSAK": {"BUKRS", "BELNR", "GJAHR", "BUZEI", "AUGDT", "AUGBL", "LIFNR"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_otc": {
        "VBAK": {"VBELN", "ERDAT", "ERZET", "ERNAM", "AUART", "VKORG", "VTWEG", "SPART", "LIFSK", "FAKSK", "KUNNR"},
        "VBAP": {"VBELN", "POSNR", "ERDAT", "ERZET", "ERNAM", "PSTYV", "WERKS", "ABGRU"},
        "LIKP": {"VBELN", "ERDAT", "ERZET", "ERNAM", "LFART", "VSTEL", "WADAT_IST"},
        "LIPS": {"VBELN", "POSNR", "VGBEL", "VGPOS"},
        "VBRK": {"VBELN", "ERDAT", "ERZET", "ERNAM", "FKART", "BUKRS", "BELNR", "GJAHR", "FKSTO", "SFAKN"},
        "VBRP": {"VBELN", "POSNR", "AUBEL", "AUPOS", "VGBEL", "VGPOS"},
        "BSAD": {"BUKRS", "BELNR", "GJAHR", "BUZEI", "AUGDT", "AUGBL", "KUNNR"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_r2r": {
        "BKPF": {"BUKRS", "BELNR", "GJAHR", "BLART", "BSTAT", "CPUDT", "CPUTM", "USNAM", "TCODE", "STBLG",
                 "STJAH", "AWTYP"},
        "BSAS": {"BUKRS", "BELNR", "GJAHR", "BUZEI", "AUGDT", "AUGBL", "HKONT"},
        "AUFK": {"AUFNR", "AUTYP", "AUART", "ERDAT", "ERFZEIT", "ERNAM", "BUKRS", "OBJNR"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_pp": {
        "AUFK": _AUFK, "AFKO": {"AUFNR", "GSTRP", "GLTRP", "GSTRI", "GLTRI", "PLNBEZ"}, "JCDS": _JCDS,
        "MKPF": _MKPF, "MSEG": _MSEG, "MATDOC": _MATDOC, "T001W": {"WERKS"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_pm": {
        "QMEL": _QMEL, "TQ80": _TQ80, "AUFK": _AUFK, "AFIH": {"AUFNR", "WARPL", "EQUNR", "IWERK"},
        "JCDS": _JCDS, "MKPF": _MKPF, "MSEG": _MSEG, "MATDOC": _MATDOC, "T001W": {"WERKS"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_qm": {
        "QALS": {"PRUEFLOS", "ENSTEHDAT", "ENTSTEZEIT", "ERSTELLER", "ART", "HERKUNFT", "WERK", "MATNR", "EBELN",
                 "AUFNR", "OBJNR"},
        "QAVE": {"PRUEFLOS", "VDATUM", "VNAME", "VCODE", "VAEDATUM"},
        "QMEL": _QMEL, "QMFE": {"QMNUM", "FENUM", "ERDAT", "ERZEIT", "ERNAM", "FECOD"},
        "QMSM": {"QMNUM", "MANUM", "ERDAT", "ERZEIT", "ERNAM", "PETER", "ERLDAT", "ERLZEIT", "ERLNAM"},
        "TQ80": _TQ80, "USR02": _USR02,
    },
    "process_events_ps": {
        "PROJ": {"PSPNR", "PSPID", "ERDAT", "ERNAM", "VBUKR", "OBJNR"},
        "PRPS": {"PSPNR", "POSID", "PSPHI", "ERDAT", "ERNAM", "PBUKR", "OBJNR"},
        "JCDS": _JCDS, "USR02": _USR02,
    },
    "process_events_wh": {
        "LTAK": {"LGNUM", "TANUM", "BWLVS", "BDATU", "BZEIT", "BNAME", "BETYP", "BENUM", "KQUIT", "VBELN"},
        "LTAP": {"LGNUM", "TANUM", "TAPOS", "QDATU", "QZEIT", "QNAME", "VLTYP", "NLTYP", "PQUIT"},
        "/SCWM/ORDIM_C": {"LGNUM", "TANUM", "TAPOS", "TOSTAT", "TRART", "PROCTY", "CREATED_AT", "CREATED_BY",
                          "CONFIRMED_AT", "CONFIRMED_BY", "VLPLA", "NLPLA"},
        "USR02": _USR02,
    },
    "process_events_htr": {
        "PA0000": {"PERNR", "BEGDA", "ENDDA", "SEQNR", "MASSN", "MASSG", "STAT2", "AEDTM", "UNAME"},
        "PA0001": _HR_KEYS | {"BUKRS", "WERKS", "PERSG", "ORGEH"},
        "PA0002": set(_HR_KEYS), "PA0008": set(_HR_KEYS),  # keys, dates and user only: no names, no pay
        "HRP1000": {"PLVAR", "OTYPE", "OBJID", "BEGDA", "AEDTM", "UNAME"},
        "HRP1001": {"PLVAR", "OTYPE", "OBJID", "RSIGN", "RELAT", "SCLAS", "BEGDA", "AEDTM", "UNAME"},
        "USR02": _USR02,
    },
    "process_events_mdg": {
        "USMD120C": {"USMD_CREQUEST", "USMD_CREQ_TYPE", "USMD_CREQ_STATUS", "USMD_CREATED_AT", "USMD_CREATED_BY",
                     "USMD_RELEASED_AT", "USMD_RELEASED_BY", "USMD_CHANGED_AT", "USMD_CHANGED_BY",
                     "USMD_DATA_CHN_AT", "USMD_PRIORITY"},
        "USR02": _USR02,
    },
}
_PE_CONFIG = {"USR02", "TQ80", "T001W"}           # whole reads, CONFIG_MAX_ROWS
_PE_SYSTEMS: dict[str, tuple[str, ...]] = {        # tables read on some system types only (spec §1.2)
    "MKPF": ("ecc",), "MSEG": ("ecc",),
    "MATDOC": ("s4hana_onprem",), "T001W": ("s4hana_onprem",),
    "LTAK": ("ecc", "s4hana_onprem"), "LTAP": ("ecc", "s4hana_onprem"),
    "/SCWM/ORDIM_C": ("ewm",),
}
_PE_NO_KEYS = {"MATDOC"}                           # technical KEY1..KEY6: read the listed fields only
```

Replace the `TablePlan` dataclass (lines 101–114) with:

```python
@dataclass
class TablePlan:
    table: str
    fields: set[str] = field(default_factory=set)
    keys: list[str] = field(default_factory=list)
    where: Optional[str] = None
    wide_where: Optional[str] = None   # retry when the default window is empty (stale/sandbox systems)
    via: Optional[str] = None          # read by parent keys (see extraction_windows.yaml)
    purpose: str = "data"              # data | config
    modules: set[str] = field(default_factory=set)
    partial: bool = False              # windowed / parent-keyed / scoped: not every record of the table
    slices: list[str] = field(default_factory=list)   # one full WHERE per month slice (process events)
    also_via: list[str] = field(default_factory=list)  # further via parents, IN-lists concatenated
    in_field: Optional[str] = None     # via: child field of the IN-list (default: most selective join field)
    group_field: Optional[str] = None  # via: child key-prefix field set per IN-list group
    max_slice_rows: int = 0            # >0: a full slice is re-read per split_by value, then per day
    split_by: dict[str, str] = field(default_factory=dict)  # field -> config table listing its values

    def columns(self) -> list[str]:
        return list(dict.fromkeys(self.keys + sorted(self.fields - set(self.keys))))
```

After `_window` (line 216) add:

```python
@lru_cache(maxsize=1)
def _pe_windows() -> dict:
    return yaml.safe_load(_PE_WINDOWS.read_text()) or {}


@lru_cache(maxsize=1)
def pe_edges() -> tuple[Edge, ...]:
    """Process-discovery read edges (process_event_joins.yaml), searched after joins.yaml."""
    doc = yaml.safe_load(_PE_JOINS.read_text())
    return tuple(Edge(parent=e["parent"], child=e["child"], on=tuple((k, v) for k, v in e["join"].items()),
                      cardinality=e["cardinality"]) for e in doc["edges"])


def _ymd(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def month_slices(field: str, start: date, today: date, end: Optional[date] = None, suffix: str = "",
                 step: int = 1) -> list[str]:
    """``FIELD >= lo AND FIELD < hi`` per ``step`` calendar months from ``start``. With ``end`` the last
    slice stops after ``end`` (inclusive); without, the slice holding ``today`` is open-ended."""
    stop = end + timedelta(days=1) if end else None
    out, lo = [], start
    while True:
        k = lo.month - 1 + step
        hi = date(lo.year + k // 12, k % 12 + 1, 1)
        if stop is not None and hi >= stop:
            out.append(f"{field} >= '{lo:%Y%m%d}{suffix}' AND {field} < '{stop:%Y%m%d}{suffix}'")
            return out
        if stop is None and hi > today:
            out.append(f"{field} >= '{lo:%Y%m%d}{suffix}'")
            return out
        out.append(f"{field} >= '{lo:%Y%m%d}{suffix}' AND {field} < '{hi:%Y%m%d}{suffix}'")
        lo = hi


_RANGE = re.compile(r"^(\w+) >= '(\d{8})(\d*)'(?: AND \1 < '(\d{8})\d*')?")


def day_slices(slice_where: str, today: Optional[date] = None) -> list[str]:
    """The slice's leading date range as one range per calendar day; the rest of the WHERE is kept."""
    m = _RANGE.match(slice_where)
    if not m:
        return [slice_where]
    f, lo, suffix, hi = m.groups()
    rest = slice_where[m.end():]
    d = _ymd(lo)
    stop = _ymd(hi) if hi else (today or date.today()) + timedelta(days=1)
    out = []
    while d < stop:
        n = d + timedelta(days=1)
        out.append(f"{f} >= '{d:%Y%m%d}{suffix}' AND {f} < '{n:%Y%m%d}{suffix}'{rest}")
        d = n
    return out


def _or(clauses: Iterable[Optional[str]]) -> Optional[str]:
    """OR of per-module filters; one module without a filter means every row is needed."""
    cs = list(dict.fromkeys(clauses))
    if not cs or None in cs:
        return None
    return cs[0] if len(cs) == 1 else "(" + " OR ".join(f"({c})" for c in cs) + ")"


def _pe_tables(modules: Iterable[str], system_type: str) -> dict[str, tuple[set[str], set[str]]]:
    """table -> (fields wanted, modules) for the process-event modules on this system type."""
    out: dict[str, tuple[set[str], set[str]]] = {}
    for m in modules:
        for t, cols in PROCESS_EVENTS_DATA.get(m, {}).items():
            if system_type in _PE_SYSTEMS.get(t, ABAP_SYSTEM_TYPES):
                fs, ms = out.setdefault(t, (set(), set()))
                fs |= cols
                ms.add(m)
    return out


def process_event_gaps(modules: Iterable[str], dictionary: Dictionary, system_type: str) -> dict[str, list[str]]:
    """Fields (or ``["*"]`` for a whole table) the dictionary lacks: the coverage reason of §10."""
    out: dict[str, list[str]] = {}
    for t, (cols, _) in sorted(_pe_tables(modules, system_type).items()):
        if dictionary.table(t) is None or dictionary.table(t).category == "VIEW":
            out[t] = ["*"]
        elif missing := sorted(f for f in cols if dictionary.field(t, f) is None):
            out[t] = missing
    return out


def _plan_process_events(modules: list[str], dictionary: Dictionary, system_type: str, scope: dict,
                         today: date) -> dict[str, TablePlan]:
    windows = _pe_windows()
    plans: dict[str, TablePlan] = {}
    for t, (cols, mods) in _pe_tables(modules, system_type).items():
        tt = dictionary.table(t)
        if tt is None or tt.category == "VIEW":
            continue
        keep = {f for f in cols if dictionary.field(t, f) is not None}
        plans[t] = TablePlan(table=t, fields=keep, modules=set(mods), partial=keep != cols,
                             keys=[] if t in _PE_NO_KEYS else list(dictionary.keys(t)),
                             purpose="config" if t in _PE_CONFIG else "data")
    for t, p in plans.items():
        if p.purpose == "config":
            continue
        w = windows.get(t) or {}
        per = {m: {**w, **((w.get("modules") or {}).get(m) or {})} for m in sorted(p.modules)}
        scoped = _scope_filters(t, dictionary, scope)
        p.partial = True
        if w.get("via"):
            parents = [x for x in [w["via"], *(w.get("also_via") or [])] if x in plans]
            p.via, p.also_via = (parents[0] if parents else None), parents[1:]
            p.in_field, p.group_field = w.get("in_field"), w.get("group_field")
            p.where = " AND ".join(x for x in (_or(c.get("where") for c in per.values()), *scoped) if x) or None
            continue
        suffix = str(w.get("suffix") or "")
        starts = {m: date.fromisoformat(scope["date_from"]) if scope.get("date_from")
                  else _ymd(_months_ago(int(c["months"]), today)) for m, c in per.items()}
        start = min(starts.values())
        end = date.fromisoformat(scope["date_to"]) if scope.get("date_to") else None
        for r in month_slices(w["field"], start, today, end, suffix, int(w.get("slice_months") or 1)):
            hi = _RANGE.match(r).group(4)
            covering = [c.get("where") for m, c in per.items() if hi is None or starts[m] < _ymd(hi)]
            p.slices.append(" AND ".join(x for x in (r, _or(covering), *scoped) if x))
        whole = [f"{w['field']} >= '{start:%Y%m%d}{suffix}'"]
        if end:
            whole.append(f"{w['field']} < '{end + timedelta(days=1):%Y%m%d}{suffix}'")
        p.where = " AND ".join(x for x in (*whole, _or(c.get("where") for c in per.values()), *scoped) if x)
        p.max_slice_rows = int(w.get("max_slice_rows") or 0)
        p.split_by = {f: src for f, src in (w.get("split_by") or {}).items() if src in plans}
    return plans
```

In `plan_modules`, change the signature (line 219) to:

```python
def plan_modules(modules: list[str], dictionary: Dictionary, scope: Optional[dict] = None, *,
                 system_type: str = "ecc", today: Optional[date] = None) -> dict[str, TablePlan]:
    """Tables/fields to extract so every rule of ``modules`` can be evaluated.

    Process-event modules (PROCESS_EVENT_MODULES) are planned by ``_plan_process_events`` and merged
    last: a table a DQ module also reads keeps its DQ window and gains the process-event fields."""
    process = [m for m in modules if m in PROCESS_EVENT_MODULES]
    modules = [m for m in modules if m not in PROCESS_EVENT_MODULES]
```

Replace the final `return plans` of `plan_modules` (line 344) with:

```python
    if process:
        for t, p in _plan_process_events(process, dictionary, system_type, scope or {},
                                         today or date.today()).items():
            if t in plans:
                plans[t].fields |= p.fields
                plans[t].modules |= p.modules
            else:
                plans[t] = p
    return plans
```

Replace `read_order` (lines 347–362) with:

```python
def read_order(plans: dict[str, TablePlan]) -> list[str]:
    """Tables ordered so every ``via`` / ``also_via`` parent and ``split_by`` source is read first."""
    done: list[str] = []

    def visit(t: str, seen: set[str]) -> None:
        if t in done or t in seen:
            return
        seen.add(t)
        p = plans[t]
        for parent in [p.via, *p.also_via, *p.split_by.values()]:
            if parent and parent in plans:
                visit(parent, seen)
        done.append(t)

    for t in sorted(plans):
        visit(t, set())
    return done
```

Replace `via_filters` (lines 376–384) with:

```python
def via_filters(child: str, parent: str, parent_rows, chunk: int = 60, *, extra_edges: Iterable[Edge] = (),
                in_field: Optional[str] = None, group_field: Optional[str] = None) -> list[str]:
    """WHERE clauses selecting child rows of already-read parent rows (key IN-lists).

    ``extra_edges`` (process_event_joins.yaml) are searched after joins.yaml. ``in_field`` names the
    child field of the IN-list; ``group_field`` prefixes each IN-list with ``FIELD = '<value>' AND`` per
    distinct parent value, so the read hits a key prefix (CDPOS: OBJECTCLAS, OBJECTID)."""
    from sap.rfc import _literal

    edges, _ = _graph()
    edge = next((e for e in (*edges, *extra_edges) if e.parent == parent and e.child == child), None)
    if edge is None or parent_rows is None or len(parent_rows) == 0:
        return []
    on = dict(edge.on)
    if in_field:
        child_f, parent_f = in_field, on[in_field]
    else:  # the most selective single join field (document number)
        child_f, parent_f = max(edge.on, key=lambda cp: cp[1] not in ("BUKRS", "GJAHR", "LGNUM", "MANDT"))
    if not group_field:
        return in_lists(child_f, parent_rows[parent_f].tolist(), chunk)
    groups = parent_rows.assign(_g=parent_rows[on[group_field]].astype(str).str.strip())
    return [f"{group_field} = {_literal(g)} AND {c}"
            for g, rows in sorted(groups.groupby("_g"), key=lambda x: x[0])
            for c in in_lists(child_f, rows[parent_f].tolist(), chunk)]
```

- [ ] **Step 8: Add the cloud targets to `sap/extraction_registry.py`**

At the top add `from dataclasses import dataclass, field, replace` and `from datetime import date, timedelta`. These replace the existing `dataclass, field` import on line 22. Then add after `SYSTEM_EXTRACTIONS` (line 1498):

```python
# Process discovery, cloud systems (spec §1.2 SFX / ARB / CNQ): subsets of the targets above, same
# source and field names. (frame name, source module, source, fields, months, date property, effective dated)
_PROCESS_EVENT_CLOUD: dict[str, tuple[str, list[tuple[str, str, str, list[str], int, str, bool]]]] = {
    "process_events_sfx": ("successfactors", [
        ("JobRequisition", "recruiting_onboarding", "JobRequisition",
         ["requisitionId", "status", "createdDate", "hiringManager"], 24, "createdDate", False),
        ("JobApplication", "recruiting_onboarding", "JobApplication",
         ["applicationId", "requisitionId", "status", "appliedDate", "lastModifiedDate"], 24, "lastModifiedDate",
         False),
        ("EmpJob", "employee_central", "EmpJob",
         ["userId", "startDate", "seqNumber", "event", "eventReason", "company", "department"], 24, "startDate",
         True),
        ("EmployeeTime", "time_attendance", "EmployeeTime",
         ["userId", "timeType", "startDate", "endDate", "approvalStatus"], 12, "startDate", False),
    ]),
    "process_events_arb": ("ariba", [
        ("suppliers", "ariba_supplier", "/api/suppliers", ["supplierId", "qualificationStatus", "registrationDate"],
         24, "registrationDate", False),
        ("contracts", "ariba_contracts", "/api/contracts",
         ["contractId", "status", "effectiveDate", "expirationDate", "owner"], 24, "effectiveDate", False),
        ("requisitions", "ariba_procurement", "/api/procurement/requisitions",
         ["requisitionId", "requestor", "status", "createdDate", "approvalStatus"], 24, "createdDate", False),
    ]),
    "process_events_cnq": ("concur", [
        ("reports", "concur_expense", "/api/v3.0/expense/reports",
         ["reportId", "ownerLoginId", "submitDate", "approvalStatus", "paymentStatus"], 24, "submitDate", False),
        ("entries", "concur_expense", "/api/v3.0/expense/entries",
         ["reportId", "entryId", "expenseTypeCode", "transactionDate"], 24, "transactionDate", False),
    ]),
}


def process_event_targets(system_type: str, module: str, date_from: Optional[str] = None,
                          today: Optional[date] = None) -> list[tuple[str, ExtractionTarget]]:
    """(frame name, target) per entity set of a cloud process-event module.

    SuccessFactors: effective-dated EmpJob gets ``from_date``; the others an OData ``$filter`` on their
    date property. Ariba and Concur connectors take no date argument: the builder applies the window.
    """
    owner, rows = _PROCESS_EVENT_CLOUD.get(module, ("", []))
    if owner != system_type:
        return []
    today = today or date.today()
    out = []
    for name, src_module, source, fields, months, prop, effective in rows:
        base = next(t for t in SYSTEM_EXTRACTIONS[owner][src_module] if t.source == source)
        missing = set(fields) - set(base.fields)
        if missing:
            raise ValueError(f"{source} has no {sorted(missing)} in the registry")
        y, m = today.year, today.month - months
        while m <= 0:
            m, y = m + 12, y - 1
        start = date_from or f"{y:04d}-{m:02d}-{min(today.day, 28):02d}"
        target = replace(base, fields=list(fields), is_config=False, from_date=None, filter=None)
        if owner == "successfactors":
            target = replace(target, from_date=start) if effective else \
                replace(target, filter=f"{prop} ge datetime'{start}T00:00:00'")
        out.append((name, target))
    return out
```

- [ ] **Step 9: Wire slices, extra via edges and cloud modules into `ConnectivityManager.extract`**

In `api/services/connectivity_manager.py`, `extract`, make these changes.

Change the import (line 230) to:

```python
        from sap.extraction_plan import (ABAP_SYSTEM_TYPES, PROCESS_EVENT_CLOUD_MODULES, pe_edges, plan_modules,
                                         read_order, via_filters)
```

Replace `plans = plan_modules(modules, dictionary, scope)` (line 249) with:

```python
                plans = plan_modules(modules, dictionary, scope, system_type=system_type)
```

Replace `needed_raw` (line 260) with:

```python
                needed_raw = {x for p in plans.values() for x in (p.via, *p.also_via, *p.split_by.values()) if x} \
                    | {"HRPY_RGDIR"}
```

Replace the `if df is None and plan.via:` block (lines 318–324) with:

```python
                        if df is None and plan.via:
                            wheres = [w for parent in (plan.via, *plan.also_via)
                                      for w in via_filters(table, parent, raw.get(parent), extra_edges=pe_edges(),
                                                           in_field=plan.in_field, group_field=plan.group_field)]
                            parts = [connector.read_table_full(table, cols, list(t.keys) if plan.keys else [],
                                     where=" AND ".join(x for x in (w, plan.where) if x), max_rows=max_rows,
                                     on_progress=lambda g, n, rows: report(table, g, n, rows))
                                     for w in wheres]
                            df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
                        elif df is None and plan.slices:
                            plants = raw.get(next(iter(plan.split_by.values()), ""))
                            df, sliced = self._read_slices(connector, table, cols, list(t.keys) if plan.keys else [],
                                                           plan, plants, max_rows,
                                                           lambda g, n, rows: report(table, g, n, rows))
```

Before that block, next to `delta_info: Optional[dict] = None`, add `sliced: list[dict] = []`.

After `if delta_info: entry["delta"] = delta_info` (line 356) add:

```python
                    if plan.slices:
                        entry["slices"] = len(plan.slices)
                        entry["window"] = plan.where
                    if sliced:
                        entry["truncated_slices"] = sliced
                        entry["truncated"] = True
                        entry["complete"] = False
```

Replace the start of the non-ABAP branch (line 370, `elif system_type == "successfactors":`) with:

```python
            elif set(modules) & set(PROCESS_EVENT_CLOUD_MODULES):
                frames, coverage = self._extract_process_cloud(connector, modules, system_type, scope)
            elif system_type == "successfactors":
```

Add these two methods after `_delta_keys`:

```python
    @staticmethod
    def _read_slices(connector, table: str, cols: list[str], keys: list[str], plan, plants: Optional[pd.DataFrame],
                     max_rows: int, on_progress: Callable[[int, int, int], None]) -> tuple[pd.DataFrame, list[dict]]:
        """Read ``plan.slices`` one at a time (spec §1.1).

        With ``plan.max_slice_rows`` (MATDOC) no read returns more than max_slice_rows + 1 rows. A full slice is
        re-read once per ``split_by`` value (plant), a full plant-month once per day, and a full plant-day
        keeps its first max_slice_rows rows and is reported in the returned truncation list."""
        from sap.extraction_plan import day_slices
        from sap.rfc import _literal

        parts: list[pd.DataFrame] = []
        truncated: list[dict] = []
        limit = plan.max_slice_rows

        def read(where: str, cap: int) -> pd.DataFrame:
            return connector.read_table_full(table, cols, keys, where=where, max_rows=cap, on_progress=on_progress)

        for s in plan.slices:
            if not limit:
                df = read(s, max_rows)
                if len(df) >= max_rows:
                    truncated.append({"slice": s, "plant": None, "day": None})
                parts.append(df)
                continue
            df = read(s, limit + 1)
            if len(df) <= limit:
                parts.append(df)
                continue
            # ponytail: one split field (WERKS); a second split_by entry is ignored until a table needs it
            split = next(iter(plan.split_by), None)
            values = sorted({str(v).strip() for v in plants[split]} - {""}) \
                if split and plants is not None and split in plants.columns else []
            if not values:
                parts.append(df.head(limit))
                truncated.append({"slice": s, "plant": None, "day": None})
                continue
            for v in values:
                ws = f"{s} AND {split} = {_literal(v)}"
                dv = read(ws, limit + 1)
                if len(dv) <= limit:
                    parts.append(dv)
                    continue
                for d in day_slices(ws):
                    dd = read(d, limit + 1)
                    if len(dd) > limit:
                        dd = dd.head(limit)
                        truncated.append({"slice": s, "plant": v, "day": d.split("'")[1][:8]})
                    parts.append(dd)
        return (pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)), truncated

    @staticmethod
    def _extract_process_cloud(connector, modules: list[str], system_type: str,
                               scope: Optional[dict]) -> tuple[dict[str, pd.DataFrame], list[dict]]:
        """Process-event entity sets of SuccessFactors / Ariba / Concur (sap/extraction_registry.py).
        Frames are keyed by entity name with ``NAME.field`` columns."""
        from sap.extraction_registry import process_event_targets

        frames: dict[str, pd.DataFrame] = {}
        coverage: list[dict] = []
        for m in modules:
            for name, target in process_event_targets(system_type, m, (scope or {}).get("date_from")):
                kwargs = {"from_date": target.from_date} if target.from_date else {}
                try:
                    df = connector.read_entity_set(target.source, select=target.fields, filter_expr=target.filter,
                                                   **kwargs)
                except Exception as e:  # one failed entity set is reported, the others still read
                    coverage.append({"table": name, "status": "failed", "detail": str(e)[:300], "modules": [m]})
                    continue
                frames[name] = df.rename(columns={c: f"{name}.{c}" for c in df.columns})
                coverage.append({"table": name, "status": "live", "rows": len(df), "modules": [m],
                                 "purpose": "data", "window": target.filter or target.from_date})
        return frames, coverage
```

The step-1 test `test_read_slices_matdoc_guard_splits_plant_then_day` checks this path. The fake connector returns a full month, then a full month for plant 1000 only, a full 30 September for plant 1000, and 3 rows for everything else.

- [ ] **Step 10: Run the tests and confirm they pass**

Run: `pytest tests/checks/test_joins_valid.py tests/test_extraction_plan_process_events.py tests/test_extraction_plan_proven_cost.py -q`
Expected: PASS. Zero failures.

Run: `pytest tests -q -k "extraction or connectivity or ddic or frames" -x`
Expected: PASS. The DQ plans are unchanged: `plan_modules` without process-event modules returns the same plans as before.

- [ ] **Step 11: Commit**

```bash
git add sap/dictionaries/process_event_windows.yaml sap/dictionaries/process_event_joins.yaml \
  sap/dictionaries/s4hana/tables/MATDOC.json sap/ddic.py sap/extraction_plan.py sap/extraction_registry.py \
  api/services/connectivity_manager.py tests/checks/test_joins_valid.py tests/test_extraction_plan_process_events.py
git commit -m "feat(process-discovery): plan process-event extraction with month slices and MATDOC guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB"
```

### Task 20: Event-log layer (wave 20): migration 079 and ORM models

**Files:**
- Create: `db/migrations/versions/079_process_event_log.py`
- Modify: `db/schema.py`. Add `SAPSystem.timezone` after `target_system_id` (about `:676`). Add `ProcessDiscoveryRun`, `ProcessEvent` and `ProcessDiscoveryVariant` after `ProcessModelVersion` (`:1049`), before the existing `ProcessVariant` (`:1064`). Do not touch `ProcessVariant`.
- Test: `tests/test_process_event_log_pg.py`
- Test: `tests/test_process_event_log_schema.py` (no DB)

**Interfaces:**
- Consumes:
  - `tenants(id)`, `sap_systems(id)` and `users(id)`, all uuid.
  - The 076/078 RLS template.
  - `_alembic` from `tests/test_migration_waves_pg.py:20`. Copy it; it is module-private.
- Produces:
  - Tables `process_discovery_runs`, `process_events` and `process_discovery_variants`. These are the spec §2.1 DDL, with `process_variants` renamed because that table already exists with another meaning.
  - Column `sap_systems.timezone text NULL`.
  - ORM classes `ProcessDiscoveryRun`, `ProcessEvent` and `ProcessDiscoveryVariant`, plus `SAPSystem.timezone`.
  - Constants `PD_STATUSES` and `PD_COVERAGE` in `db/schema.py`. Tasks 25 and 27 import them.

- [ ] **Step 1: Confirm the head**

Run: `cd <worktree> && alembic heads`
Expected: `078 (head)`. If another number is head, use head+1 as the revision and the file prefix, and set `down_revision` to that head. Update the test's `"079"` literal to match.

- [ ] **Step 2: Write the failing schema test (no DB)**

`tests/test_process_event_log_schema.py`:

```python
"""Process event log ORM shape (spec §2.1). No database needed."""

from __future__ import annotations

from db.schema import (
    PD_COVERAGE,
    PD_STATUSES,
    ProcessDiscoveryRun,
    ProcessDiscoveryVariant,
    ProcessEvent,
    ProcessVariant,
    SAPSystem,
)


def test_tables_are_named_and_do_not_clash() -> None:
    assert ProcessDiscoveryRun.__tablename__ == "process_discovery_runs"
    assert ProcessEvent.__tablename__ == "process_events"
    assert ProcessDiscoveryVariant.__tablename__ == "process_discovery_variants"
    assert ProcessVariant.__tablename__ == "process_variants"  # existing, unrelated


def test_event_columns_and_lengths() -> None:
    c = ProcessEvent.__table__.c
    assert c.case_id.type.length == 160
    assert c.activity.type.length == 64
    assert c.l5_id.type.length == 120
    assert c.source_table.type.length == 40
    assert c.seq.default is None and c.seq.server_default is not None
    idx = {i.name: [col.name for col in i.columns] for i in ProcessEvent.__table__.indexes}
    assert idx["ix_pe_case"] == ["tenant_id", "system_id", "l1", "case_type", "case_id", "ts", "seq", "id"]
    assert idx["ix_pe_activity"] == ["tenant_id", "system_id", "l1", "activity"]
    assert idx["ix_pe_ts"] == ["tenant_id", "system_id", "l1", "ts"]


def test_variant_primary_key() -> None:
    pk = [c.name for c in ProcessDiscoveryVariant.__table__.primary_key.columns]
    assert pk == ["run_id", "case_type", "variant_hash"]


def test_status_vocab_and_timezone() -> None:
    assert PD_STATUSES == ("queued", "waiting", "extracting", "building", "mining", "completed", "failed")
    assert PD_COVERAGE == ("discovered", "partial", "reference")
    assert SAPSystem.__table__.c.timezone.nullable is True
```

- [ ] **Step 3: Run it (FAIL)**

Run: `pytest tests/test_process_event_log_schema.py -q`
Expected: FAIL with `ImportError: cannot import name 'PD_COVERAGE' from 'db.schema'`.

- [ ] **Step 4: Write the failing Postgres test**

`tests/test_process_event_log_pg.py`:

```python
"""Migration 079: process event log is tenant-isolated, cascades from runs, and is reversible."""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_pd_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def engines():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant_and_system(owner) -> tuple[str, str]:
    from sqlalchemy import text

    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PD-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": sid, "t": tid})
    return tid, sid


def _run(c, tid: str, sid: str) -> str:
    from sqlalchemy import text

    return str(c.execute(text(
        "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
        "VALUES (:t, :s, 'PTP', 'full', 'queued') RETURNING id"), {"t": tid, "s": sid}).scalar())


@pg
def test_rls_isolates_all_three_tables(engines) -> None:
    from sqlalchemy import text

    owner, app = engines
    a, sa = _tenant_and_system(owner)
    b, _ = _tenant_and_system(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        rid = _run(c, a, sa)
        c.execute(text(
            "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, ts, ts_precision, "
            "source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', '4500000001/00010', 'PO_CREATED', now(), "
            "'second', 'EKKO', :r)"), {"t": a, "s": sa, "r": rid})
        c.execute(text(
            "INSERT INTO process_discovery_variants (run_id, tenant_id, case_type, variant_hash, activities, "
            "case_count, share, sample_case_ids) VALUES (:r, :t, 'po_item', :h, '{PO_CREATED}', 1, 1, '{x}')"),
            {"r": rid, "t": a, "h": "a" * 32})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
        for t in ("process_discovery_runs", "process_events", "process_discovery_variants"):
            assert c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() == 0, t
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        row = c.execute(text("SELECT coverage, filters, stats, seq FROM process_discovery_runs r "
                             "JOIN process_events e ON e.run_id = r.id")).one()
        assert (row.coverage, row.filters, row.stats, row.seq) == ("reference", {}, {}, 0)


@pg
def test_deleting_a_run_cascades(engines) -> None:
    from sqlalchemy import text

    owner, app = engines
    a, sa = _tenant_and_system(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        rid = _run(c, a, sa)
        c.execute(text(
            "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, ts, ts_precision, "
            "source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', 'c', 'PO_CREATED', now(), 'day', 'EKKO', :r)"),
            {"t": a, "s": sa, "r": rid})
        c.execute(text("DELETE FROM process_discovery_runs WHERE id = :r"), {"r": rid})
        assert c.execute(text("SELECT COUNT(*) FROM process_events WHERE run_id = :r"), {"r": rid}).scalar() == 0


@pg
def test_timezone_column_and_downgrade(engines) -> None:
    from sqlalchemy import create_engine, inspect

    owner, _ = engines
    cols = {c["name"] for c in inspect(owner).get_columns("sap_systems")}
    assert "timezone" in cols
    _alembic("downgrade", "078")
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    try:
        insp = inspect(eng)
        assert not insp.has_table("process_events")
        assert not insp.has_table("process_discovery_runs")
        assert not insp.has_table("process_discovery_variants")
        assert "timezone" not in {c["name"] for c in insp.get_columns("sap_systems")}
    finally:
        eng.dispose()
        _alembic("upgrade", "head")
```

- [ ] **Step 5: Run it (FAIL)**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/pd_test pytest tests/test_process_event_log_pg.py -q`
Expected: FAIL with `relation "process_discovery_runs" does not exist`.

- [ ] **Step 6: Write the migration**

`db/migrations/versions/079_process_event_log.py`:

```python
"""process event log

Revision ID: 079
Revises: 078
Create Date: 2026-10-11

Process discovery: runs, the per-case event log and mined variants (spec §2.1).
The variant table is process_discovery_variants because process_variants already
exists (config-variant discovery, db/schema.py ProcessVariant).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "079"
down_revision: Union[str, None] = "078"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("process_discovery_runs", "process_events", "process_discovery_variants")


def upgrade() -> None:
    op.execute("ALTER TABLE sap_systems ADD COLUMN IF NOT EXISTS timezone text")
    op.execute("""
        CREATE TABLE IF NOT EXISTS process_discovery_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            system_id uuid NOT NULL REFERENCES sap_systems(id) ON DELETE CASCADE,
            l1 varchar(8) NOT NULL,
            mode varchar(12) NOT NULL,
            status varchar(16) NOT NULL,
            coverage varchar(12) NOT NULL DEFAULT 'reference',
            window_from date,
            window_to date,
            watermark timestamptz,
            extraction_version_id uuid,
            job_id varchar(64),
            filters jsonb NOT NULL DEFAULT '{}',
            stats jsonb NOT NULL DEFAULT '{}',
            model jsonb,
            error text,
            created_by uuid REFERENCES users(id),
            started_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz,
            CONSTRAINT ck_pdr_mode CHECK (mode IN ('full', 'incremental')),
            CONSTRAINT ck_pdr_status CHECK (status IN ('queued', 'waiting', 'extracting', 'building',
                                                       'mining', 'completed', 'failed')),
            CONSTRAINT ck_pdr_coverage CHECK (coverage IN ('discovered', 'partial', 'reference'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pdr_tenant_system_l1 "
               "ON process_discovery_runs (tenant_id, system_id, l1, started_at DESC)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS process_events (
            id bigserial PRIMARY KEY,
            tenant_id uuid NOT NULL,
            system_id uuid NOT NULL,
            l1 varchar(8) NOT NULL,
            case_type varchar(32) NOT NULL,
            case_id varchar(160) NOT NULL,
            activity varchar(64) NOT NULL,
            l5_id varchar(120),
            ts timestamptz NOT NULL,
            ts_precision varchar(6) NOT NULL,
            seq smallint NOT NULL DEFAULT 0,
            resource varchar(64),
            automated boolean,
            doc_type varchar(16),
            org jsonb NOT NULL DEFAULT '{}',
            object_refs jsonb NOT NULL DEFAULT '[]',
            attributes jsonb NOT NULL DEFAULT '{}',
            source_table varchar(40) NOT NULL,
            run_id uuid NOT NULL REFERENCES process_discovery_runs(id) ON DELETE CASCADE,
            CONSTRAINT ck_pe_precision CHECK (ts_precision IN ('second', 'day'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_case ON process_events "
               "(tenant_id, system_id, l1, case_type, case_id, ts, seq, id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_activity ON process_events (tenant_id, system_id, l1, activity)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_ts ON process_events (tenant_id, system_id, l1, ts)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_run ON process_events (run_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS process_discovery_variants (
            run_id uuid NOT NULL REFERENCES process_discovery_runs(id) ON DELETE CASCADE,
            tenant_id uuid NOT NULL,
            case_type varchar(32) NOT NULL,
            variant_hash char(32) NOT NULL,
            activities text[] NOT NULL,
            case_count integer NOT NULL,
            share numeric(7,6) NOT NULL,
            median_seconds bigint,
            p90_seconds bigint,
            fitness numeric(5,4),
            sample_case_ids text[] NOT NULL,
            PRIMARY KEY (run_id, case_type, variant_hash)
        )
    """)
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"DROP TABLE IF EXISTS {t}")
    op.execute("ALTER TABLE sap_systems DROP COLUMN IF EXISTS timezone")
```

`ix_pe_run` is not in the spec. It is added because the `ON DELETE CASCADE` from runs and the retention delete both look events up by `run_id`. Without it, each run delete scans the whole table.

- [ ] **Step 7: Add the ORM models**

In `db/schema.py`, add this line to `SAPSystem` directly after the `target_system_id` column:

```python
    timezone = Column(Text, nullable=True)  # IANA zone for SAP dates (migration 079); NULL = Africa/Johannesburg
```

Insert the following block after `class ProcessModelVersion` and before `class ProcessVariant`:

```python
PD_STATUSES: tuple[str, ...] = ("queued", "waiting", "extracting", "building", "mining", "completed", "failed")
PD_COVERAGE: tuple[str, ...] = ("discovered", "partial", "reference")


class ProcessDiscoveryRun(Base):
    """One process-discovery run per (system, L1) — migration 079, spec §2.1."""
    __tablename__ = "process_discovery_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False)
    l1 = Column(String(8), nullable=False)
    mode = Column(String(12), nullable=False)
    status = Column(String(16), nullable=False)
    coverage = Column(String(12), nullable=False, server_default="reference")
    window_from = Column(Date, nullable=True)
    window_to = Column(Date, nullable=True)
    watermark = Column(DateTime(timezone=True), nullable=True)
    extraction_version_id = Column(UUID(as_uuid=True), nullable=True)  # analysis_versions.id, no FK (spec §2.1)
    job_id = Column(String(64), nullable=True)
    filters = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    stats = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    model = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    finished_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_pdr_tenant_system_l1", "tenant_id", "system_id", "l1", text("started_at DESC")),
    )


class ProcessEvent(Base):
    """One event in a case — migration 079, spec §2.1. HTR/SFX case_id and resource are hashed."""
    __tablename__ = "process_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    system_id = Column(UUID(as_uuid=True), nullable=False)
    l1 = Column(String(8), nullable=False)
    case_type = Column(String(32), nullable=False)
    case_id = Column(String(160), nullable=False)
    activity = Column(String(64), nullable=False)
    l5_id = Column(String(120), nullable=True)
    ts = Column(DateTime(timezone=True), nullable=False)
    ts_precision = Column(String(6), nullable=False)
    seq = Column(SmallInteger, nullable=False, server_default="0")
    resource = Column(String(64), nullable=True)
    automated = Column(Boolean, nullable=True)
    doc_type = Column(String(16), nullable=True)
    org = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    object_refs = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    attributes = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    source_table = Column(String(40), nullable=False)
    run_id = Column(UUID(as_uuid=True), ForeignKey("process_discovery_runs.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        Index("ix_pe_case", "tenant_id", "system_id", "l1", "case_type", "case_id", "ts", "seq", "id"),
        Index("ix_pe_activity", "tenant_id", "system_id", "l1", "activity"),
        Index("ix_pe_ts", "tenant_id", "system_id", "l1", "ts"),
        Index("ix_pe_run", "run_id"),
    )


class ProcessDiscoveryVariant(Base):
    """Mined variant per (run, case type) — migration 079. Spec calls it process_variants; renamed (clash)."""
    __tablename__ = "process_discovery_variants"

    run_id = Column(UUID(as_uuid=True), ForeignKey("process_discovery_runs.id", ondelete="CASCADE"),
                    primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    case_type = Column(String(32), primary_key=True)
    variant_hash = Column(String(32), primary_key=True)  # char(32) in DDL
    activities = Column(ARRAY(Text), nullable=False)
    case_count = Column(Integer, nullable=False)
    share = Column(Numeric(7, 6), nullable=False)
    median_seconds = Column(BigInteger, nullable=True)
    p90_seconds = Column(BigInteger, nullable=True)
    fitness = Column(Numeric(5, 4), nullable=True)
    sample_case_ids = Column(ARRAY(Text), nullable=False)
```

Add `SmallInteger` to the `from sqlalchemy import (...)` block at the top of `db/schema.py`.

- [ ] **Step 8: Run both tests (PASS)**

Run: `pytest tests/test_process_event_log_schema.py -q && MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/pd_test pytest tests/test_process_event_log_pg.py -q`
Expected: `4 passed`, then `3 passed`. Without the DB URL, expect `3 skipped`.

Run: `alembic heads`
Expected: `079 (head)`.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/versions/079_process_event_log.py db/schema.py tests/test_process_event_log_schema.py tests/test_process_event_log_pg.py
git commit -m "$(cat <<'MSG'
feat(process): event log tables, RLS and sap_systems.timezone (migration 079)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 21: Event builders, core (wave 21): event primitives, PTP, OTC, R2R

**Files:**
- Create: `api/services/process_discovery/__init__.py`
- Create: `api/services/process_discovery/events.py`
- Create: `api/services/process_discovery/builders/__init__.py`
- Create: `api/services/process_discovery/builders/ptp.py`
- Create: `api/services/process_discovery/builders/otc.py`
- Create: `api/services/process_discovery/builders/r2r.py`
- Create: `tests/process_discovery/__init__.py` (empty). The repo's `tests/` subpackages each carry an `__init__.py`; without it, `test_builders_*.py` names collide across packages.
- Test: `tests/process_discovery/test_builders_core.py`

**Interfaces:**
- Consumes:
  - `sap.process_definitions.reference_document()` (`sap/process_definitions.py:574`), which returns `ProcessModelDocument` (`api/models/process_model.py`) with `.l1[].l2[].l3[].l4[].activities[]` and `.all_l4()`. Used only by the test, to prove every mapped `l5_id` exists.
  - `workers.dataset._client`, `bundle_object(path, table)` and `iter_parquet_chunks(object, keep=...)`. `BundleFrames` imports them lazily, so the unit tests need no MinIO.
  - Extracted columns from Task 19's `process_event_windows.yaml` and `PROCESS_EVENT_MODULES`. Column names match the ABAP field names the spec §2.3 tables use.
- Produces:
  - `L1S`, `PRIMARY_CASE_TYPE`, `MODULE_OF`, `L1S_BY_SYSTEM` and `primary_case_type(l1, system_type)`.
  - `ActivityMap`, `EventRow` (with `as_row()`), `BuildContext`, `Frames`, `MemoryFrames`, `BundleFrames`, `make_context`, `collect`, `event`, `dyn`, `sap_ts`, `sap_day`, `dec15_ts`, `iso_ts`, `first`, `norm_key`, `cd_headers`, `cd_changes`, `cd_stamp`, `value_attr`, `rows`, `master_data_events`. Tasks 22, 23 and 27 import these.
  - `builders.builder(l1)`, which returns the module. Each builder module exposes `MAPPING: tuple[ActivityMap, ...]` and `build(frames, ctx) -> Iterator[Optional[EventRow]]`.
  - `r2r.post_activity(tcode)`.

Decisions this task fixes, and why:
- `EventRow` carries no tenant, system, L1 or run id. The worker (Task 27) adds them on insert, so builders stay pure.
- `seq` is the mapping row's Order for every event, not only day-precision ones. Same-second events then sort in template order too.
- A builder sets `l5_id` at build time from the mapping. Task 25 rewrites only the discovered `X_`/`DSC` ids, with `UPDATE … FROM (VALUES …)`.
- `cd_changes` drops the create change document (`CHANGE_IND='I'`). Its CDPOS rows are the create activity, not field changes.
- SAP time `000000` counts as "no time": day precision at 00:00. Many batch postings carry `000000`.
- PTP `INVOICE_BLOCKED` uses `RBKP.CPUDT`+`CPUTM`. The spec gives no timestamp for it.
- OTC: the `BUKRS` org key comes only from `VBRK` (on invoice and payment events), because `VBAK` has no company code in the extracted columns.
- OTC: a cancelled original invoice (`FKSTO='X'`) emits no `CREATE_INVOICE`, which is the spec's literal condition. Clearing `FAKSK` emits nothing; the spec has no "remove billing block" row.
- R2R: `BSTAT` values other than `''` and `'V'` (noted items, sample docs) emit nothing. A blank `TCODE` becomes `POST_NONE`.
- R2R `REVERSE_DOC`: original and reversal reference each other through `STBLG`. Only the earlier document gets the event, at the reversal's timestamp. A same-second tie goes to the lower `BELNR`.
- `object_refs` type names are the SAP key a reader would search by: `BANFN`, `MBLNR`, `RBKP`, `BKPF`, `AUGBL`, `LIPS`, `VBRP`, `STBLG`.

- [ ] **Step 1: Write the failing test**

Create the empty `tests/process_discovery/__init__.py`, then `tests/process_discovery/test_builders_core.py`:

```python
"""PTP, OTC and R2R builders against in-memory extraction frames (spec §2.2, §2.3, §9 wave 2)."""

from __future__ import annotations

import random
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from api.services.process_discovery import builders
from api.services.process_discovery.builders import otc, ptp, r2r
from api.services.process_discovery.events import BuildContext, MemoryFrames, collect, make_context
from sap.process_definitions import reference_document

JNB = ZoneInfo("Africa/Johannesburg")
RUN = date(2026, 10, 11)


def cd(*docs: tuple) -> dict[str, pd.DataFrame]:
    """CDHDR + CDPOS from (class, objectid, changenr, change_ind, udate, utime, user, [(tab, tabkey, field, ind, new)])."""
    hdr, pos = [], []
    for cls, obj, nr, ind, udate, utime, user, items in docs:
        hdr.append({"OBJECTCLAS": cls, "OBJECTID": obj, "CHANGENR": nr, "USERNAME": user, "UDATE": udate,
                    "UTIME": utime, "TCODE": "", "CHANGE_IND": ind})
        for tab, key, fname, chng, new in items:
            pos.append({"OBJECTCLAS": cls, "OBJECTID": obj, "CHANGENR": nr, "TABNAME": tab, "TABKEY": key,
                        "FNAME": fname, "CHNGIND": chng, "VALUE_NEW": new})
    return {"CDHDR": pd.DataFrame(hdr), "CDPOS": pd.DataFrame(pos)}


def df(*records: dict) -> pd.DataFrame:
    return pd.DataFrame(list(records))


def ptp_tables() -> dict[str, pd.DataFrame]:
    po, k10, k20 = "4500000001", "1004500000001" + "00010", "1004500000001" + "00020"
    return {
        "EKKO": df({"EBELN": po, "AEDAT": "20260105", "ERNAM": "BUYER1", "BSART": "NB", "BUKRS": "1000",
                    "EKORG": "1000", "LIFNR": "V1"}),
        "EKPO": df({"EBELN": po, "EBELP": "00010", "BANFN": "0010000001", "BNFPO": "00010", "WERKS": "1000"},
                   {"EBELN": po, "EBELP": "00020", "BANFN": "", "BNFPO": "", "WERKS": "1000"}),
        "EBAN": df({"BANFN": "0010000001", "BNFPO": "00010", "ERDAT": "20260102", "ERNAM": "REQ1"}),
        **cd(("BANF", "0010000001", "0000000001", "U", "20260103", "090000", "MGR1",
              [("EBAN", "100001000000100010", "FRGZU", "U", "X")]),
             ("EINKBELEG", po, "0000000002", "U", "20260106", "080000", "MGR1",
              [("EKKO", "100" + po, "FRGZU", "U", "X")]),
             ("EINKBELEG", po, "0000000003", "U", "20260106", "081500", "BUYER1",
              [("EKKO", "100" + po, "ZTERM", "U", "0001"), ("EKPO", k10, "MENGE", "U", "12"),
               ("EKPO", k10, "NETPR", "U", "9.50"), ("EKET", k10 + "0001", "EINDT", "U", "20260120"),
               ("EKPO", k20, "LOEKZ", "U", "L")]),
             ("KRED", "V1", "0000000004", "I", "20251201", "100000", "MD1", [("LFA1", "100V1", "KEY", "I", "")]),
             ("KRED", "V1", "0000000005", "U", "20251202", "100000", "MD1",
              [("LFA1", "100V1", "NAME1", "U", "Acme"), ("LFB1", "100V11000", "ZTERM", "U", "0002"),
               ("LFBK", "100V1ZA", "BANKN", "U", "123")])),
        "EKBE": df(
            # One GR document for both items; item 10 repeats it (account-assignment line).
            {"EBELN": po, "EBELP": "00010", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000001", "BWART": "101",
             "SHKZG": "S", "CPUDT": "20260110", "CPUTM": "101500", "ERNAM": "BATCH"},
            {"EBELN": po, "EBELP": "00010", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000001", "BWART": "101",
             "SHKZG": "S", "CPUDT": "20260110", "CPUTM": "101500", "ERNAM": "BATCH"},
            {"EBELN": po, "EBELP": "00020", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000001", "BWART": "101",
             "SHKZG": "S", "CPUDT": "20260110", "CPUTM": "101500", "ERNAM": "BATCH"},
            {"EBELN": po, "EBELP": "00020", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000002", "BWART": "102",
             "SHKZG": "H", "CPUDT": "20260111", "CPUTM": "000000", "ERNAM": "WH1"},
            {"EBELN": po, "EBELP": "00010", "VGABE": "2", "GJAHR": "2026", "BELNR": "5105600001", "BWART": "",
             "SHKZG": "S", "CPUDT": "20260112", "CPUTM": "080000", "ERNAM": "AP1"},
            {"EBELN": po, "EBELP": "00010", "VGABE": "2", "GJAHR": "2026", "BELNR": "5105600002", "BWART": "",
             "SHKZG": "H", "CPUDT": "20260113", "CPUTM": "080000", "ERNAM": "AP1"}),
        "RBKP": df({"BELNR": "5105600001", "GJAHR": "2026", "CPUDT": "20260112", "CPUTM": "080000", "USNAM": "AP1",
                    "ZLSPR": "A", "RBSTAT": "5"}),
        "BKPF": df({"BUKRS": "1000", "BELNR": "5100000001", "GJAHR": "2026", "AWTYP": "RMRP",
                    "AWKEY": "51056000012026"}),
        "BSAK": df({"BUKRS": "1000", "BELNR": "5100000001", "GJAHR": "2026", "AUGDT": "20260201",
                    "AUGBL": "1500000001"}),
        "USR02": df({"BNAME": "BUYER1", "USTYP": "A"}, {"BNAME": "BATCH", "USTYP": "B"}),
    }


def otc_tables() -> dict[str, pd.DataFrame]:
    so, key = "0000000100", "1000000000100000010"
    return {
        "VBAK": df({"VBELN": so, "AUART": "TA", "VKORG": "1000", "VTWEG": "10", "SPART": "00"}),
        "VBAP": df({"VBELN": so, "POSNR": "000010", "ERDAT": "20260105", "ERZET": "093000", "ERNAM": "CSR1",
                    "PSTYV": "TAN", "WERKS": "1000"}),
        **cd(("VERKBELEG", so, "0000000011", "U", "20260105", "100000", "CSR1",
              [("VBAK", "100" + so, "LIFSK", "U", "01"), ("VBAK", "100" + so, "FAKSK", "U", "02"),
               ("VBAK", "100" + so, "BSTKD", "U", "PO-77"), ("VBAP", key, "NETWR", "U", "100.00"),
               ("VBEP", key + "0001", "EDATU", "U", "20260109"), ("VBAP", key, "KWMENG", "U", "5")]),
             ("VERKBELEG", so, "0000000012", "U", "20260105", "120000", "CRED1",
              [("VBAK", "100" + so, "LIFSK", "U", ""), ("VBAP", key, "ABGRU", "U", "")]),
             ("DEBI", "C1", "0000000021", "I", "20251201", "080000", "MD1", []),
             ("DEBI", "C1", "0000000022", "U", "20251203", "080000", "MD1",
              [("KNA1", "100C1", "NAME1", "U", "Acme"), ("KNB1", "100C11000", "AKONT", "U", "140000"),
               ("KNKK", "100C10001", "KLIMK", "U", "5000")])),
        "LIKP": df({"VBELN": "0080000001", "ERDAT": "20260106", "ERZET": "100000", "ERNAM": "WH1", "LFART": "LF",
                    "WADAT_IST": "20260107"}),
        "LIPS": df({"VBELN": "0080000001", "POSNR": "000010", "VGBEL": so, "VGPOS": "000010"}),
        "VBRK": df({"VBELN": "0090000001", "ERDAT": "20260108", "ERZET": "110000", "ERNAM": "BILL1", "FKART": "F2",
                    "BUKRS": "1000", "BELNR": "0100000001", "GJAHR": "2026", "FKSTO": "", "SFAKN": ""},
                   {"VBELN": "0090000002", "ERDAT": "20260109", "ERZET": "110000", "ERNAM": "BILL1", "FKART": "S1",
                    "BUKRS": "1000", "BELNR": "0100000002", "GJAHR": "2026", "FKSTO": "", "SFAKN": "0090000001"}),
        "VBRP": df({"VBELN": "0090000001", "POSNR": "000010", "AUBEL": so, "AUPOS": "000010"},
                   {"VBELN": "0090000002", "POSNR": "000010", "AUBEL": so, "AUPOS": "000010"}),
        "BSAD": df({"BUKRS": "1000", "BELNR": "0100000001", "GJAHR": "2026", "AUGDT": "20260201",
                    "AUGBL": "1400000001"}),
    }


def r2r_tables() -> dict[str, pd.DataFrame]:
    def doc(belnr, tcode, cpudt, bstat="", stblg="", user="GL1", blart="SA"):
        return {"BUKRS": "1000", "BELNR": belnr, "GJAHR": "2026", "BLART": blart, "BSTAT": bstat, "CPUDT": cpudt,
                "CPUTM": "090000", "USNAM": user, "TCODE": tcode, "STBLG": stblg, "STJAH": "2026" if stblg else "",
                "AWTYP": "BKPF"}
    return {
        "BKPF": df(doc("0100000010", "FB50", "20260110", stblg="0100000011"),
                   doc("0100000011", "FB08", "20260115", stblg="0100000010"),
                   doc("0100000012", "ABZON", "20260111", blart="AA"),
                   doc("0100000013", "AFAB", "20260131", user="BATCH", blart="AF"),
                   doc("0100000014", "FBV1", "20260112", bstat="V"),
                   {**doc("0100000015", "FB50", "20240101"), "GJAHR": "2024"}),
        "BSAS": df({"BUKRS": "1000", "BELNR": "0100000010", "GJAHR": "2026", "AUGDT": "20260120",
                    "AUGBL": "0100000099"}),
        **cd(("SACH", "0000400000", "0000000031", "I", "20251101", "080000", "FI1", []),
             ("SACH", "0000400000", "0000000032", "U", "20251102", "080000", "FI1",
              [("SKB1", "10010000000400000", "FSTAG", "U", "G001"), ("SKAT", "100E0000400000", "TXT50", "U", "x")]),
             ("ANLA", "100000001", "0000000041", "I", "20251101", "080000", "AA1", []),
             ("ANLA", "100000001", "0000000042", "U", "20251105", "080000", "AA1",
              [("ANLZ", "x", "KOSTL", "U", "1000"), ("ANLB", "y", "AFASL", "U", "LINA")]),
             ("KOSTL", "0001K1", "0000000051", "I", "20251101", "080000", "CO1", []),
             ("KOSTL", "0001K1", "0000000052", "U", "20251110", "080000", "CO1", [("CSKS", "k", "VERAK", "U", "z")]),
             ("KSTAR", "0001400000", "0000000061", "I", "20251101", "080000", "CO1", [])),
        "AUFK": df({"AUFNR": "000000700001", "AUTYP": "01", "AUART": "0100", "ERDAT": "20260201",
                    "ERFZEIT": "081500", "ERNAM": "CO1", "BUKRS": "1000"},
                   {"AUFNR": "000001000001", "AUTYP": "10", "AUART": "PP01", "ERDAT": "20260201",
                    "ERFZEIT": "081500", "ERNAM": "PP1", "BUKRS": "1000"}),
        "USR02": df({"BNAME": "BATCH", "USTYP": "B"}, {"BNAME": "GL1", "USTYP": "A"}),
    }


FIXTURES = {"PTP": ptp_tables, "OTC": otc_tables, "R2R": r2r_tables}


def run(l1: str, tables: dict[str, pd.DataFrame]):
    frames = MemoryFrames(tables)
    return collect(builders.builder(l1).build, frames, make_context(frames, "t1", "ecc", RUN))


def by(events, activity, case=None):
    return [e for e in events if e.activity == activity and (case is None or e.case_id == case)]


@pytest.mark.parametrize("l1", sorted(FIXTURES))
def test_every_mapping_row_fires(l1):
    fired = {e.activity for e in run(l1, FIXTURES[l1]())}
    expected = {m.key for m in builders.builder(l1).MAPPING if "<" not in m.key}
    assert expected <= fired, expected - fired


@pytest.mark.parametrize("l1", sorted(FIXTURES))
def test_rerun_and_row_order_are_deterministic(l1):
    first = run(l1, FIXTURES[l1]())
    shuffled = {k: v.sample(frac=1, random_state=random.Random(7).randint(0, 999)) for k, v in FIXTURES[l1]().items()}
    assert run(l1, FIXTURES[l1]()) == first
    assert run(l1, shuffled) == first


@pytest.mark.parametrize("l1", sorted(FIXTURES))
def test_seq_is_mapping_order_and_ids_exist(l1):
    doc = reference_document()
    l4_ids = {l4.id for l4 in doc.all_l4()}
    l5_ids = {a.id for l4 in doc.all_l4() for a in l4.activities}
    mod = builders.builder(l1)
    order = {m.key: m.order for m in mod.MAPPING}
    for e in run(l1, FIXTURES[l1]()):
        assert e.seq == order.get(e.activity, order.get("POST_<TCODE>")), e
        if "-DSC-" in e.l5_id:
            continue
        if "-X_" in e.l5_id:
            assert e.l5_id.split("-X_")[0] in l4_ids, e.l5_id
        else:
            assert e.l5_id in l5_ids, e.l5_id
    for m in mod.MAPPING:
        assert m.l5_id.startswith(l1 + "-")


def test_ptp_timestamps_resources_and_automation():
    ev = run("PTP", ptp_tables())
    (po,) = by(ev, "CREATE_PO_ITEM", "4500000001/00010")
    assert (po.ts, po.ts_precision, po.resource, po.automated) == (datetime(2026, 1, 5, tzinfo=JNB), "day",
                                                                   "BUYER1", False)
    assert dict(po.org) == {"BUKRS": "1000", "EKORG": "1000", "WERKS": "1000"} and po.doc_type == "NB"
    (gr,) = by(ev, "GOODS_RECEIPT", "4500000001/00010")
    assert (gr.ts, gr.ts_precision, gr.automated) == (datetime(2026, 1, 10, 10, 15, tzinfo=JNB), "second", True)
    (rev,) = by(ev, "REVERSE_GR")
    assert rev.ts_precision == "day"  # CPUTM 000000
    (rel,) = by(ev, "RELEASE_PR")
    assert rel.case_id == "4500000001/00010" and dict(rel.attributes)["FRGZU"] == "X"
    assert {e.case_id for e in by(ev, "RELEASE_PO")} == {"4500000001/00010", "4500000001/00020"}
    (inv,) = by(ev, "INVOICE_RECEIPT")
    assert inv.object_refs == (("RBKP", "5105600001/2026"), ("BKPF", "1000/5100000001/2026"))
    (pay,) = by(ev, "CLEAR_INVOICE")
    assert (pay.ts, pay.ts_precision) == (datetime(2026, 2, 1, tzinfo=JNB), "day")
    assert by(ev, "DELETE_PO_ITEM")[0].case_id == "4500000001/00020"
    assert {e.activity for e in ev if e.case_type == "vendor"} == {
        "CREATE_VENDOR", "CHANGE_VENDOR_GENERAL", "CHANGE_VENDOR_COMPANY", "CHANGE_VENDOR_BANK"}


def test_ptp_shared_goods_receipt_lands_in_both_cases_once():
    grs = by(run("PTP", ptp_tables()), "GOODS_RECEIPT")
    assert sorted(e.case_id for e in grs) == ["4500000001/00010", "4500000001/00020"]
    assert {e.object_refs for e in grs} == {(("MBLNR", "5000000001/2026"),)}


def test_otc_blocks_billing_and_cancellation():
    ev = run("OTC", otc_tables())
    case = "0000000100/000010"
    assert [dict(e.attributes)["LIFSK"] for e in by(ev, "SET_DELIVERY_BLOCK", case)] == ["01"]
    assert len(by(ev, "REMOVE_DELIVERY_BLOCK", case)) == 1
    (gi,) = by(ev, "GOODS_ISSUE", case)
    assert (gi.ts_precision, gi.object_refs) == ("day", (("LIPS", "0080000001/000010"),))
    (inv,) = by(ev, "CREATE_INVOICE", case)
    assert inv.object_refs == (("VBRP", "0090000001/000010"), ("BKPF", "1000/0100000001/2026"))
    assert dict(inv.org)["BUKRS"] == "1000" and "BUKRS" not in dict(by(ev, "CREATE_SO_ITEM")[0].org)
    (cancel,) = by(ev, "CANCEL_INVOICE", case)
    assert cancel.object_refs == (("VBRP", "0090000002/000010"),)
    (clr,) = by(ev, "CLEAR_PAYMENT", case)
    assert clr.object_refs[-1] == ("AUGBL", "1400000001")
    assert [e.activity for e in ev if e.case_id == case][0] == "CREATE_SO_ITEM"


def test_r2r_postings_reversal_window_and_master_data():
    ev = run("R2R", r2r_tables())
    assert by(ev, "POST_GL_DOC")[0].l5_id == "R2R-GL-FB50-01"
    (fb08,) = by(ev, "POST_FB08")
    assert fb08.l5_id == "R2R-DSC-POST_FB08-01" and fb08.case_id == "1000/0100000011/2026"
    (rev,) = by(ev, "REVERSE_DOC")
    assert rev.case_id == "1000/0100000010/2026" and rev.ts == datetime(2026, 1, 15, 9, tzinfo=JNB)
    assert by(ev, "POST_DEPRECIATION")[0].automated is True
    assert by(ev, "PARK_DOC")[0].case_id == "1000/0100000014/2026"
    assert not [e for e in ev if e.case_id.endswith("/2024")]  # before run_date - 365
    (aufk,) = by(ev, "CREATE_INTERNAL_ORDER")
    assert aufk.case_id == "000000700001" and aufk.case_type == "internal_order"
    assert {e.case_type for e in ev} == {"fi_doc", "gl_account", "asset", "cost_center", "cost_element",
                                         "internal_order"}


def test_r2r_window_from_overrides_default():
    frames = MemoryFrames(r2r_tables())
    ctx = BuildContext("t1", "ecc", RUN, window_from=date(2026, 1, 12))
    ev = collect(r2r.build, frames, ctx)
    assert {e.case_id for e in ev if e.case_type == "fi_doc"} == {
        "1000/0100000011/2026", "1000/0100000013/2026", "1000/0100000014/2026"}


def test_missing_tables_yield_no_events():
    for mod in (ptp, otc, r2r):
        assert collect(mod.build, MemoryFrames({}), BuildContext("t1", "ecc", RUN)) == []
```

- [ ] **Step 2: Run it (FAIL)**

Run: `pytest tests/process_discovery/test_builders_core.py -q`
Expected: FAIL, collection error `ModuleNotFoundError: No module named 'api.services.process_discovery'`.

- [ ] **Step 3: Create the package root**

`api/services/process_discovery/__init__.py`:

```python
"""Process discovery (spec docs/superpowers/specs/2026-10-11-process-discovery-design.md).

Event log builders, mining and L1-L5 generation. No LLM is called anywhere in this package.
"""

from __future__ import annotations

L1S: tuple[str, ...] = ("PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG", "SFX", "ARB", "CNQ")

# Spec §2.2: the first row per L1 is its primary case type (ARB: see the plan's gap list).
PRIMARY_CASE_TYPE: dict[str, str] = {
    "PTP": "po_item", "OTC": "so_item", "R2R": "fi_doc", "PP": "prod_order", "PM": "pm_order",
    "QM": "insp_lot", "PS": "wbs", "WH": "transfer_order", "HTR": "emp_event", "MDG": "change_request",
    "SFX": "requisition", "ARB": "requisition", "CNQ": "expense_report",
}

# Extraction module per L1 (sap/extraction_plan.py PROCESS_EVENT_MODULES / PROCESS_EVENT_CLOUD_MODULES).
MODULE_OF: dict[str, str] = {l1: f"process_events_{l1.lower()}" for l1 in L1S}

# Spec §8.2 / §1: the L1s a system type can discover.
L1S_BY_SYSTEM: dict[str, tuple[str, ...]] = {
    "ecc": L1S[:10], "s4hana_onprem": L1S[:10], "ewm": ("WH",),
    "successfactors": ("SFX",), "ariba": ("ARB",), "concur": ("CNQ",),
}


def primary_case_type(l1: str, system_type: str) -> str:
    """WH on EWM has warehouse tasks only, never transfer orders (spec §2.2, WH rows)."""
    if l1 == "WH" and system_type == "ewm":
        return "warehouse_task"
    return PRIMARY_CASE_TYPE[l1]
```

- [ ] **Step 4: Create the event primitives**

`api/services/process_discovery/events.py`:

```python
"""Event-log primitives shared by every L1 builder (spec §2.1-§2.3).

A builder reads extracted tables through ``Frames`` and yields ``EventRow``s. Rows carry no tenant,
system, L1 or run id; the worker (Task 27) adds those when it writes ``process_events``.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Iterable, Iterator, Mapping, Optional, Protocol, Sequence
from zoneinfo import ZoneInfo

import pandas as pd

DEFAULT_TZ = "Africa/Johannesburg"  # workers/celery_app.py:22
KEEP_VALUE_NEW = frozenset({"FRGZU", "FRGKE", "LIFSK", "FAKSK", "PRIOK"})  # spec §2.1 personal-data rule
_AUTOMATED_USTYP = frozenset({"B", "S"})
_HUMAN_USTYP = frozenset({"A", "C", "L"})
_KEY_RE = re.compile(r"[^A-Z0-9_]")
_OData_RE = re.compile(r"/Date\((-?\d+)")

Stamp = tuple[datetime, str]  # (ts, ts_precision) with ts_precision in {"second", "day"}
Pairs = tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class ActivityMap:
    """One row of a spec §2.3 mapping table."""
    key: str
    label: str
    l5_id: str
    case_type: str
    source: str
    condition: str
    ts: str
    order: int
    expected: bool


@dataclass(frozen=True)
class EventRow:
    """One ``process_events`` row without tenant/system/l1/run. Hashable, so identical rows collapse."""
    case_type: str
    case_id: str
    activity: str
    ts: datetime
    ts_precision: str
    source_table: str
    l5_id: Optional[str] = None
    seq: int = 0
    resource: Optional[str] = None
    automated: Optional[bool] = None
    doc_type: Optional[str] = None
    org: Pairs = ()
    object_refs: Pairs = ()
    attributes: Pairs = ()

    def as_row(self) -> dict[str, object]:
        return {
            "case_type": self.case_type, "case_id": self.case_id, "activity": self.activity,
            "l5_id": self.l5_id, "ts": self.ts, "ts_precision": self.ts_precision, "seq": self.seq,
            "resource": self.resource, "automated": self.automated, "doc_type": self.doc_type,
            "org": dict(self.org), "object_refs": [{"type": t, "id": i} for t, i in self.object_refs],
            "attributes": dict(self.attributes), "source_table": self.source_table,
        }


@dataclass(frozen=True)
class BuildContext:
    """Per-run inputs every builder needs. ``users`` is USR02 BNAME -> USTYP, None when USR02 was not read."""
    tenant_id: str
    system_type: str
    run_date: date
    tz: ZoneInfo = field(default_factory=lambda: ZoneInfo(DEFAULT_TZ))
    users: Optional[Mapping[str, str]] = None
    window_from: Optional[date] = None

    def automated(self, user: str) -> Optional[bool]:
        if self.users is None or not user:
            return None
        ustyp = self.users.get(user)
        return True if ustyp in _AUTOMATED_USTYP else False if ustyp in _HUMAN_USTYP else None

    def hash(self, value: str) -> str:
        """sha256(tenant id text || value), 32 hex chars (spec §2.1). Raw PERNR/userId never stored."""
        return hashlib.sha256((self.tenant_id + value).encode()).hexdigest()[:32]


# --- frame access -------------------------------------------------------------------------------------


class Frames(Protocol):
    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame: ...
    def has(self, table: str) -> bool: ...


def _project(df: pd.DataFrame, table: str, cols: Sequence[str]) -> pd.DataFrame:
    """Bare column names, exactly ``cols``, str values, stripped, '' for missing/NaN."""
    prefix = table + "."
    df = df.rename(columns=lambda c: c[len(prefix):] if str(c).startswith(prefix) else c)
    out = df.reindex(columns=list(cols)).astype(object).where(lambda x: x.notna(), "")
    for c in out.columns:
        out[c] = out[c].astype(str).str.strip()
    return out.reset_index(drop=True)


class MemoryFrames:
    """Frames over in-memory DataFrames (tests, and cloud frames already in memory)."""

    def __init__(self, tables: Mapping[str, pd.DataFrame]) -> None:
        self._tables = dict(tables)

    def has(self, table: str) -> bool:
        return table in self._tables

    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame:
        return _project(self._tables.get(table, pd.DataFrame()), table, cols)


class BundleFrames:
    """Frames over an extraction bundle prefix (``staging/<tenant>/<version>/``) in MinIO.

    ponytail: each get() decodes the whole projected table into pandas; switch to per-case-batch
    reads off ``iter_parquet_chunks`` if one L1's event tables outgrow worker RAM."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._cache: dict[tuple[str, tuple[str, ...]], pd.DataFrame] = {}

    def has(self, table: str) -> bool:
        from workers.dataset import _client, bundle_object

        try:
            _client().stat_object(os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads"),
                                  bundle_object(self.path, table))
            return True
        except Exception:  # noqa: BLE001 - any MinIO error means "not in the bundle"
            return False

    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame:
        key = (table, tuple(cols))
        if key not in self._cache:
            from workers.dataset import bundle_object, iter_parquet_chunks

            want = {f"{table}.{c}" for c in cols} | set(cols)
            try:
                parts = list(iter_parquet_chunks(bundle_object(self.path, table), keep=lambda c: c in want))
            except Exception:  # noqa: BLE001 - table absent from this bundle: no events from it
                parts = []
            raw = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
            self._cache[key] = _project(raw, table, cols)
        return self._cache[key]


def make_context(frames: Frames, tenant_id: str, system_type: str, run_date: date,
                 tz_name: Optional[str] = None, window_from: Optional[date] = None) -> BuildContext:
    users = None
    if frames.has("USR02"):
        u = frames.get("USR02", ["BNAME", "USTYP"])
        users = dict(zip(u["BNAME"], u["USTYP"]))
    return BuildContext(tenant_id=tenant_id, system_type=system_type, run_date=run_date,
                        tz=ZoneInfo(tz_name or DEFAULT_TZ), users=users, window_from=window_from)


# --- values and timestamps ----------------------------------------------------------------------------


def sap_date(v: str) -> Optional[date]:
    v = v.strip().replace("-", "")
    if len(v) != 8 or not v.isdigit() or v == "00000000":
        return None
    try:
        return date(int(v[:4]), int(v[4:6]), int(v[6:]))
    except ValueError:
        return None


def sap_ts(ctx: BuildContext, d: str, t: str = "") -> Optional[Stamp]:
    """SAP DATS (+TIMS) in the system timezone. No time, or 000000, is day precision (spec §2.1 rule 4)."""
    day = sap_date(d)
    if day is None:
        return None
    t = t.strip().replace(":", "")
    if len(t) == 6 and t.isdigit() and t != "000000":
        try:
            return datetime.combine(day, time(int(t[:2]), int(t[2:4]), int(t[4:])), ctx.tz), "second"
        except ValueError:
            pass
    return datetime.combine(day, time(0), ctx.tz), "day"


def sap_day(ctx: BuildContext, d: str) -> Optional[Stamp]:
    return sap_ts(ctx, d, "")


def first(*stamps: Optional[Stamp]) -> Optional[Stamp]:
    """Timestamp precedence (spec §2.1): the first source that has a value wins."""
    return next((s for s in stamps if s is not None), None)


def dec15_ts(v: str) -> Optional[Stamp]:
    """SAP DEC15 UTC timestamp YYYYMMDDhhmmss (USMD*, /SCWM/ORDIM_C)."""
    digits = v.strip().split(".")[0].split(",")[0]
    if len(digits) != 14 or not digits.isdigit() or set(digits) == {"0"}:
        return None
    try:
        return datetime.strptime(digits, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc), "second"
    except ValueError:
        return None


def iso_ts(ctx: BuildContext, v: str, day: bool = False) -> Optional[Stamp]:
    """Cloud dates: OData ``/Date(ms)/``, ISO date or ISO datetime (naive = UTC). ``day`` forces day precision."""
    v = v.strip()
    if not v:
        return None
    m = _OData_RE.match(v)
    try:
        if m:
            dt = datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
        elif len(v) == 10:
            return datetime.combine(date.fromisoformat(v), time(0), ctx.tz), "day"
        else:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    if day:
        return datetime.combine(dt.astimezone(timezone.utc).date(), time(0), ctx.tz), "day"
    return dt, "second"


def norm_key(v: str, n: int = 24) -> str:
    """Upper-case, non [A-Z0-9_] to '_', truncated (spec §2.3 <STATUS>; keeps ProcessModel ID_PATTERN valid)."""
    return _KEY_RE.sub("_", v.strip().upper())[:n]


def dyn(m: ActivityMap, key: str, label: str, l5_id: str) -> ActivityMap:
    """Runtime mapping row for a templated activity (POST_<TCODE>, STATUS_<STAT>, APPLICATION_<STATUS>)."""
    return replace(m, key=key, label=label, l5_id=l5_id)


def _pairs(d: Optional[Mapping[str, str]]) -> Pairs:
    return tuple(sorted((k, v) for k, v in (d or {}).items() if v))


def event(ctx: BuildContext, m: ActivityMap, case_id: str, when: Optional[Stamp], table: str, *,
          user: str = "", hashed: bool = False, doc_type: str = "", org: Optional[Mapping[str, str]] = None,
          refs: Iterable[tuple[str, str]] = (), attrs: Optional[Mapping[str, str]] = None) -> Optional[EventRow]:
    """Build one event, or None when the source has no usable timestamp.

    ``seq`` is the mapping's Order for every event: day-precision events sort in template order inside a
    day (spec §2.1), and same-second events get the same deterministic tiebreak. ``automated`` is
    computed from the raw user before ``hashed`` replaces it (HTR, SFX)."""
    if when is None or not case_id:
        return None
    resource = (ctx.hash(user) if hashed else user[:64]) if user else None
    return EventRow(
        case_type=m.case_type, case_id=case_id[:160], activity=m.key[:64], l5_id=m.l5_id[:120],
        ts=when[0], ts_precision=when[1], seq=m.order, resource=resource,
        automated=None if hashed and ctx.system_type in _CLOUD else ctx.automated(user),
        doc_type=doc_type[:16] or None, org=_pairs(org),
        object_refs=tuple(dict.fromkeys((t, i) for t, i in refs if i.strip("/"))), attributes=_pairs(attrs),
        source_table=table[:40],
    )


_CLOUD = frozenset({"successfactors", "ariba", "concur"})


def collect(build: Callable[[Frames, BuildContext], Iterable[Optional[EventRow]]], frames: Frames,
            ctx: BuildContext) -> list[EventRow]:
    """Distinct events in a total order: (case_type, case_id, ts, seq, activity, ...). Same input, same list."""
    rows = {e for e in build(frames, ctx) if e is not None}
    return sorted(rows, key=lambda e: (e.case_type, e.case_id, e.ts, e.seq, e.activity, e.source_table,
                                       e.resource or "", e.object_refs, e.attributes))


# --- change documents -----------------------------------------------------------------------------------

CDHDR_COLS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "UTIME", "TCODE", "CHANGE_IND"]
CDPOS_COLS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND", "VALUE_NEW"]


def cd_headers(frames: Frames, classes: Iterable[str]) -> pd.DataFrame:
    h = frames.get("CDHDR", CDHDR_COLS)
    return h[h["OBJECTCLAS"].isin(set(classes))]


def cd_changes(frames: Frames, classes: Iterable[str], *, updates_only: bool = True) -> pd.DataFrame:
    """CDPOS joined to its CDHDR on (OBJECTCLAS, OBJECTID, CHANGENR).

    The inner join keeps only CDPOS rows whose change number is in the CDHDR window (CDPOS is read by
    OBJECTID IN-list, Task 19). ``updates_only`` drops the create change document (CHANGE_IND 'I'):
    its KEY/field rows are the create activity, not field changes."""
    h = cd_headers(frames, classes)
    if updates_only:
        h = h[h["CHANGE_IND"] != "I"]
    p = frames.get("CDPOS", CDPOS_COLS)
    return h.merge(p, on=["OBJECTCLAS", "OBJECTID", "CHANGENR"], how="inner")


def cd_stamp(ctx: BuildContext, r: Mapping[str, str]) -> Optional[Stamp]:
    return sap_ts(ctx, r["UDATE"], r["UTIME"])


def value_attr(r: Mapping[str, str]) -> dict[str, str]:
    """CDPOS VALUE_NEW only for the whitelisted fields (spec §2.1)."""
    return {r["FNAME"]: r["VALUE_NEW"]} if r["FNAME"] in KEEP_VALUE_NEW else {}


def rows(df: pd.DataFrame) -> Iterator[dict[str, str]]:
    return iter(df.to_dict("records"))  # type: ignore[arg-type]


def master_data_events(frames: Frames, ctx: BuildContext, cls: str, create: ActivityMap,
                       changes: Sequence[tuple[ActivityMap, str, str]]) -> Iterator[Optional[EventRow]]:
    """Master-data stream keyed by CDHDR OBJECTID (KRED, DEBI, SACH, ANLA, KOSTL, KSTAR, STUE, EQUI).

    ``changes`` rows are (mapping, TABNAME or '' for any, CHNGIND or '' for any)."""
    for r in rows(cd_headers(frames, [cls])):
        if r["CHANGE_IND"] == "I":
            yield event(ctx, create, r["OBJECTID"], cd_stamp(ctx, r), "CDHDR", user=r["USERNAME"])
    if not changes:
        return
    for r in rows(cd_changes(frames, [cls])):
        for m, tab, ind in changes:
            if (not tab or r["TABNAME"] == tab) and (not ind or r["CHNGIND"] == ind):
                yield event(ctx, m, r["OBJECTID"], cd_stamp(ctx, r), "CDPOS", user=r["USERNAME"])
```

- [ ] **Step 5: Create the builder registry**

`api/services/process_discovery/builders/__init__.py`:

```python
"""One builder module per L1 (spec §2.3). Each exposes ``MAPPING`` and ``build(frames, ctx)``."""

from __future__ import annotations

from importlib import import_module
from types import ModuleType

from api.services.process_discovery import L1S


def builder(l1: str) -> ModuleType:
    if l1 not in L1S:
        raise KeyError(l1)
    return import_module(f"{__name__}.{l1.lower()}")
```

The registry imports modules that Tasks 22 and 23 create. Until then, `builder("PP")` raises `ModuleNotFoundError`, and nothing calls it.

- [ ] **Step 6: Create the PTP builder**

`api/services/process_discovery/builders/ptp.py`:

```python
"""PTP event builder (spec §2.2, §2.3 PTP). Case ``po_item`` = EBELN/EBELP, case ``vendor`` = LIFNR."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_day, sap_ts, value_attr,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_PR", "Create purchase requisition", "PTP-PR-ME51N-01", "po_item", "EBAN.BANFN EBAN.BNFPO EBAN.ERDAT",
      "EBAN row linked by EKPO.BANFN/BNFPO", "EBAN.ERDAT", 1, False),
    A("RELEASE_PR", "Release purchase requisition", "PTP-PR-ME51N-X_RELEASE_PR", "po_item", "CDPOS.FNAME",
      "CDPOS class BANF, FNAME='FRGZU'", "CDHDR.UDATE CDHDR.UTIME", 2, False),
    A("CREATE_PO_ITEM", "Create purchase order item", "PTP-PO-ME21N-02", "po_item", "EKKO.EBELN EKPO.EBELP EKKO.AEDAT",
      "EKKO row", "EKKO.AEDAT", 3, True),
    A("CHANGE_PO_HEADER", "Change purchase order header", "PTP-PO-ME21N-01", "po_item", "CDPOS.TABNAME CDPOS.FNAME",
      "CDPOS class EINKBELEG, TABNAME='EKKO', FNAME<>'FRGZU', CHNGIND='U'", "CDHDR.UDATE CDHDR.UTIME", 4, False),
    A("CHANGE_PO_QTY", "Change order quantity", "PTP-PO-ME21N-X_CHANGE_QTY", "po_item", "EKPO.MENGE",
      "CDPOS class EINKBELEG, TABNAME='EKPO', FNAME='MENGE'", "CDHDR.UDATE CDHDR.UTIME", 5, False),
    A("CHANGE_PO_PRICE", "Change net price", "PTP-PO-ME21N-X_CHANGE_PRICE", "po_item", "EKPO.NETPR",
      "CDPOS class EINKBELEG, TABNAME='EKPO', FNAME='NETPR'", "CDHDR.UDATE CDHDR.UTIME", 6, False),
    A("CHANGE_PO_DATE", "Change delivery date", "PTP-PO-ME21N-X_CHANGE_DATE", "po_item", "EKET.EINDT",
      "CDPOS class EINKBELEG, TABNAME='EKET', FNAME='EINDT'", "CDHDR.UDATE CDHDR.UTIME", 7, False),
    A("RELEASE_PO", "Release purchase order", "PTP-REL-ME29N-01", "po_item", "EKKO.FRGZU",
      "CDPOS class EINKBELEG, TABNAME='EKKO', FNAME='FRGZU'", "CDHDR.UDATE CDHDR.UTIME", 8, False),
    A("GOODS_RECEIPT", "Post goods receipt", "PTP-GR-MIGO-01", "po_item", "EKBE.VGABE EKBE.SHKZG EKBE.BELNR",
      "EKBE VGABE='1', SHKZG='S'", "EKBE.CPUDT EKBE.CPUTM", 9, True),
    A("REVERSE_GR", "Reverse goods receipt", "PTP-GR-MIGO-X_REVERSE_GR", "po_item", "EKBE.VGABE EKBE.SHKZG",
      "EKBE VGABE='1', SHKZG='H'", "EKBE.CPUDT EKBE.CPUTM", 10, False),
    A("INVOICE_RECEIPT", "Post invoice receipt", "PTP-IV-MIRO-01", "po_item", "EKBE.VGABE EKBE.SHKZG RBKP.USNAM",
      "EKBE VGABE='2', SHKZG='S'", "EKBE.CPUDT EKBE.CPUTM", 11, True),
    A("INVOICE_BLOCKED", "Invoice blocked for payment", "PTP-IV-MIRO-X_PAYMENT_BLOCK", "po_item", "RBKP.ZLSPR",
      "RBKP ZLSPR<>'' for the EKBE invoice", "RBKP.CPUDT RBKP.CPUTM", 12, False),
    A("REVERSE_INVOICE", "Reverse invoice", "PTP-IV-MIRO-X_REVERSE_INVOICE", "po_item", "EKBE.VGABE EKBE.SHKZG",
      "EKBE VGABE='2', SHKZG='H'", "EKBE.CPUDT EKBE.CPUTM", 13, False),
    A("CLEAR_INVOICE", "Pay invoice (clearing)", "PTP-PAY-F110-01", "po_item", "BKPF.AWKEY BSAK.AUGDT BSAK.AUGBL",
      "BSAK for the BKPF doc with AWKEY = RBKP.BELNR || RBKP.GJAHR", "BSAK.AUGDT", 14, True),
    A("DELETE_PO_ITEM", "Delete purchase order item", "PTP-PO-ME21N-X_DELETE_ITEM", "po_item", "EKPO.LOEKZ",
      "CDPOS class EINKBELEG, TABNAME='EKPO', FNAME='LOEKZ'", "CDHDR.UDATE CDHDR.UTIME", 15, False),
    A("CREATE_VENDOR", "Create vendor", "PTP-VM-FK01-01", "vendor", "CDHDR.OBJECTID",
      "CDHDR class KRED, CHANGE_IND='I'", "CDHDR.UDATE CDHDR.UTIME", 1, True),
    A("CHANGE_VENDOR_GENERAL", "Change vendor general data", "PTP-VM-FK01-02", "vendor", "LFA1",
      "CDPOS class KRED, TABNAME='LFA1', CHNGIND='U'", "CDHDR.UDATE CDHDR.UTIME", 2, False),
    A("CHANGE_VENDOR_COMPANY", "Change vendor company code data", "PTP-VM-FK01-03", "vendor", "LFB1",
      "CDPOS class KRED, TABNAME='LFB1'", "CDHDR.UDATE CDHDR.UTIME", 3, False),
    A("CHANGE_VENDOR_BANK", "Change vendor bank details", "PTP-VM-FK01-04", "vendor", "LFBK",
      "CDPOS class KRED, TABNAME='LFBK'", "CDHDR.UDATE CDHDR.UTIME", 4, False),
)
M = {m.key: m for m in MAPPING}
_EKPO_FIELD = {"MENGE": "CHANGE_PO_QTY", "NETPR": "CHANGE_PO_PRICE", "LOEKZ": "DELETE_PO_ITEM"}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    ekko = frames.get("EKKO", ["EBELN", "AEDAT", "ERNAM", "BSART", "BUKRS", "EKORG", "LIFNR"])
    ekpo = frames.get("EKPO", ["EBELN", "EBELP", "BANFN", "BNFPO", "WERKS"])
    items = ekpo.merge(ekko, on="EBELN", how="inner")
    head: dict[str, dict[str, str]] = {}
    by_po: dict[str, list[str]] = defaultdict(list)
    by_pr: dict[tuple[str, str], list[str]] = defaultdict(list)
    for r in rows(items):
        case = f"{r['EBELN']}/{r['EBELP']}"
        head[case] = r
        by_po[r["EBELN"]].append(case)
        if r["BANFN"]:
            by_pr[(r["BANFN"], r["BNFPO"])].append(case)

    def ev(key: str, case: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = head[case]
        return event(ctx, M[key], case, when, table, user=user, doc_type=h["BSART"],
                     org={"BUKRS": h["BUKRS"], "EKORG": h["EKORG"], "WERKS": h["WERKS"]},
                     refs=refs, attrs={"BSART": h["BSART"], **(attrs or {})})

    for case, h in head.items():
        yield ev("CREATE_PO_ITEM", case, sap_day(ctx, h["AEDAT"]), "EKKO", h["ERNAM"])

    eban = frames.get("EBAN", ["BANFN", "BNFPO", "ERDAT", "ERNAM"])
    for r in rows(eban):
        for case in by_pr.get((r["BANFN"], r["BNFPO"]), []):
            yield ev("CREATE_PR", case, sap_day(ctx, r["ERDAT"]), "EBAN", r["ERNAM"],
                     refs=[("BANFN", f"{r['BANFN']}/{r['BNFPO']}")])

    # Change documents. TABKEY = MANDT(3) + key fields; header rows fan out to every item of the PO.
    for r in rows(cd_changes(frames, ["BANF"])):
        if r["FNAME"] == "FRGZU" and r["TABNAME"] == "EBAN":
            pr = (r["TABKEY"][3:13], r["TABKEY"][13:18])
            for case in by_pr.get(pr, []):
                yield ev("RELEASE_PR", case, cd_stamp(ctx, r), "CDPOS", r["USERNAME"],
                         refs=[("BANFN", f"{pr[0]}/{pr[1]}")], attrs=value_attr(r))
    for r in rows(cd_changes(frames, ["EINKBELEG"])):
        when, tab, fname = cd_stamp(ctx, r), r["TABNAME"], r["FNAME"]
        if tab == "EKKO":
            key = "RELEASE_PO" if fname == "FRGZU" else "CHANGE_PO_HEADER" if r["CHNGIND"] == "U" else ""
            for case in by_po.get(r["OBJECTID"], []) if key else []:
                yield ev(key, case, when, "CDPOS", r["USERNAME"], attrs=value_attr(r))
        elif tab == "EKPO" and fname in _EKPO_FIELD:
            case = f"{r['TABKEY'][3:13]}/{r['TABKEY'][13:18]}"
            if case in head:
                yield ev(_EKPO_FIELD[fname], case, when, "CDPOS", r["USERNAME"])
        elif tab == "EKET" and fname == "EINDT":
            case = f"{r['TABKEY'][3:13]}/{r['TABKEY'][13:18]}"
            if case in head:
                yield ev("CHANGE_PO_DATE", case, when, "CDPOS", r["USERNAME"])

    # History: one row per (item, event type, document); EKBE repeats account-assignment lines.
    ekbe = frames.get("EKBE", ["EBELN", "EBELP", "VGABE", "GJAHR", "BELNR", "BWART", "SHKZG", "CPUDT", "CPUTM",
                               "ERNAM"]).drop_duplicates(["EBELN", "EBELP", "VGABE", "GJAHR", "BELNR"])
    rbkp = {(r["BELNR"], r["GJAHR"]): r for r in rows(frames.get(
        "RBKP", ["BELNR", "GJAHR", "CPUDT", "CPUTM", "USNAM", "ZLSPR", "RBSTAT"]))}
    bkpf = frames.get("BKPF", ["BUKRS", "BELNR", "GJAHR", "AWTYP", "AWKEY"])
    fi_of = {r["AWKEY"]: r for r in rows(bkpf[bkpf["AWTYP"] == "RMRP"])}
    clearing: dict[tuple[str, str, str], dict[str, str]] = {}
    for r in rows(frames.get("BSAK", ["BUKRS", "BELNR", "GJAHR", "AUGDT", "AUGBL"])):
        clearing.setdefault((r["BUKRS"], r["BELNR"], r["GJAHR"]), r)
    for r in rows(ekbe):
        case = f"{r['EBELN']}/{r['EBELP']}"
        if case not in head or r["VGABE"] not in ("1", "2") or r["SHKZG"] not in ("S", "H"):
            continue
        when, doc = sap_ts(ctx, r["CPUDT"], r["CPUTM"]), f"{r['BELNR']}/{r['GJAHR']}"
        if r["VGABE"] == "1":
            key = "GOODS_RECEIPT" if r["SHKZG"] == "S" else "REVERSE_GR"
            yield ev(key, case, when, "EKBE", r["ERNAM"], refs=[("MBLNR", doc)], attrs={"BWART": r["BWART"]})
            continue
        inv = rbkp.get((r["BELNR"], r["GJAHR"]))
        user = inv["USNAM"] if inv else r["ERNAM"]
        if r["SHKZG"] == "H":
            yield ev("REVERSE_INVOICE", case, when, "EKBE", user, refs=[("RBKP", doc)])
            continue
        fi = fi_of.get(r["BELNR"] + r["GJAHR"])
        fi_ref = [("BKPF", f"{fi['BUKRS']}/{fi['BELNR']}/{fi['GJAHR']}")] if fi else []
        yield ev("INVOICE_RECEIPT", case, when, "EKBE", user, refs=[("RBKP", doc), *fi_ref],
                 attrs={"RBSTAT": inv["RBSTAT"]} if inv else None)
        if inv and inv["ZLSPR"]:
            yield ev("INVOICE_BLOCKED", case, sap_ts(ctx, inv["CPUDT"], inv["CPUTM"]), "RBKP", inv["USNAM"],
                     refs=[("RBKP", doc)], attrs={"ZLSPR": inv["ZLSPR"]})
        clr = clearing.get((fi["BUKRS"], fi["BELNR"], fi["GJAHR"])) if fi else None
        if clr:
            yield ev("CLEAR_INVOICE", case, sap_day(ctx, clr["AUGDT"]), "BSAK",
                     refs=[*fi_ref, ("AUGBL", clr["AUGBL"])])

    yield from master_data_events(frames, ctx, "KRED", M["CREATE_VENDOR"], [
        (M["CHANGE_VENDOR_GENERAL"], "LFA1", "U"), (M["CHANGE_VENDOR_COMPANY"], "LFB1", ""),
        (M["CHANGE_VENDOR_BANK"], "LFBK", ""),
    ])
```

- [ ] **Step 7: Create the OTC builder**

`api/services/process_discovery/builders/otc.py`:

```python
"""OTC event builder (spec §2.2, §2.3 OTC). Case ``so_item`` = VBELN/POSNR, case ``customer`` = KUNNR."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_day, sap_ts, value_attr,
)

A = ActivityMap
_CD = "CDHDR.UDATE CDHDR.UTIME"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_SO_ITEM", "Create sales order item", "OTC-SO-VA01-02", "so_item", "VBAP.VBELN VBAP.POSNR VBAP.ERDAT",
      "VBAP row", "VBAP.ERDAT VBAP.ERZET", 1, True),
    A("CHANGE_SO_HEADER", "Change sales order header", "OTC-SO-VA01-01", "so_item", "CDPOS.TABNAME CDPOS.FNAME",
      "CDPOS class VERKBELEG, TABNAME='VBAK', FNAME not in (LIFSK, FAKSK)", _CD, 2, False),
    A("CHANGE_PRICE", "Change item price", "OTC-SO-VA01-03", "so_item", "VBAP.NETWR",
      "CDPOS class VERKBELEG, TABNAME='VBAP', FNAME='NETWR'", _CD, 3, False),
    A("CHANGE_SCHEDULE", "Change requested delivery date", "OTC-SO-VA01-04", "so_item", "VBEP.EDATU",
      "CDPOS class VERKBELEG, TABNAME='VBEP', FNAME='EDATU'", _CD, 4, False),
    A("CHANGE_QTY", "Change order quantity", "OTC-SO-VA01-X_CHANGE_QTY", "so_item", "VBAP.KWMENG",
      "CDPOS class VERKBELEG, TABNAME='VBAP', FNAME='KWMENG'", _CD, 5, False),
    A("SET_DELIVERY_BLOCK", "Set delivery block", "OTC-DEL-VL01N-02", "so_item", "VBAK.LIFSK",
      "CDPOS class VERKBELEG, FNAME='LIFSK', value set", _CD, 6, False),
    A("REMOVE_DELIVERY_BLOCK", "Remove delivery block", "OTC-DEL-VL01N-X_REMOVE_BLOCK", "so_item", "VBAK.LIFSK",
      "CDPOS class VERKBELEG, FNAME='LIFSK', value cleared", _CD, 7, False),
    A("SET_BILLING_BLOCK", "Set billing block", "OTC-BIL-VF01-X_BILLING_BLOCK", "so_item", "VBAK.FAKSK",
      "CDPOS class VERKBELEG, FNAME='FAKSK', value set", _CD, 8, False),
    A("CREATE_DELIVERY", "Create delivery", "OTC-DEL-VL01N-01", "so_item", "LIPS.VGBEL LIPS.VGPOS LIKP.ERDAT",
      "LIPS with VGBEL/VGPOS = case", "LIKP.ERDAT LIKP.ERZET", 9, True),
    A("GOODS_ISSUE", "Post goods issue", "OTC-DEL-VL01N-X_GOODS_ISSUE", "so_item", "LIKP.WADAT_IST",
      "LIKP WADAT_IST<>'' for that delivery", "LIKP.WADAT_IST", 10, True),
    A("CREATE_INVOICE", "Create billing document", "OTC-BIL-VF01-01", "so_item", "VBRP.AUBEL VBRP.AUPOS VBRK.FKART",
      "VBRP with AUBEL/AUPOS = case, VBRK FKSTO='', SFAKN=''", "VBRK.ERDAT VBRK.ERZET", 11, True),
    A("CANCEL_INVOICE", "Cancel billing document", "OTC-BIL-VF01-X_CANCEL", "so_item", "VBRK.SFAKN",
      "VBRP for the case where VBRK SFAKN<>''", "VBRK.ERDAT VBRK.ERZET", 12, False),
    A("CLEAR_PAYMENT", "Receive payment (clearing)", "OTC-DUN-F150-X_CLEAR_PAYMENT", "so_item",
      "BSAD.AUGDT BSAD.AUGBL", "BSAD on VBRK.BUKRS/BELNR/GJAHR", "BSAD.AUGDT", 13, True),
    A("REJECT_ITEM", "Reject item", "OTC-SO-VA01-X_REJECT", "so_item", "VBAP.ABGRU",
      "CDPOS class VERKBELEG, TABNAME='VBAP', FNAME='ABGRU'", _CD, 14, False),
    A("CREATE_CUSTOMER", "Create customer", "OTC-CM-FD01-01", "customer", "CDHDR.OBJECTID",
      "CDHDR class DEBI, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_CUSTOMER_GENERAL", "Change customer general data", "OTC-CM-FD01-02", "customer", "KNA1",
      "CDPOS class DEBI, TABNAME='KNA1', CHNGIND='U'", _CD, 2, False),
    A("CHANGE_CUSTOMER_COMPANY", "Change customer company code data", "OTC-CM-FD01-03", "customer", "KNB1",
      "CDPOS class DEBI, TABNAME='KNB1'", _CD, 3, False),
    A("CHANGE_CREDIT_LIMIT", "Change credit data", "OTC-CM-FD01-04", "customer", "KNKK",
      "CDPOS class DEBI, TABNAME='KNKK'", _CD, 4, False),
)
M = {m.key: m for m in MAPPING}
_VBAP_FIELD = {"NETWR": "CHANGE_PRICE", "KWMENG": "CHANGE_QTY", "ABGRU": "REJECT_ITEM"}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    vbak = frames.get("VBAK", ["VBELN", "AUART", "VKORG", "VTWEG", "SPART"])
    vbap = frames.get("VBAP", ["VBELN", "POSNR", "ERDAT", "ERZET", "ERNAM", "PSTYV", "WERKS"])
    head: dict[str, dict[str, str]] = {}
    by_so: dict[str, list[str]] = defaultdict(list)
    for r in rows(vbap.merge(vbak, on="VBELN", how="inner")):
        case = f"{r['VBELN']}/{r['POSNR']}"
        head[case] = r
        by_so[r["VBELN"]].append(case)

    def ev(key: str, case: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None,
           bukrs: str = "") -> Optional[EventRow]:
        h = head[case]
        return event(ctx, M[key], case, when, table, user=user, doc_type=h["AUART"],
                     org={"VKORG": h["VKORG"], "VTWEG": h["VTWEG"], "SPART": h["SPART"], "WERKS": h["WERKS"],
                          "BUKRS": bukrs},
                     refs=refs, attrs={"AUART": h["AUART"], "PSTYV": h["PSTYV"], **(attrs or {})})

    for case, h in head.items():
        yield ev("CREATE_SO_ITEM", case, sap_ts(ctx, h["ERDAT"], h["ERZET"]), "VBAP", h["ERNAM"])

    for r in rows(cd_changes(frames, ["VERKBELEG"])):
        when, tab, fname = cd_stamp(ctx, r), r["TABNAME"], r["FNAME"]
        if fname in ("LIFSK", "FAKSK"):
            key = ("SET_DELIVERY_BLOCK" if r["VALUE_NEW"] else "REMOVE_DELIVERY_BLOCK") if fname == "LIFSK" \
                else ("SET_BILLING_BLOCK" if r["VALUE_NEW"] else "")
            for case in by_so.get(r["OBJECTID"], []) if key else []:
                yield ev(key, case, when, "CDPOS", r["USERNAME"], attrs=value_attr(r))
        elif tab == "VBAK" and r["CHNGIND"] == "U":
            for case in by_so.get(r["OBJECTID"], []):
                yield ev("CHANGE_SO_HEADER", case, when, "CDPOS", r["USERNAME"])
        elif (tab == "VBAP" and fname in _VBAP_FIELD) or (tab == "VBEP" and fname == "EDATU"):
            case = f"{r['TABKEY'][3:13]}/{r['TABKEY'][13:19]}"
            if case in head:
                yield ev(_VBAP_FIELD.get(fname, "CHANGE_SCHEDULE"), case, when, "CDPOS", r["USERNAME"])

    likp = {r["VBELN"]: r for r in rows(frames.get("LIKP", ["VBELN", "ERDAT", "ERZET", "ERNAM", "LFART",
                                                            "WADAT_IST"]))}
    for r in rows(frames.get("LIPS", ["VBELN", "POSNR", "VGBEL", "VGPOS"])):
        case, d = f"{r['VGBEL']}/{r['VGPOS']}", likp.get(r["VBELN"])
        if case not in head or d is None:
            continue
        ref, attrs = [("LIPS", f"{r['VBELN']}/{r['POSNR']}")], {"LFART": d["LFART"]}
        yield ev("CREATE_DELIVERY", case, sap_ts(ctx, d["ERDAT"], d["ERZET"]), "LIKP", d["ERNAM"], ref, attrs)
        if d["WADAT_IST"]:
            yield ev("GOODS_ISSUE", case, sap_day(ctx, d["WADAT_IST"]), "LIKP", refs=ref, attrs=attrs)

    vbrk = {r["VBELN"]: r for r in rows(frames.get(
        "VBRK", ["VBELN", "ERDAT", "ERZET", "ERNAM", "FKART", "BUKRS", "BELNR", "GJAHR", "FKSTO", "SFAKN"]))}
    clearing: dict[tuple[str, str, str], dict[str, str]] = {}
    for r in rows(frames.get("BSAD", ["BUKRS", "BELNR", "GJAHR", "AUGDT", "AUGBL"])):
        clearing.setdefault((r["BUKRS"], r["BELNR"], r["GJAHR"]), r)
    for r in rows(frames.get("VBRP", ["VBELN", "POSNR", "AUBEL", "AUPOS"])):
        case, b = f"{r['AUBEL']}/{r['AUPOS']}", vbrk.get(r["VBELN"])
        if case not in head or b is None:
            continue
        when, ref, attrs = sap_ts(ctx, b["ERDAT"], b["ERZET"]), [("VBRP", f"{r['VBELN']}/{r['POSNR']}")], \
            {"FKART": b["FKART"]}
        if b["SFAKN"]:
            yield ev("CANCEL_INVOICE", case, when, "VBRK", b["ERNAM"], ref, attrs, b["BUKRS"])
        elif not b["FKSTO"]:
            fi = [("BKPF", f"{b['BUKRS']}/{b['BELNR']}/{b['GJAHR']}")] if b["BELNR"] else []
            yield ev("CREATE_INVOICE", case, when, "VBRK", b["ERNAM"], [*ref, *fi], attrs, b["BUKRS"])
            clr = clearing.get((b["BUKRS"], b["BELNR"], b["GJAHR"])) if b["BELNR"] else None
            if clr:
                yield ev("CLEAR_PAYMENT", case, sap_day(ctx, clr["AUGDT"]), "BSAD",
                         refs=[*fi, ("AUGBL", clr["AUGBL"])], bukrs=b["BUKRS"])

    yield from master_data_events(frames, ctx, "DEBI", M["CREATE_CUSTOMER"], [
        (M["CHANGE_CUSTOMER_GENERAL"], "KNA1", "U"), (M["CHANGE_CUSTOMER_COMPANY"], "KNB1", ""),
        (M["CHANGE_CREDIT_LIMIT"], "KNKK", ""),
    ])
```

- [ ] **Step 8: Create the R2R builder**

`api/services/process_discovery/builders/r2r.py`:

```python
"""R2R event builder (spec §2.2, §2.3 R2R). Case ``fi_doc`` = BUKRS/BELNR/GJAHR plus master-data streams."""

from __future__ import annotations

from datetime import timedelta
from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dyn, event, master_data_events, norm_key, rows, sap_date, sap_day,
    sap_ts,
)

A = ActivityMap
_CD = "CDHDR.UDATE CDHDR.UTIME"
_TS = "BKPF.CPUDT BKPF.CPUTM"
MAPPING: tuple[ActivityMap, ...] = (
    A("POST_GL_DOC", "Post G/L document", "R2R-GL-FB50-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', TCODE IN ('FB50','FB01','FB01L','FBS1','F-02','FB50L')", _TS, 1, True),
    A("POST_ASSET_ACQ", "Post asset acquisition", "R2R-AA-ABZON-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', TCODE IN ('ABZON','ABZO','F-90','AB01')", _TS, 1, True),
    A("POST_DEPRECIATION", "Post depreciation", "R2R-AA-AFAB-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', TCODE IN ('AFAB','AFABN')", _TS, 1, True),
    A("POST_<TCODE>", "Post document via <TCODE>", "R2R-DSC-POST_<TCODE>-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', any other TCODE", _TS, 1, True),
    A("PARK_DOC", "Park document", "R2R-GL-FB50-X_PARK", "fi_doc", "BKPF.BSTAT", "BKPF BSTAT='V'", _TS, 2, False),
    A("REVERSE_DOC", "Reverse document", "R2R-GL-FB50-X_REVERSE", "fi_doc", "BKPF.STBLG BKPF.STJAH",
      "BKPF STBLG<>''; ts of the reversal document STBLG/STJAH", _TS, 3, False),
    A("CLEAR_ITEM", "Clear open item", "R2R-GL-FB50-X_CLEAR", "fi_doc", "BSAS.AUGDT BSAS.AUGBL",
      "BSAS on the doc", "BSAS.AUGDT", 4, False),
    A("CREATE_GL_ACCOUNT", "Create G/L account", "R2R-GL-FS00-01", "gl_account", "CDHDR.OBJECTID",
      "CDHDR class SACH, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_GL_COMPANY", "Change G/L company code data", "R2R-GL-FS00-02", "gl_account", "SKB1",
      "CDPOS class SACH, TABNAME='SKB1'", _CD, 2, False),
    A("CHANGE_GL_TEXT", "Change G/L account text", "R2R-GL-FS00-03", "gl_account", "SKAT",
      "CDPOS class SACH, TABNAME='SKAT'", _CD, 3, False),
    A("CREATE_ASSET", "Create asset", "R2R-AA-AS01-01", "asset", "CDHDR.OBJECTID",
      "CDHDR class ANLA, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_ASSET_ASSIGNMENT", "Change asset time-dependent data", "R2R-AA-AS01-02", "asset", "ANLZ",
      "CDPOS class ANLA, TABNAME='ANLZ'", _CD, 2, False),
    A("CHANGE_ASSET_DEPRECIATION", "Change depreciation terms", "R2R-AA-AS01-03", "asset", "ANLB",
      "CDPOS class ANLA, TABNAME='ANLB'", _CD, 3, False),
    A("CREATE_COST_CENTER", "Create cost centre", "R2R-CO-KS01-01", "cost_center", "CDHDR.OBJECTID",
      "CDHDR class KOSTL, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_COST_CENTER", "Change cost centre", "R2R-CO-KS01-02", "cost_center", "CDPOS.CHNGIND",
      "CDPOS class KOSTL, CHNGIND='U'", _CD, 2, False),
    A("CREATE_COST_ELEMENT", "Create cost element", "R2R-CO-KA01-01", "cost_element", "CDHDR.OBJECTID",
      "CDHDR class KSTAR, CHANGE_IND='I'", _CD, 1, True),
    A("CREATE_INTERNAL_ORDER", "Create internal order", "R2R-CO-KO01-01", "internal_order", "AUFK.AUFNR AUFK.AUTYP",
      "AUFK AUTYP='01'", "AUFK.ERDAT AUFK.ERFZEIT", 1, True),
)
M = {m.key: m for m in MAPPING}
_TCODE_KEY = {
    **dict.fromkeys(("FB50", "FB01", "FB01L", "FBS1", "F-02", "FB50L"), "POST_GL_DOC"),
    **dict.fromkeys(("ABZON", "ABZO", "F-90", "AB01"), "POST_ASSET_ACQ"),
    **dict.fromkeys(("AFAB", "AFABN"), "POST_DEPRECIATION"),
}


def post_activity(tcode: str) -> ActivityMap:
    """Mapped posting activity for a T-code, or the discovered ``POST_<TCODE>`` row (§4.2 rule 3)."""
    if tcode in _TCODE_KEY:
        return M[_TCODE_KEY[tcode]]
    key = "POST_" + (norm_key(tcode, 20) or "NONE")
    return dyn(M["POST_<TCODE>"], key, f"Post document via {tcode or 'no T-code'}", f"R2R-DSC-{key}-01")


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    since = ctx.window_from or ctx.run_date - timedelta(days=365)
    bkpf = frames.get("BKPF", ["BUKRS", "BELNR", "GJAHR", "BLART", "BSTAT", "CPUDT", "CPUTM", "USNAM", "TCODE",
                               "STBLG", "STJAH", "AWTYP"])
    # BKPF is read for PTP (AWTYP RMRP) and R2R; the extraction merges both reads, the window applies here.
    docs = {(r["BUKRS"], r["BELNR"], r["GJAHR"]): r for r in rows(bkpf)
            if (d := sap_date(r["CPUDT"])) is not None and d >= since}

    def ev(m: ActivityMap, key: tuple[str, str, str], when, table: str, user: str = "",
           refs: tuple[tuple[str, str], ...] = ()) -> Optional[EventRow]:
        h = docs[key]
        return event(ctx, m, "/".join(key), when, table, user=user, doc_type=h["BLART"], org={"BUKRS": key[0]},
                     refs=refs, attrs={"BLART": h["BLART"], "TCODE": h["TCODE"], "BSTAT": h["BSTAT"],
                                       "AWTYP": h["AWTYP"]})

    for key, h in docs.items():
        when = sap_ts(ctx, h["CPUDT"], h["CPUTM"])
        if h["BSTAT"] == "":
            yield ev(post_activity(h["TCODE"]), key, when, "BKPF", h["USNAM"])
        elif h["BSTAT"] == "V":
            yield ev(M["PARK_DOC"], key, when, "BKPF", h["USNAM"])
        if h["STBLG"]:
            # Original and reversal point at each other; only the later document is the reversal event.
            rev = docs.get((key[0], h["STBLG"], h["STJAH"] or key[2]))
            rev_when = sap_ts(ctx, rev["CPUDT"], rev["CPUTM"]) if rev else None
            if rev_when and when and rev_when[0] >= when[0] and (rev_when[0], rev["BELNR"]) > (when[0], key[1]):
                yield ev(M["REVERSE_DOC"], key, rev_when, "BKPF", rev["USNAM"],
                         refs=(("STBLG", f"{h['STBLG']}/{h['STJAH']}"),))

    for r in rows(frames.get("BSAS", ["BUKRS", "BELNR", "GJAHR", "AUGDT", "AUGBL"])):
        key = (r["BUKRS"], r["BELNR"], r["GJAHR"])
        if key in docs:
            yield ev(M["CLEAR_ITEM"], key, sap_day(ctx, r["AUGDT"]), "BSAS", refs=(("AUGBL", r["AUGBL"]),))

    yield from master_data_events(frames, ctx, "SACH", M["CREATE_GL_ACCOUNT"], [
        (M["CHANGE_GL_COMPANY"], "SKB1", ""), (M["CHANGE_GL_TEXT"], "SKAT", "")])
    yield from master_data_events(frames, ctx, "ANLA", M["CREATE_ASSET"], [
        (M["CHANGE_ASSET_ASSIGNMENT"], "ANLZ", ""), (M["CHANGE_ASSET_DEPRECIATION"], "ANLB", "")])
    yield from master_data_events(frames, ctx, "KOSTL", M["CREATE_COST_CENTER"], [
        (M["CHANGE_COST_CENTER"], "", "U")])
    yield from master_data_events(frames, ctx, "KSTAR", M["CREATE_COST_ELEMENT"], [])

    aufk = frames.get("AUFK", ["AUFNR", "AUTYP", "AUART", "ERDAT", "ERFZEIT", "ERNAM", "BUKRS"])
    for r in rows(aufk[aufk["AUTYP"] == "01"]):
        yield event(ctx, M["CREATE_INTERNAL_ORDER"], r["AUFNR"], sap_ts(ctx, r["ERDAT"], r["ERFZEIT"]), "AUFK",
                    user=r["ERNAM"], doc_type=r["AUART"], org={"BUKRS": r["BUKRS"]}, attrs={"AUART": r["AUART"]})
```

- [ ] **Step 9: Run it (PASS)**

Run: `pytest tests/process_discovery/test_builders_core.py -q`
Expected: `15 passed`.

Run: `pytest --collect-only -q tests/process_discovery | tail -1`
Expected: `15 tests collected`.

- [ ] **Step 10: Commit**

```bash
git add api/services/process_discovery tests/process_discovery/__init__.py tests/process_discovery/test_builders_core.py
git commit -m "$(cat <<'MSG'
feat(process): event primitives and PTP, OTC, R2R event builders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 22: Event builders, logistics (wave 22): PP, PM, QM, PS, WH

**Files:**
- Create: `api/services/process_discovery/builders/_logistics.py` (shared JCDS, goods-movement and notification helpers; the registry imports only `l1.lower()`, so this module is never loaded as a builder)
- Create: `api/services/process_discovery/builders/pp.py`
- Create: `api/services/process_discovery/builders/pm.py`
- Create: `api/services/process_discovery/builders/qm.py`
- Create: `api/services/process_discovery/builders/ps.py`
- Create: `api/services/process_discovery/builders/wh.py`
- Test: `tests/process_discovery/test_builders_logistics.py`

**Interfaces:**
- Consumes:
  - From Task 21 `events.py`: `ActivityMap`, `EventRow`, `BuildContext`, `Frames`, `Stamp`, `MemoryFrames`, `make_context`, `collect`, `event`, `dyn`, `norm_key`, `sap_ts`, `sap_day`, `dec15_ts`, `cd_changes`, `cd_stamp`, `value_attr`, `rows`, `master_data_events`.
  - From Task 21 `builders/__init__.py`: `builder(l1)`.
  - From Task 21 `tests/process_discovery/test_builders_core.py`: `cd`, `df`, `by`, `RUN`, `JNB`.
  - `sap.process_definitions.reference_document()` for the l5-id existence check (test only).
  - Extracted tables from Task 19's windows: `AUFK`, `AFIH`, `JCDS`, `MKPF`+`MSEG` (ecc) or `MATDOC` (s4hana_onprem), `CDHDR`/`CDPOS` (classes `ORDER`, `STUE`, `QMEL`, `EQUI`), `QMEL`, `TQ80`, `QALS`, `QAVE`, `QMFE`, `QMSM`, `PROJ`, `PRPS`, `LTAK`, `LTAP`, `/SCWM/ORDIM_C`.
- Produces:
  - `pp`, `pm`, `qm`, `ps`, `wh` builder modules, each with `MAPPING` and `build(frames, ctx)`.
  - `_logistics.status_sets`, `status_activity`, `goods_movements`, `notification_kinds`, `notification_kind`, `JCDS_COLS`, `QMEL_COLS`.
  - Runtime activities `STATUS_<STAT>` with l5 `<L4>-X_STATUS_<STAT>` for PP, PM and PS. Task 25 treats them as discovered (`X_`) ids.
  - `qm.M` is keyed by `(case_type, key)` and `wh.M` by `(key, L4)`. In both, one activity key has several l5 ids, so Task 25 must group by `l5_id`, not by activity key.

Decisions this task fixes, and why:
- JCDS is read once and has two parents here (AUFK orders and PRPS WBS elements). Each builder filters by its own `OBJNR` set. Only active rows (`INACT=''`) count; an `INACT='X'` row records a status being reset.
- An unknown JCDS status becomes `STATUS_<STAT>` / `<L4>-X_STATUS_<STAT>` in PP, PM and PS, with the template row's Order (last). The spec names this rule for PP only; applying it to all three keeps one status code path.
- `RESCHEDULE_ORDER` and `CHANGE_PRIORITY` read the object key from `CDPOS.TABKEY[3:15]` (MANDT plus 12 characters), not from `OBJECTID`. The `ORDER` class `OBJECTID` layout is not confirmed against a live system.
- Goods movements come from `MSEG`⋈`MKPF` on `ecc` and from `MATDOC` (`RECORD_TYPE='MDOC'`) on `s4hana_onprem`, chosen by `ctx.system_type`. Only `source_table` differs; activity, l5, ts, resource and refs are identical (tested).
- Notification kind: `TQ80.QMTYP` `'01'` is PM and `'02'` is QM; other categories (for example customer service) are neither. A `QMART` missing from `TQ80` (or no `TQ80` at all) falls back to `PRUEFLOS<>''` for QM, else PM.
- A PM notification joins its order's case only when `QMEL.AUFNR` is an extracted PM order. Otherwise it is its own `pm_notification` case (`dataclasses.replace` on the mapping row), so no notification is dropped.
- A QM notification with an extracted inspection lot joins the lot case. It emits no `COMPLETE_TASK` or `COMPLETE_NOTIFICATION` there, because the lot template has no such rows.
- `CHANGE_USAGE_DECISION` has no resource. The user who changed the decision is not in the extracted `QAVE` columns.
- WH L4 routing is per transfer order, from any of its items: a source storage type starting with `9` is putaway (`LT06`), else `BETYP='L'` is picking (`LT03`), else internal (`LT01`). `s4hana_onprem` still reads `LTAK`/`LTAP`; `/SCWM/ORDIM_C` is read only on `ewm`.

- [ ] **Step 1: Write the failing test**

`tests/process_discovery/test_builders_logistics.py`:

```python
"""PP, PM, QM, PS and WH builders against in-memory extraction frames (spec §2.2, §2.3, §9 wave 22)."""

from __future__ import annotations

import random
from datetime import datetime, timezone

import pandas as pd
import pytest

from api.services.process_discovery import builders
from api.services.process_discovery.builders import pm, pp, ps, qm, wh
from api.services.process_discovery.events import BuildContext, MemoryFrames, collect, make_context
from sap.process_definitions import reference_document
from tests.process_discovery.test_builders_core import JNB, RUN, by, cd, df

PP_ORD, PM_ORD, PM_PLAN = "000001000001", "000004000001", "000004000002"


def jcds(objnr: str, *stats: tuple[str, str, str]) -> list[dict]:
    """JCDS rows (STAT, UDATE+UTIME, INACT) for one object."""
    return [{"OBJNR": objnr, "STAT": s, "CHGNR": f"{n:03d}", "UDATE": ts[:8], "UTIME": ts[8:], "USNAM": "PLANNER1",
             "INACT": inact} for n, (s, ts, inact) in enumerate(stats, 1)]


def movements(*lines: tuple[str, str, str, str]) -> list[dict]:
    """(MBLNR, BWART, AUFNR, CPUDT+CPUTM) material-document lines, MJAHR 2026, user WH1."""
    return [{"MBLNR": m, "MJAHR": "2026", "ZEILE": "0001", "BWART": b, "AUFNR": a, "WERKS": "1000",
             "CPUDT": ts[:8], "CPUTM": ts[8:], "USNAM": "WH1"} for m, b, a, ts in lines]


GM = movements(("4900000001", "261", PP_ORD, "20260107090000"), ("4900000002", "101", PP_ORD, "20260109160000"),
               ("4900000003", "102", PP_ORD, "20260110080000"), ("4900000004", "262", PP_ORD, "20260110081000"),
               ("4900000005", "261", PM_ORD, "20260112100000"), ("4900000006", "311", PP_ORD, "20260110090000"))


def logistics_tables(system: str = "ecc") -> dict[str, pd.DataFrame]:
    """One extraction bundle: AUFK, JCDS, CDHDR and QMEL are shared by several L1s, as in Task 19."""
    t = {
        "AUFK": df(
            {"AUFNR": PP_ORD, "AUTYP": "10", "AUART": "PP01", "WERKS": "1000", "ERDAT": "20260105",
             "ERFZEIT": "080000", "ERNAM": "PLANNER1", "OBJNR": "OR" + PP_ORD},
            {"AUFNR": PM_ORD, "AUTYP": "30", "AUART": "PM01", "WERKS": "1000", "ERDAT": "20260111",
             "ERFZEIT": "070000", "ERNAM": "MAINT1", "OBJNR": "OR" + PM_ORD},
            {"AUFNR": PM_PLAN, "AUTYP": "30", "AUART": "PM02", "WERKS": "1000", "ERDAT": "20260111",
             "ERFZEIT": "000000", "ERNAM": "BATCH", "OBJNR": "OR" + PM_PLAN},
            {"AUFNR": "000000700001", "AUTYP": "01", "AUART": "IO01", "WERKS": "", "ERDAT": "20260111",
             "ERFZEIT": "070000", "ERNAM": "CO1", "OBJNR": "OR000000700001"}),
        "AFIH": df({"AUFNR": PM_ORD, "WARPL": "", "EQUNR": "10000001", "IWERK": "1000"},
                   {"AUFNR": PM_PLAN, "WARPL": "PLAN01", "EQUNR": "10000001", "IWERK": "1000"}),
        "JCDS": df(*jcds("OR" + PP_ORD, ("I0002", "20260106080000", "X"), ("I0002", "20260106090000", ""),
                         ("I0016", "20260106090500", ""), ("I0010", "20260108100000", ""),
                         ("I0009", "20260109150000", ""), ("I0012", "20260109160000", ""),
                         ("I0045", "20260115080000", ""), ("I0046", "20260131080000", "")),
                   *jcds("OR" + PM_ORD, ("I0002", "20260111080000", ""), ("I0010", "20260112110000", ""),
                         ("I0009", "20260112150000", ""), ("I0045", "20260113080000", ""),
                         ("I0046", "20260131080000", "")),
                   *jcds("PR00000002", ("I0002", "20260103080000", ""), ("I0045", "20260301080000", ""),
                         ("I0046", "20260401080000", ""))),
        **cd(("ORDER", PP_ORD, "0000000001", "U", "20260106", "100000", "PLANNER1",
              [("AFKO", "100" + PP_ORD, "GSTRP", "U", "20260107"), ("AFKO", "100" + PP_ORD, "GLTRP", "U", "20260110"),
               ("AUFK", "100" + PP_ORD, "KTEXT", "U", "")]),
             ("STUE", "M00000001", "0000000002", "I", "20251201", "100000", "ENG1", [("STKO", "1", "KEY", "I", "")]),
             ("STUE", "M00000001", "0000000003", "U", "20251202", "100000", "ENG1",
              [("STPO", "1", "MENGE", "U", "2")]),
             ("QMEL", "000010000001", "0000000004", "U", "20260110", "120000", "MAINT1",
              [("QMEL", "100000010000001", "PRIOK", "U", "1")]),
             ("EQUI", "10000001", "0000000005", "I", "20250101", "100000", "MD1", [("EQUI", "1", "KEY", "I", "")]),
             ("EQUI", "10000001", "0000000006", "U", "20250102", "100000", "MD1",
              [("EQUZ", "1", "IWERK", "U", "1000")])),
        "QMEL": df(
            {"QMNUM": "000010000001", "QMART": "M1", "QMDAT": "20260110", "MZEIT": "090000", "ERNAM": "OPS1",
             "QMDAB": "20260114", "QMZAB": "170000", "PRIOK": "2", "AUFNR": PM_ORD, "PRUEFLOS": "", "IWERK": "1000"},
            {"QMNUM": "000010000002", "QMART": "M1", "QMDAT": "20260120", "MZEIT": "090000", "ERNAM": "OPS1",
             "QMDAB": "", "QMZAB": "", "PRIOK": "3", "AUFNR": "", "PRUEFLOS": "", "IWERK": "1000"},
            {"QMNUM": "000020000001", "QMART": "Q2", "QMDAT": "20260106", "MZEIT": "110000", "ERNAM": "QA1",
             "QMDAB": "", "QMZAB": "", "PRIOK": "", "AUFNR": "", "PRUEFLOS": "010000000001", "IWERK": "1000"},
            {"QMNUM": "000020000002", "QMART": "Q3", "QMDAT": "20260108", "MZEIT": "110000", "ERNAM": "QA1",
             "QMDAB": "20260112", "QMZAB": "150000", "PRIOK": "", "AUFNR": "", "PRUEFLOS": "", "IWERK": "1000"}),
        "TQ80": df({"QMART": "M1", "QMTYP": "01"}, {"QMART": "Q2", "QMTYP": "02"}, {"QMART": "Q3", "QMTYP": "02"}),
        "QALS": df({"PRUEFLOS": "010000000001", "ENSTEHDAT": "20260105", "ENTSTEZEIT": "100000", "ERSTELLER": "QA1",
                    "ART": "01", "HERKUNFT": "01", "WERK": "1000", "MATNR": "M1", "EBELN": "4500000001",
                    "AUFNR": "", "OBJNR": "QL010000000001"}),
        "QAVE": df({"PRUEFLOS": "010000000001", "VDATUM": "20260107", "VNAME": "QA2", "VCODE": "A",
                    "VAEDATUM": "20260109"}),
        "QMFE": df({"QMNUM": "000020000001", "FENUM": "0001", "ERDAT": "20260106", "ERZEIT": "113000",
                    "ERNAM": "QA1", "FECOD": "SCR"},
                   {"QMNUM": "000020000002", "FENUM": "0001", "ERDAT": "20260108", "ERZEIT": "113000",
                    "ERNAM": "QA1", "FECOD": "DNT"}),
        "QMSM": df({"QMNUM": "000020000002", "MANUM": "0001", "ERDAT": "20260108", "ERZEIT": "120000", "ERNAM": "QA1",
                    "PETER": "", "ERLDAT": "20260111", "ERLZEIT": "100000", "ERLNAM": "QA3"},
                   {"QMNUM": "000020000002", "MANUM": "0002", "ERDAT": "20260108", "ERZEIT": "120000", "ERNAM": "QA1",
                    "PETER": "", "ERLDAT": "", "ERLZEIT": "", "ERLNAM": ""}),
        "PROJ": df({"PSPNR": "00000001", "PSPID": "P-100", "ERDAT": "20260101", "ERNAM": "PM1", "VBUKR": "1000",
                    "OBJNR": "PD00000001"}),
        "PRPS": df({"PSPNR": "00000002", "POSID": "P-100.01", "PSPHI": "00000001", "ERDAT": "20260102",
                    "ERNAM": "PM1", "PBUKR": "1000", "OBJNR": "PR00000002"}),
        "USR02": df({"BNAME": "PLANNER1", "USTYP": "A"}, {"BNAME": "BATCH", "USTYP": "B"}),
    }
    if system == "s4hana_onprem":
        t["MATDOC"] = df(*[{**r, "RECORD_TYPE": "MDOC"} for r in GM],
                         {**GM[0], "MBLNR": "4900000099", "RECORD_TYPE": "MDAG"})  # aggregate row: no event
    else:
        t["MKPF"] = df(*[{k: r[k] for k in ("MBLNR", "MJAHR", "CPUDT", "CPUTM", "USNAM")} for r in GM])
        t["MSEG"] = df(*[{k: r[k] for k in ("MBLNR", "MJAHR", "ZEILE", "BWART", "AUFNR", "WERKS")} for r in GM])
    return t


def wm_tables(system: str = "ecc") -> dict[str, pd.DataFrame]:
    to = lambda n, betyp, vbeln: {"LGNUM": "100", "TANUM": n, "BWLVS": "101", "BDATU": "20260110",  # noqa: E731
                                  "BZEIT": "080000", "BNAME": "WH1", "BETYP": betyp, "BENUM": "", "KQUIT": "X",
                                  "VBELN": vbeln}
    item = lambda n, pos, vltyp, pquit: {"LGNUM": "100", "TANUM": n, "TAPOS": pos, "QDATU": "20260110" if pquit else "",  # noqa: E731
                                         "QZEIT": "093000" if pquit else "", "QNAME": "WH2" if pquit else "",
                                         "VLTYP": vltyp, "NLTYP": "001", "PQUIT": pquit}
    return {"LTAK": df(to("0000000001", "", ""), to("0000000002", "L", "0080000001"), to("0000000003", "", "")),
            "LTAP": df(item("0000000001", "0001", "902", "X"), item("0000000001", "0002", "001", ""),
                       item("0000000002", "0001", "001", "X"), item("0000000003", "0001", "001", "X"))}


def ewm_tables(system: str = "ewm") -> dict[str, pd.DataFrame]:
    wt = lambda n, trart, conf: {"LGNUM": "W100", "TANUM": n, "TAPOS": "0001", "TOSTAT": "C" if conf else "",  # noqa: E731
                                 "TRART": trart, "PROCTY": "S110", "CREATED_AT": "20260110060000",
                                 "CREATED_BY": "RFUSER", "CONFIRMED_AT": "20260110063000" if conf else "0",
                                 "CONFIRMED_BY": "RFUSER" if conf else "", "VLPLA": "", "NLPLA": ""}
    return {"/SCWM/ORDIM_C": df(wt("000000000001", "1", True), wt("000000000002", "2", True),
                                wt("000000000003", "3", True), wt("000000000004", "1", False))}


def run(l1: str, tables: dict[str, pd.DataFrame], system: str = "ecc"):
    frames = MemoryFrames(tables)
    return collect(builders.builder(l1).build, frames, make_context(frames, "t1", system, RUN))


CASES = {"PP": [("ecc", logistics_tables)], "PM": [("ecc", logistics_tables)], "QM": [("ecc", logistics_tables)],
         "PS": [("ecc", logistics_tables)], "WH": [("ecc", wm_tables), ("ewm", ewm_tables)]}


def mapping_row(mod, e):
    """The MAPPING row an event came from; runtime STATUS_<STAT> events map to the template row."""
    rows = [m for m in mod.MAPPING if m.key == e.activity and m.l5_id == e.l5_id] or \
        [m for m in mod.MAPPING if m.key == "STATUS_<STAT>"]
    return next((m for m in rows if m.case_type == e.case_type), rows[0])


@pytest.mark.parametrize("l1", sorted(CASES))
def test_every_mapping_row_fires(l1):
    fired = {(e.case_type, e.activity, e.l5_id) for system, tables in CASES[l1] for e in run(l1, tables(system), system)}
    expected = {(m.case_type, m.key, m.l5_id) for m in builders.builder(l1).MAPPING if "<" not in m.key}
    assert expected <= fired, expected - fired


@pytest.mark.parametrize("l1", sorted(CASES))
def test_rerun_and_row_order_are_deterministic(l1):
    for system, tables in CASES[l1]:
        first = run(l1, tables(system), system)
        shuffled = {k: v.sample(frac=1, random_state=random.Random(7).randint(0, 999))
                    for k, v in tables(system).items()}
        assert first and run(l1, tables(system), system) == first == run(l1, shuffled, system)


@pytest.mark.parametrize("l1", sorted(CASES))
def test_seq_is_mapping_order_and_ids_exist(l1):
    doc = reference_document()
    l4_ids = {l4.id for l4 in doc.all_l4()}
    l5_ids = {a.id for l4 in doc.all_l4() for a in l4.activities}
    mod = builders.builder(l1)
    for system, tables in CASES[l1]:
        for e in run(l1, tables(system), system):
            assert e.seq == mapping_row(mod, e).order, e
            if "-X_" in e.l5_id:
                assert e.l5_id.split("-X_")[0] in l4_ids, e.l5_id
            else:
                assert e.l5_id in l5_ids, e.l5_id
    assert all(m.l5_id.startswith(l1 + "-") for m in mod.MAPPING)


def test_pp_order_lifecycle_statuses_and_movements():
    ev = [e for e in run("PP", logistics_tables()) if e.case_id == PP_ORD]
    assert [e.activity for e in ev] == [
        "CREATE_PROD_ORDER", "RELEASE_ORDER", "STATUS_I0016", "RESCHEDULE_ORDER", "ISSUE_COMPONENTS",
        "PARTIAL_CONFIRM", "CONFIRM_ORDER", "GOODS_RECEIPT_ORDER", "DELIVER_ORDER", "REVERSE_MOVEMENT",
        "REVERSE_MOVEMENT", "TECO_ORDER", "CLOSE_ORDER"]
    (rel,) = by(ev, "RELEASE_ORDER")  # the INACT='X' row (status reset) is not an event
    assert rel.ts == datetime(2026, 1, 6, 9, tzinfo=JNB) and dict(rel.attributes)["STAT"] == "I0002"
    (other,) = by(ev, "STATUS_I0016")
    assert other.l5_id == "PP-ORD-CO01-X_STATUS_I0016" and other.seq == 12
    (gr,) = by(ev, "GOODS_RECEIPT_ORDER")
    assert gr.object_refs == (("MBLNR", "4900000002/2026"),) and dict(gr.org) == {"WERKS": "1000"}
    assert {e.case_id for e in run("PP", logistics_tables()) if e.case_type == "prod_order"} == {PP_ORD}
    assert [e.activity for e in run("PP", logistics_tables()) if e.case_type == "bom"] == [
        "CREATE_BOM", "CHANGE_BOM_ITEM"]


@pytest.mark.parametrize("l1", ["PP", "PM"])
def test_matdoc_on_s4_matches_mseg_on_ecc(l1):
    def movements_of(system):
        return [(e.case_id, e.activity, e.l5_id, e.ts, e.resource, e.object_refs)
                for e in run(l1, logistics_tables(system), system) if e.source_table in ("MSEG", "MATDOC")]
    ecc, s4 = movements_of("ecc"), movements_of("s4hana_onprem")
    assert ecc and ecc == s4
    assert not [m for m in s4 if m[-1] == (("MBLNR", "4900000099/2026"),)]  # RECORD_TYPE 'MDAG'
    assert not [m for m in ecc if m[-1] == (("MBLNR", "4900000006/2026"),)]  # BWART 311 is unmapped


def test_pm_order_notification_and_equipment_cases():
    ev = run("PM", logistics_tables())
    assert [e.activity for e in ev if e.case_id == PM_ORD] == [
        "CREATE_NOTIFICATION", "CHANGE_PRIORITY", "CREATE_PM_ORDER", "RELEASE_ORDER", "ISSUE_SPARES",
        "PARTIAL_CONFIRM", "CONFIRM_ORDER", "TECO_ORDER", "COMPLETE_NOTIFICATION", "CLOSE_ORDER"]
    (note,) = by(ev, "CREATE_NOTIFICATION", PM_ORD)
    assert ("QMNUM", "000010000001") in note.object_refs and dict(note.org) == {"IWERK": "1000", "WERKS": "1000"}
    assert dict(by(ev, "CHANGE_PRIORITY")[0].attributes)["PRIOK"] == "1"
    (plan,) = by(ev, "CREATE_ORDER_FROM_PLAN")
    assert plan.case_id == PM_PLAN and ("WARPL", "PLAN01") in plan.object_refs and plan.automated is True
    (own,) = [e for e in ev if e.case_type == "pm_notification"]
    assert (own.case_id, own.activity, own.seq) == ("000010000002", "CREATE_NOTIFICATION", 1)
    assert [e.activity for e in ev if e.case_type == "equipment"] == ["CREATE_EQUIPMENT", "CHANGE_EQUIPMENT"]
    assert {e.case_id for e in ev if e.case_type == "pm_order"} == {PM_ORD, PM_PLAN}


def test_notification_split_by_tq80_then_prueflos():
    with_tq80 = logistics_tables()
    pm_notes = {e.case_id for e in run("PM", with_tq80) if e.case_type == "pm_notification"}
    qm_notes = {e.case_id for e in run("QM", with_tq80) if e.case_type == "qm_notification"}
    assert (pm_notes, qm_notes) == ({"000010000002"}, {"000020000002"})
    no_tq80 = {k: v for k, v in logistics_tables().items() if k != "TQ80"}
    # Without TQ80 a notification with no inspection lot is PM, so Q3 moves from QM to PM.
    assert {e.case_id for e in run("PM", no_tq80) if e.case_type == "pm_notification"} == {
        "000010000002", "000020000002"}
    assert not [e for e in run("QM", no_tq80) if e.case_type == "qm_notification"]
    assert by(run("QM", no_tq80), "CREATE_QM_NOTIFICATION", "010000000001")  # PRUEFLOS still routes to QM


def test_qm_lot_and_notification_streams():
    ev = run("QM", logistics_tables())
    assert [e.activity for e in ev if e.case_id == "010000000001"] == [
        "CREATE_LOT", "CREATE_QM_NOTIFICATION", "RECORD_DEFECT", "USAGE_DECISION", "CHANGE_USAGE_DECISION"]
    (ud,) = by(ev, "USAGE_DECISION")
    assert (ud.ts_precision, ud.resource, dict(ud.attributes)["VCODE"]) == ("day", "QA2", "A")
    (defect,) = by(ev, "RECORD_DEFECT", "010000000001")
    assert defect.seq == 3 and ("QMNUM", "000020000001") in defect.object_refs
    assert [(e.activity, e.seq) for e in ev if e.case_id == "000020000002"] == [
        ("CREATE_QM_NOTIFICATION", 1), ("RECORD_DEFECT", 2), ("COMPLETE_TASK", 3), ("COMPLETE_NOTIFICATION", 4)]
    assert by(ev, "COMPLETE_TASK")[0].resource == "QA3"  # the open task (ERLDAT '') gives no event


def test_ps_wbs_case():
    ev = run("PS", logistics_tables())
    assert [e.activity for e in ev] == ["CREATE_PROJECT", "CREATE_WBS", "RELEASE_WBS", "TECO_WBS", "CLOSE_WBS"]
    assert {e.case_id for e in ev} == {"P-100.01"}
    assert ev[0].object_refs == (("PSPID", "P-100"),) and dict(ev[0].org) == {"PBUKR": "1000"}
    assert ev[0].ts_precision == "day"


def test_wh_routing_wm_and_ewm():
    wm = run("WH", wm_tables())
    l4 = {e.case_id: e.l5_id.rsplit("-", 1)[0] for e in by(wm, "CREATE_TO")}
    assert l4 == {"100/0000000001": "WH-IN-LT06", "100/0000000002": "WH-OUT-LT03", "100/0000000003": "WH-INT-LT01"}
    assert [e.l5_id for e in by(wm, "CONFIRM_TO_ITEM", "100/0000000001")] == ["WH-IN-LT06-02"]
    assert ("VBELN", "0080000001") in by(wm, "CREATE_TO", "100/0000000002")[0].object_refs
    ewm = run("WH", ewm_tables(), "ewm")
    assert {e.case_type for e in ewm} == {"warehouse_task"}
    assert {e.case_id: e.l5_id for e in by(ewm, "CONFIRM_TASK")} == {
        "W100/000000000001": "WH-IN-SCWM_PRDI-01", "W100/000000000002": "WH-OUT-SCWM_PRDO-01",
        "W100/000000000003": "WH-INT-SCWM_MON-01"}
    (create,) = by(ewm, "CREATE_TASK", "W100/000000000004")
    assert create.ts == datetime(2026, 1, 10, 6, tzinfo=timezone.utc) and create.l5_id == "WH-IN-SCWM_PRDI-X_CREATE_TASK"
    assert not run("WH", wm_tables(), "ewm") and not run("WH", ewm_tables(), "ecc")


def test_missing_tables_yield_no_events():
    for mod in (pp, pm, qm, ps, wh):
        for system in ("ecc", "s4hana_onprem", "ewm"):
            assert collect(mod.build, MemoryFrames({}), BuildContext("t1", system, RUN)) == []
```

- [ ] **Step 2: Run it (FAIL)**

Run: `pytest tests/process_discovery/test_builders_logistics.py -q`
Expected: FAIL, collection error `ImportError: cannot import name 'pm' from 'api.services.process_discovery.builders'`.

- [ ] **Step 3: Create the shared logistics helpers**

`api/services/process_discovery/builders/_logistics.py`:

```python
"""Readers shared by the PP, PM, QM and PS builders: JCDS status sets, order goods movements, QMEL split."""

from __future__ import annotations

from typing import Iterator, Mapping, Optional

from api.services.process_discovery.events import ActivityMap, BuildContext, Frames, dyn, norm_key, rows

JCDS_COLS = ["OBJNR", "STAT", "CHGNR", "UDATE", "UTIME", "USNAM", "INACT"]
QMEL_COLS = ["QMNUM", "QMART", "QMDAT", "MZEIT", "ERNAM", "ERDAT", "QMDAB", "QMZAB", "PRIOK", "AUFNR", "PRUEFLOS",
             "IWERK"]


def status_sets(frames: Frames, objnrs: Mapping[str, str]) -> Iterator[tuple[str, dict[str, str]]]:
    """(case id, JCDS row) for every status *set* (``INACT=''``) on an object in ``objnrs`` (OBJNR -> case id).

    JCDS is extracted once for both parents (AUFK orders and PRPS WBS elements), so each builder keeps
    only its own OBJNRs here."""
    j = frames.get("JCDS", JCDS_COLS)
    for r in rows(j[(j["INACT"] == "") & j["OBJNR"].isin(set(objnrs))]):
        yield objnrs[r["OBJNR"]], r


def status_activity(known: Mapping[str, ActivityMap], template: ActivityMap, stat: str) -> ActivityMap:
    """Mapped JCDS status, or ``STATUS_<STAT>`` under the template's L4 (spec §4.2 rule 2)."""
    if stat in known:
        return known[stat]
    key = "STATUS_" + norm_key(stat, 20)
    return dyn(template, key, f"Set status {stat}", template.l5_id.replace("X_STATUS_<STAT>", f"X_{key}"))


def goods_movements(frames: Frames, ctx: BuildContext, aufnrs: set[str]) -> Iterator[tuple[dict[str, str], str]]:
    """(line, source table) for material-document lines posted against ``aufnrs``.

    ``ecc``: MSEG lines with the MKPF header time and user. ``s4hana_onprem``: MATDOC lines with
    ``RECORD_TYPE='MDOC'`` (the other record types are archive and aggregate rows). Both yield the same
    columns, so ECC and S/4 events of one process are identical apart from ``source_table``."""
    cols = ["MBLNR", "MJAHR", "BWART", "AUFNR", "CPUDT", "CPUTM", "USNAM"]
    if ctx.system_type == "s4hana_onprem":
        m = frames.get("MATDOC", [*cols, "RECORD_TYPE"])
        m, table = m[(m["RECORD_TYPE"] == "MDOC") & m["AUFNR"].isin(aufnrs)], "MATDOC"
    else:
        lines = frames.get("MSEG", ["MBLNR", "MJAHR", "BWART", "AUFNR"])
        head = frames.get("MKPF", ["MBLNR", "MJAHR", "CPUDT", "CPUTM", "USNAM"])
        m, table = lines[lines["AUFNR"].isin(aufnrs)].merge(head, on=["MBLNR", "MJAHR"], how="inner"), "MSEG"
    for r in rows(m[cols]):
        yield r, table


def notification_kinds(frames: Frames) -> Mapping[str, str]:
    """QMART -> QMTYP from TQ80 (``'01'`` PM, ``'02'`` QM); empty when TQ80 was not read."""
    t = frames.get("TQ80", ["QMART", "QMTYP"])
    return dict(zip(t["QMART"], t["QMTYP"]))


def notification_kind(r: Mapping[str, str], kinds: Mapping[str, str]) -> Optional[str]:
    """'PM', 'QM' or None (other notification categories, e.g. customer service '03').

    Without a TQ80 entry for the type, a notification with an inspection lot is QM and any other is PM
    (spec §2.2, coverage table: "TQ80 unreadable")."""
    qmtyp = kinds.get(r["QMART"])
    if qmtyp is None:
        return "QM" if r["PRUEFLOS"] else "PM"
    return {"01": "PM", "02": "QM"}.get(qmtyp)
```

- [ ] **Step 4: Create the PP builder**

`api/services/process_discovery/builders/pp.py`:

```python
"""PP event builder (spec §2.2, §2.3 PP). Case ``prod_order`` = AUFNR (AUTYP 10), case ``bom`` = STUE OBJECTID."""

from __future__ import annotations

from typing import Iterable, Iterator, Optional

from api.services.process_discovery.builders._logistics import goods_movements, status_activity, status_sets
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_ts,
)

A = ActivityMap
_JCDS = "JCDS.UDATE JCDS.UTIME"
_GM = "MKPF.CPUDT MKPF.CPUTM | MATDOC.CPUDT MATDOC.CPUTM"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_PROD_ORDER", "Create production order", "PP-ORD-CO01-01", "prod_order", "AUFK.AUFNR AUFK.AUTYP",
      "AUFK AUTYP='10'", "AUFK.ERDAT AUFK.ERFZEIT", 1, True),
    A("RESCHEDULE_ORDER", "Reschedule order dates", "PP-ORD-CO01-02", "prod_order", "AFKO.GSTRP AFKO.GLTRP",
      "CDPOS class ORDER, TABNAME='AFKO', FNAME IN ('GSTRP','GLTRP')", "CDHDR.UDATE CDHDR.UTIME", 2, False),
    A("RELEASE_ORDER", "Release order", "PP-ORD-CO01-X_RELEASE", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0002'", _JCDS, 3, True),
    A("ISSUE_COMPONENTS", "Issue components", "PP-ORD-CO01-X_GOODS_ISSUE", "prod_order", "MSEG.BWART MATDOC.BWART",
      "MSEG (ecc) or MATDOC RECORD_TYPE='MDOC' (s4hana_onprem), BWART='261', AUFNR = case", _GM, 4, False),
    A("PARTIAL_CONFIRM", "Partially confirm order", "PP-ORD-CO01-X_PARTIAL_CONFIRM", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0010'", _JCDS, 5, False),
    A("CONFIRM_ORDER", "Confirm order", "PP-ORD-CO01-X_CONFIRM", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0009'", _JCDS, 6, True),
    A("GOODS_RECEIPT_ORDER", "Receive goods from order", "PP-ORD-CO01-X_GOODS_RECEIPT", "prod_order",
      "MSEG.BWART MATDOC.BWART", "MSEG or MATDOC 'MDOC', BWART='101', AUFNR = case", _GM, 7, True),
    A("REVERSE_MOVEMENT", "Reverse goods movement", "PP-ORD-CO01-X_REVERSE_MOVEMENT", "prod_order",
      "MSEG.BWART MATDOC.BWART", "MSEG or MATDOC 'MDOC', BWART IN ('102','262'), AUFNR = case", _GM, 8, False),
    A("DELIVER_ORDER", "Order delivered", "PP-ORD-CO01-X_DELIVERED", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0012'", _JCDS, 9, False),
    A("TECO_ORDER", "Technically complete order", "PP-ORD-CO01-X_TECO", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0045'", _JCDS, 10, True),
    A("CLOSE_ORDER", "Close order", "PP-ORD-CO01-X_CLOSE", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0046'", _JCDS, 11, False),
    A("STATUS_<STAT>", "Set status <STAT>", "PP-ORD-CO01-X_STATUS_<STAT>", "prod_order", "JCDS.STAT",
      "JCDS, any other STAT", _JCDS, 12, False),
    A("CREATE_BOM", "Create bill of material", "PP-BOM-CS01-01", "bom", "CDHDR.OBJECTID",
      "CDHDR class STUE, CHANGE_IND='I'", "CDHDR.UDATE CDHDR.UTIME", 1, True),
    A("CHANGE_BOM_ITEM", "Change BOM item", "PP-BOM-CS01-02", "bom", "STPO",
      "CDPOS class STUE, TABNAME='STPO'", "CDHDR.UDATE CDHDR.UTIME", 2, False),
)
M = {m.key: m for m in MAPPING}
STATUS = {"I0002": M["RELEASE_ORDER"], "I0010": M["PARTIAL_CONFIRM"], "I0009": M["CONFIRM_ORDER"],
          "I0012": M["DELIVER_ORDER"], "I0045": M["TECO_ORDER"], "I0046": M["CLOSE_ORDER"]}
_BWART = {"261": "ISSUE_COMPONENTS", "101": "GOODS_RECEIPT_ORDER", "102": "REVERSE_MOVEMENT",
          "262": "REVERSE_MOVEMENT"}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    aufk = frames.get("AUFK", ["AUFNR", "AUTYP", "AUART", "WERKS", "ERDAT", "ERFZEIT", "ERNAM", "OBJNR"])
    # AUFK is read for R2R (AUTYP 01), PP (10) and PM (30) in one extraction; each builder filters.
    orders = {r["AUFNR"]: r for r in rows(aufk[aufk["AUTYP"] == "10"])}

    def ev(m: ActivityMap, aufnr: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = orders[aufnr]
        return event(ctx, m, aufnr, when, table, user=user, doc_type=h["AUART"], org={"WERKS": h["WERKS"]},
                     refs=refs, attrs={"AUART": h["AUART"], **(attrs or {})})

    for aufnr, h in orders.items():
        yield ev(M["CREATE_PROD_ORDER"], aufnr, sap_ts(ctx, h["ERDAT"], h["ERFZEIT"]), "AUFK", h["ERNAM"])

    # AFKO TABKEY = MANDT(3) + AUFNR(12). GSTRP and GLTRP in one change document collapse to one event.
    for r in rows(cd_changes(frames, ["ORDER"])):
        aufnr = r["TABKEY"][3:15]
        if r["TABNAME"] == "AFKO" and r["FNAME"] in ("GSTRP", "GLTRP") and aufnr in orders:
            yield ev(M["RESCHEDULE_ORDER"], aufnr, cd_stamp(ctx, r), "CDPOS", r["USERNAME"])

    for aufnr, r in status_sets(frames, {h["OBJNR"]: a for a, h in orders.items() if h["OBJNR"]}):
        yield ev(status_activity(STATUS, M["STATUS_<STAT>"], r["STAT"]), aufnr, sap_ts(ctx, r["UDATE"], r["UTIME"]),
                 "JCDS", r["USNAM"], attrs={"STAT": r["STAT"]})

    for r, table in goods_movements(frames, ctx, set(orders)):
        if r["BWART"] in _BWART:
            yield ev(M[_BWART[r["BWART"]]], r["AUFNR"], sap_ts(ctx, r["CPUDT"], r["CPUTM"]), table, r["USNAM"],
                     refs=[("MBLNR", f"{r['MBLNR']}/{r['MJAHR']}")], attrs={"BWART": r["BWART"]})

    yield from master_data_events(frames, ctx, "STUE", M["CREATE_BOM"], [(M["CHANGE_BOM_ITEM"], "STPO", "")])
```

- [ ] **Step 5: Create the PM builder**

`api/services/process_discovery/builders/pm.py`:

```python
"""PM event builder (spec §2.2, §2.3 PM).

Cases: ``pm_order`` = AUFNR (AUTYP 30), ``pm_notification`` = QMNUM for a PM notification whose order is
not in the extraction, ``equipment`` = EQUI OBJECTID."""

from __future__ import annotations

from dataclasses import replace
from typing import Iterable, Iterator, Optional

from api.services.process_discovery.builders._logistics import (
    QMEL_COLS, goods_movements, notification_kind, notification_kinds, status_activity, status_sets,
)
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_ts, value_attr,
)

A = ActivityMap
_JCDS = "JCDS.UDATE JCDS.UTIME"
_CD = "CDHDR.UDATE CDHDR.UTIME"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_NOTIFICATION", "Create maintenance notification", "PM-PLN-IW21-01", "pm_order", "QMEL.QMNUM QMEL.QMART",
      "QMEL, PM notification (TQ80 QMTYP '01', else PRUEFLOS='')", "QMEL.QMDAT QMEL.MZEIT", 1, False),
    A("CHANGE_PRIORITY", "Change notification priority", "PM-PLN-IW21-02", "pm_order", "QMEL.PRIOK",
      "CDPOS class QMEL, FNAME='PRIOK'", _CD, 2, False),
    A("CREATE_PM_ORDER", "Create maintenance order", "PM-PLN-IW31-01", "pm_order", "AUFK.AUFNR AFIH.WARPL",
      "AUFK AUTYP='30', AFIH WARPL=''", "AUFK.ERDAT AUFK.ERFZEIT", 3, True),
    A("CREATE_ORDER_FROM_PLAN", "Create order from maintenance plan", "PM-PLN-IP01-02", "pm_order",
      "AUFK.AUFNR AFIH.WARPL", "AUFK AUTYP='30', AFIH WARPL<>''", "AUFK.ERDAT AUFK.ERFZEIT", 3, True),
    A("RELEASE_ORDER", "Release order", "PM-PLN-IW31-X_RELEASE", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0002'", _JCDS, 4, True),
    A("ISSUE_SPARES", "Issue spare parts", "PM-PLN-IW31-02", "pm_order", "MSEG.BWART MATDOC.BWART",
      "MSEG (ecc) or MATDOC RECORD_TYPE='MDOC' (s4hana_onprem), BWART='261', AUFNR = case",
      "MKPF.CPUDT MKPF.CPUTM | MATDOC.CPUDT MATDOC.CPUTM", 5, False),
    A("PARTIAL_CONFIRM", "Partially confirm order", "PM-PLN-IW31-X_PARTIAL_CONFIRM", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0010'", _JCDS, 6, False),
    A("CONFIRM_ORDER", "Confirm order", "PM-PLN-IW31-X_CONFIRM", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0009'", _JCDS, 7, True),
    A("TECO_ORDER", "Technically complete order", "PM-PLN-IW31-X_TECO", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0045'", _JCDS, 8, True),
    A("COMPLETE_NOTIFICATION", "Complete notification", "PM-PLN-IW21-X_COMPLETE", "pm_order", "QMEL.QMDAB",
      "QMEL QMDAB<>''", "QMEL.QMDAB QMEL.QMZAB", 9, False),
    A("CLOSE_ORDER", "Close order", "PM-PLN-IW31-X_CLOSE", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0046'", _JCDS, 10, False),
    A("STATUS_<STAT>", "Set status <STAT>", "PM-PLN-IW31-X_STATUS_<STAT>", "pm_order", "JCDS.STAT",
      "JCDS, any other STAT", _JCDS, 11, False),
    A("CREATE_EQUIPMENT", "Create equipment", "PM-TO-IE01-01", "equipment", "CDHDR.OBJECTID",
      "CDHDR class EQUI, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_EQUIPMENT", "Change equipment", "PM-TO-IE01-02", "equipment", "CDPOS.CHNGIND",
      "CDPOS class EQUI, CHNGIND='U'", _CD, 2, False),
)
M = {m.key: m for m in MAPPING}
STATUS = {"I0002": M["RELEASE_ORDER"], "I0010": M["PARTIAL_CONFIRM"], "I0009": M["CONFIRM_ORDER"],
          "I0045": M["TECO_ORDER"], "I0046": M["CLOSE_ORDER"]}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    aufk = frames.get("AUFK", ["AUFNR", "AUTYP", "AUART", "WERKS", "ERDAT", "ERFZEIT", "ERNAM", "OBJNR"])
    afih = frames.get("AFIH", ["AUFNR", "WARPL", "EQUNR", "IWERK"])
    pm = aufk[aufk["AUTYP"] == "30"].merge(afih, on="AUFNR", how="left").fillna("")
    orders = {r["AUFNR"]: r for r in rows(pm)}

    def ev(m: ActivityMap, aufnr: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = orders[aufnr]
        return event(ctx, m, aufnr, when, table, user=user, doc_type=h["AUART"],
                     org={"WERKS": h["WERKS"], "IWERK": h["IWERK"]},
                     refs=[*refs, ("WARPL", h["WARPL"]), ("EQUNR", h["EQUNR"])],
                     attrs={"AUART": h["AUART"], **(attrs or {})})

    for aufnr, h in orders.items():
        key = "CREATE_ORDER_FROM_PLAN" if h["WARPL"] else "CREATE_PM_ORDER"
        yield ev(M[key], aufnr, sap_ts(ctx, h["ERDAT"], h["ERFZEIT"]), "AUFK", h["ERNAM"])

    for aufnr, r in status_sets(frames, {h["OBJNR"]: a for a, h in orders.items() if h["OBJNR"]}):
        yield ev(status_activity(STATUS, M["STATUS_<STAT>"], r["STAT"]), aufnr, sap_ts(ctx, r["UDATE"], r["UTIME"]),
                 "JCDS", r["USNAM"], attrs={"STAT": r["STAT"]})

    for r, table in goods_movements(frames, ctx, set(orders)):
        if r["BWART"] == "261":
            yield ev(M["ISSUE_SPARES"], r["AUFNR"], sap_ts(ctx, r["CPUDT"], r["CPUTM"]), table, r["USNAM"],
                     refs=[("MBLNR", f"{r['MBLNR']}/{r['MJAHR']}")], attrs={"BWART": r["BWART"]})

    # Notifications: on the order's case when QMEL.AUFNR is an extracted PM order, else their own case.
    kinds = notification_kinds(frames)
    notes = {r["QMNUM"]: r for r in rows(frames.get("QMEL", QMEL_COLS)) if notification_kind(r, kinds) == "PM"}

    def note_ev(m: ActivityMap, qmnum: str, when: Optional[Stamp], table: str, user: str = "",
                attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        n = notes[qmnum]
        extra = {"QMART": n["QMART"], "PRIOK": n["PRIOK"], **(attrs or {})}
        if n["AUFNR"] in orders:
            return ev(m, n["AUFNR"], when, table, user, refs=[("QMNUM", qmnum)], attrs=extra)
        return event(ctx, replace(m, case_type="pm_notification"), qmnum, when, table, user=user,
                     doc_type=n["QMART"], org={"IWERK": n["IWERK"]}, attrs=extra)

    for qmnum, n in notes.items():
        yield note_ev(M["CREATE_NOTIFICATION"], qmnum, sap_ts(ctx, n["QMDAT"], n["MZEIT"]), "QMEL", n["ERNAM"])
        if n["QMDAB"]:
            yield note_ev(M["COMPLETE_NOTIFICATION"], qmnum, sap_ts(ctx, n["QMDAB"], n["QMZAB"]), "QMEL")

    # QMEL TABKEY = MANDT(3) + QMNUM(12).
    for r in rows(cd_changes(frames, ["QMEL"])):
        qmnum = r["TABKEY"][3:15]
        if r["FNAME"] == "PRIOK" and qmnum in notes:
            yield note_ev(M["CHANGE_PRIORITY"], qmnum, cd_stamp(ctx, r), "CDPOS", r["USERNAME"], value_attr(r))

    yield from master_data_events(frames, ctx, "EQUI", M["CREATE_EQUIPMENT"], [(M["CHANGE_EQUIPMENT"], "", "U")])
```

- [ ] **Step 6: Create the QM builder**

`api/services/process_discovery/builders/qm.py`:

```python
"""QM event builder (spec §2.2, §2.3 QM). Case ``insp_lot`` = PRUEFLOS, ``qm_notification`` = QMNUM without a lot.

Activity keys repeat across the two case types with different Order, so ``M`` is keyed by (case_type, key)."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._logistics import QMEL_COLS, notification_kind, notification_kinds
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, event, rows, sap_day, sap_ts,
)

A = ActivityMap
_LOT, _NOTE = "insp_lot", "qm_notification"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_LOT", "Create inspection lot", "QM-IN-QA01-01", _LOT, "QALS.PRUEFLOS QALS.ART",
      "QALS row", "QALS.ENSTEHDAT QALS.ENTSTEZEIT", 1, True),
    A("CREATE_QM_NOTIFICATION", "Raise quality notification", "QM-IN-QM01-01", _LOT, "QMEL.QMNUM QMEL.PRUEFLOS",
      "QMEL with PRUEFLOS = case", "QMEL.QMDAT QMEL.MZEIT", 2, False),
    A("RECORD_DEFECT", "Record defect", "QM-IN-QM01-02", _LOT, "QMFE.FENUM QMFE.FECOD",
      "QMFE for a notification of the lot", "QMFE.ERDAT QMFE.ERZEIT", 3, False),
    A("USAGE_DECISION", "Make usage decision", "QM-IN-QA01-X_USAGE_DECISION", _LOT, "QAVE.VCODE",
      "QAVE row", "QAVE.VDATUM", 4, True),
    A("CHANGE_USAGE_DECISION", "Change usage decision", "QM-IN-QA01-X_CHANGE_UD", _LOT, "QAVE.VAEDATUM",
      "QAVE VAEDATUM<>''", "QAVE.VAEDATUM", 5, False),
    A("CREATE_QM_NOTIFICATION", "Raise quality notification", "QM-IN-QM01-01", _NOTE, "QMEL.QMNUM QMEL.QMART",
      "QMEL, QM notification without a lot", "QMEL.QMDAT QMEL.MZEIT", 1, True),
    A("RECORD_DEFECT", "Record defect", "QM-IN-QM01-02", _NOTE, "QMFE.FENUM QMFE.FECOD",
      "QMFE", "QMFE.ERDAT QMFE.ERZEIT", 2, False),
    A("COMPLETE_TASK", "Complete task", "QM-IN-QM01-X_COMPLETE_TASK", _NOTE, "QMSM.ERLDAT",
      "QMSM ERLDAT<>''", "QMSM.ERLDAT QMSM.ERLZEIT", 3, False),
    A("COMPLETE_NOTIFICATION", "Complete notification", "QM-IN-QM01-X_COMPLETE", _NOTE, "QMEL.QMDAB",
      "QMEL QMDAB<>''", "QMEL.QMDAB QMEL.QMZAB", 4, True),
)
M = {(m.case_type, m.key): m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    lots = {r["PRUEFLOS"]: r for r in rows(frames.get(
        "QALS", ["PRUEFLOS", "ENSTEHDAT", "ENTSTEZEIT", "ERSTELLER", "ART", "HERKUNFT", "WERK", "EBELN", "AUFNR"]))}

    def lot_ev(key: str, lot: str, when: Optional[Stamp], table: str, user: str = "",
               refs: tuple[tuple[str, str], ...] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = lots[lot]
        return event(ctx, M[(_LOT, key)], lot, when, table, user=user, doc_type=h["ART"], org={"WERK": h["WERK"]},
                     refs=[("EBELN", h["EBELN"]), ("AUFNR", h["AUFNR"]), *refs],
                     attrs={"ART": h["ART"], "HERKUNFT": h["HERKUNFT"], **(attrs or {})})

    for lot, h in lots.items():
        yield lot_ev("CREATE_LOT", lot, sap_ts(ctx, h["ENSTEHDAT"], h["ENTSTEZEIT"]), "QALS", h["ERSTELLER"])
    for r in rows(frames.get("QAVE", ["PRUEFLOS", "VDATUM", "VNAME", "VCODE", "VAEDATUM"])):
        if r["PRUEFLOS"] in lots:
            ud = {"VCODE": r["VCODE"]}
            yield lot_ev("USAGE_DECISION", r["PRUEFLOS"], sap_day(ctx, r["VDATUM"]), "QAVE", r["VNAME"], attrs=ud)
            if r["VAEDATUM"]:
                yield lot_ev("CHANGE_USAGE_DECISION", r["PRUEFLOS"], sap_day(ctx, r["VAEDATUM"]), "QAVE", attrs=ud)

    # QM notifications: on the lot's case when PRUEFLOS is an extracted lot, else their own case.
    kinds = notification_kinds(frames)
    notes = {r["QMNUM"]: r for r in rows(frames.get("QMEL", QMEL_COLS)) if notification_kind(r, kinds) == "QM"}

    def note_ev(key: str, qmnum: str, when: Optional[Stamp], table: str, user: str = "",
                attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        n = notes[qmnum]
        extra = {"QMART": n["QMART"], **(attrs or {})}
        if n["PRUEFLOS"] in lots:
            if (_LOT, key) not in M:
                return None  # COMPLETE_TASK / COMPLETE_NOTIFICATION are not lot activities (spec §2.3 QM)
            return lot_ev(key, n["PRUEFLOS"], when, table, user, refs=(("QMNUM", qmnum),), attrs=extra)
        return event(ctx, M[(_NOTE, key)], qmnum, when, table, user=user, doc_type=n["QMART"],
                     org={"WERK": n["IWERK"]}, attrs=extra)

    for qmnum, n in notes.items():
        yield note_ev("CREATE_QM_NOTIFICATION", qmnum, sap_ts(ctx, n["QMDAT"], n["MZEIT"]), "QMEL", n["ERNAM"])
        if n["QMDAB"]:
            yield note_ev("COMPLETE_NOTIFICATION", qmnum, sap_ts(ctx, n["QMDAB"], n["QMZAB"]), "QMEL")
    for r in rows(frames.get("QMFE", ["QMNUM", "FENUM", "ERDAT", "ERZEIT", "ERNAM", "FECOD"])):
        if r["QMNUM"] in notes:
            yield note_ev("RECORD_DEFECT", r["QMNUM"], sap_ts(ctx, r["ERDAT"], r["ERZEIT"]), "QMFE", r["ERNAM"],
                          {"FECOD": r["FECOD"]})
    for r in rows(frames.get("QMSM", ["QMNUM", "MANUM", "ERLDAT", "ERLZEIT", "ERLNAM"])):
        if r["QMNUM"] in notes and r["ERLDAT"]:
            yield note_ev("COMPLETE_TASK", r["QMNUM"], sap_ts(ctx, r["ERLDAT"], r["ERLZEIT"]), "QMSM", r["ERLNAM"])
```

- [ ] **Step 7: Create the PS builder**

`api/services/process_discovery/builders/ps.py`:

```python
"""PS event builder (spec §2.2, §2.3 PS). Case ``wbs`` = POSID."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._logistics import status_activity, status_sets
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, event, rows, sap_day, sap_ts,
)

A = ActivityMap
_JCDS = "JCDS.UDATE JCDS.UTIME"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_PROJECT", "Create project definition", "PS-PRJ-CJ01-01", "wbs", "PROJ.PSPID",
      "PROJ row for PRPS.PSPHI", "PROJ.ERDAT", 1, True),
    A("CREATE_WBS", "Create WBS element", "PS-PRJ-CJ02-01", "wbs", "PRPS.POSID", "PRPS row", "PRPS.ERDAT", 2, True),
    A("RELEASE_WBS", "Release WBS element", "PS-PRJ-CJ02-X_RELEASE", "wbs", "JCDS.STAT",
      "JCDS on PRPS.OBJNR, STAT='I0002'", _JCDS, 3, True),
    A("TECO_WBS", "Technically complete WBS", "PS-PRJ-CJ02-X_TECO", "wbs", "JCDS.STAT",
      "JCDS STAT='I0045'", _JCDS, 4, False),
    A("CLOSE_WBS", "Close WBS element", "PS-PRJ-CJ02-X_CLOSE", "wbs", "JCDS.STAT",
      "JCDS STAT='I0046'", _JCDS, 5, False),
    A("STATUS_<STAT>", "Set status <STAT>", "PS-PRJ-CJ02-X_STATUS_<STAT>", "wbs", "JCDS.STAT",
      "JCDS, any other STAT", _JCDS, 6, False),
)
M = {m.key: m for m in MAPPING}
STATUS = {"I0002": M["RELEASE_WBS"], "I0045": M["TECO_WBS"], "I0046": M["CLOSE_WBS"]}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    proj = {r["PSPNR"]: r for r in rows(frames.get("PROJ", ["PSPNR", "PSPID", "ERDAT", "ERNAM"]))}
    wbs = {r["POSID"]: r for r in rows(frames.get("PRPS", ["PSPNR", "POSID", "PSPHI", "ERDAT", "ERNAM", "PBUKR",
                                                           "OBJNR"]))}

    def ev(m: ActivityMap, posid: str, when: Optional[Stamp], table: str, user: str = "",
           attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h, p = wbs[posid], proj.get(wbs[posid]["PSPHI"])
        return event(ctx, m, posid, when, table, user=user, org={"PBUKR": h["PBUKR"]},
                     refs=[("PSPID", p["PSPID"])] if p else [], attrs=attrs)

    for posid, h in wbs.items():
        if (p := proj.get(h["PSPHI"])) is not None:
            yield ev(M["CREATE_PROJECT"], posid, sap_day(ctx, p["ERDAT"]), "PROJ", p["ERNAM"])
        yield ev(M["CREATE_WBS"], posid, sap_day(ctx, h["ERDAT"]), "PRPS", h["ERNAM"])

    for posid, r in status_sets(frames, {h["OBJNR"]: k for k, h in wbs.items() if h["OBJNR"]}):
        yield ev(status_activity(STATUS, M["STATUS_<STAT>"], r["STAT"]), posid, sap_ts(ctx, r["UDATE"], r["UTIME"]),
                 "JCDS", r["USNAM"], {"STAT": r["STAT"]})
```

- [ ] **Step 8: Create the WH builder**

`api/services/process_discovery/builders/wh.py`:

```python
"""WH event builder (spec §2.2, §2.3 WH).

``ecc`` and ``s4hana_onprem`` (WM): case ``transfer_order`` = LGNUM/TANUM from LTAK/LTAP.
``ewm``: case ``warehouse_task`` = LGNUM/TANUM from /SCWM/ORDIM_C.
The L4 is chosen per case, so one activity key (``CREATE_TO``) has one mapping row per L4."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dec15_ts, event, rows, sap_ts,
)

A = ActivityMap
WM_L4 = ("WH-IN-LT06", "WH-OUT-LT03", "WH-INT-LT01")
EWM_L4 = {"1": "WH-IN-SCWM_PRDI", "2": "WH-OUT-SCWM_PRDO"}
EWM_OTHER = "WH-INT-SCWM_MON"
_ORDIM = "/SCWM/ORDIM_C"
MAPPING: tuple[ActivityMap, ...] = (
    *(row for l4 in WM_L4 for row in (
        A("CREATE_TO", "Create transfer order", f"{l4}-01", "transfer_order", "LTAK.TANUM LTAK.BWLVS",
          "LTAK row", "LTAK.BDATU LTAK.BZEIT", 1, True),
        A("CONFIRM_TO_ITEM", "Confirm transfer order item", f"{l4}-02", "transfer_order", "LTAP.PQUIT",
          "LTAP PQUIT='X'", "LTAP.QDATU LTAP.QZEIT", 2, True))),
    *(row for l4 in (*EWM_L4.values(), EWM_OTHER) for row in (
        A("CREATE_TASK", "Create warehouse task", f"{l4}-X_CREATE_TASK", "warehouse_task",
          f"{_ORDIM}.TANUM {_ORDIM}.TRART", f"{_ORDIM} row", f"{_ORDIM}.CREATED_AT", 1, True),
        A("CONFIRM_TASK", "Confirm warehouse task", f"{l4}-01", "warehouse_task", f"{_ORDIM}.CONFIRMED_AT",
          f"{_ORDIM} CONFIRMED_AT set", f"{_ORDIM}.CONFIRMED_AT", 2, True))),
)
M = {(m.key, m.l5_id.rsplit("-", 1)[0]): m for m in MAPPING}


def wm_l4(betyp: str, source_types: list[str]) -> str:
    """Spec §2.3 WH routing: any item from a storage type starting with 9 (interim/GR area) is putaway,
    else a delivery reference (BETYP 'L') is picking, else internal movement."""
    if any(t.startswith("9") for t in source_types):
        return "WH-IN-LT06"
    return "WH-OUT-LT03" if betyp == "L" else "WH-INT-LT01"


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    if ctx.system_type == "ewm":
        yield from _ewm(frames, ctx)
        return
    ltak = {(r["LGNUM"], r["TANUM"]): r for r in rows(frames.get(
        "LTAK", ["LGNUM", "TANUM", "BWLVS", "BDATU", "BZEIT", "BNAME", "BETYP", "BENUM", "VBELN"]))}
    items: dict[tuple[str, str], list[dict[str, str]]] = {k: [] for k in ltak}
    for r in rows(frames.get("LTAP", ["LGNUM", "TANUM", "TAPOS", "QDATU", "QZEIT", "QNAME", "VLTYP", "PQUIT"])):
        if (r["LGNUM"], r["TANUM"]) in items:
            items[(r["LGNUM"], r["TANUM"])].append(r)
    for key, h in ltak.items():
        l4 = wm_l4(h["BETYP"], [i["VLTYP"] for i in items[key]])
        common = dict(doc_type=h["BWLVS"], org={"LGNUM": key[0]}, refs=[("VBELN", h["VBELN"]), ("BENUM", h["BENUM"])],
                      attrs={"BWLVS": h["BWLVS"], "BETYP": h["BETYP"]})
        case = "/".join(key)
        yield event(ctx, M[("CREATE_TO", l4)], case, sap_ts(ctx, h["BDATU"], h["BZEIT"]), "LTAK", user=h["BNAME"],
                    **common)
        for i in items[key]:
            if i["PQUIT"] == "X":
                yield event(ctx, M[("CONFIRM_TO_ITEM", l4)], case, sap_ts(ctx, i["QDATU"], i["QZEIT"]), "LTAP",
                            user=i["QNAME"], **common)


def _ewm(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    # One warehouse task (TANUM) can have several confirmed items; identical events collapse in collect().
    for r in rows(frames.get(_ORDIM, ["LGNUM", "TANUM", "TRART", "PROCTY", "CREATED_AT", "CREATED_BY",
                                      "CONFIRMED_AT", "CONFIRMED_BY"])):
        l4, case = EWM_L4.get(r["TRART"], EWM_OTHER), f"{r['LGNUM']}/{r['TANUM']}"
        common = dict(doc_type=r["PROCTY"], org={"LGNUM": r["LGNUM"]},
                      attrs={"TRART": r["TRART"], "PROCTY": r["PROCTY"]})
        yield event(ctx, M[("CREATE_TASK", l4)], case, dec15_ts(r["CREATED_AT"]), _ORDIM, user=r["CREATED_BY"],
                    **common)
        yield event(ctx, M[("CONFIRM_TASK", l4)], case, dec15_ts(r["CONFIRMED_AT"]), _ORDIM,
                    user=r["CONFIRMED_BY"], **common)
```

- [ ] **Step 9: Run it (PASS)**

Run: `pytest tests/process_discovery/test_builders_logistics.py -q`
Expected: `24 passed`.

Run: `pytest --collect-only -q tests/process_discovery | tail -1`
Expected: `39 tests collected`.

- [ ] **Step 10: Commit**

```bash
git add api/services/process_discovery/builders tests/process_discovery/test_builders_logistics.py
git commit -m "$(cat <<'MSG'
feat(process): PP, PM, QM, PS and WH event builders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 23: Event builders, people and cloud (wave 23): HTR, MDG, SFX, ARB, CNQ

**Files:**
- Create: `api/services/process_discovery/builders/_cloud.py` (window filter shared by SFX, ARB and CNQ; never loaded as a builder, because the registry imports only `l1.lower()`)
- Create: `api/services/process_discovery/builders/htr.py`
- Create: `api/services/process_discovery/builders/mdg.py`
- Create: `api/services/process_discovery/builders/sfx.py`
- Create: `api/services/process_discovery/builders/arb.py`
- Create: `api/services/process_discovery/builders/cnq.py`
- Test: `tests/process_discovery/test_builders_people.py`

**Interfaces:**
- Consumes:
  - From Task 21 `events.py`: `ActivityMap`, `EventRow` (`as_row`), `BuildContext` (`hash`, `automated`, `window_from`, `run_date`), `Frames`, `Stamp`, `MemoryFrames`, `make_context`, `collect`, `event` (with `hashed=True`), `dyn`, `norm_key`, `sap_day`, `dec15_ts`, `iso_ts`, `rows`.
  - From Task 21 `builders/__init__.py`: `builder(l1)`.
  - From Task 21 `tests/process_discovery/test_builders_core.py`: `df`, `by`, `RUN`, `JNB`.
  - `api.models.process_model.ID_PATTERN` (existing, line 12) and `sap.process_definitions.reference_document()` (test only).
  - Extracted tables and frames from Task 19: `PA0000`, `PA0001`, `PA0002`, `PA0008`, `HRP1000`, `HRP1001`, `USR02` (HTR); `USMD120C` (MDG); `JobRequisition`, `JobApplication`, `EmpJob`, `EmployeeTime` (SFX); `requisitions`, `suppliers`, `contracts` (ARB); `reports`, `entries` (CNQ).
- Produces:
  - `htr`, `mdg`, `sfx`, `arb`, `cnq` builder modules, each with `MAPPING` and `build(frames, ctx)`.
  - `_cloud.in_window(ctx, when) -> Optional[Stamp]`.
  - `sfx.application_status(status)` and `sfx.job_event(code)`: runtime rows `APPLICATION_<STATUS>` (l5 `SFX-RCM-MANAGE_JOB_REQUISITIONS-X_APP_<STATUS>`) and `EVENT_<event>` (l5 `SFX-DSC-EVENT_<event>-01`, spec §4.2 rule 3).
  - `htr.PERSON_OTYPES`.
  - Hashed person ids in `case_id` and `resource` for `emp_event` (HTR, SFX) and `time_record` (SFX). Task 24 and Task 25 never see a raw PERNR or userId.

Decisions this task fixes, and why:
- `_cloud.in_window` applies `ctx.window_from` per event. The Ariba and Concur connectors take no date argument (Task 19), so the builder is the only place the window can be applied. SuccessFactors is filtered at extraction; applying it again changes nothing.
- HTR `emp_event` case id is `hash(PERNR)/BEGDA/MASSN`. Every infotype record (PA0001, PA0002, PA0008) with the same PERNR and BEGDA joins every action of that day, and PA0001 `BUKRS`/`WERKS`/`PERSG` is the org of every event of the action. Infotype records with no action on that date are not events: the template has no standalone infotype maintenance process.
- HTR timestamps are `AEDTM` (day precision); `BEGDA` is the business effective date, often in the future, and stays in the case id only.
- HTR resources are hashed, but `automated` is still computed on-premise from the raw `UNAME` against `USR02`, before hashing (`event` does this). On cloud systems there is no `USR02`, so `automated` is None for hashed resources.
- HTR skips `HRP1000`/`HRP1001` rows whose `OTYPE` is a person type (`P`, `H`, `CP`, `BP`, `US`). Their `OBJID` is a PERNR or user id, and an `org_object` case id is not hashed. Relationships attach only to objects that have a creation event; the related object id (`SOBID`) is never stored.
- HTR org-object creation is the earliest `HRP1000` record (lowest `BEGDA`, then `AEDTM`). Later records are renames and validity changes, which the template has no step for.
- MDG `LAST_CHANGE` fires only when `USMD_CHANGED_AT` is strictly later than every other timestamp present. On a request that was only created, `CHANGED_AT` equals `CREATED_AT` and would otherwise add a false step.
- SFX application status: one `JobApplication` row gives only its latest status at `lastModifiedDate`, so SFX rework and status history cannot be measured. The status is normalised with `norm_key(status, 24)`, which keeps the activity key and l5 id inside `ID_PATTERN` (tested).
- SFX applications whose requisition was not extracted are dropped: the case would have no start.
- SFX `emp_event` and `time_record` have no resource (the extracted `EmpJob` and `EmployeeTime` columns carry no changer). Case-id dates are the day-precision stamp in ISO form.
- ARB `CONTRACT_EXPIRED` fires only when `expirationDate` is on or before `ctx.run_date`; a future expiry is a contract term, not an event.
- CNQ `approvalStatus` and `paymentStatus` are attributes on every event of the report, never activities: the registry has no timestamp for either (spec §2.3).

- [ ] **Step 1: Write the failing test**

`tests/process_discovery/test_builders_people.py`:

```python
"""HTR, MDG, SFX, ARB and CNQ builders against in-memory extraction frames (spec §2.1-§2.3, §9 wave 23)."""

from __future__ import annotations

import random
import re
from datetime import date, datetime, timezone

import pandas as pd
import pytest

from api.models.process_model import ID_PATTERN
from api.services.process_discovery import builders
from api.services.process_discovery.builders import arb, cnq, htr, mdg, sfx
from api.services.process_discovery.events import MemoryFrames, collect, make_context
from sap.process_definitions import reference_document
from tests.process_discovery.test_builders_core import JNB, RUN, by, df

PERNRS = ("00001001", "00001002")
SF_USERS = ("jdoe", "asmith")


def hr_tables() -> dict[str, pd.DataFrame]:
    keys = lambda pernr, begda, aedtm: {"PERNR": pernr, "BEGDA": begda, "SEQNR": "000",  # noqa: E731
                                        "AEDTM": aedtm, "UNAME": "HRADMIN"}
    return {
        "PA0000": df({**keys(PERNRS[0], "20260201", "20260125"), "ENDDA": "99991231", "MASSN": "01", "MASSG": "02",
                      "STAT2": "3"},
                     {**keys(PERNRS[1], "20260301", "20260220"), "ENDDA": "99991231", "MASSN": "10", "MASSG": "",
                      "STAT2": "0"}),
        "PA0001": df({**keys(PERNRS[0], "20260201", "20260126"), "BUKRS": "1000", "WERKS": "ZA01", "PERSG": "1",
                      "ORGEH": "50000001"}),
        "PA0002": df(keys(PERNRS[0], "20260201", "20260125")),
        "PA0008": df(keys(PERNRS[0], "20260201", "20260127"), keys(PERNRS[0], "20250101", "20250101")),
        "HRP1000": df({"PLVAR": "01", "OTYPE": "O", "OBJID": "50000001", "BEGDA": "20260101", "AEDTM": "20251215",
                       "UNAME": "OMADMIN"},
                      {"PLVAR": "01", "OTYPE": "O", "OBJID": "50000001", "BEGDA": "20260601", "AEDTM": "20260520",
                       "UNAME": "OMADMIN"},
                      {"PLVAR": "01", "OTYPE": "P", "OBJID": PERNRS[0], "BEGDA": "20260201", "AEDTM": "20260125",
                       "UNAME": "OMADMIN"}),
        "HRP1001": df({"PLVAR": "01", "OTYPE": "O", "OBJID": "50000001", "RSIGN": "B", "RELAT": "002",
                       "SCLAS": "O", "BEGDA": "20260101", "AEDTM": "20251216", "UNAME": "OMADMIN"},
                      {"PLVAR": "01", "OTYPE": "P", "OBJID": PERNRS[0], "RSIGN": "B", "RELAT": "008",
                       "SCLAS": "S", "BEGDA": "20260201", "AEDTM": "20260125", "UNAME": "OMADMIN"}),
        "USR02": df({"BNAME": "HRADMIN", "USTYP": "A"}, {"BNAME": "OMADMIN", "USTYP": "A"}),
    }


def mdg_tables() -> dict[str, pd.DataFrame]:
    cr = lambda n, created, released, changed, chn: {  # noqa: E731
        "USMD_CREQUEST": n, "USMD_CREQ_TYPE": "MAT01", "USMD_CREQ_STATUS": "05", "USMD_CREATED_AT": created,
        "USMD_CREATED_BY": "MDREQ", "USMD_RELEASED_AT": released, "USMD_RELEASED_BY": "MDAPP" if released else "",
        "USMD_CHANGED_AT": changed, "USMD_CHANGED_BY": "MDREQ", "USMD_DATA_CHN_AT": chn, "USMD_PRIORITY": "2"}
    return {"USMD120C": df(cr("000000000101", "20260105080000", "20260106090000", "20260108100000",
                              "20260107100000"),
                           cr("000000000102", "20260110080000", "0", "20260110080000", "0"))}


def sfx_tables() -> dict[str, pd.DataFrame]:
    return {
        "JobRequisition": df({"requisitionId": "501", "status": "Open", "createdDate": "/Date(1767600000000)/",
                              "hiringManager": SF_USERS[1]}),
        "JobApplication": df({"applicationId": "9001", "requisitionId": "501", "status": "Offer Accepted",
                              "appliedDate": "2026-01-08T09:00:00Z", "lastModifiedDate": "2026-01-20T10:00:00Z"},
                             {"applicationId": "9002", "requisitionId": "501", "status": "Rejected",
                              "appliedDate": "2026-01-09T09:00:00Z", "lastModifiedDate": "2026-01-12T10:00:00Z"},
                             {"applicationId": "9003", "requisitionId": "999", "status": "Rejected",
                              "appliedDate": "2026-01-09T09:00:00Z", "lastModifiedDate": "2026-01-12T10:00:00Z"}),
        "EmpJob": df({"userId": SF_USERS[0], "startDate": "2026-02-01", "seqNumber": "1", "event": "H",
                      "eventReason": "NEWHIRE", "company": "ZA01", "department": "D10"},
                     {"userId": SF_USERS[0], "startDate": "2026-05-01", "seqNumber": "1", "event": "5",
                      "eventReason": "PROMO", "company": "ZA01", "department": "D20"}),
        "EmployeeTime": df({"userId": SF_USERS[0], "timeType": "VAC", "startDate": "2026-03-02",
                            "endDate": "2026-03-04", "approvalStatus": "APPROVED"}),
    }


def arb_tables() -> dict[str, pd.DataFrame]:
    return {
        "requisitions": df({"requisitionId": "PR100", "requestor": "buyer1", "status": "Ordered",
                            "createdDate": "2026-01-05T08:00:00Z", "approvalStatus": "Approved"}),
        "suppliers": df({"supplierId": "S1", "qualificationStatus": "Qualified",
                         "registrationDate": "2026-01-02T08:00:00Z"}),
        "contracts": df({"contractId": "C1", "status": "Expired", "effectiveDate": "2026-01-01",
                         "expirationDate": "2026-06-30", "owner": "buyer1"},
                        {"contractId": "C2", "status": "Published", "effectiveDate": "2026-02-01",
                         "expirationDate": "2027-01-31", "owner": "buyer1"},
                        {"contractId": "C0", "status": "Expired", "effectiveDate": "2024-01-01",
                         "expirationDate": "2024-12-31", "owner": "buyer1"}),
    }


def cnq_tables() -> dict[str, pd.DataFrame]:
    return {
        "reports": df({"reportId": "R1", "ownerLoginId": "emp1@corp", "submitDate": "2026-01-15T12:00:00Z",
                       "approvalStatus": "A_APPR", "paymentStatus": "P_PAID"}),
        "entries": df({"reportId": "R1", "entryId": "E2", "expenseTypeCode": "TAXI", "transactionDate": "2026-01-12"},
                      {"reportId": "R1", "entryId": "E1", "expenseTypeCode": "HOTEL",
                       "transactionDate": "2026-01-10"}),
    }


CASES = {"HTR": ("ecc", hr_tables), "MDG": ("ecc", mdg_tables), "SFX": ("successfactors", sfx_tables),
         "ARB": ("ariba", arb_tables), "CNQ": ("concur", cnq_tables)}
WINDOW = date(2025, 1, 1)


def run(l1: str, tables: dict[str, pd.DataFrame] | None = None, tenant: str = "t1", window=WINDOW):
    system, fixture = CASES[l1]
    frames = MemoryFrames(fixture() if tables is None else tables)
    return collect(builders.builder(l1).build, frames, make_context(frames, tenant, system, RUN,
                                                                     window_from=window))


@pytest.mark.parametrize("l1", sorted(CASES))
def test_every_mapping_row_fires(l1):
    fired = {(e.case_type, e.activity, e.l5_id) for e in run(l1)}
    expected = {(m.case_type, m.key, m.l5_id) for m in builders.builder(l1).MAPPING if "<" not in m.key}
    assert expected <= fired, expected - fired


@pytest.mark.parametrize("l1", sorted(CASES))
def test_rerun_and_row_order_are_deterministic(l1):
    first = run(l1)
    shuffled = {k: v.sample(frac=1, random_state=random.Random(7).randint(0, 999))
                for k, v in CASES[l1][1]().items()}
    assert first and run(l1) == first == run(l1, shuffled)


@pytest.mark.parametrize("l1", sorted(CASES))
def test_seq_is_mapping_order_and_ids_exist(l1):
    doc = reference_document()
    l4_ids = {l4.id for l4 in doc.all_l4()}
    l5_ids = {a.id for l4 in doc.all_l4() for a in l4.activities}
    mod = builders.builder(l1)
    template = {m.l5_id: m for m in mod.MAPPING}
    for e in run(l1):
        row = template.get(e.l5_id) or next(m for m in mod.MAPPING if "<" in m.key and m.case_type == e.case_type
                                            and e.l5_id.startswith(m.l5_id.split("<")[0]))
        assert e.seq == row.order, e
        assert re.match(ID_PATTERN, e.l5_id) and re.match(ID_PATTERN, e.activity), e
        if f"{l1}-DSC-" in e.l5_id:
            assert e.l5_id.endswith("-01"), e.l5_id
        elif "-X_" in e.l5_id:
            assert e.l5_id.split("-X_")[0] in l4_ids, e.l5_id
        else:
            assert e.l5_id in l5_ids, e.l5_id
    assert all(m.l5_id.startswith(l1 + "-") for m in mod.MAPPING)


@pytest.mark.parametrize("l1,raw", [("HTR", PERNRS), ("SFX", SF_USERS)])
def test_no_raw_person_id_in_any_stored_column(l1, raw):
    ev = run(l1)
    assert ev
    for e in ev:
        text = repr(e.as_row())
        for value in raw:
            assert value not in text, (value, e)


@pytest.mark.parametrize("l1", ["HTR", "SFX"])
def test_person_hash_is_stable_per_tenant_and_differs_across_tenants(l1):
    a, b = run(l1, tenant="t1"), run(l1, tenant="t2")
    assert a == run(l1, tenant="t1")
    people = lambda ev: {e.case_id for e in ev if e.case_type == "emp_event"}  # noqa: E731
    assert people(a) and people(a).isdisjoint(people(b))


def test_htr_actions_infotypes_and_org_objects():
    ev = run("HTR")
    hire = [e for e in ev if e.case_id.endswith("/20260201/01")]
    assert [e.activity for e in hire] == ["RECORD_ACTION", "RECORD_REASON", "UPDATE_PERSONAL_DATA",
                                          "UPDATE_ORG_ASSIGNMENT", "UPDATE_PAY"]
    assert all(dict(e.org) == {"BUKRS": "1000", "PERSG": "1", "WERKS": "ZA01"} for e in hire)
    assert all(e.automated is False and e.ts_precision == "day" for e in hire)
    assert {e.resource for e in hire} == {hire[0].resource} and hire[0].resource != "HRADMIN"
    (other,) = [e for e in ev if e.case_id.endswith("/20260301/10")]
    assert other.activity == "RECORD_ACTION"  # no MASSG, no infotype records on that date
    org = [e for e in ev if e.case_type == "org_object"]
    assert {e.case_id for e in org} == {"01/O/50000001"}  # person objects (OTYPE P) are never cases
    assert [(e.activity, e.ts.date()) for e in org] == [("CREATE_ORG_OBJECT", date(2025, 12, 15)),
                                                        ("CREATE_RELATIONSHIP", date(2025, 12, 16))]


def test_mdg_change_request_lifecycle():
    ev = run("MDG")
    assert [e.activity for e in ev if e.case_id == "000000000101"] == [
        "CREATE_CR", "APPROVE_CR", "ACTIVATE_DATA", "LAST_CHANGE"]
    (create,) = by(ev, "CREATE_CR", "000000000101")
    assert create.ts == datetime(2026, 1, 5, 8, tzinfo=timezone.utc) and create.doc_type == "MAT01"
    # An unreleased request has only its creation; CHANGED_AT equal to CREATED_AT is not a later change.
    assert [e.activity for e in ev if e.case_id == "000000000102"] == ["CREATE_CR"]


def test_sfx_requisition_statuses_and_employee_events():
    ev = run("SFX")
    req = [e for e in ev if e.case_type == "requisition"]
    assert {e.case_id for e in req} == {"501"}  # application 9003 has no extracted requisition
    assert [e.activity for e in req] == ["CREATE_REQUISITION", "RECEIVE_APPLICATION", "RECEIVE_APPLICATION",
                                         "APPLICATION_REJECTED", "APPLICATION_OFFER_ACCEPTED"]
    (acc,) = by(ev, "APPLICATION_OFFER_ACCEPTED")
    assert acc.l5_id == "SFX-RCM-MANAGE_JOB_REQUISITIONS-X_APP_OFFER_ACCEPTED"
    assert acc.object_refs == (("applicationId", "9001"),) and dict(acc.attributes) == {"status": "Offer Accepted"}
    (create,) = by(ev, "CREATE_REQUISITION")
    assert create.ts == datetime(2026, 1, 5, 8, tzinfo=timezone.utc) and create.automated is None
    (hire,) = by(ev, "HIRE")
    assert hire.ts == datetime(2026, 2, 1, tzinfo=JNB) and hire.ts_precision == "day"
    assert hire.case_id.endswith("/2026-02-01/1") and dict(hire.org) == {"company": "ZA01"}
    (promo,) = by(ev, "EVENT_5")
    assert promo.l5_id == "SFX-DSC-EVENT_5-01" and promo.resource is None
    (time_rec,) = by(ev, "RECORD_TIME")
    assert time_rec.case_id.endswith("/2026-03-02/VAC") and dict(time_rec.attributes)["approvalStatus"] == "APPROVED"


def test_arb_contracts_expire_only_up_to_run_date():
    ev = run("ARB")
    assert [e.activity for e in ev if e.case_id == "C1"] == ["CONTRACT_EFFECTIVE", "CONTRACT_EXPIRED"]
    assert [e.activity for e in ev if e.case_id == "C2"] == ["CONTRACT_EFFECTIVE"]  # expires after RUN
    (req,) = by(ev, "CREATE_REQUISITION")
    assert req.resource == "buyer1" and req.case_type == "requisition"


def test_cnq_first_expense_then_submit_with_statuses_as_attributes():
    ev = run("CNQ")
    assert [e.activity for e in ev] == ["INCUR_EXPENSE", "SUBMIT_REPORT"]
    incur, submit = ev
    assert incur.ts == datetime(2026, 1, 10, tzinfo=JNB) and incur.ts_precision == "day"
    assert incur.object_refs == (("entryId", "E1"), ("entryId", "E2"))
    assert submit.resource == "emp1@corp"
    for e in ev:
        assert dict(e.attributes) == {"approvalStatus": "A_APPR", "paymentStatus": "P_PAID"}
    assert not any("APPR" in e.activity or "PAID" in e.activity for e in ev)


@pytest.mark.parametrize("l1", ["SFX", "ARB", "CNQ"])
def test_cloud_window_drops_older_events(l1):
    everything, windowed = run(l1, window=None), run(l1, window=date(2026, 1, 11))
    assert windowed and len(windowed) < len(everything)
    assert all(e.ts.date() >= date(2026, 1, 11) for e in windowed)


def test_arb_contract_from_before_the_window_is_dropped():
    assert [e.activity for e in run("ARB", window=None) if e.case_id == "C0"] == [
        "CONTRACT_EFFECTIVE", "CONTRACT_EXPIRED"]
    assert [e for e in run("ARB") if e.case_id == "C0"] == []


def test_missing_tables_yield_no_events():
    for l1 in CASES:
        assert run(l1, tables={}) == []
```

- [ ] **Step 2: Run it (FAIL)**

Run: `pytest tests/process_discovery/test_builders_people.py -q`
Expected: FAIL, collection error `ImportError: cannot import name 'arb' from 'api.services.process_discovery.builders'`.

- [ ] **Step 3: Create the cloud window helper**

`api/services/process_discovery/builders/_cloud.py`:

```python
"""Shared by the SFX, ARB and CNQ builders."""

from __future__ import annotations

from typing import Optional

from api.services.process_discovery.events import BuildContext, Stamp


def in_window(ctx: BuildContext, when: Optional[Stamp]) -> Optional[Stamp]:
    """The stamp, or None when it falls before the run window.

    The Ariba and Concur connectors take no date argument (Task 19, ``process_event_targets``), so the
    window is applied here, per event. SuccessFactors is filtered at extraction; applying it again is a no-op."""
    if when is None or (ctx.window_from is not None and when[0].date() < ctx.window_from):
        return None
    return when
```

- [ ] **Step 4: Create the HTR builder**

`api/services/process_discovery/builders/htr.py`:

```python
"""HTR event builder (spec §2.2, §2.3 HTR).

Cases: ``emp_event`` = hash(PERNR)/BEGDA/MASSN (one personnel action), ``org_object`` = PLVAR/OTYPE/OBJID.
Raw PERNR never leaves this module: case ids and resources are hashed with the tenant id (spec §2.1)."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, event, rows, sap_day,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("RECORD_ACTION", "Record personnel action", "HTR-PA-PA40-01", "emp_event", "PA0000.MASSN",
      "PA0000 row", "PA0000.AEDTM", 1, True),
    A("RECORD_REASON", "Record action reason", "HTR-PA-PA40-02", "emp_event", "PA0000.MASSG",
      "PA0000 MASSG<>''", "PA0000.AEDTM", 2, False),
    A("UPDATE_ORG_ASSIGNMENT", "Update organisational assignment", "HTR-PA-PA40-03", "emp_event",
      "PA0001.BUKRS PA0001.WERKS PA0001.PERSG", "PA0001 with same PERNR and BEGDA", "PA0001.AEDTM", 3, True),
    A("UPDATE_PERSONAL_DATA", "Update personal data", "HTR-PA-PA30-01", "emp_event", "PA0002.PERNR",
      "PA0002 with same PERNR and BEGDA", "PA0002.AEDTM", 4, False),
    A("UPDATE_PAY", "Update basic pay", "HTR-PA-PA30-02", "emp_event", "PA0008.PERNR",
      "PA0008 with same PERNR and BEGDA", "PA0008.AEDTM", 5, False),
    A("CREATE_ORG_OBJECT", "Create organisational object", "HTR-OM-PP01-01", "org_object",
      "HRP1000.OTYPE HRP1000.OBJID", "HRP1000 row, earliest BEGDA", "HRP1000.AEDTM", 1, True),
    A("CREATE_RELATIONSHIP", "Create relationship", "HTR-OM-PP01-02", "org_object", "HRP1001.RSIGN HRP1001.RELAT",
      "HRP1001 for that object", "HRP1001.AEDTM", 2, False),
)
M = {m.key: m for m in MAPPING}
_HR_KEYS = ["PERNR", "BEGDA", "SEQNR", "AEDTM", "UNAME"]
# Object types that are people (person, external person, central person, business partner, user).
# Their OBJID is a PERNR or user id, so they are never an org_object case.
PERSON_OTYPES = frozenset({"P", "H", "CP", "BP", "US"})


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    pa1 = {}
    for r in rows(frames.get("PA0001", [*_HR_KEYS, "BUKRS", "WERKS", "PERSG"])):
        pa1.setdefault((r["PERNR"], r["BEGDA"]), r)
    actions: dict[tuple[str, str], list[tuple[str, dict[str, str]]]] = {}

    def org(pernr: str, begda: str) -> dict[str, str]:
        r = pa1.get((pernr, begda))
        return {k: r[k] for k in ("BUKRS", "WERKS", "PERSG")} if r else {}

    for r in rows(frames.get("PA0000", ["PERNR", "BEGDA", "SEQNR", "MASSN", "MASSG", "STAT2", "AEDTM", "UNAME"])):
        if not r["PERNR"]:
            continue
        case = f"{ctx.hash(r['PERNR'])}/{r['BEGDA']}/{r['MASSN']}"
        actions.setdefault((r["PERNR"], r["BEGDA"]), []).append((case, r))
        common = dict(user=r["UNAME"], hashed=True, doc_type=r["MASSN"], org=org(r["PERNR"], r["BEGDA"]),
                      attrs={"MASSN": r["MASSN"], "MASSG": r["MASSG"], "STAT2": r["STAT2"]})
        when = sap_day(ctx, r["AEDTM"])
        yield event(ctx, M["RECORD_ACTION"], case, when, "PA0000", **common)
        if r["MASSG"]:
            yield event(ctx, M["RECORD_REASON"], case, when, "PA0000", **common)

    # An infotype record joins every action of the same employee and start date.
    for key, table in (("UPDATE_ORG_ASSIGNMENT", "PA0001"), ("UPDATE_PERSONAL_DATA", "PA0002"),
                       ("UPDATE_PAY", "PA0008")):
        for r in rows(frames.get(table, _HR_KEYS)):
            for case, a in actions.get((r["PERNR"], r["BEGDA"]), []):
                yield event(ctx, M[key], case, sap_day(ctx, r["AEDTM"]), table, user=r["UNAME"], hashed=True,
                            doc_type=a["MASSN"], org=org(r["PERNR"], r["BEGDA"]), attrs={"MASSN": a["MASSN"]})

    # Org objects: the earliest HRP1000 record (lowest BEGDA, then AEDTM) is the creation; later records
    # are renames and validity changes, which the template has no step for.
    created: dict[str, dict[str, str]] = {}
    for r in rows(frames.get("HRP1000", ["PLVAR", "OTYPE", "OBJID", "BEGDA", "AEDTM", "UNAME"])):
        case = f"{r['PLVAR']}/{r['OTYPE']}/{r['OBJID']}"
        if r["OTYPE"] in PERSON_OTYPES:
            continue
        if case not in created or (r["BEGDA"], r["AEDTM"]) < (created[case]["BEGDA"], created[case]["AEDTM"]):
            created[case] = r
    for case, r in created.items():
        yield event(ctx, M["CREATE_ORG_OBJECT"], case, sap_day(ctx, r["AEDTM"]), "HRP1000", user=r["UNAME"],
                    hashed=True, doc_type=r["OTYPE"], attrs={"OTYPE": r["OTYPE"]})
    for r in rows(frames.get("HRP1001", ["PLVAR", "OTYPE", "OBJID", "RSIGN", "RELAT", "BEGDA", "AEDTM", "UNAME"])):
        case = f"{r['PLVAR']}/{r['OTYPE']}/{r['OBJID']}"
        if case in created:
            yield event(ctx, M["CREATE_RELATIONSHIP"], case, sap_day(ctx, r["AEDTM"]), "HRP1001", user=r["UNAME"],
                        hashed=True, doc_type=r["OTYPE"],
                        attrs={"OTYPE": r["OTYPE"], "RSIGN": r["RSIGN"], "RELAT": r["RELAT"]})
```

- [ ] **Step 5: Create the MDG builder**

`api/services/process_discovery/builders/mdg.py`:

```python
"""MDG event builder (spec §2.2, §2.3 MDG). Case ``change_request`` = USMD_CREQUEST.

The USMD timestamps are DEC15 UTC (``YYYYMMDDhhmmss``) and are taken as UTC."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dec15_ts, event, rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_CR", "Create change request", "MDG-CR-MDGIMG-01", "change_request", "USMD120C.USMD_CREQUEST",
      "USMD120C row", "USMD120C.USMD_CREATED_AT", 1, True),
    A("APPROVE_CR", "Approve change request", "MDG-CR-MDGIMG-02", "change_request", "USMD120C.USMD_RELEASED_AT",
      "USMD_RELEASED_AT set", "USMD120C.USMD_RELEASED_AT", 2, True),
    A("ACTIVATE_DATA", "Activate data", "MDG-CR-MDGIMG-X_ACTIVATE", "change_request", "USMD120C.USMD_DATA_CHN_AT",
      "USMD_DATA_CHN_AT set", "USMD120C.USMD_DATA_CHN_AT", 3, True),
    A("LAST_CHANGE", "Last change to request", "MDG-CR-MDGIMG-X_LAST_CHANGE", "change_request",
      "USMD120C.USMD_CHANGED_AT", "USMD_CHANGED_AT later than every timestamp above",
      "USMD120C.USMD_CHANGED_AT", 4, False),
)
M = {m.key: m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    cols = ["USMD_CREQUEST", "USMD_CREQ_TYPE", "USMD_CREQ_STATUS", "USMD_CREATED_AT", "USMD_CREATED_BY",
            "USMD_RELEASED_AT", "USMD_RELEASED_BY", "USMD_CHANGED_AT", "USMD_CHANGED_BY", "USMD_DATA_CHN_AT",
            "USMD_PRIORITY"]
    for r in rows(frames.get("USMD120C", cols)):
        case = r["USMD_CREQUEST"]
        common = dict(doc_type=r["USMD_CREQ_TYPE"],
                      attrs={"USMD_CREQ_TYPE": r["USMD_CREQ_TYPE"], "USMD_CREQ_STATUS": r["USMD_CREQ_STATUS"],
                             "USMD_PRIORITY": r["USMD_PRIORITY"]})
        created, released = dec15_ts(r["USMD_CREATED_AT"]), dec15_ts(r["USMD_RELEASED_AT"])
        activated, changed = dec15_ts(r["USMD_DATA_CHN_AT"]), dec15_ts(r["USMD_CHANGED_AT"])
        yield event(ctx, M["CREATE_CR"], case, created, "USMD120C", user=r["USMD_CREATED_BY"], **common)
        yield event(ctx, M["APPROVE_CR"], case, released, "USMD120C", user=r["USMD_RELEASED_BY"], **common)
        yield event(ctx, M["ACTIVATE_DATA"], case, activated, "USMD120C", **common)
        if changed and all(s is None or changed[0] > s[0] for s in (created, released, activated)):
            yield event(ctx, M["LAST_CHANGE"], case, changed, "USMD120C", user=r["USMD_CHANGED_BY"], **common)
```

- [ ] **Step 6: Create the SFX builder**

`api/services/process_discovery/builders/sfx.py`:

```python
"""SFX (SuccessFactors) event builder (spec §2.2, §2.3 SFX).

Cases: ``requisition`` = requisitionId, ``emp_event`` = hash(userId)/startDate/seqNumber,
``time_record`` = hash(userId)/startDate/timeType. Raw userId never leaves this module (spec §2.1).
One application's ``lastModifiedDate`` gives only its latest status, so SFX rework cannot be measured."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._cloud import in_window
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dyn, event, iso_ts, norm_key, rows,
)

A = ActivityMap
_REQ = "SFX-RCM-MANAGE_JOB_REQUISITIONS"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_REQUISITION", "Create job requisition", f"{_REQ}-01", "requisition",
      "JobRequisition.requisitionId", "JobRequisition row", "JobRequisition.createdDate", 1, True),
    A("RECEIVE_APPLICATION", "Receive application", f"{_REQ}-02", "requisition", "JobApplication.applicationId",
      "JobApplication for the requisition", "JobApplication.appliedDate", 2, True),
    A("APPLICATION_<STATUS>", "Application reached <status>", f"{_REQ}-X_APP_<STATUS>", "requisition",
      "JobApplication.status", "JobApplication status set", "JobApplication.lastModifiedDate", 3, False),
    A("HIRE", "Hire employee", "SFX-EC-ADD_NEW_EMPLOYEE-02", "emp_event", "EmpJob.event",
      "EmpJob event='H'", "EmpJob.startDate", 1, True),
    A("EVENT_<EVENT>", "Job event <event>", "SFX-DSC-EVENT_<EVENT>-01", "emp_event", "EmpJob.event",
      "EmpJob, any other event", "EmpJob.startDate", 1, True),
    A("RECORD_TIME", "Record time", "SFX-TIM-MY_TIMESHEET-01", "time_record", "EmployeeTime.timeType",
      "EmployeeTime row", "EmployeeTime.startDate", 1, True),
)
M = {m.key: m for m in MAPPING}


def application_status(status: str) -> ActivityMap:
    """``APPLICATION_<STATUS>`` under the requisition L4 (spec §4.2 rule 2). ``norm_key`` keeps ``ID_PATTERN``."""
    key = norm_key(status, 24)
    return dyn(M["APPLICATION_<STATUS>"], f"APPLICATION_{key}", f"Application reached {status}",
               f"{_REQ}-X_APP_{key}")


def job_event(code: str) -> ActivityMap:
    """``HIRE`` for event 'H', else the discovered ``EVENT_<event>`` branch (spec §4.2 rule 3)."""
    if code == "H":
        return M["HIRE"]
    key = "EVENT_" + (norm_key(code, 24) or "NONE")
    return dyn(M["EVENT_<EVENT>"], key, f"Job event {code or 'none'}", f"SFX-DSC-{key}-01")


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    reqs = {r["requisitionId"]: r for r in rows(frames.get(
        "JobRequisition", ["requisitionId", "status", "createdDate", "hiringManager"]))}
    for req, r in reqs.items():
        yield event(ctx, M["CREATE_REQUISITION"], req, in_window(ctx, iso_ts(ctx, r["createdDate"])),
                    "JobRequisition", user=r["hiringManager"], hashed=True, attrs={"status": r["status"]})
    for r in rows(frames.get("JobApplication", ["applicationId", "requisitionId", "status", "appliedDate",
                                                "lastModifiedDate"])):
        if r["requisitionId"] not in reqs:
            continue
        refs = [("applicationId", r["applicationId"])]
        yield event(ctx, M["RECEIVE_APPLICATION"], r["requisitionId"], in_window(ctx, iso_ts(ctx, r["appliedDate"])),
                    "JobApplication", refs=refs)
        if r["status"]:
            yield event(ctx, application_status(r["status"]), r["requisitionId"],
                        in_window(ctx, iso_ts(ctx, r["lastModifiedDate"])), "JobApplication", refs=refs,
                        attrs={"status": r["status"]})

    for r in rows(frames.get("EmpJob", ["userId", "startDate", "seqNumber", "event", "eventReason", "company"])):
        when = in_window(ctx, iso_ts(ctx, r["startDate"], day=True))
        if not r["userId"] or when is None:
            continue
        case = f"{ctx.hash(r['userId'])}/{when[0].date().isoformat()}/{r['seqNumber']}"
        yield event(ctx, job_event(r["event"]), case, when, "EmpJob", doc_type=r["event"],
                    org={"company": r["company"]}, attrs={"event": r["event"], "eventReason": r["eventReason"]})

    for r in rows(frames.get("EmployeeTime", ["userId", "timeType", "startDate", "approvalStatus"])):
        when = in_window(ctx, iso_ts(ctx, r["startDate"], day=True))
        if not r["userId"] or when is None:
            continue
        case = f"{ctx.hash(r['userId'])}/{when[0].date().isoformat()}/{r['timeType']}"
        yield event(ctx, M["RECORD_TIME"], case, when, "EmployeeTime", doc_type=r["timeType"],
                    attrs={"timeType": r["timeType"], "approvalStatus": r["approvalStatus"]})
```

- [ ] **Step 7: Create the ARB builder**

`api/services/process_discovery/builders/arb.py`:

```python
"""ARB (Ariba) event builder (spec §2.2, §2.3 ARB).

Cases: ``requisition`` = requisitionId (primary), ``supplier`` = supplierId, ``contract`` = contractId."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._cloud import in_window
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, event, iso_ts, rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_REQUISITION", "Create requisition", "ARB-PRC-PROCUREMENT-X_CREATE_REQUISITION", "requisition",
      "requisitions.requisitionId", "requisitions row", "requisitions.createdDate", 1, True),
    A("REGISTER_SUPPLIER", "Register supplier", "ARB-SUP-SUPPLIER_MANAGEMENT-01", "supplier",
      "suppliers.supplierId", "suppliers row", "suppliers.registrationDate", 1, True),
    A("CONTRACT_EFFECTIVE", "Contract effective", "ARB-CON-CONTRACTS-01", "contract", "contracts.contractId",
      "contracts row", "contracts.effectiveDate", 1, True),
    A("CONTRACT_EXPIRED", "Contract expired", "ARB-CON-CONTRACTS-X_EXPIRED", "contract", "contracts.expirationDate",
      "expirationDate not after the run date", "contracts.expirationDate", 2, False),
)
M = {m.key: m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    for r in rows(frames.get("requisitions", ["requisitionId", "requestor", "status", "createdDate",
                                              "approvalStatus"])):
        yield event(ctx, M["CREATE_REQUISITION"], r["requisitionId"], in_window(ctx, iso_ts(ctx, r["createdDate"])),
                    "requisitions", user=r["requestor"],
                    attrs={"status": r["status"], "approvalStatus": r["approvalStatus"]})
    for r in rows(frames.get("suppliers", ["supplierId", "qualificationStatus", "registrationDate"])):
        yield event(ctx, M["REGISTER_SUPPLIER"], r["supplierId"], in_window(ctx, iso_ts(ctx, r["registrationDate"])),
                    "suppliers", attrs={"qualificationStatus": r["qualificationStatus"]})
    for r in rows(frames.get("contracts", ["contractId", "status", "effectiveDate", "expirationDate", "owner"])):
        common = dict(user=r["owner"], attrs={"status": r["status"]})
        yield event(ctx, M["CONTRACT_EFFECTIVE"], r["contractId"], in_window(ctx, iso_ts(ctx, r["effectiveDate"])),
                    "contracts", **common)
        expired = in_window(ctx, iso_ts(ctx, r["expirationDate"]))
        if expired and expired[0].date() <= ctx.run_date:
            yield event(ctx, M["CONTRACT_EXPIRED"], r["contractId"], expired, "contracts", **common)
```

- [ ] **Step 8: Create the CNQ builder**

`api/services/process_discovery/builders/cnq.py`:

```python
"""CNQ (Concur) event builder (spec §2.2, §2.3 CNQ). Case ``expense_report`` = reportId.

``approvalStatus`` and ``paymentStatus`` have no timestamp in the registry, so they are attributes on
every event of the report, never activities."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._cloud import in_window
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, event, iso_ts, rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("INCUR_EXPENSE", "Incur first expense", "CNQ-EXP-EXPENSE-02", "expense_report", "entries.entryId",
      "entries, min(transactionDate) per report", "entries.transactionDate", 1, True),
    A("SUBMIT_REPORT", "Submit expense report", "CNQ-EXP-EXPENSE-01", "expense_report", "reports.reportId",
      "reports row", "reports.submitDate", 2, True),
)
M = {m.key: m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    reports = {r["reportId"]: r for r in rows(frames.get(
        "reports", ["reportId", "ownerLoginId", "submitDate", "approvalStatus", "paymentStatus"]))}

    def attrs(report: str) -> dict[str, str]:
        r = reports.get(report)
        return {"approvalStatus": r["approvalStatus"], "paymentStatus": r["paymentStatus"]} if r else {}

    first: dict[str, tuple] = {}
    entries: dict[str, list[str]] = {}
    for r in rows(frames.get("entries", ["reportId", "entryId", "transactionDate"])):
        entries.setdefault(r["reportId"], []).append(r["entryId"])
        when = iso_ts(ctx, r["transactionDate"], day=True)
        if when and (r["reportId"] not in first or when < first[r["reportId"]]):
            first[r["reportId"]] = when
    for report, when in first.items():
        yield event(ctx, M["INCUR_EXPENSE"], report, in_window(ctx, when), "entries",
                    user=reports[report]["ownerLoginId"] if report in reports else "",
                    refs=[("entryId", e) for e in sorted(entries[report])], attrs=attrs(report))
    for report, r in reports.items():
        yield event(ctx, M["SUBMIT_REPORT"], report, in_window(ctx, iso_ts(ctx, r["submitDate"])), "reports",
                    user=r["ownerLoginId"], attrs=attrs(report))
```

- [ ] **Step 9: Run it (PASS)**

Run: `pytest tests/process_discovery/test_builders_people.py -q`
Expected: `29 passed`.

Run: `pytest --collect-only -q tests/process_discovery | tail -1`
Expected: `68 tests collected`.

- [ ] **Step 10: Commit**

```bash
git add api/services/process_discovery/builders tests/process_discovery/test_builders_people.py
git commit -m "$(cat <<'MSG'
feat(process): HTR, MDG, SFX, Ariba and Concur event builders

Person ids are hashed per tenant in case ids and resources.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 24: Mining (wave 24): filters, DFG, variants, rework, conformance, run stats

**Files:**
- Create: `api/services/process_discovery/filters.py`
- Create: `api/services/process_discovery/mining.py`
- Test: `tests/process_discovery/test_mining.py` (no DB)
- Test: `tests/process_discovery/test_mining_pg.py` (Postgres; skipped without `MERIDIAN_TEST_DB_URL`)

**Interfaces:**
- Consumes:
  - From Task 20: tables `process_events`, `process_discovery_runs` and `process_discovery_variants` (migration 079), and `ix_pe_case`.
  - From Task 21: `events.ActivityMap`, `events.DEFAULT_TZ`, `builders.builder(l1).MAPPING`.
  - `workers.db.tenant_session(engine, tenant_id)` (existing, `workers/db.py:33`). The PG test uses it so every transaction sets `app.tenant_id` under the `_rls` policies.
  - `api.services.bpmn_layout._ranks(order, flows, starts)` (existing, `bpmn_layout.py:43`) for loop detection.
- Produces:
  - `filters.ProcessFilter` (Pydantic): `period_from`, `period_to`, `org`, `doc_type`, `case_type`, `automated`, plus `from_query(params)` and `digest()`.
  - `filters.case_filter_sql(flt, tz) -> (having_sql, params)`.
  - `mining.Scope(tenant_id, system_id, l1, tz)`.
  - `mining.Edge`, `mining.ActivityStats`, `mining.Variant`, `mining.Conformance`, `mining.CaseTypeResult` (with `stored()`), and `mining.MiningResult` (with `stats(tables, truncated, shared_objects)`).
  - `mining.mine(session, scope, mapping, primary) -> MiningResult` and `mining.mine_case_type(session, scope, case_type, flt, mapping) -> CaseTypeResult`.
  - `mining.store_variants(session, run_id, tenant_id, result) -> int`.
  - `mining.truncate`, `mining.conformance`, `mining.expected_groups`, `mining.score_variant`, `mining.loops(edges)`, `mining.is_unmapped(l5_id)` and `mining.cache_key(scope, flt, run_id)`.
  - Constants `START`, `END`, `OTHER`, `OTHER_HASH`, `TOP_VARIANTS`, `CACHE_TTL`.
  - Task 25 consumes `MiningResult`. Task 27 consumes `mine`, `store_variants`, `stats`, `mine_case_type`, `ProcessFilter.from_query`, `cache_key` and `CACHE_TTL`.

Decisions this task fixes, and why:
- Every query takes the same two CTEs: `f`, the filtered case ids, and `pe`, their events. Filters therefore always mean "cases whose first event matches", as spec §3.1 requires. Filters never mean "events that match".
- `case_filter_sql` returns a `HAVING` body. It reads the first event as `(array_agg(x ORDER BY ts, seq, id))[1]`, the same order the DFG window uses.
- The org key is a bind parameter (`org ->> :f_ok0`), not SQL text. `ProcessFilter` also rejects keys outside `^[A-Za-z][A-Za-z0-9_]{0,15}$`, because the key comes from the URL.
- The period compares the first event's date in the system time zone (`sap_systems.timezone`, default `Africa/Johannesburg`). Day-precision events are stored at local midnight, so a UTC date would move them to the previous day.
- `automated=false` means "no event is known to be automated" (`NOT coalesce(bool_or(automated), false)`). A case whose events are all unknown therefore passes.
- Variants are grouped by the path text. `md5(path)` is only the stored key, because equal paths give equal hashes. Case throughput is the `()` grouping set of the same query, so there is no second scan.
- `MiningResult` keeps every variant, not only the top 2,000. Task 25 rolls stats up to L4, L3 and L2 from variant sequences, and the "other" bucket has no sequence. `stored()` is the spec §3.3 cut: the top 2,000 plus `__OTHER__`. Conformance runs on `stored()`, as spec §3.5 says.
- Rework rate is "cases that repeat the activity / cases that contain it". The spec says "share of cases" without a denominator. With "cases of the case type" as the denominator, a rare activity that always repeats would look like low rework.
- A runtime activity key (`STATUS_TECO`, `POST_FB01`, `APPLICATION_HIRED`) takes the Order of its template row (`STATUS_<STAT>` and so on) by prefix. Such keys are mapped, so they are optional, not extra. Template rows are never expected.
- Alternative groups appear in `stats.conformance.missing` as the keys joined by `|`.
- `unmapped` in run stats counts events whose `l5_id` is in the `<L1>-DSC-…` branch (spec §4.2 rule 3) or is NULL. `X_` ids under a known L4 are mapped.
- When a case type has no `expected=True` row (for example HTR `org_object`), conformance is `None`, not 1.0.
- Loops are DFG edges whose target does not rank above its source in `bpmn_layout._ranks`. Every kept edge raises the rank by at least one. Self-loops are rework, so they are left out of loops.
- Workers and routes call the same sync functions. Routes call them through `AsyncSession.run_sync` (Task 27), so there is one SQL implementation.

- [ ] **Step 1: Write the failing tests**

`tests/process_discovery/test_mining.py`:

```python
"""Mining logic that needs no database (spec §3.1, §3.3, §3.4, §3.5, §3.7)."""

from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from api.services.process_discovery.builders import builder
from api.services.process_discovery.filters import ProcessFilter, case_filter_sql
from api.services.process_discovery.mining import (
    OTHER, OTHER_HASH, ActivityStats, CaseTypeResult, Conformance, Edge, MiningResult, Scope, Variant,
    cache_key, conformance, expected_groups, is_unmapped, loops, score_variant, truncate, _order_of,
)
from api.services.process_discovery.events import ActivityMap

PTP = [m for m in builder("PTP").MAPPING if m.case_type == "po_item"]
HAPPY = ("CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE")


def v(acts: tuple[str, ...], n: int, h: str = "") -> Variant:
    return Variant(h or ("%032x" % abs(hash(acts)))[:32], acts, n, 0.0, None, None, ("c",))


def test_expected_groups_follow_order() -> None:
    assert expected_groups(PTP) == [frozenset({k}) for k in HAPPY]


def test_happy_path_fits_and_optional_steps_are_not_extra() -> None:
    order = _order_of(PTP)
    groups = expected_groups(PTP)
    assert score_variant(HAPPY, groups, order)[0] == 1.0
    fit, missing, bad = score_variant(("CREATE_PR", "CREATE_PO_ITEM", "CHANGE_PO_QTY", *HAPPY[1:]), groups, order)
    assert (fit, missing, bad) == (1.0, [], set())


def test_missing_extra_and_out_of_order() -> None:
    order = _order_of(PTP)
    groups = expected_groups(PTP)
    # GR missing (1), ZZ unmapped (1), INVOICE before CREATE_PO_ITEM: one inverted pair (1). 3 / (4 + 4)
    fit, missing, bad = score_variant(("INVOICE_RECEIPT", "CREATE_PO_ITEM", "ZZ", "CLEAR_INVOICE"), groups, order)
    assert fit == pytest.approx(1 - 3 / 8)
    assert missing == [frozenset({"GOODS_RECEIPT"})]
    assert bad == {"INVOICE_RECEIPT", "CREATE_PO_ITEM"}


def test_repeat_counts_only_first_occurrence_for_order() -> None:
    order = _order_of(PTP)
    fit, _, bad = score_variant((*HAPPY[:2], "CREATE_PO_ITEM", *HAPPY[2:]), expected_groups(PTP), order)
    assert bad == set() and fit == 1.0


def test_alternatives_share_an_order() -> None:
    a = ActivityMap("A", "A", "X-A", "c", "", "", "", 1, True)
    b = ActivityMap("B", "B", "X-B", "c", "", "", "", 1, True)
    z = ActivityMap("Z", "Z", "X-Z", "c", "", "", "", 2, True)
    groups = expected_groups([a, b, z])
    assert groups == [frozenset({"A", "B"}), frozenset({"Z"})]
    assert score_variant(("B", "Z"), groups, _order_of([a, b, z]))[0] == 1.0


def test_runtime_keys_match_their_template_row() -> None:
    m = builder("PM").MAPPING
    order = _order_of(m)
    tmpl = next(x for x in m if x.key == "STATUS_<STAT>")
    assert order("STATUS_TECO") == tmpl.order
    assert order("NOT_A_KEY") is None


def test_conformance_is_weighted_and_other_bucket_scores_zero() -> None:
    vs = [v(HAPPY, 3), v(HAPPY[:1] + HAPPY[2:], 1)]
    rest = [v(HAPPY + (f"X{i}",), 1) for i in range(3)]
    stored = truncate(vs + rest, 7, top=2)
    assert stored[-1].hash == OTHER_HASH and stored[-1].activities == (OTHER,)
    assert stored[-1].case_count == 3 and stored[-1].sample_case_ids == ("c", "c", "c")
    c = conformance(stored, PTP)
    assert stored[-1].fitness == 0.0
    assert stored[0].fitness == 1.0
    assert stored[1].fitness == pytest.approx(round(1 - 1 / 7, 4))
    assert c.fitness == pytest.approx(round((3 * 1 + 1 * (1 - 1 / 7)) / 7, 4))
    assert c.missing["GOODS_RECEIPT"] == pytest.approx(round(4 / 7, 4))
    assert c.step_fitness["CREATE_PO_ITEM"] == pytest.approx(round(1 - 3 / 7, 4))


def test_no_expected_rows_means_no_conformance() -> None:
    opt = [ActivityMap("A", "A", "X-A", "c", "", "", "", 1, False)]
    assert conformance([v(("A",), 2)], opt) == Conformance(None, {}, {}, {})


def test_truncate_keeps_short_lists_whole() -> None:
    vs = [v(HAPPY, 2)]
    assert truncate(vs, 2) == vs


def test_loops_are_back_edges_and_self_loops_are_not() -> None:
    e = [Edge("__START__", "A", 5, 5, None, None), Edge("A", "B", 5, 5, 1, 1), Edge("B", "A", 2, 2, 1, 1),
         Edge("B", "B", 1, 1, 0, 0), Edge("B", "__END__", 5, 5, None, None)]
    assert loops(e) == {("B", "A")}


def test_unmapped_is_the_discovered_branch() -> None:
    assert is_unmapped("R2R-DSC-POST_ZF01-01") and is_unmapped(None)
    assert not is_unmapped("PM-PLN-IW31-X_STATUS_TECO") and not is_unmapped("PTP-GR-MIGO-01")


def test_filter_from_query_and_sql() -> None:
    flt = ProcessFilter.from_query({"from": "2025-01-01", "to": "2025-03-31", "org.BUKRS": ["1000,2000"],
                                    "doc_type": "NB", "automated": "false", "case_type": "po_item"})
    assert flt.period_from == date(2025, 1, 1) and flt.org == {"BUKRS": ["1000", "2000"]}
    assert (flt.doc_type, flt.automated, flt.case_type) == (["NB"], False, "po_item")
    sql, p = case_filter_sql(flt, "Africa/Johannesburg")
    assert "(array_agg(org ->> :f_ok0 ORDER BY ts, seq, id))[1] = ANY(:f_ov0)" in sql
    assert "NOT coalesce(bool_or(automated), false)" in sql
    assert p["f_ok0"] == "BUKRS" and p["f_ov0"] == ["1000", "2000"] and p["f_dt"] == ["NB"]
    assert case_filter_sql(ProcessFilter(), "UTC") == ("TRUE", {"f_tz": "UTC"})


def test_org_key_is_validated_because_it_reaches_the_query() -> None:
    with pytest.raises(ValidationError):
        ProcessFilter(org={"BUKRS'; DROP": ["1"]})


def test_cache_key_changes_with_filter_and_run() -> None:
    s = Scope("t", "s", "PTP")
    a = cache_key(s, ProcessFilter(), "r1")
    assert a.startswith("pd:dfg:t:s:PTP:") and a.endswith(":r1")
    assert a != cache_key(s, ProcessFilter(doc_type=["NB"]), "r1") and a != cache_key(s, ProcessFilter(), "r2")


def test_stats_shape() -> None:
    act = ActivityStats("POST_ZF01", "R2R-DSC-POST_ZF01-01", 4, 2, 1.0, None, None, 0.5, 0.25, 1, 4)
    r = CaseTypeResult("fi_doc", 2, 4, 10.0, 20.0, [], {act.activity: act}, [v(("POST_ZF01",), 2)],
                       Conformance(0.5, {"A": 0.5}, {}, {}))
    s = MiningResult("R2R", "fi_doc", {"fi_doc": r}).stats({"BKPF": {"rows": 4, "partial": False}}, [], 0)
    assert set(s) == {"cases", "events", "variants", "case_types", "throughput", "automation_rate", "conformance",
                      "rework", "tables", "truncated_tables", "shared_objects", "unmapped"}
    assert s["automation_rate"] == 0.25 and s["unmapped"] == {"POST_ZF01": 4} and s["rework"] == {"POST_ZF01": 0.5}
    assert s["throughput"] == {"median_seconds": 10.0, "p90_seconds": 20.0} and s["conformance"]["fitness"] == 0.5
```

`tests/process_discovery/test_mining_pg.py`:

```python
"""Mining SQL against Postgres (spec §3.1-§3.3, §3.6). Skipped without MERIDIAN_TEST_DB_URL."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HAPPY = ["CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE"]
T0 = datetime(2025, 1, 10, 8, 0, tzinfo=timezone.utc)
T1 = datetime(2025, 2, 10, 8, 0, tzinfo=timezone.utc)
DAY = 86400


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def log():
    """One tenant, one system, one PTP run: three po_item cases and one vendor case."""
    from sqlalchemy import create_engine, text

    from workers.db import tenant_session

    _alembic("upgrade", "head")
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDM-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": sid, "t": tid})
    events = []

    def add(case, acts, start, org, doc, auto=(), same_second=()):
        for i, a in enumerate(acts):
            ts = start + timedelta(days=0 if i in same_second else i)
            events.append({"ct": "vendor" if a == "CREATE_VENDOR" else "po_item", "case": case, "a": a,
                           "ts": ts, "seq": i, "auto": i in auto, "doc": doc, "org": json.dumps({"BUKRS": org}),
                           "l5": None if a == "ZZ_UNMAPPED" else f"PTP-X-{a}"})

    add("4500000001/00010", HAPPY, T0, "1000", "NB")
    add("4500000002/00010", HAPPY, T0, "2000", "FO")
    add("4500000003/00010", ["CREATE_PO_ITEM", "CHANGE_PO_QTY", "CHANGE_PO_QTY", "INVOICE_RECEIPT"], T1, "1000",
        "NB", auto=(2,), same_second=(1, 2))
    add("0000100001", ["CREATE_VENDOR"], T0, "1000", None)
    s = tenant_session(eng, tid)
    rid = str(s.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                             "VALUES (:t, :s, 'PTP', 'full', 'mining') RETURNING id"), {"t": tid, "s": sid}).scalar())
    s.execute(text(
        "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, l5_id, ts, ts_precision,"
        " seq, automated, doc_type, org, source_table, run_id) VALUES (:t, :s, 'PTP', :ct, :case, :a, :l5, :ts, "
        "'second', :seq, :auto, :doc, CAST(:org AS jsonb), 'EKPO', :r)"),
        [{**e, "t": tid, "s": sid, "r": rid} for e in events])
    s.commit()
    yield s, tid, sid, rid
    s.close()
    eng.dispose()  # rows stay, like tests/test_process_event_log_pg.py; every test uses a fresh tenant


def _mine(log, **flt):
    from api.services.process_discovery.builders import builder
    from api.services.process_discovery.filters import ProcessFilter
    from api.services.process_discovery.mining import Scope, mine_case_type

    s, tid, sid, _ = log
    return mine_case_type(s, Scope(tid, sid, "PTP"), "po_item", ProcessFilter(**flt), builder("PTP").MAPPING)


@pg
def test_variants_and_throughput(log) -> None:
    r = _mine(log)
    assert (r.cases, r.events) == (3, 12)
    top = r.variants[0]
    assert top.activities == tuple(HAPPY) and top.case_count == 2 and top.share == pytest.approx(0.666667)
    assert top.hash == hashlib.md5(">".join(HAPPY).encode()).hexdigest()
    assert top.median_seconds == 3 * DAY and top.sample_case_ids == ("4500000001/00010", "4500000002/00010")
    assert r.variants[1].activities == ("CREATE_PO_ITEM", "CHANGE_PO_QTY", "CHANGE_PO_QTY", "INVOICE_RECEIPT")
    assert r.median_seconds == 3 * DAY


@pg
def test_dfg_edges_start_end_and_waiting_time(log) -> None:
    e = {(x.source, x.target): x for x in _mine(log).edges}
    assert e[("__START__", "CREATE_PO_ITEM")].count == 3
    assert e[("CREATE_PO_ITEM", "GOODS_RECEIPT")].median_seconds == DAY
    assert e[("CHANGE_PO_QTY", "CHANGE_PO_QTY")].median_seconds == 0
    assert e[("CLEAR_INVOICE", "__END__")].count == 2 and e[("INVOICE_RECEIPT", "__END__")].count == 1
    assert e[("CLEAR_INVOICE", "__END__")].median_seconds is None


@pg
def test_node_stats_rework_automation_conformance(log) -> None:
    r = _mine(log)
    q = r.activities["CHANGE_PO_QTY"]
    assert (q.events, q.cases, q.rework_rate, q.automation_rate) == (2, 1, 1.0, 0.5)
    assert r.activities["CREATE_PO_ITEM"].share == 1.0 and r.activities["CREATE_PO_ITEM"].l5_id == "PTP-X-CREATE_PO_ITEM"
    assert r.conformance.missing == {"GOODS_RECEIPT": pytest.approx(0.3333), "CLEAR_INVOICE": pytest.approx(0.3333)}
    assert r.variants[0].fitness == 1.0 and r.variants[1].fitness == pytest.approx(round(1 - 2 / 8, 4))


@pg
def test_filters_use_the_first_event(log) -> None:
    assert _mine(log, org={"BUKRS": ["2000"]}).cases == 1
    assert _mine(log, doc_type=["NB"]).cases == 2
    assert _mine(log, automated=True).cases == 1
    assert _mine(log, automated=False).cases == 2
    assert _mine(log, period_from=date(2025, 2, 1)).cases == 1
    assert _mine(log, period_to=date(2025, 1, 31)).cases == 2
    assert _mine(log, org={"BUKRS": ["9999"]}).cases == 0


@pg
def test_mine_all_case_types_and_store_variants(log) -> None:
    from sqlalchemy import text

    from api.services.process_discovery.builders import builder
    from api.services.process_discovery.mining import Scope, mine, store_variants

    s, tid, sid, rid = log
    m = mine(s, Scope(tid, sid, "PTP"), builder("PTP").MAPPING, "po_item")
    assert set(m.by_type) == {"po_item", "vendor"}
    stats = m.stats()
    assert stats["cases"] == 4 and stats["case_types"] == {"po_item": 3, "vendor": 1}
    assert stats["automation_rate"] == pytest.approx(round(1 / 13, 4))
    assert stats["rework"] == {"CHANGE_PO_QTY": 1.0}
    assert store_variants(s, rid, tid, m.by_type["po_item"]) == 2
    s.commit()
    row = s.execute(text("SELECT case_count, share, fitness, activities, median_seconds FROM "
                         "process_discovery_variants WHERE run_id = :r ORDER BY case_count DESC LIMIT 1"),
                    {"r": rid}).one()
    assert (row.case_count, float(row.share), float(row.fitness), row.activities, row.median_seconds) == (
        2, 0.666667, 1.0, HAPPY, 3 * DAY)
```

- [ ] **Step 2: Run them (FAIL)**

Run: `pytest tests/process_discovery/test_mining.py -q`
Expected: FAIL, collection error `ModuleNotFoundError: No module named 'api.services.process_discovery.filters'`.

- [ ] **Step 3: Create the filter model**

`api/services/process_discovery/filters.py`:

```python
"""Mining filters (spec §3.1). Every filter tests the case's first event, except ``automated``."""

from __future__ import annotations

import hashlib
import re
from datetime import date
from typing import Mapping, Optional

from pydantic import BaseModel, field_validator

_ORG_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,15}$")


class ProcessFilter(BaseModel):
    period_from: Optional[date] = None
    period_to: Optional[date] = None
    org: dict[str, list[str]] = {}
    doc_type: list[str] = []
    case_type: Optional[str] = None  # None = primary case type of the L1
    automated: Optional[bool] = None

    @field_validator("org")
    @classmethod
    def _org_keys(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        bad = [k for k in v if not _ORG_KEY.match(k)]
        if bad:
            raise ValueError(f"invalid org key: {bad[0]}")
        return {k: vals for k, vals in sorted(v.items()) if vals}

    @classmethod
    def from_query(cls, params: Mapping[str, object]) -> "ProcessFilter":
        """Parse ``?from=&to=&org.BUKRS=&doc_type=&case_type=&automated=``.

        ``params`` is a ``MultiDict`` (Starlette ``request.query_params``) or a plain dict of lists;
        repeated keys and comma-separated values both give lists."""
        def values(key: str) -> list[str]:
            raw = params.getlist(key) if hasattr(params, "getlist") else params.get(key, [])
            raw = [raw] if isinstance(raw, str) else list(raw)
            return [p for v in raw for p in str(v).split(",") if p]

        auto = values("automated")
        return cls(
            period_from=(values("from") or [None])[0],
            period_to=(values("to") or [None])[0],
            org={k[4:]: values(k) for k in params.keys() if k.startswith("org.")},
            doc_type=values("doc_type"),
            case_type=(values("case_type") or [None])[0],
            automated=None if not auto else auto[0].lower() in ("1", "true", "yes"),
        )

    def digest(self) -> str:
        """sha1 of the canonical JSON; the Redis DFG cache key part (spec §3.7)."""
        return hashlib.sha1(self.model_dump_json().encode()).hexdigest()


def case_filter_sql(flt: ProcessFilter, tz: str) -> tuple[str, dict[str, object]]:
    """``HAVING`` body over one case's events, and its bind params.

    The first event is ``(array_agg(x ORDER BY ts, seq, id))[1]``, the same order every mining query uses.
    ``tz`` turns the first event's instant into the SAP-local date the period compares against."""
    conds: list[str] = []
    p: dict[str, object] = {"f_tz": tz}
    if flt.period_from:
        conds.append("(min(ts) AT TIME ZONE :f_tz)::date >= :f_from")
        p["f_from"] = flt.period_from
    if flt.period_to:
        conds.append("(min(ts) AT TIME ZONE :f_tz)::date <= :f_to")
        p["f_to"] = flt.period_to
    for i, (key, vals) in enumerate(flt.org.items()):
        conds.append(f"(array_agg(org ->> :f_ok{i} ORDER BY ts, seq, id))[1] = ANY(:f_ov{i})")
        p[f"f_ok{i}"], p[f"f_ov{i}"] = key, list(vals)
    if flt.doc_type:
        conds.append("(array_agg(doc_type ORDER BY ts, seq, id))[1] = ANY(:f_dt)")
        p["f_dt"] = list(flt.doc_type)
    if flt.automated is True:
        conds.append("bool_or(automated) IS TRUE")
    elif flt.automated is False:
        conds.append("NOT coalesce(bool_or(automated), false)")
    return (" AND ".join(conds) or "TRUE"), p
```

- [ ] **Step 4: Create the mining module**

`api/services/process_discovery/mining.py`:

```python
"""Process mining over ``process_events`` (spec §3).

Aggregates run in Postgres. Conformance and the roll-ups that need variant sequences run in Python.
Every query is scoped by ``(tenant_id, system_id, l1, case_type)`` and walks ``ix_pe_case``."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session
from sqlalchemy.types import Text

from api.services.process_discovery.events import DEFAULT_TZ, ActivityMap
from api.services.process_discovery.filters import ProcessFilter, case_filter_sql

START, END, OTHER = "__START__", "__END__", "__OTHER__"
OTHER_HASH = "0" * 32
TOP_VARIANTS = 2000
SAMPLES = 5
CACHE_TTL = 600

# f: the filtered cases; pe: their events. Shared by every query below.
_CASES = """
WITH f AS (
    SELECT case_id FROM process_events
    WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct
    GROUP BY case_id HAVING {having}),
pe AS (
    SELECT p.* FROM process_events p JOIN f USING (case_id)
    WHERE p.tenant_id = :t AND p.system_id = :s AND p.l1 = :l1 AND p.case_type = :ct)"""

_SEQ = """,
e AS (
    SELECT case_id, activity, ts, l5_id, automated,
           lead(activity) OVER w AS nxt, lead(ts) OVER w AS nxt_ts, row_number() OVER w AS rn
    FROM pe WINDOW w AS (PARTITION BY case_id ORDER BY ts, seq, id))"""

DFG_SQL = _CASES + _SEQ + """
SELECT activity AS src, coalesce(nxt, '__END__') AS tgt, count(*) AS n, count(DISTINCT case_id) AS cases,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM nxt_ts - ts)) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM nxt_ts - ts)) AS p90_s
FROM e GROUP BY 1, 2
UNION ALL
SELECT '__START__', activity, count(*), count(*), NULL, NULL FROM e WHERE rn = 1 GROUP BY activity"""

NODES_SQL = _CASES + _SEQ + """,
r AS (SELECT activity, count(*) FILTER (WHERE n > 1) AS rework
      FROM (SELECT case_id, activity, count(*) AS n FROM pe GROUP BY 1, 2) x GROUP BY activity)
SELECT e.activity, max(e.l5_id) AS l5_id, count(*) AS events, count(DISTINCT e.case_id) AS cases,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.nxt_ts - e.ts)) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM e.nxt_ts - e.ts)) AS p90_s,
       count(*) FILTER (WHERE e.automated) AS auto_n, count(e.automated) AS auto_known,
       max(r.rework) AS rework
FROM e JOIN r USING (activity) GROUP BY e.activity"""

VARIANTS_SQL = _CASES + """,
v AS (
    SELECT case_id, string_agg(activity, '>' ORDER BY ts, seq, id) AS path,
           extract(epoch FROM max(ts) - min(ts)) AS dur
    FROM pe GROUP BY case_id)
SELECT path, md5(path) AS hash, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY dur) AS p90_s,
       (array_agg(case_id ORDER BY case_id))[1:5] AS samples
FROM v GROUP BY GROUPING SETS ((path), ())"""

CASE_TYPES_SQL = """
SELECT case_type, count(DISTINCT case_id) FROM process_events
WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 GROUP BY case_type"""

INSERT_VARIANT_SQL = text("""
INSERT INTO process_discovery_variants (run_id, tenant_id, case_type, variant_hash, activities, case_count,
                                        share, median_seconds, p90_seconds, fitness, sample_case_ids)
VALUES (:run_id, :tenant_id, :case_type, :variant_hash, :activities, :case_count, :share, :median_seconds,
        :p90_seconds, :fitness, :sample_case_ids)""").bindparams(
    bindparam("activities", type_=ARRAY(Text)), bindparam("sample_case_ids", type_=ARRAY(Text)))


@dataclass(frozen=True)
class Scope:
    tenant_id: str
    system_id: str
    l1: str
    tz: str = DEFAULT_TZ  # sap_systems.timezone, or the default

    def params(self, case_type: str) -> dict[str, object]:
        return {"t": self.tenant_id, "s": self.system_id, "l1": self.l1, "ct": case_type}


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    count: int
    cases: int
    median_seconds: Optional[float]
    p90_seconds: Optional[float]


@dataclass(frozen=True)
class ActivityStats:
    activity: str
    l5_id: Optional[str]
    events: int
    cases: int
    share: float
    median_seconds: Optional[float]  # to the next event of the same case
    p90_seconds: Optional[float]
    rework_rate: float               # cases repeating it / cases containing it
    automation_rate: Optional[float]
    auto_events: int
    auto_known: int


@dataclass
class Variant:
    hash: str
    activities: tuple[str, ...]
    case_count: int
    share: float
    median_seconds: Optional[float]
    p90_seconds: Optional[float]
    sample_case_ids: tuple[str, ...]
    fitness: Optional[float] = None


@dataclass(frozen=True)
class Conformance:
    fitness: Optional[float]
    missing: dict[str, float]       # expected key (alternatives joined by "|") -> share of cases missing it
    out_of_order: dict[str, float]  # activity -> share of cases where it is out of order
    step_fitness: dict[str, float]  # expected activity -> step fitness (spec §3.5)


@dataclass
class CaseTypeResult:
    case_type: str
    cases: int
    events: int
    median_seconds: Optional[float]
    p90_seconds: Optional[float]
    edges: list[Edge]
    activities: dict[str, ActivityStats]
    variants: list[Variant]         # every variant, by case count; ``stored()`` is the top 2,000 plus other
    conformance: Conformance = field(default_factory=lambda: Conformance(None, {}, {}, {}))

    def stored(self) -> list[Variant]:
        return truncate(self.variants, self.cases)


@dataclass
class MiningResult:
    l1: str
    primary: str
    by_type: dict[str, CaseTypeResult]

    def stats(self, tables: Optional[dict] = None, truncated: Sequence[str] = (), shared_objects: int = 0) -> dict:
        """``process_discovery_runs.stats`` (spec §3.6). Throughput and conformance are the primary case type's."""
        acts = [a for r in self.by_type.values() for a in r.activities.values()]
        known = sum(a.auto_known for a in acts)
        p = self.by_type.get(self.primary)
        return {
            "cases": sum(r.cases for r in self.by_type.values()),
            "events": sum(r.events for r in self.by_type.values()),
            "variants": sum(len(r.variants) for r in self.by_type.values()),
            "case_types": {ct: r.cases for ct, r in sorted(self.by_type.items())},
            "throughput": {"median_seconds": p.median_seconds if p else None,
                           "p90_seconds": p.p90_seconds if p else None},
            "automation_rate": round(sum(a.auto_events for a in acts) / known, 4) if known else None,
            "conformance": {"fitness": p.conformance.fitness if p else None,
                            "missing": p.conformance.missing if p else {},
                            "out_of_order": p.conformance.out_of_order if p else {}},
            "rework": {a.activity: round(a.rework_rate, 4) for a in acts if a.rework_rate > 0},
            "tables": tables or {},
            "truncated_tables": list(truncated),
            "shared_objects": shared_objects,
            "unmapped": {a.activity: a.events for a in acts if is_unmapped(a.l5_id)},
        }


def is_unmapped(l5_id: Optional[str]) -> bool:
    """No reference L4: the ``<L1>-DSC-…`` branch of spec §4.2 rule 3, or no id at all."""
    return not l5_id or "-DSC-" in l5_id


def _f(v) -> Optional[float]:
    return None if v is None else float(v)


def _query(session: Session, sql: str, scope: Scope, case_type: str, flt: ProcessFilter):
    having, p = case_filter_sql(flt, scope.tz)
    return session.execute(text(sql.format(having=having)), {**scope.params(case_type), **p}).all()


def mine_case_type(session: Session, scope: Scope, case_type: str, flt: ProcessFilter,
                   mapping: Sequence[ActivityMap]) -> CaseTypeResult:
    """DFG, node stats, variants and conformance for one case type under ``flt``."""
    vrows = _query(session, VARIANTS_SQL, scope, case_type, flt)
    total = next((r for r in vrows if r.path is None), None)
    cases = int(total.n) if total else 0
    variants = sorted(
        (Variant(r.hash, tuple(r.path.split(">")), int(r.n), round(r.n / cases, 6), _f(r.median_s), _f(r.p90_s),
                 tuple(r.samples)) for r in vrows if r.path is not None),
        key=lambda v: (-v.case_count, v.hash))
    edges = sorted((Edge(r.src, r.tgt, int(r.n), int(r.cases), _f(r.median_s), _f(r.p90_s))
                    for r in _query(session, DFG_SQL, scope, case_type, flt)),
                   key=lambda e: (-e.count, e.source, e.target))
    acts = {r.activity: ActivityStats(
        r.activity, r.l5_id, int(r.events), int(r.cases), round(r.cases / cases, 6) if cases else 0.0,
        _f(r.median_s), _f(r.p90_s), round(r.rework / r.cases, 6) if r.cases else 0.0,
        round(r.auto_n / r.auto_known, 6) if r.auto_known else None, int(r.auto_n), int(r.auto_known))
        for r in _query(session, NODES_SQL, scope, case_type, flt)}
    result = CaseTypeResult(case_type, cases, sum(a.events for a in acts.values()),
                            _f(total.median_s) if total else None, _f(total.p90_s) if total else None,
                            edges, acts, variants)
    result.conformance = conformance(result.stored(), [m for m in mapping if m.case_type == case_type])
    return result


def mine(session: Session, scope: Scope, mapping: Sequence[ActivityMap], primary: str) -> MiningResult:
    """Unfiltered mining of every case type present for the scope (the run's model, spec §4)."""
    types = [r[0] for r in session.execute(text(CASE_TYPES_SQL), scope.params(""))]
    return MiningResult(scope.l1, primary, {ct: mine_case_type(session, scope, ct, ProcessFilter(case_type=ct),
                                                               mapping) for ct in sorted(types)})


def truncate(variants: Sequence[Variant], cases: int, top: int = TOP_VARIANTS) -> list[Variant]:
    """The top ``top`` variants, plus one ``__OTHER__`` row summing the rest (spec §3.3). Medians of the
    other bucket are unknown, so they are None."""
    keep = list(variants[:top])
    rest = variants[top:]
    if rest:
        n = sum(v.case_count for v in rest)
        keep.append(Variant(OTHER_HASH, (OTHER,), n, round(n / cases, 6) if cases else 0.0, None, None,
                            tuple(c for v in rest for c in v.sample_case_ids)[:SAMPLES], 0.0))
    return keep


def store_variants(session: Session, run_id: str, tenant_id: str, result: CaseTypeResult) -> int:
    """Write the stored variants of one case type. The caller's session has ``app.tenant_id`` set."""
    rows = [{"run_id": run_id, "tenant_id": tenant_id, "case_type": result.case_type, "variant_hash": v.hash,
             "activities": list(v.activities), "case_count": v.case_count, "share": v.share,
             "median_seconds": None if v.median_seconds is None else round(v.median_seconds),
             "p90_seconds": None if v.p90_seconds is None else round(v.p90_seconds),
             "fitness": None if v.fitness is None else round(v.fitness, 4),
             "sample_case_ids": list(v.sample_case_ids)} for v in result.stored()]
    if rows:
        session.execute(INSERT_VARIANT_SQL, rows)
    return len(rows)


# --- conformance (spec §3.5) ---------------------------------------------------------------------------


def _order_of(mapping: Sequence[ActivityMap]):
    exact = {m.key: m.order for m in mapping}
    # A runtime key (STATUS_TECO, POST_FB01) belongs to its template row (STATUS_<STAT>, POST_<TCODE>).
    prefixes = [(m.key[:m.key.index("<")], m.order) for m in mapping if "<" in m.key]

    def order(activity: str) -> Optional[int]:
        if activity in exact:
            return exact[activity]
        return next((o for p, o in prefixes if activity.startswith(p)), None)
    return order


def expected_groups(mapping: Sequence[ActivityMap]) -> list[frozenset[str]]:
    """Expected activities sorted by Order; rows sharing an Order are alternatives (one group)."""
    by_order: dict[int, set[str]] = {}
    for m in mapping:
        if m.expected and "<" not in m.key:
            by_order.setdefault(m.order, set()).add(m.key)
    return [frozenset(by_order[o]) for o in sorted(by_order)]


def score_variant(activities: Sequence[str], groups: Sequence[frozenset[str]], order) -> tuple[
        float, list[frozenset[str]], set[str]]:
    """(fitness, missing groups, activities out of order) for one variant."""
    present = set(activities)
    missing = [g for g in groups if not g & present]
    extra = sum(1 for a in activities if order(a) is None)
    firsts = [a for i, a in enumerate(activities) if a not in activities[:i] and order(a) is not None]
    bad: set[str] = set()
    inversions = 0
    for i, a in enumerate(firsts):
        for b in firsts[i + 1:]:
            if order(a) > order(b):
                inversions += 1
                bad.update((a, b))
    denom = len(groups) + len(activities)
    fit = 1.0 - (len(missing) + extra + inversions) / denom if denom else 1.0
    return max(0.0, min(1.0, fit)), missing, bad


def conformance(variants: Iterable[Variant], mapping: Sequence[ActivityMap]) -> Conformance:
    """Score each variant (sets ``Variant.fitness``) and weight by case count. Without expected rows for the
    case type there is no reference to conform to, so every value is None or empty."""
    groups = expected_groups(mapping)
    if not groups:
        return Conformance(None, {}, {}, {})
    order = _order_of(mapping)
    total = 0
    weighted = 0.0
    missing: Counter[frozenset[str]] = Counter()
    bad: Counter[str] = Counter()
    for v in variants:
        fit, miss, oo = score_variant(v.activities, groups, order)
        v.fitness = round(fit, 4)
        total += v.case_count
        weighted += fit * v.case_count
        missing.update({g: v.case_count for g in miss})
        bad.update({a: v.case_count for a in oo})
    if not total:
        return Conformance(None, {}, {}, {})

    def name(g: frozenset[str]) -> str:
        return "|".join(sorted(g))
    step = {k: round(1 - (missing[g] + bad[k]) / total, 4) for g in groups for k in sorted(g)}
    return Conformance(round(weighted / total, 4),
                       {name(g): round(missing[g] / total, 4) for g in groups if missing[g]},
                       {a: round(n / total, 4) for a, n in sorted(bad.items())},
                       {k: max(0.0, v) for k, v in step.items()})


def loops(edges: Iterable[Edge]) -> set[tuple[str, str]]:
    """Back-edges of the DFG: target ranks before source in ``bpmn_layout._ranks`` (spec §3.4).
    Self-loops are rework, not loops, and are left out."""
    from api.services.bpmn_layout import _ranks

    flows = [(f"e{i}", e.source, e.target) for i, e in enumerate(edges) if e.source != e.target]
    nodes = sorted({n for _, s, t in flows for n in (s, t)})
    rank = _ranks(nodes, flows, [START] if START in nodes else [])
    return {(s, t) for _, s, t in flows if rank[t] <= rank[s]}  # a kept edge always raises the rank


def cache_key(scope: Scope, flt: ProcessFilter, run_id: str) -> str:
    """Redis key of a filtered DFG (spec §3.7). A new run changes ``run_id``, which invalidates it."""
    return f"pd:dfg:{scope.tenant_id}:{scope.system_id}:{scope.l1}:{flt.digest()}:{run_id}"
```

- [ ] **Step 5: Run them (PASS)**

Run: `pytest tests/process_discovery/test_mining.py -q`
Expected: `15 passed`.

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/pd_test pytest tests/process_discovery/test_mining_pg.py -q`
Expected: `5 passed`. Without the URL, expect `5 skipped`.

Run: `pytest --collect-only -q tests/process_discovery | tail -1`
Expected: `88 tests collected`.

- [ ] **Step 6: Commit**

```bash
git add api/services/process_discovery/filters.py api/services/process_discovery/mining.py tests/process_discovery/test_mining.py tests/process_discovery/test_mining_pg.py
git commit -m "$(cat <<'MSG'
feat(process): mining over the event log (DFG, variants, rework, conformance)

Filters apply to each case's first event. Conformance is scored per variant
and weighted by case count.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 25: Generation (wave 25): discovered L1-L5 model, stats roll-up, as-is L4 diagrams, l5_id write-back

**Files:**
- Modify: `api/models/process_model.py` (`Source`, new `DiscoveryEdge` and `DiscoveryStats`, `discovery` on L1-L5, `source` on L1-L3)
- Modify: `api/services/process_model_validator.py` (`_validate_diagram`: exempt not-observed tasks from the reachability check)
- Create: `api/services/process_discovery/generate.py`
- Test: `tests/process_discovery/test_generate.py` (no DB)
- Test: `tests/process_discovery/test_generate_pg.py` (Postgres; skipped without `MERIDIAN_TEST_DB_URL`)

**Interfaces:**
- Consumes:
  - From Task 24: `mining.MiningResult`, `CaseTypeResult`, `ActivityStats`, `Edge`, `Variant`, `Conformance.step_fitness`, `Scope`, `START`, `END`, `is_unmapped`.
  - From Task 21: `events.ActivityMap` and `builders.builder(l1).MAPPING`.
  - `sap.process_definitions.reference_document()` (existing, `sap/process_definitions.py:574`).
  - `api.models.process_model.ID_PATTERN`, `L2`-`L5`, `Diagram`, `Node`, `Flow`, `FieldRef` and `L5.with_derived()` (existing).
  - `process_model_validator.validate_document(doc, dictionary=None, check_ids=None)` (existing, `:84`).
- Produces:
  - Model: `DiscoveryEdge(target, count, median_seconds)`, and `DiscoveryStats(case_count, share, event_count, median_seconds, p90_seconds, rework_rate, automation_rate, fitness, observed, case_type, edges, entry_count)`.
  - Model: `discovery: Optional[DiscoveryStats]` on L1-L5, `source` on L1-L3, and `"discovered"` in `Source`.
  - `generate.generate(base, mining, mapping, system_type=None) -> Generated(document, l5_of)`.
  - `generate.write_back(session, scope, l5_of) -> int`.
  - `generate.keep_edges(edges, cases, starts, threshold=EDGE_THRESHOLD)`, which Task 26 reuses for the L1-L3 landscape flows.
  - `generate.node_key`, `mapping_row`, `label_of`, `fields_of`, and `EDGE_THRESHOLD`.
  - Task 27's worker calls `generate` then `write_back` per L1. Tasks 26, 29 and 30 read `discovery` from the stored document.

Decisions this task fixes, and why:
- The signature is `generate(base, mining, mapping, system_type)`, not the spec's `generate(l1, run, mining)`. The caller passes `reference_document()` with the tenant's config overlay already applied. Generation therefore stays pure, so it can be tested without a database. The run row adds nothing generation needs.
- The output document holds only the mined L1. It has `source="discovered"`. `base` is deep-copied and never modified.
- Placement follows spec §4.2. Rule 1: the mapped `l5_id` exists, so it is used. Rule 2: the id is valid and its parent L4 (`rsplit("-", 1)[0]`) exists, so a `source="discovered"` L5 is appended. The builder's id is kept instead of being rebuilt as `X_<KEY>`, because the mapping tables use ids such as `X_CHANGE_QTY` for `CHANGE_PO_QTY`. Rule 3: everything else, and every `<L1>-DSC-…` id, goes to `<L1>-DSC` / `<L1>-DSC-P1` / `<L1>-DSC-<KEY>` / `<L4>-01`. Rule 4: every node with no stats gets `DiscoveryStats(observed=False)`.
- A runtime key such as `STATUS_TECO` takes its label from the template row (`STATUS_<STAT>`, "Set status <STAT>"), giving "Set status TECO". Fields come from the row's `source` tokens that have the form `TABLE.FIELD`. A token without a dot, such as `LFA1`, is skipped.
- L2-L4 stats are rolled up from the full variant list (Task 24 keeps every variant for this reason). Events under one node that follow each other collapse to one visit. At L5, any repeat counts as rework, which matches the SQL. At L4 and above, only a return after leaving counts.
- Edges join siblings under the same parent. A transition that ends the case or leaves the parent becomes `__END__`. `entry_count` (an addition to the spec's model) counts the transitions into a node from outside its parent, or at case start. The L4 diagram needs it to draw start-event flows.
- L5 medians, p90 and fitness come from the activity with the most events on that L5. L2-L4 medians and fitness are `None`, because the variant roll-up has no per-case timestamps.
- A node reached by several case types keeps the stats of the case type with the most cases (ties go to the case-type name). The L1 carries the primary case type's throughput and fitness.
- Only observed L4s get a rebuilt diagram. A not-observed L4 keeps its reference diagram unchanged.
- In a rebuilt diagram, observed tasks are wired by the kept edges. A not-observed task is drawn unconnected, per spec §4.3. The validator previously required every node to be reachable, so it now skips tasks whose L5 has `discovery.observed == False`. Reference documents have `discovery=None`, so their validation is unchanged.
- `keep_edges` keeps an edge carrying at least 1% of the case type's cases, and it keeps the only outgoing edge of any node. It then adds back the strongest pruned edge from a reachable node to an unreachable one until every node is reachable again. Without this repair, the 1% cut could disconnect a rare path, and the diagram would fail validation.
- An XOR gateway is added where a source has more than one kept outgoing edge (`<L5>-GO`, or `<L4>-GS` at the start event), and where a task has more than one kept incoming edge (`<L5>-GI`). Flows are labelled `"1,234 cases"`. Ids are deterministic, so generating twice gives the same JSON.
- `write_back` is one `UPDATE … FROM unnest(:cts, :acts, :l5s)`. It is equivalent to the spec's `VALUES` list, but it binds three arrays instead of building 3×n parameters. `IS DISTINCT FROM` skips rows that are already correct, so a re-run writes nothing.

- [ ] **Step 1: Write the failing tests**

`tests/process_discovery/test_generate.py`:

```python
"""L1-L5 generation from a mining result (spec §4). No database."""

from __future__ import annotations

import re
from collections import Counter

import pytest

from api.models.process_model import ID_PATTERN, ProcessModelDocument
from api.services.process_discovery.builders import builder
from api.services.process_discovery.generate import generate, keep_edges, label_of, mapping_row, node_key
from api.services.process_discovery.mining import (END, ActivityStats, CaseTypeResult, Edge, MiningResult, Variant,
                                                   conformance)
from api.services.process_model_validator import validate_document
from sap.process_definitions import reference_document

MAP = builder("PTP").MAPPING
HAPPY = ("CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE")
REWORK = ("CREATE_PO_ITEM", "CHANGE_PO_QTY", "CHANGE_PO_QTY", *HAPPY[1:])
ODD = ("CREATE_PO_ITEM", "ZZ_NEW", "INVOICE_RECEIPT")


def _result(case_type: str, variants: list[tuple[tuple[str, ...], int]], edges=()) -> CaseTypeResult:
    """A CaseTypeResult whose activity stats are counted from the variants, as the SQL would."""
    rows = {m.key: m for m in MAP if m.case_type == case_type}
    total = sum(n for _, n in variants)
    vs = [Variant(f"{i:032x}", acts, n, n / total, 100.0 * (i + 1), 200.0 * (i + 1), ("c",))
          for i, (acts, n) in enumerate(variants)]
    ev: Counter[str] = Counter()
    cs: Counter[str] = Counter()
    rw: Counter[str] = Counter()
    for acts, n in variants:
        for a, k in Counter(acts).items():
            ev[a] += k * n
            cs[a] += n
            rw[a] += n if k > 1 else 0
    acts = {a: ActivityStats(a, rows[a].l5_id if a in rows else None, ev[a], cs[a], cs[a] / total, 60.0, 120.0,
                             rw[a] / cs[a], 0.5, ev[a] // 2, ev[a]) for a in ev}
    r = CaseTypeResult(case_type, total, sum(ev.values()), 3600.0, 7200.0, list(edges), acts, vs)
    r.conformance = conformance(r.stored(), list(rows.values()))
    return r


@pytest.fixture(scope="module")
def mined() -> MiningResult:
    po = _result("po_item", [(HAPPY, 6), (REWORK, 3), (ODD, 1)],
                 [Edge("CREATE_PO_ITEM", "CHANGE_PO_QTY", 3, 3, 3600.0, 7200.0)])
    return MiningResult("PTP", "po_item", {"po_item": po, "vendor": _result("vendor", [(("CREATE_VENDOR",), 2)])})


@pytest.fixture(scope="module")
def gen(mined):
    return generate(reference_document(), mined, MAP, system_type="ecc")


def _nodes(doc: ProcessModelDocument) -> dict:
    out = {}
    for l1 in doc.l1:
        out[l1.id] = l1
        for b in l1.l2:
            out[b.id] = b
            for c in b.l3:
                out[c.id] = c
                for d in c.l4:
                    out[d.id] = d
                    out.update({a.id: a for a in d.activities})
    return out


def test_document_is_the_one_l1_and_discovered(gen) -> None:
    doc = gen.document
    assert [x.id for x in doc.l1] == ["PTP"] and doc.source == "discovered" and doc.system_type == "ecc"
    assert doc.l1[0].discovery.case_count == 10 and doc.l1[0].discovery.share == 1.0
    assert doc.l1[0].discovery.median_seconds == 3600.0 and doc.l1[0].discovery.case_type == "po_item"


def test_rule_1_reference_l5_gets_stats_and_sibling_edges(gen) -> None:
    d = _nodes(gen.document)["PTP-PO-ME21N-02"].discovery
    assert (d.observed, d.case_type, d.case_count, d.event_count, d.entry_count) == (True, "po_item", 10, 10, 10)
    assert d.share == 1.0 and d.rework_rate == 0.0 and d.automation_rate == 0.5
    assert [(e.target, e.count, e.median_seconds) for e in d.edges] == [
        ("PTP-PO-ME21N-X_CHANGE_QTY", 3, 3600.0), (END, 7, None)]
    assert _nodes(gen.document)["PTP-GR-MIGO-01"].discovery.fitness == pytest.approx(0.9)


def test_rule_2_extra_l5_is_added_under_its_l4(gen) -> None:
    a = _nodes(gen.document)["PTP-PO-ME21N-X_CHANGE_QTY"]
    assert (a.source, a.name, [f.field for f in a.fields], a.sap_tables) == (
        "discovered", "Change order quantity", ["EKPO.MENGE"], ["EKPO"])
    assert (a.discovery.event_count, a.discovery.case_count, a.discovery.rework_rate) == (6, 3, 1.0)
    assert [(e.target, e.count) for e in a.discovery.edges] == [(END, 3)]


def test_rule_3_unmapped_activity_goes_to_the_dsc_branch(gen) -> None:
    n = _nodes(gen.document)
    assert n["PTP-DSC"].source == n["PTP-DSC-P1"].source == n["PTP-DSC-ZZ_NEW"].source == "discovered"
    assert n["PTP-DSC"].name == "Discovered, not in reference" and n["PTP-DSC-ZZ_NEW"].name == "ZZ_NEW"
    assert n["PTP-DSC-ZZ_NEW-01"].discovery.case_count == 1
    assert gen.l5_of[("po_item", "ZZ_NEW")] == "PTP-DSC-ZZ_NEW-01"


def test_rule_4_reference_nodes_without_cases_are_not_observed(gen) -> None:
    n = _nodes(gen.document)
    for x in ("PTP-PO-ME21N-01", "PTP-PR-ME51N-01", "PTP-PR"):
        assert n[x].discovery.observed is False and n[x].discovery.case_count == 0


def test_l2_edges_and_case_types(gen) -> None:
    n = _nodes(gen.document)
    flow = {(x, e.target): e.count for x in ("PTP-PO", "PTP-GR", "PTP-IV", "PTP-PAY", "PTP-DSC")
            for e in n[x].discovery.edges}
    assert flow == {("PTP-PO", "PTP-GR"): 9, ("PTP-PO", "PTP-DSC"): 1, ("PTP-DSC", "PTP-IV"): 1,
                    ("PTP-GR", "PTP-IV"): 9, ("PTP-IV", "PTP-PAY"): 9, ("PTP-IV", END): 1, ("PTP-PAY", END): 9}
    assert n["PTP-VM"].discovery.case_type == "vendor" and n["PTP-VM"].discovery.case_count == 2
    assert n["PTP-PO"].discovery.rework_rate == 0.0 and n["PTP-PO-ME21N"].discovery.event_count == 16


def test_l4_diagram_is_the_as_is_flow(gen) -> None:
    d = _nodes(gen.document)["PTP-PO-ME21N"].diagram
    flows = {(f.source, f.target) for f in d.flows}
    assert ("PTP-PO-ME21N-S", "PTP-PO-ME21N-02-T") in flows
    assert {("PTP-PO-ME21N-02-T", "PTP-PO-ME21N-02-GO"), ("PTP-PO-ME21N-02-GO", "PTP-PO-ME21N-X_CHANGE_QTY-T"),
            ("PTP-PO-ME21N-02-GO", "PTP-PO-ME21N-E"), ("PTP-PO-ME21N-X_CHANGE_QTY-T", "PTP-PO-ME21N-E")} <= flows
    assert {f.label for f in d.flows if f.source == "PTP-PO-ME21N-02-GO"} == {"3 cases", "7 cases"}
    loose = next(x for x in d.nodes if x.activity_id == "PTP-PO-ME21N-01")
    assert all(loose.id not in (f.source, f.target) for f in d.flows)


def test_generated_model_validates_and_every_id_matches(gen) -> None:
    res = validate_document(gen.document, check_ids=[])
    assert res.errors == []
    pat = re.compile(ID_PATTERN)
    for x in _nodes(gen.document):
        assert pat.match(x), x
    for l4 in gen.document.all_l4():
        assert all(pat.match(n.id) for n in l4.diagram.nodes) and all(pat.match(f.id) for f in l4.diagram.flows)


def test_documents_without_discovery_still_load() -> None:
    raw = reference_document().model_dump()
    for l1 in raw["l1"]:
        for x in (l1, *l1["l2"], *(c for b in l1["l2"] for c in b["l3"])):
            x.pop("discovery"), x.pop("source")
    assert validate_document(ProcessModelDocument.model_validate(raw), check_ids=[]).errors == []


def test_generation_is_deterministic_and_leaves_the_base_alone(mined) -> None:
    base = reference_document()
    before = base.model_dump_json()
    a, b = generate(base, mined, MAP), generate(base, mined, MAP)
    assert a.document.model_dump_json() == b.document.model_dump_json() and a.l5_of == b.l5_of
    assert base.model_dump_json() == before


def test_l5_of_covers_every_activity(gen, mined) -> None:
    assert set(gen.l5_of) == {(ct, a) for ct, r in mined.by_type.items() for a in r.activities}
    assert gen.l5_of[("po_item", "CHANGE_PO_QTY")] == "PTP-PO-ME21N-X_CHANGE_QTY"
    assert gen.l5_of[("vendor", "CREATE_VENDOR")] == "PTP-VM-FK01-01"


def test_unknown_l1_is_rejected(mined) -> None:
    with pytest.raises(ValueError):
        generate(reference_document(), MiningResult("NOPE", "x", {}), MAP)


def test_keep_edges_prunes_and_repairs_reachability() -> None:
    edges = [("S", "A", 1000), ("A", "B", 995), ("A", "C", 5), ("B", "C", 3), ("B", "E", 992), ("C", "E", 8)]
    assert keep_edges(edges, 1000, ["S"]) == [("S", "A", 1000), ("A", "B", 995), ("A", "C", 5), ("B", "E", 992),
                                              ("C", "E", 8)]


def test_runtime_keys_take_their_template_label() -> None:
    pm = builder("PM").MAPPING
    row = mapping_row("STATUS_TECO", pm)
    assert row.key == "STATUS_<STAT>" and label_of("STATUS_TECO", row) == "Set status TECO"
    assert label_of("ZZ", None) == "ZZ" and node_key("a.b-c") == "A_B_C"
```

`tests/process_discovery/test_generate_pg.py`:

```python
"""``write_back`` against Postgres (spec §4.2). Skipped without MERIDIAN_TEST_DB_URL."""

from __future__ import annotations

import os
import subprocess
import uuid
from datetime import datetime, timezone

import pytest

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pg
def test_write_back_points_events_at_generated_l5s() -> None:
    from sqlalchemy import create_engine, text

    from api.services.process_discovery.generate import write_back
    from api.services.process_discovery.mining import Scope
    from workers.db import tenant_session

    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDG-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": sid, "t": tid})
    s = tenant_session(eng, tid)
    ts = datetime(2025, 1, 10, tzinfo=timezone.utc)
    rid = s.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                         "VALUES (:t, :s, 'PTP', 'full', 'mining') RETURNING id"), {"t": tid, "s": sid}).scalar()
    s.execute(text(
        "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, l5_id, ts, ts_precision,"
        " seq, source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', :c, :a, :l5, :ts, 'second', 0, 'EKPO', :r)"),
        [{"t": tid, "s": sid, "r": rid, "c": c, "a": a, "l5": l5, "ts": ts} for c, a, l5 in (
            ("1", "ZZ_NEW", None), ("2", "ZZ_NEW", None), ("1", "GOODS_RECEIPT", "PTP-GR-MIGO-01"))])
    l5_of = {("po_item", "ZZ_NEW"): "PTP-DSC-ZZ_NEW-01", ("po_item", "GOODS_RECEIPT"): "PTP-GR-MIGO-01"}
    assert write_back(s, Scope(tid, sid, "PTP"), l5_of) == 2  # the unchanged row is not rewritten
    s.commit()
    rows = s.execute(text("SELECT activity, l5_id FROM process_events WHERE system_id = :s ORDER BY activity, case_id"),
                     {"s": sid}).all()
    assert [tuple(x) for x in rows] == [("GOODS_RECEIPT", "PTP-GR-MIGO-01"), ("ZZ_NEW", "PTP-DSC-ZZ_NEW-01"),
                                        ("ZZ_NEW", "PTP-DSC-ZZ_NEW-01")]
    assert write_back(s, Scope(tid, sid, "PTP"), {}) == 0
    s.close()
    eng.dispose()
```

- [ ] **Step 2: Run them (FAIL)**

Run: `pytest tests/process_discovery/test_generate.py -q`
Expected: FAIL, collection error `ModuleNotFoundError: No module named 'api.services.process_discovery.generate'`.

- [ ] **Step 3: Add discovery stats to the process model**

In `api/models/process_model.py`, replace `Source = Literal["template", "config"]` and add the two models directly below `NodeStatus`:

```python
Source = Literal["template", "config", "discovered"]
NodeStatus = Literal["configured", "not_configured", "client_specific"]


class DiscoveryEdge(BaseModel):
    """As-is flow from a node: to a sibling at the same level, or "__END__" (case ends or leaves the parent)."""
    target: str
    count: int
    median_seconds: Optional[float] = None


class DiscoveryStats(BaseModel):
    """Mined stats of one node (process discovery). Counts only, never event data."""
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
    entry_count: int = 0              # transitions into this node from outside its parent, or at case start
```

Add the field to `L5`, after `evidence: list[Evidence] = []`, and to `L4`, after `next_l4: list[str] = []`:

```python
    discovery: Optional[DiscoveryStats] = None
```

Add both fields to `L3` after `l4: list[L4] = []`, to `L2` after `l3: list[L3] = []`, and to `L1` after `l2: list[L2] = []`:

```python
    source: Source = "template"
    discovery: Optional[DiscoveryStats] = None
```

- [ ] **Step 4: Let the validator accept unconnected not-observed tasks**

In `api/services/process_model_validator.py` `_validate_diagram`, replace the reachability loop header:

```python
    for i, n in enumerate(l4.diagram.nodes):
        if starts and n.id not in seen:
```

with:

```python
    # Process discovery draws reference activities with no observed case as unconnected tasks (spec §4.3).
    unobserved = {a.id for a in l4.activities if a.discovery is not None and not a.discovery.observed}
    for i, n in enumerate(l4.diagram.nodes):
        if n.type == "task" and n.activity_id in unobserved:
            continue
        if starts and n.id not in seen:
```

- [ ] **Step 5: Create the generator**

`api/services/process_discovery/generate.py`:

```python
"""L1 to L5 generation from a mining result (spec §4).

Starts from the reference model of one L1 (with the tenant's config overlay already applied by the caller),
places every mined activity on an L5 by the four rules of spec §4.2, attaches ``DiscoveryStats`` at every
level, and rebuilds the diagram of every observed L4 from its as-is flow."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, NamedTuple, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.models.process_model import (ID_PATTERN, L2, L3, L4, L5, Diagram, DiscoveryEdge, DiscoveryStats, FieldRef,
                                      Flow, Node, ProcessModelDocument)
from api.services.process_discovery.events import ActivityMap
from api.services.process_discovery.mining import END, START, CaseTypeResult, MiningResult, Scope, is_unmapped

EDGE_THRESHOLD = 0.01  # spec §4.3: keep an edge carrying at least 1% of the case type's cases
_ID = re.compile(ID_PATTERN)
_KEY = re.compile(r"[^A-Z0-9_]")
_REF = re.compile(r"^[A-Za-z0-9_/]+\.[A-Za-z0-9_/]+$")
_SLOT = re.compile(r"<[^>]+>")

WRITE_BACK_SQL = text("""
UPDATE process_events pe SET l5_id = v.l5_id
FROM unnest(CAST(:cts AS text[]), CAST(:acts AS text[]), CAST(:l5s AS text[])) AS v(case_type, activity, l5_id)
WHERE pe.tenant_id = :t AND pe.system_id = :s AND pe.l1 = :l1
  AND pe.case_type = v.case_type AND pe.activity = v.activity AND pe.l5_id IS DISTINCT FROM v.l5_id""")


class Generated(NamedTuple):
    document: ProcessModelDocument
    l5_of: dict[tuple[str, str], str]  # (case_type, activity) -> L5 id, for ``write_back``


def node_key(activity: str) -> str:
    """Activity key as an id segment: characters outside ``[A-Z0-9_]`` become ``_`` (spec §4.2 rule 2)."""
    return _KEY.sub("_", activity.upper()) or "NONE"


def mapping_row(activity: str, mapping: Sequence[ActivityMap]) -> Optional[ActivityMap]:
    """The exact row, else the template row (``STATUS_<STAT>``) whose prefix the runtime key carries."""
    exact = next((m for m in mapping if m.key == activity), None)
    if exact:
        return exact
    return next((m for m in mapping if "<" in m.key and activity.startswith(m.key[:m.key.index("<")])), None)


def label_of(activity: str, row: Optional[ActivityMap]) -> str:
    if row is None:
        return activity
    if "<" not in row.key:
        return row.label
    return _SLOT.sub(activity[row.key.index("<"):] or "none", row.label, count=1)


def fields_of(row: Optional[ActivityMap]) -> list[FieldRef]:
    refs = dict.fromkeys(t for t in (row.source.split() if row else []) if _REF.match(t))
    return [FieldRef(field=r) for r in refs]


@dataclass
class _Index:
    """Parent links of one L1, kept current while discovered nodes are added."""
    l1: object
    l2: dict[str, L2]
    l3: dict[str, L3]
    l4: dict[str, L4]
    l5: dict[str, L5]
    up: dict[str, str]  # child id -> parent id, for L2..L5

    @classmethod
    def of(cls, l1) -> "_Index":
        ix = cls(l1, {}, {}, {}, {}, {})
        for b in l1.l2:
            ix.l2[b.id], ix.up[b.id] = b, l1.id
            for c in b.l3:
                ix.l3[c.id], ix.up[c.id] = c, b.id
                for d in c.l4:
                    ix.l4[d.id], ix.up[d.id] = d, c.id
                    for a in d.activities:
                        ix.l5[a.id], ix.up[a.id] = a, d.id
        return ix

    def add_l5(self, l4: L4, l5_id: str, name: str, fields: list[FieldRef]) -> L5:
        if l5_id not in self.l5:
            a = L5(id=l5_id, name=name, order=max((x.order for x in l4.activities), default=0) + 1,
                   fields=fields, source="discovered").with_derived()
            l4.activities.append(a)
            self.l5[l5_id], self.up[l5_id] = a, l4.id
        return self.l5[l5_id]

    def dsc_l4(self, key: str, name: str) -> L4:
        """``<L1>-DSC`` / ``<L1>-DSC-P1`` / ``<L1>-DSC-<KEY>`` (spec §4.2 rule 3)."""
        root = self.l1.id
        l2_id, l3_id, l4_id = f"{root}-DSC", f"{root}-DSC-P1", f"{root}-DSC-{key}"
        if l2_id not in self.l2:
            b = L2(id=l2_id, name="Discovered, not in reference", source="discovered",
                   order=max((x.order for x in self.l1.l2), default=0) + 1)
            self.l1.l2.append(b)
            self.l2[l2_id], self.up[l2_id] = b, root
        if l3_id not in self.l3:
            c = L3(id=l3_id, name="Discovered activities", order=1, source="discovered")
            self.l2[l2_id].l3.append(c)
            self.l3[l3_id], self.up[l3_id] = c, l2_id
        if l4_id not in self.l4:
            c = self.l3[l3_id]
            d = L4(id=l4_id, name=name, order=len(c.l4) + 1, source="discovered")
            c.l4.append(d)
            self.l4[l4_id], self.up[l4_id] = d, l3_id
        return self.l4[l4_id]

    def place(self, activity: str, l5_id: Optional[str], row: Optional[ActivityMap]) -> str:
        """Spec §4.2 rules 1-3. Returns the L5 id the activity's events belong to."""
        if l5_id in self.l5 and not is_unmapped(l5_id):
            return l5_id                                                           # rule 1
        parent = l5_id.rsplit("-", 1)[0] if l5_id else ""
        if l5_id and not is_unmapped(l5_id) and _ID.match(l5_id) and parent in self.l4:
            return self.add_l5(self.l4[parent], l5_id, label_of(activity, row), fields_of(row)).id  # rule 2
        key = node_key(activity)                                                   # rule 3
        l4 = self.dsc_l4(key, label_of(activity, row))
        return self.add_l5(l4, f"{l4.id}-01", label_of(activity, row), fields_of(row)).id


def _roll(variants, up: dict[str, str], raw_rework: bool):
    """Cases, events, rework cases and transitions per node, with activities mapped through ``up``.

    Consecutive events under one node collapse to one visit; transitions run between visits and include
    ``__START__`` and ``__END__``. ``raw_rework`` (the L5 level) counts any repeat as rework, like the SQL."""
    cases: Counter[str] = Counter()
    events: Counter[str] = Counter()
    rework: Counter[str] = Counter()
    trans: Counter[tuple[str, str]] = Counter()
    for v in variants:
        n = v.case_count
        seq = [up[a] for a in v.activities]
        visits = [x for i, x in enumerate(seq) if i == 0 or seq[i - 1] != x]
        for x, k in Counter(seq).items():
            events[x] += k * n
        for x, k in Counter(visits).items():
            cases[x] += n
            if k > 1 or (raw_rework and seq.count(x) > 1):
                rework[x] += n
        for a, b in zip([START, *visits], [*visits, END]):
            trans[(a, b)] += n
    return cases, events, rework, trans


def _level_stats(r: CaseTypeResult, up: dict[str, str], parent: dict[str, str], level: int,
                 members: dict[str, list[str]]) -> dict[str, DiscoveryStats]:
    """DiscoveryStats per node of one level for one case type. ``members``: node -> its activities."""
    cases, events, rework, trans = _roll(r.variants, up, raw_rework=level == 5)
    dfg = {(e.source, e.target): e for e in r.edges}
    out: dict[str, DiscoveryStats] = {}
    for x in sorted(cases):
        acts = sorted(members[x], key=lambda a: (-r.activities[a].events, a))
        sib: Counter[str] = Counter()
        leave = entry = 0
        for (a, b), n in trans.items():
            if a == x and b != x:
                if b != END and parent.get(b) == parent[x]:
                    sib[b] += n
                else:
                    leave += n
            if b == x and a != x and (a == START or parent.get(a) != parent[x]):
                entry += n
        edges = []
        for t, n in sorted(sib.items(), key=lambda kv: (-kv[1], kv[0])):
            med = None
            if level == 5 and len(acts) == 1 and len(members[t]) == 1:
                e = dfg.get((acts[0], members[t][0]))
                med = e.median_seconds if e else None
            edges.append(DiscoveryEdge(target=t, count=n, median_seconds=med))
        if leave:
            edges.append(DiscoveryEdge(target=END, count=leave))
        known = sum(r.activities[a].auto_known for a in acts)
        lead = r.activities[acts[0]]
        out[x] = DiscoveryStats(
            case_count=cases[x], share=round(cases[x] / r.cases, 6) if r.cases else 0.0, event_count=events[x],
            # ponytail: L2-L4 medians need per-case timestamps the variant roll-up lacks; None until a SQL roll-up.
            median_seconds=lead.median_seconds if level == 5 else None,
            p90_seconds=lead.p90_seconds if level == 5 else None,
            rework_rate=round(rework[x] / cases[x], 6),
            automation_rate=round(sum(r.activities[a].auto_events for a in acts) / known, 6) if known else None,
            fitness=r.conformance.step_fitness.get(lead.activity) if level == 5 else None,
            observed=True, case_type=r.case_type, edges=edges, entry_count=entry)
    return out


def keep_edges(edges: Sequence[tuple[str, str, int]], cases: int, starts: Iterable[str],
               threshold: float = EDGE_THRESHOLD) -> list[tuple[str, str, int]]:
    """Spec §4.3 pruning: keep an edge with ``count >= threshold * cases`` or the only outgoing edge of its
    source. A node left unreachable from ``starts`` gets back its strongest edge from a reachable node, so the
    diagram stays connected (``process_model_validator`` requires it)."""
    outdeg = Counter(s for s, _, _ in edges)
    kept = {e for e in edges if e[2] >= threshold * cases or outdeg[e[0]] == 1}
    nodes = {n for s, t, _ in edges for n in (s, t)}
    while True:
        seen, stack = set(starts), list(starts)
        while stack:
            x = stack.pop()
            for s, t, _ in kept:
                if s == x and t not in seen:
                    seen.add(t)
                    stack.append(t)
        back = [e for e in edges if e not in kept and e[0] in seen and e[1] not in seen]
        if not back or nodes <= seen:
            return [e for e in edges if e in kept]
        kept.add(min(back, key=lambda e: (-e[2], e[0], e[1])))


def _diagram(l4: L4, cases: int) -> Diagram:
    """The as-is L4 diagram (spec §4.3): observed tasks wired by kept edges, XOR gateways at fan-out and fan-in,
    not-observed reference tasks unconnected."""
    base = l4.id
    s_id, e_id = f"{base}-S", f"{base}-E"
    acts = sorted(l4.activities, key=lambda a: (a.order, a.id))
    seen = [a for a in acts if a.discovery and a.discovery.observed]
    cand: list[tuple[str, str, int]] = []
    for a in seen:
        if a.discovery.entry_count:
            cand.append((s_id, f"{a.id}-T", a.discovery.entry_count))
    for a in seen:
        for e in a.discovery.edges:
            cand.append((f"{a.id}-T", e_id if e.target == END else f"{e.target}-T", e.count))
    kept = keep_edges(cand, cases, [s_id])
    outdeg = Counter(s for s, _, _ in kept)
    indeg = Counter(t for _, t, _ in kept)

    def gw(node: str, side: str) -> str:
        return f"{base}-GS" if node == s_id else f"{node[:-2]}-G{side}"

    nodes = [Node(id=s_id, type="startEvent", label="Start")]
    nodes += [Node(id=f"{a.id}-T", type="task", activity_id=a.id) for a in seen]
    nodes += [Node(id=e_id, type="endEvent", label="End")]
    flows: list[Flow] = []

    def link(src: str, dst: str, label: Optional[str] = None) -> None:
        flows.append(Flow(id=f"{base}-F{len(flows) + 1}", source=src, target=dst, label=label))

    for x in [s_id, *(f"{a.id}-T" for a in seen)]:
        if outdeg[x] > 1:
            nodes.append(Node(id=gw(x, "O"), type="exclusiveGateway"))
            link(x, gw(x, "O"))
        if x != s_id and indeg[x] > 1:
            nodes.append(Node(id=gw(x, "I"), type="exclusiveGateway"))
            link(gw(x, "I"), x)
    for s, t, n in kept:
        src = gw(s, "O") if outdeg[s] > 1 else s
        dst = gw(t, "I") if t != e_id and indeg[t] > 1 else t
        link(src, dst, f"{n:,} cases")
    nodes += [Node(id=f"{a.id}-T", type="task", activity_id=a.id) for a in acts if a not in seen]
    return Diagram(nodes=nodes, flows=flows)


def generate(base: ProcessModelDocument, mining: MiningResult, mapping: Sequence[ActivityMap],
             system_type: Optional[str] = None) -> Generated:
    """The as-is model of ``mining.l1`` (spec §4). ``base`` is ``reference_document()`` with the tenant's config
    overlay applied; it is not modified."""
    doc = base.model_copy(deep=True)
    doc.l1 = [x for x in doc.l1 if x.id == mining.l1]
    if not doc.l1:
        raise ValueError(f"{mining.l1} is not in the reference model")
    doc.source, doc.system_type = "discovered", system_type
    root = doc.l1[0]
    ix = _Index.of(root)

    l5_of: dict[tuple[str, str], str] = {}
    for ct, r in sorted(mining.by_type.items()):
        rows = {a: mapping_row(a, [m for m in mapping if m.case_type == ct]) for a in r.activities}
        for a in sorted(r.activities, key=lambda a: (rows[a].order if rows[a] else 1_000_000, a)):
            l5_of[(ct, a)] = ix.place(a, r.activities[a].l5_id, rows[a])

    # Stats per level; a node seen by several case types keeps the one with the most cases.
    best: dict[str, DiscoveryStats] = {}
    for ct, r in sorted(mining.by_type.items()):
        up5 = {a: l5_of[(ct, a)] for a in r.activities}
        ups = [up5]
        for _ in range(3):  # L4, L3, L2
            ups.append({a: ix.up[x] for a, x in ups[-1].items()})
        for level, up in zip((5, 4, 3, 2), ups):
            members: dict[str, list[str]] = {}
            for a, x in up.items():
                members.setdefault(x, []).append(a)
            for x, st in _level_stats(r, up, ix.up, level, members).items():
                if x not in best or (st.case_count, best[x].case_type or "") > (best[x].case_count, ct):
                    best[x] = st

    p = mining.by_type.get(mining.primary)
    known = sum(a.auto_known for a in p.activities.values()) if p else 0
    root.discovery = DiscoveryStats(
        case_count=p.cases if p else 0, share=1.0 if p and p.cases else 0.0, event_count=p.events if p else 0,
        median_seconds=p.median_seconds if p else None, p90_seconds=p.p90_seconds if p else None,
        automation_rate=round(sum(a.auto_events for a in p.activities.values()) / known, 6) if known else None,
        fitness=p.conformance.fitness if p else None, observed=bool(p and p.cases), case_type=mining.primary)
    for nodes in (ix.l2, ix.l3, ix.l4, ix.l5):
        for x, node in nodes.items():
            node.discovery = best.get(x) or DiscoveryStats(observed=False)                # rule 4
    for x, l4 in ix.l4.items():
        if l4.discovery.observed:
            l4.diagram = _diagram(l4, mining.by_type[l4.discovery.case_type].cases)
    return Generated(ProcessModelDocument.model_validate(doc.model_dump()), l5_of)


def write_back(session: Session, scope: Scope, l5_of: dict[tuple[str, str], str]) -> int:
    """Point ``process_events.l5_id`` at the generated L5s in one statement per L1 (spec §4.2).
    The caller's session has ``app.tenant_id`` set."""
    if not l5_of:
        return 0
    keys = sorted(l5_of)
    return session.execute(WRITE_BACK_SQL, {
        "t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1,
        "cts": [k[0] for k in keys], "acts": [k[1] for k in keys], "l5s": [l5_of[k] for k in keys]}).rowcount
```

- [ ] **Step 6: Run them (PASS)**

Run: `pytest tests/process_discovery/test_generate.py -q`
Expected: `14 passed`.

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/pd_test pytest tests/process_discovery/test_generate_pg.py -q`
Expected: `1 passed`. Without the URL, expect `1 skipped`.

Run: `pytest tests/process_discovery tests/test_bpmn_export.py tests/test_bpmn_layout.py tests/test_process_writer.py tests/test_process_flow_derivation.py tests/test_process_designer_api.py tests/test_process_templates.py -q`
Expected: no failures. The model fields are optional, and the validator exemption applies only when `discovery` is set.

Run: `pytest --collect-only -q tests/process_discovery | tail -1`
Expected: `103 tests collected`.

- [ ] **Step 7: Commit**

```bash
git add api/models/process_model.py api/services/process_model_validator.py api/services/process_discovery/generate.py tests/process_discovery/test_generate.py tests/process_discovery/test_generate_pg.py
git commit -m "$(cat <<'MSG'
feat(process): generate discovered L1-L5 models

Places mined activities on the reference model (extra L5s and a DSC branch),
rolls stats up to every level, rebuilds observed L4 diagrams from the as-is
flow and writes the final l5_id back to process_events.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 26: Export (wave 26): discovered models to Signavio BPMN

**Files:**
- Modify: `api/services/bpmn_export.py` (`landscape_edges`, `_count_meta`, `duration`, `_landscape(edges=)`, discovery metadata in `_task`, edge counts in `_l4_file`, manifest block and README in `export_zip`, new `export_node`)
- Test: `tests/test_process_discovery_export.py` (no DB)

**Interfaces:**
- Consumes:
  - From Task 25: `DiscoveryStats` / `DiscoveryEdge` on L1-L5, `source="discovered"`, and `generate.keep_edges`, `generate.EDGE_THRESHOLD`.
  - From Task 24: `mining.END` (`"__END__"`), which Task 25 writes as the `target` of an edge that ends the case or leaves the parent.
  - Existing in `bpmn_export.py`: `_sub`, `_extras`, `_doc`, `_wire`, `_diagram(defs, pid, elems, lay, flow_ids, flow_el, labelled, gateways)`, `_definitions`, `_xml`, `export_zip(document, overlay, meta)` and `import_zip`.
  - `bpmn_layout.layout_diagram(nodes, flows, flow_labels=None, positions=None, starts=None)` (existing, `bpmn_layout.py:91`).
  - `bpmn_validate.validate_package(files, manifest)` (existing).
- Produces:
  - `bpmn_export.landscape_edges(node, children) -> Optional[list[(source, target, label)]]`. Task 30's L1 drill reuses it for the L1-L3 flow view, so the UI and the export draw the same edges.
  - `bpmn_export.duration(seconds) -> str`.
  - `bpmn_export.export_node(document, node_id, overlay, meta) -> (filename, bytes)`, for Task 27's per-node download.
  - `meta["discovery"]` (optional, `{run_id, window: {from, to}, edge_threshold}`) is copied to `manifest.json` as `discovery`.

Decisions this task fixes, and why:
- A landscape (L1-L3) is drawn from discovery only when its node has `discovery.observed`. Otherwise it keeps the linear chain, so reference exports are unchanged byte for byte. `tests/test_bpmn_export.py` proves this.
- Landscape candidates are: START to each observed child by `entry_count`, child to sibling by `discovery.edges`, and child to END for `__END__`. They are pruned by `keep_edges` against the parent's `case_count`. A child reached by a second case type (PTP `vendor`) is therefore measured against the primary case type's count. That is a known approximation (listed in the concerns).
- An XOR gateway is added where a node has more than one kept outgoing flow (`GW_<id>_OUT`, `Diverging`; `GW_START_OUT` at the start event, which the spec does not name), or more than one kept incoming flow (`GW_<id>_IN`, `Converging`). The end event takes several incoming flows without a gateway, which BPMN allows. Parallel gateways are never drawn, because a directly-follows graph cannot show concurrency.
- Unobserved children stay on the canvas without flows, the same rule as L4 tasks in Task 25.
- Each discovered flow carries `signavio:signavioMetaData meridian_edge_count`. On L4 the count is parsed from the `"1,234 cases"` label that Task 25 writes, because `Flow` has no count field. The parse runs only when `l4.discovery` is set, so a reference label such as "yes" is never read.
- Tasks with `discovery` get a `meridian:discovery` element, documentation lines ("Cases: 1,204 (61.0%)", "Median to next step: 3d 4h", and "Source: discovered, not in reference" for `source="discovered"`), and Signavio meta keys `meridian_case_count`, `meridian_share` (percent, one decimal), `meridian_median`, `meridian_source` and `meridian_fitness`. Task 24's `median_seconds` is the time to the next event of the same case, so the documentation says "Median to next step".
- `manifest.schema_version` stays 1. `discovery` is an optional extra key that `import_zip` ignores. L1-L3 `source` now round-trips through the existing `_extras`.
- `export_node` rebuilds one file with the same `_pos` that `export_zip` uses, so the single-file download is byte-identical to that file in the zip. It does not run `validate_package`, which needs the whole package for `calledElement` checks. The route validates through `export_zip` once per run instead (Task 27).

- [ ] **Step 1: Write the failing tests**

`tests/test_process_discovery_export.py`:

```python
"""Signavio export of a discovered model (spec §5.2): as-is flows, gateways, discovery metadata, per-node file."""

from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from api.services.bpmn_export import (MER, SIG, duration, export_node, export_zip, import_zip, landscape_edges)
from api.services.bpmn_validate import BPMN, validate_package
from api.services.process_discovery.generate import generate
from api.services.process_discovery.mining import Edge, MiningResult
from sap.process_definitions import reference_document
from tests.process_discovery.test_generate import HAPPY, MAP, ODD, REWORK, _result
from tests.test_bpmn_export import _files, _manifest, _xsd_validate

META = {"model_id": None, "name": "PTP as-is", "version_no": 1, "exported_at": "2026-10-11T00:00:00Z",
        "app_version": "1.0.0",
        "discovery": {"run_id": "r1", "window": {"from": "2025-01-01", "to": "2025-12-31"}, "edge_threshold": 0.01}}


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


@pytest.fixture(scope="module")
def doc():
    po = _result("po_item", [(HAPPY, 6), (REWORK, 3), (ODD, 1)],
                 [Edge("CREATE_PO_ITEM", "CHANGE_PO_QTY", 3, 3, 3600.0, 7200.0)])
    mined = MiningResult("PTP", "po_item", {"po_item": po, "vendor": _result("vendor", [(("CREATE_VENDOR",), 2)])})
    return generate(reference_document(), mined, MAP, system_type="ecc").document


@pytest.fixture(scope="module")
def files(doc):
    return _files(export_zip(doc, None, META))


def _proc(files, name):
    return ET.fromstring(files[name]).find(_q(BPMN, "process"))


def _flows(proc) -> dict[tuple[str, str], str | None]:
    return {(f.get("sourceRef"), f.get("targetRef")): f.get("name") for f in proc.iter(_q(BPMN, "sequenceFlow"))}


def test_package_validates(files) -> None:
    bpmn = {k: v for k, v in files.items() if k.endswith(".bpmn")}
    assert validate_package(bpmn, _manifest(files)) == []
    _xsd_validate(files)


def test_structure_called_elements_gateways_and_ids(files) -> None:
    pids = {_proc(files, n).get("id") for n in files if n.endswith(".bpmn")}
    for name in (n for n in files if n.endswith(".bpmn")):
        proc = _proc(files, name)
        ids = [e.get("id") for e in proc.iter() if e.get("id") and e.tag.startswith(f"{{{BPMN}}}")]
        assert len(ids) == len(set(ids)), name
        for ca in proc.iter(_q(BPMN, "callActivity")):
            assert ca.get("calledElement") in pids
        for gw in proc.iter(_q(BPMN, "exclusiveGateway")):
            assert len(gw.findall(_q(BPMN, "incoming"))) > 1 or len(gw.findall(_q(BPMN, "outgoing"))) > 1, name


def test_l1_landscape_is_the_as_is_flow(files) -> None:
    proc = _proc(files, "L1_PTP.bpmn")
    flows = _flows(proc)
    assert flows[("E_START", "GW_START_OUT")] is None
    assert flows[("GW_START_OUT", "CA_PTP-PO")] == "10 cases" and flows[("GW_START_OUT", "CA_PTP-VM")] == "2 cases"
    assert flows[("CA_PTP-PO", "GW_PTP-PO_OUT")] is None
    assert flows[("GW_PTP-PO_OUT", "CA_PTP-GR")] == "9 cases" and flows[("GW_PTP-PO_OUT", "CA_PTP-DSC")] == "1 cases"
    assert flows[("CA_PTP-GR", "GW_PTP-IV_IN")] == "9 cases" and flows[("GW_PTP-IV_IN", "CA_PTP-IV")] is None
    assert flows[("CA_PTP-PAY", "E_END")] == "9 cases"
    assert all("CA_PTP-PR" not in k for k in flows)  # never observed: drawn unconnected
    gw = {g.get("id"): g.get("gatewayDirection") for g in proc.iter(_q(BPMN, "exclusiveGateway"))}
    assert gw["GW_PTP-PO_OUT"] == "Diverging" and gw["GW_PTP-IV_IN"] == "Converging"
    edge = next(f for f in proc.iter(_q(BPMN, "sequenceFlow")) if f.get("name") == "9 cases")
    assert edge.find(f"{_q(BPMN, 'extensionElements')}/{_q(SIG, 'signavioMetaData')}").get("metaValue") == "9"


def test_task_carries_discovery_metadata(files) -> None:
    proc = _proc(files, "L4_PTP-PO-ME21N.bpmn")
    task = next(t for t in proc.iter(_q(BPMN, "task")) if t.get("id") == "A_PTP-PO-ME21N-02")
    sig = {m.get("metaKey"): m.get("metaValue") for m in task.iter(_q(SIG, "signavioMetaData"))}
    assert (sig["meridian_case_count"], sig["meridian_share"], sig["meridian_median"], sig["meridian_source"]) == (
        "10", "100.0", "1m", "template")
    md = task.find(f"{_q(BPMN, 'extensionElements')}/{_q(MER, 'discovery')}")
    assert md.get("caseCount") == "10" and md.get("observed") == "true"
    assert "Cases: 10 (100.0%)" in task.findtext(_q(BPMN, "documentation"))
    extra = next(t for t in proc.iter(_q(BPMN, "task")) if t.get("id") == "A_PTP-PO-ME21N-X_CHANGE_QTY")
    assert "Source: discovered, not in reference" in extra.findtext(_q(BPMN, "documentation"))
    three = next(f for f in proc.iter(_q(BPMN, "sequenceFlow")) if f.get("name") == "3 cases")
    assert three.find(f".//{_q(SIG, 'signavioMetaData')}").get("metaValue") == "3"


def test_manifest_and_readme(files) -> None:
    assert _manifest(files)["discovery"] == META["discovery"]
    readme = files["README.txt"].decode()
    assert "directly-follows" in readme and "2025-01-01" in readme and "po_item" in readme


def test_round_trip_and_determinism(doc, files) -> None:
    data = export_zip(doc, None, META)
    assert data == export_zip(doc, None, META)
    back = import_zip(data)
    assert [x.id for x in back.all_l4()] == [x.id for x in doc.all_l4()]


def test_reference_model_keeps_the_linear_landscape() -> None:
    ref = reference_document()
    assert landscape_edges(ref.l1[0], ref.l1[0].l2) is None


def test_export_node_matches_the_zip(doc, files) -> None:
    for node_id, name in (("PTP", "L1_PTP.bpmn"), ("PTP-PO-ME21N", "L4_PTP-PO-ME21N.bpmn")):
        assert export_node(doc, node_id, None, META) == (name, files[name])
    with pytest.raises(KeyError):
        export_node(doc, "NOPE", None, META)


@pytest.mark.parametrize("seconds, text", [(40, "40s"), (420, "7m"), (5 * 3600 + 720, "5h 12m"),
                                           (3 * 86400 + 4 * 3600, "3d 4h")])
def test_duration(seconds, text) -> None:
    assert duration(seconds) == text
```

- [ ] **Step 2: Run them (FAIL)**

Run: `pytest tests/test_process_discovery_export.py -q`
Expected: FAIL, collection error `ImportError: cannot import name 'duration' from 'api.services.bpmn_export'`.

- [ ] **Step 3: Add the imports and the label pattern**

In `api/services/bpmn_export.py`, below `from api.services.bpmn_validate import BPMN, BPMNDI, DC, DI, validate_package`, add:

```python
from api.services.process_discovery.generate import EDGE_THRESHOLD, keep_edges
from api.services.process_discovery.mining import END as _DFG_END
```

Below the `_KIND = {...}` dict, add:

```python
_CASES = re.compile(r"^([0-9,]+) cases$")  # flow label written by process discovery (generate._diagram)
```

- [ ] **Step 4: Replace `_landscape` and add the flow helpers**

Replace the whole of `def _landscape(...)` (it ends just above `def _field_line`) with:

```python
def landscape_edges(node: Any, children: list[Any]) -> Optional[list[tuple[str, str, str]]]:
    """As-is flows between ``children`` (spec §5.2): ``(source, target, label)`` with ``START`` / ``END`` for the
    events, pruned like the L4 diagram. None when ``node`` was not mined, so the linear chain is kept."""
    d = getattr(node, "discovery", None)
    if d is None or not d.observed:
        return None
    seen = [c for c in children if c.discovery is not None and c.discovery.observed]
    cand = [("START", c.id, c.discovery.entry_count) for c in seen if c.discovery.entry_count]
    cand += [(c.id, "END" if e.target == _DFG_END else e.target, e.count) for c in seen for e in c.discovery.edges]
    return [(s, t, f"{n:,} cases") for s, t, n in keep_edges(cand, d.case_count, ["START"], EDGE_THRESHOLD)]


def _count_meta(flow_el: ET.Element, label: Optional[str]) -> None:
    m = _CASES.match(label or "")
    if m:
        _sub(_sub(flow_el, BPMN, "extensionElements"), SIG, "signavioMetaData",
             {"metaKey": "meridian_edge_count", "metaValue": m.group(1).replace(",", "")})


def _landscape(level: int, node: Any, children: list[Any], meta: dict[str, Any],
               edges: Optional[list[tuple[str, str, str]]] = None) -> bytes:
    pid = f"L{level}_{node.id}"
    defs = _definitions(meta)
    proc = _sub(defs, BPMN, "process", {"id": pid, "name": node.name, "isExecutable": "false"})
    _doc(proc, [node.description])
    ext = _sub(proc, BPMN, "extensionElements")
    lv = _sub(ext, MER, "level", {"id": node.id, "level": level, "order": node.order, "pos": meta["_pos"],
                                  "description": node.description or None, **_extras(node)})
    for m in getattr(node, "modules", []):
        _sub(lv, MER, "module", {"name": m})
    kids = sorted(enumerate(children), key=lambda p: (p[1].order, p[0]))
    keys = ["START", *[c.id for _, c in kids], "END"]
    elems: list[tuple[str, str, ET.Element]] = []
    start = _sub(proc, BPMN, "startEvent", {"id": "E_START", "name": "Start"})
    elems.append(("START", "E_START", start))
    for pos, c in kids:
        el = _sub(proc, BPMN, "callActivity", {"id": f"CA_{c.id}", "name": c.name,
                                               "calledElement": f"L{level + 1}_{c.id}"})
        elems.append((c.id, f"CA_{c.id}", el))
    end = _sub(proc, BPMN, "endEvent", {"id": "E_END", "name": "End"})
    elems.append(("END", "E_END", end))
    kinds = [(k, _KIND["startEvent"] if k in ("START", "END") else "task") for k in keys]
    gateways: dict[str, str] = {}
    labels: dict[str, str] = {}
    if edges is None:
        flows = [(str(i + 1), keys[i], keys[i + 1]) for i in range(len(keys) - 1)]
    else:
        # Discovered: XOR gateways where a node branches or merges; a DFG cannot show concurrency (spec §5.2).
        outdeg = {s: sum(1 for e in edges if e[0] == s) for s, _, _ in edges}
        indeg = {t: sum(1 for e in edges if e[1] == t) for _, t, _ in edges}
        out_gw = {k: f"GW_{k}_OUT" for k in keys if outdeg.get(k, 0) > 1}
        in_gw = {k: f"GW_{k}_IN" for k in keys if k != "END" and indeg.get(k, 0) > 1}
        chain: list[tuple[str, str, Optional[str]]] = []
        for k, g in in_gw.items():
            chain.append((g, k, None))
        for k, g in out_gw.items():
            chain.append((k, g, None))
        chain += [(out_gw.get(s, s), in_gw.get(t, t), label) for s, t, label in edges]
        for g, direction in [*((g, "Converging") for g in in_gw.values()),
                             *((g, "Diverging") for g in out_gw.values())]:
            el = _sub(proc, BPMN, "exclusiveGateway", {"id": g, "gatewayDirection": direction})
            elems.append((g, g, el))
            kinds.append((g, "gateway"))
            gateways[g] = "exclusiveGateway"
        flows = [(str(i + 1), s, t) for i, (s, t, _) in enumerate(chain)]
        labels = {str(i + 1): label for i, (_, _, label) in enumerate(chain) if label}
    eid_of = {k: e for k, e, _ in elems}
    flow_el = {}
    for fid, s, t in flows:
        flow_el[fid] = f"F_{fid}"
        fe = _sub(proc, BPMN, "sequenceFlow", {"id": f"F_{fid}", "sourceRef": eid_of[s], "targetRef": eid_of[t],
                                               "name": labels.get(fid)})
        _count_meta(fe, labels.get(fid))
    _wire(proc, flows, eid_of)
    lay = layout_diagram(kinds, flows, labels or None, starts=["START"])
    _diagram(defs, pid, elems, lay, [f for f, _, _ in flows], flow_el, {"START", "END"}, gateways)
    return _xml(defs)


def duration(seconds: float) -> str:
    """``3d 4h``, ``5h 12m``, ``7m`` or ``40s``: the Signavio ``meridian_median`` value."""
    s = int(round(seconds))
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m" if m else f"{s}s"
```

- [ ] **Step 5: Add discovery metadata to tasks and L4 flows**

In `_task`, replace:

```python
    dq = (overlay or {}).get("activities", {}).get(act.id)
    if dq and dq.get("dq_status"):
        lines.append(_dq_line(dq))
    _doc(el, lines)
```

with:

```python
    dq = (overlay or {}).get("activities", {}).get(act.id)
    if dq and dq.get("dq_status"):
        lines.append(_dq_line(dq))
    d = act.discovery
    if d is not None and d.observed:
        lines.append(f"Cases: {d.case_count:,} ({d.share * 100:.1f}%)")
        if d.median_seconds is not None:
            lines.append(f"Median to next step: {duration(d.median_seconds)}")
    if act.source == "discovered":
        lines.append("Source: discovered, not in reference")
    _doc(el, lines)
```

In `_task`, replace the `meta = [...]` assignment with:

```python
    if d is not None:
        _sub(ext, MER, "discovery", {
            "caseCount": d.case_count, "share": d.share, "medianSeconds": d.median_seconds,
            "p90Seconds": d.p90_seconds, "fitness": d.fitness, "reworkRate": d.rework_rate,
            "automationRate": d.automation_rate, "observed": str(d.observed).lower()})
    meta = [("meridian_tcode", act.tcode), ("meridian_rules", ";".join(act.check_ids) or None),
            ("meridian_dq_status", dq["dq_status"] if dq and dq.get("dq_status") else None)]
    if d is not None:
        meta += [("meridian_case_count", str(d.case_count)), ("meridian_share", f"{d.share * 100:.1f}"),
                 ("meridian_median", duration(d.median_seconds) if d.median_seconds is not None else None),
                 ("meridian_source", act.source),
                 ("meridian_fitness", f"{d.fitness:.4f}" if d.fitness is not None else None)]
```

In `_l4_file`, between the `fe = _sub(proc, BPMN, "sequenceFlow", ...)` call and `if f.condition:`, insert the following. It must come before the condition, because the XSD orders `extensionElements` before `conditionExpression`:

```python
        if l4.discovery is not None:
            _count_meta(fe, f.label)
```

- [ ] **Step 6: Wire `export_zip` and add `export_node`**

In `export_zip`, change the three landscape `add(...)` calls to pass the edges:

```python
        add(1, l1, None, i1, lambda m, n=l1: _landscape(1, n, n.l2, m, landscape_edges(n, n.l2)))
        for i2, l2 in enumerate(l1.l2):
            add(2, l2, l1.id, i2, lambda m, n=l2: _landscape(2, n, n.l3, m, landscape_edges(n, n.l3)))
            for i3, l3 in enumerate(l2.l3):
                add(3, l3, l2.id, i3, lambda m, n=l3: _landscape(3, n, n.l4, m, landscape_edges(n, n.l4)))
```

Directly after the `manifest = {...}` literal, add:

```python
    if meta.get("discovery"):
        manifest["discovery"] = meta["discovery"]  # optional; import_zip ignores it (spec §5.2)
```

Directly after the `readme = (...)` literal, add:

```python
    if document.source == "discovered":
        readme += _discovery_readme(document, meta.get("discovery") or {})
```

Above the `# ---- import (round-trip)` divider, add:

```python
def _discovery_readme(document: ProcessModelDocument, disc: dict[str, Any]) -> str:
    window = disc.get("window") or {}
    notions = sorted({l1.discovery.case_type for l1 in document.l1 if l1.discovery and l1.discovery.case_type})
    threshold = disc.get("edge_threshold", EDGE_THRESHOLD)
    return (
        f"\nThis is an as-is model discovered from the SAP event log, {window.get('from') or 'start'} to "
        f"{window.get('to') or 'latest'}. Case notion: {', '.join(notions) or 'none'}. Flows are observed\n"
        f"directly-follows edges carrying at least {threshold:.0%} of cases (or a step's only exit). Gateways are\n"
        "exclusive choices inferred from branching; parallel work is never inferred. Reference steps never\n"
        "observed are drawn unconnected.\n\n"
        "Signavio import:\n"
        "1. Open the target folder.\n"
        "2. Choose Import, then BPMN 2.0 (.bpmn), and upload the files from the zip. Start with L1_<L1>.bpmn,\n"
        "   then the remaining files.\n"
        "3. Each callActivity's calledElement is the process id of the exported file it refers to. Signavio may\n"
        "   not link them on import: confirm the links after import and set any missing ones by hand.\n")


def export_node(document: ProcessModelDocument, node_id: str, overlay: Optional[dict[str, Any]],
                meta: dict[str, Any]) -> tuple[str, bytes]:
    """One ``L{level}_{id}.bpmn`` for an L1-L4 node, byte-identical to the same file in ``export_zip``.
    Raises KeyError when the node is not in the document."""
    for i1, l1 in enumerate(document.l1):
        found = [(1, l1, i1, lambda m, n=l1: _landscape(1, n, n.l2, m, landscape_edges(n, n.l2)))]
        for i2, l2 in enumerate(l1.l2):
            found.append((2, l2, i2, lambda m, n=l2: _landscape(2, n, n.l3, m, landscape_edges(n, n.l3))))
            for i3, l3 in enumerate(l2.l3):
                found.append((3, l3, i3, lambda m, n=l3: _landscape(3, n, n.l4, m, landscape_edges(n, n.l4))))
                found += [(4, l4, i4, lambda m, n=l4: _l4_file(n, m, overlay)) for i4, l4 in enumerate(l3.l4)]
        for level, node, pos, fn in found:
            if node.id == node_id:
                return f"L{level}_{node.id}.bpmn", fn({**meta, "_pos": pos})
    raise KeyError(node_id)
```

- [ ] **Step 7: Run them (PASS)**

Run: `pytest tests/test_process_discovery_export.py -q`
Expected: `11 passed, 1 skipped`. The skip is the XSD check, which needs `lxml`. With `lxml` installed, expect `12 passed`.

Run: `pytest tests/test_bpmn_export.py tests/test_bpmn_layout.py tests/process_discovery -q`
Expected: no failures. Reference exports keep the linear landscape.

Run: `pytest --collect-only -q tests/process_discovery tests/test_process_discovery_export.py | tail -1`
Expected: `115 tests collected`.

- [ ] **Step 8: Commit**

```bash
git add api/services/bpmn_export.py tests/test_process_discovery_export.py
git commit -m "$(cat <<'MSG'
feat(process): export discovered models to Signavio

L1-L3 landscapes draw the as-is flow with XOR gateways where steps branch
or merge; tasks and flows carry case counts, shares and medians as
Signavio metadata. Adds a single-file export for one node.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 27: Job and API (wave 27): the discovery job, the run API and the export endpoints

**Files:**
- Create: `workers/tasks/run_process_discovery.py` (`discover_process`, `abort_runs`, `prune_events`, `discover`, `store_events`, `MemoryGuard`, `prune`)
- Create: `api/routes/process_discovery.py` (catalogue, runs, mined views, case explorer, Signavio and BPMN export)
- Modify: `api/services/process_discovery/__init__.py` (add `CLOUD_L1S`, `reason`)
- Modify: `api/services/process_discovery/generate.py` (add `reference_model`)
- Modify: `api/services/jobs.py` (`STAGES["process_discovery"]`, `TOUCHES["process_discovery"]`)
- Modify: `workers/celery_app.py` (import the task module)
- Modify: `workers/scheduler.py` (nightly prune beat entry)
- Modify: `api/main.py` (register the router)
- Test: `tests/test_process_discovery_jobs.py` (unit, plus Postgres when `MERIDIAN_TEST_DB_URL` is set)
- Test: `tests/test_process_discovery_api.py` (Postgres; Redis, Celery and the audit insert are faked)

**Interfaces:**
- Consumes:
  - From Task 19: the `process_discovery_runs`, `process_events` and `process_discovery_variants` tables, `sap_systems.timezone`, and the `process_events_<l1>` extraction modules named by `MODULE_OF`.
  - From Tasks 20-23: `builder(l1).build` / `.MAPPING`, `events.collect`, `make_context(..., window_from=)`, `BundleFrames`, `MemoryFrames`, `EventRow.as_row()`.
  - From Task 24: `mining.mine`, `mine_case_type`, `store_variants`, `Scope`, `CASE_TYPES_SQL`, `cache_key`, `CACHE_TTL`, `MiningResult.stats(tables=)`, `CaseTypeResult.stored()`; `filters.ProcessFilter`, `case_filter_sql`.
  - From Task 25: `generate.generate`, `write_back`, `EDGE_THRESHOLD`.
  - From Task 26: `bpmn_export.landscape_edges`, `export_node`, `export_zip(meta["discovery"])`.
  - Existing: `workers.tasks.run_extraction.run_extraction(self, tenant_id, system_id, modules, include_config=True, sync_type="both", scope=None, analyse=True, label=None, version_id=None, delta=False)`, which writes `analysis_versions.metadata.dataset_path` and `.coverage`; `api.services.jobs.start_job` / `update_job` / `finish_job` / `list_jobs`; `api.services.task_progress._redis_client`; `api.routes.process_designer._reference`, `_rls`, `_invalid`; `api.middleware.audit._insert_audit_row`; `api.services.process_model_validator.validate_document`; `workers.db.tenant_session`, `get_sync_engine`.
- Produces:
  - Celery tasks `workers.tasks.run_process_discovery.discover_process(tenant_id, system_id, run_ids, version_id)` on the default Celery queue, `abort_runs(tenant_id, system_id, run_ids)` and `prune_events()` (beat, 03:15).
  - `discover(session, tenant_id, system_id, run_ids, version_id, *, frames_for, guard, progress, today) -> {run_id: "completed" | "failed"}`.
  - `process_discovery.reason(l1, system_type) -> Optional[str]` and `generate.reference_model(base, l1, system_type) -> ProcessModelDocument`.
  - HTTP, prefix `/api/v1/process-discovery`. Task 29 and Task 30 call these:
    - `GET /systems/{system_id}/catalogue` (`view`): 13 rows `{l1, name, coverage, reason, last_run: {id, status, finished_at, cases, fitness} | null, sources: [{table, rows, partial}]}`.
    - `POST /systems/{system_id}/runs` (`run_process_discovery`): body `{l1s, mode: "full" | "incremental", period_from?}`; returns `{job_id, run_ids}` (`job_id` is null when every L1 is reference only); 409 when a run is active for the system, 503 when Redis is down.
    - `GET /systems/{system_id}/runs?l1=&limit=`, `GET /runs/{run_id}`, `GET /runs/{run_id}/model` (`view`).
    - `GET /runs/{run_id}/dfg?node_id=&level=&<filters>` (`view`): `{level, node, nodes: [{id, name, source, observed, case_count, share, median_seconds, fitness}], edges: [{source, target, count}], edge_threshold, cached}`. `START` and `END` are the case start and end.
    - `GET /runs/{run_id}/variants?case_type=&limit=&offset=&<filters>` (`view`): `{case_type, total, items: [{hash, activities, case_count, share, median_seconds, p90_seconds, fitness, sample_case_ids}]}`.
    - `GET /runs/{run_id}/conformance?case_type=&<filters>` (`view`): `{case_type, fitness, missing, steps: [{activity, step_fitness, out_of_order}]}`.
    - `GET /runs/{run_id}/cases?activity=&variant=&limit=&offset=&<filters>` and `GET /runs/{run_id}/cases/{case_id}` (`export_process`).
    - `GET /runs/{run_id}/export/signavio` (zip) and `GET /runs/{run_id}/export/bpmn/{node_id}` (one `.bpmn`) (`export_process`), each writing an audit row `process_discovery.export`.
    - Filters are the query parameters of `ProcessFilter.from_query`: `from`, `to`, `org.<KEY>`, `doc_type`, `case_type`, `automated`.

Decisions this task fixes, and why:
- The run is a Celery chain: `run_extraction.si(...)` with `include_config=False`, `sync_type="data"`, `analyse=False` and a new `version_id`, then `discover_process.si(...)`. An `abort_runs` errback (not in the spec) fails the runs and frees the lock when the extraction raises. Without it the lock would stay held for the full 6-hour TTL.
- `run_extraction` returns `failed` on a timeout without raising, so the chain continues. `discover` therefore reads `analysis_versions.metadata.dataset_path`, and fails every run with "Extraction produced no data" when it is missing.
- The lock is `pd:lock:<tenant>:<system>`, set with NX and a 21600 s TTL by the route, and released by the job's `finally`. While another `extraction` or `config_sync` job on the same system is active, the job keeps the lock and retries every 300 s, at most 24 times. Then it fails with the spec's message. The codebase has no `sync` job kind, so `config_sync` stands in for it.
- The memory guard reads the current RSS from `/proc/self/statm`, not `ru_maxrss`, which the spec names. `ru_maxrss` is a peak that never falls, so after one large L1 every later L1 would fail. macOS falls back to the peak. Above 1.5 GiB the insert batch halves, down to a floor of 1,000. Above 2 GiB the L1 fails with "Memory budget exceeded; narrow the period." and the other L1s continue.
- The insert batch is 50,000 rows, not the spec's 200,000, so the guard runs often enough to act. Builders read whole bundle tables (`BundleFrames`), not `iter_parquet_chunks`.
- `discover` runs three passes: build every L1 (50-80 %), mine every L1 (80-95 %), generate every L1 (95-100 %). That keeps the job stage moving forward. The extraction's own 0-50 % is not mirrored into the job; the stage stays `extraction` until the build pass starts.
- Full mode deletes the scope's events and inserts again. Incremental mode keeps each touched case's events from before the window and rebuilds the window only. Events that a builder dates before the window are dropped, because the stored copies are already there. The incremental window is the last completed watermark minus 14 days, as a date in the system timezone. Without a watermark the run falls back to full.
- Coverage: `reference` with no cases; `discovered` with at least 50 primary cases and no partial source table; `partial` otherwise. A table is partial when its extraction coverage status is not `live`, `delta` or `delta_fallback`, or when it was read incompletely.
- L1s with no source on the system type complete straight away as `reference` runs. Their model is `reference_model(...)`, and `stats.reason` comes from `reason()`. When every requested L1 is reference only, no chain is queued and the lock is released.
- Views without filters read what the run stored (model, variants). Views with filters re-mine the system's current event log, which is not a snapshot of the run. Filtered DFGs are cached in Redis for 600 s under `cache_key(...)` plus the node id.
- The DFG endpoint returns `landscape_edges(parent, children)`, the function the export uses. The flow view and the Signavio file therefore draw the same pruned edges. `level` 5 (an L4's activities) also works.
- The route returns 503 when Redis is unavailable. A run without the lock could overlap another.
- Retention: `prune_events` runs nightly at 03:15 in the Celery timezone (`Africa/Johannesburg`). It deletes events older than 730 days, then completed and failed runs beyond the newest 20 per `(tenant, system, l1)` that no event still references (`process_events.run_id` cascades). The existing beat comments say UTC, but `celery_app` sets `timezone="Africa/Johannesburg"`.
- The worker needs the tenant's base document without an event loop, so `base_document` repeats the SQL of `process_designer._reference` synchronously.
- Permission names `run_process_discovery` and `export_process` arrive with Task 28. The API test adds them to `analyst` with `monkeypatch.setitem` until then. The spec says `process_export` uses `view`; the code uses `export`. The case explorer and the downloads use `export_process`, because they show document numbers and user names.
- The tasks use the default Celery queue, not a dedicated `process_discovery` queue. The worker commands in `docker-compose.yml`, `docker-compose.dev.yml` and `docker/Dockerfile.worker.prod` pass no `-Q`, so they consume only the default queue. A dedicated queue would need `-Q celery,process_discovery` in all three.
- Case ids contain `/` (PTP `EBELN/EBELP`), so the case route uses a `{case_id:path}` converter.

- [ ] **Step 1: Write the failing tests**

`tests/test_process_discovery_jobs.py`:

```python
"""Process discovery job (spec §8): memory guard, lock, wait-for-extraction, the discover passes and pruning.

The Postgres tests run with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from datetime import date, datetime, timezone

import pytest
from celery.exceptions import Retry

from api.services.process_discovery import reason
from workers.tasks import run_process_discovery as rpd

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GiB = 1024 ** 3


def test_memory_guard_halves_then_fails() -> None:
    used = iter([GiB, int(1.6 * GiB), int(1.6 * GiB), int(2.1 * GiB)])
    g = rpd.MemoryGuard(batch=4000, rss=lambda: next(used))
    assert g.check() == 4000
    assert g.check() == 2000
    assert g.check() == 1000
    with pytest.raises(rpd.MemoryBudgetExceeded, match="narrow the period"):
        g.check()


def test_memory_guard_never_goes_below_min_batch() -> None:
    g = rpd.MemoryGuard(batch=1500, rss=lambda: int(1.6 * GiB))
    assert g.check() == rpd.MIN_BATCH
    assert g.check() == rpd.MIN_BATCH


def test_lock_and_job_ids() -> None:
    assert rpd.lock_key("t1", "s1") == "pd:lock:t1:s1"
    assert rpd.job_id_of(["r1", "r2"]) == "pd-r1"


def test_reason_per_system_type() -> None:
    assert reason("PTP", "ecc") is None
    assert reason("SFX", "ecc") == "Connect the SuccessFactors / Ariba / Concur system to discover this process."
    assert reason("PTP", "ariba") == "Discovered from an ABAP system."
    assert reason("PTP", "s4hana_cloud").startswith("Event tables are not exposed")


def test_other_extraction_ignores_own_chain_and_other_systems(monkeypatch) -> None:
    running = [{"kind": "extraction", "system_id": "s1", "version_id": "own"},
               {"kind": "extraction", "system_id": "s2", "version_id": "x"},
               {"kind": "analysis", "system_id": "s1", "version_id": "y"}]
    monkeypatch.setattr(rpd.jobs, "list_jobs", lambda tenant, active_only=False: running)
    assert not rpd.other_extraction_active("t", "s1", "own")
    running.append({"kind": "config_sync", "system_id": "s1", "version_id": None})
    assert rpd.other_extraction_active("t", "s1", "own")


class _FakeSession:
    def __init__(self) -> None:
        self.sql: list[tuple[str, dict]] = []

    def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params or {}))

    def commit(self) -> None: ...
    def rollback(self) -> None: ...
    def close(self) -> None: ...


def test_waits_for_running_extraction_and_keeps_the_lock(monkeypatch) -> None:
    session, released, updates = _FakeSession(), [], []
    monkeypatch.setattr(rpd, "tenant_session", lambda eng, t: session)
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: None)
    monkeypatch.setattr(rpd, "other_extraction_active", lambda *a: True)
    monkeypatch.setattr(rpd, "release_lock", lambda t, s: released.append(s))
    monkeypatch.setattr(rpd.jobs, "update_job", lambda *a, **k: updates.append(k))
    with pytest.raises(Retry):
        rpd.discover_process.run("t", "s1", ["r1"], "v1")
    assert released == []
    assert any("status = :status" in q and p["status"] == "waiting" for q, p in session.sql)
    assert updates[0]["message"].startswith("Waiting for another extraction")


def test_gives_up_after_two_hours(monkeypatch) -> None:
    session, released, finished = _FakeSession(), [], []
    monkeypatch.setattr(rpd, "tenant_session", lambda eng, t: session)
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: None)
    monkeypatch.setattr(rpd, "other_extraction_active", lambda *a: True)
    monkeypatch.setattr(rpd, "release_lock", lambda t, s: released.append(s))
    monkeypatch.setattr(rpd.jobs, "finish_job", lambda t, j, status="completed", **k: finished.append((status, k)))
    rpd.discover_process.push_request(retries=rpd.WAIT_RETRIES)
    try:
        assert rpd.discover_process.run("t", "s1", ["r1"], "v1") == {"r1": "failed"}
    finally:
        rpd.discover_process.pop_request()
    assert released == ["s1"]
    assert finished == [("failed", {"error": rpd.WAIT_ERROR})]
    assert any(p.get("e") == rpd.WAIT_ERROR for _, p in session.sql)


# --- Postgres ---------------------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def engine():
    from sqlalchemy import create_engine

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    eng = create_engine(url)
    yield eng
    eng.dispose()


COVERAGE = [{"table": t, "rows": 1, "status": "live"} for t in
            ("EKKO", "EKPO", "EBAN", "CDHDR", "CDPOS", "EKBE", "RBKP", "BKPF", "BSAK", "USR02")]


def _seed(eng, runs: list[tuple[str, str, date | None]], dataset: bool = True) -> tuple[str, str, str | None, list]:
    """Tenant, ECC system, extraction version and queued runs ``(l1, mode, window_from)``."""
    from sqlalchemy import text

    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    vid = str(uuid.uuid4()) if dataset else None
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDJ-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                  {"s": sid, "t": tid})
        if vid:
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                           "VALUES (:v, :t, 'completed', CAST(:m AS jsonb))"),
                      {"v": vid, "t": tid, "m": json.dumps({"dataset_path": "mem", "coverage": COVERAGE})})
        ids = [str(c.execute(text(
            "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, window_from) "
            "VALUES (:t, :s, :l1, :m, 'queued', :wf) RETURNING id"),
            {"t": tid, "s": sid, "l1": l1, "m": mode, "wf": wf}).scalar()) for l1, mode, wf in runs]
    return tid, sid, vid, ids


def _frames(_path: str):
    from api.services.process_discovery.events import MemoryFrames
    from tests.process_discovery.test_builders_core import ptp_tables

    return MemoryFrames(ptp_tables())


def _run(eng, rid: str):
    from sqlalchemy import text

    with eng.connect() as c:
        return c.execute(text("SELECT status, coverage, error, model IS NOT NULL AS has_model, watermark, stats "
                              "FROM process_discovery_runs WHERE id = :r"), {"r": rid}).one()


@pg
def test_discover_builds_mines_and_stores_the_model(engine) -> None:
    from sqlalchemy import text

    from workers.db import tenant_session

    tid, sid, vid, (rid,) = _seed(engine, [("PTP", "full", None)])
    stages = []
    s = tenant_session(engine, tid)
    out = rpd.discover(s, tid, sid, [rid], vid, frames_for=_frames, today=date(2026, 10, 11),
                       progress=lambda stage, pct, msg: stages.append((stage, pct)))
    s.close()
    assert out == {rid: "completed"}
    assert [x[0] for x in stages] == ["building", "mining", "generating"]
    assert [x[1] for x in stages] == [50, 80, 95]
    run = _run(engine, rid)
    assert run.status == "completed" and run.has_model and run.error is None
    assert run.coverage == "partial"  # 2 PO items, below the 50-case floor
    assert run.stats["tables"]["EKKO"] == {"rows": 1, "partial": False}
    with engine.connect() as c:
        events = c.execute(text("SELECT count(*), max(ts) FROM process_events WHERE run_id = :r"), {"r": rid}).one()
        variants = c.execute(text("SELECT count(*) FROM process_discovery_variants WHERE run_id = :r"),
                             {"r": rid}).scalar()
    assert events[0] > 0 and run.watermark == events[1]
    assert variants > 0


@pg
def test_incremental_keeps_history_before_the_window(engine) -> None:
    from sqlalchemy import text

    from workers.db import tenant_session

    tid, sid, vid, (full,) = _seed(engine, [("PTP", "full", None)])
    s = tenant_session(engine, tid)
    rpd.discover(s, tid, sid, [full], vid, frames_for=_frames, today=date(2026, 10, 11))
    with engine.begin() as c:
        inc = str(c.execute(text(
            "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, window_from) "
            "VALUES (:t, :s, 'PTP', 'incremental', 'queued', '2026-01-11') RETURNING id"),
            {"t": tid, "s": sid}).scalar())
    assert rpd.discover(s, tid, sid, [inc], vid, frames_for=_frames, today=date(2026, 10, 11)) == {inc: "completed"}
    s.close()
    since = rpd.window_start(date(2026, 1, 11), "Africa/Johannesburg")
    with engine.connect() as c:
        rows = c.execute(text("SELECT run_id, ts >= :since AS recent, count(*) FROM process_events "
                              "WHERE system_id = :s GROUP BY 1, 2"), {"s": sid, "since": since}).all()
    by = {(str(r[0]), r[1]): r[2] for r in rows}
    assert by.get((full, False), 0) > 0      # history before the window is kept from the full run
    assert by.get((full, True), 0) == 0      # the window was rebuilt by the incremental run
    assert by.get((inc, True), 0) > 0
    assert (inc, False) not in by


@pg
def test_memory_failure_fails_only_that_l1(engine) -> None:
    from workers.db import tenant_session

    tid, sid, vid, (otc, ptp) = _seed(engine, [("OTC", "full", None), ("PTP", "full", None)])
    s = tenant_session(engine, tid)
    guard = rpd.MemoryGuard(rss=lambda: 3 * GiB)  # checked only after an insert batch; OTC has no rows
    out = rpd.discover(s, tid, sid, [otc, ptp], vid, frames_for=_frames, guard=guard, today=date(2026, 10, 11))
    s.close()
    assert out == {otc: "completed", ptp: "failed"}
    assert _run(engine, ptp).error == rpd.MEMORY_ERROR
    assert _run(engine, otc).coverage == "reference"


@pg
def test_no_dataset_fails_every_run(engine) -> None:
    from workers.db import tenant_session

    tid, sid, _, ids = _seed(engine, [("PTP", "full", None), ("R2R", "full", None)], dataset=False)
    s = tenant_session(engine, tid)
    assert rpd.discover(s, tid, sid, ids, None, frames_for=_frames) == {i: "failed" for i in ids}
    s.close()
    assert {_run(engine, i).error for i in ids} == {rpd.NO_DATA_ERROR}


@pg
def test_prune_keeps_recent_runs_and_runs_with_events(engine) -> None:
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    tid, sid, _, _ = _seed(engine, [], dataset=False)
    with engine.begin() as c:
        ids = [str(c.execute(text(
            "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, started_at) "
            "VALUES (:t, :s, 'PTP', 'full', 'completed', :at) RETURNING id"),
            {"t": tid, "s": sid, "at": datetime(2026, 1, 1 + i, tzinfo=timezone.utc)}).scalar()) for i in range(4)]
        c.execute(text(
            "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, ts, ts_precision, "
            "source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', :c, 'CREATE_PO', :ts, 'day', 'EKKO', :r)"),
            [{"t": tid, "s": sid, "c": "old", "ts": datetime(2020, 1, 1, tzinfo=timezone.utc), "r": ids[0]},
             {"t": tid, "s": sid, "c": "new", "ts": datetime(2026, 1, 1, tzinfo=timezone.utc), "r": ids[1]}])
    with Session(engine) as s:
        events, runs = rpd.prune(s, days=730, keep=2)
    assert events >= 1 and runs >= 1
    with engine.connect() as c:
        left = {str(r[0]) for r in c.execute(text("SELECT id FROM process_discovery_runs WHERE system_id = :s"),
                                             {"s": sid})}
        cases = [r[0] for r in c.execute(text("SELECT case_id FROM process_events WHERE system_id = :s"),
                                         {"s": sid})]
    assert left == {ids[1], ids[2], ids[3]}  # ids[0] pruned once its old event went; ids[1] still has events
    assert cases == ["new"]
```

`tests/test_process_discovery_api.py`:

```python
"""Process discovery API (spec §5.3) against a real Postgres, with Redis, Celery and the audit insert faked.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_process_designer_api.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import uuid
import zipfile
from datetime import date, timedelta

import pytest

from tests.test_process_designer_api import app_engine  # noqa: F401  (module fixture: app role + owner engine)

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
BASE = "/api/v1/process-discovery"


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    def get(self, key):
        return self.data.get(key)

    def setex(self, key, ttl, value):
        self.data[key] = value

    def delete(self, key):
        self.data.pop(key, None)


class FakeChain:
    calls: list = []

    def __init__(self, *sigs) -> None:
        self.sigs = sigs

    def apply_async(self, link_error=None):
        FakeChain.calls.append((self.sigs, link_error))


@pg
def test_process_discovery_api(app_engine, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_discovery as route
    from api.services import rbac
    from tests.test_process_discovery_jobs import COVERAGE, _frames
    from workers.db import tenant_session
    from workers.tasks import run_process_discovery as rpd

    # Until Task 28 adds them to the role table.
    monkeypatch.setitem(rbac.PERMISSIONS, "analyst",
                        rbac.PERMISSIONS["analyst"] | {"run_process_discovery", "export_process"})
    redis, audit, started = FakeRedis(), [], []
    monkeypatch.setattr(route, "_redis_client", lambda: redis)
    monkeypatch.setattr(rpd, "_redis_client", lambda: redis)
    monkeypatch.setattr(route, "_insert_audit_row", audit.append)
    monkeypatch.setattr(route, "chain", FakeChain)
    monkeypatch.setattr(route.jobs, "start_job", lambda *a, **k: started.append((a, k)))
    monkeypatch.setattr(route.jobs, "update_job", lambda *a, **k: None)
    FakeChain.calls = []

    owner, app_eng = app_engine
    tid, sid, vid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDA-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                  {"s": sid, "t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'completed', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"dataset_path": "mem", "coverage": COVERAGE})})
        rid = str(c.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                                 "VALUES (:t, :s, 'PTP', 'full', 'queued') RETURNING id"),
                            {"t": tid, "s": sid}).scalar())
    s = tenant_session(owner, tid)
    assert rpd.discover(s, tid, sid, [rid], vid, frames_for=_frames, today=date(2026, 10, 11)) == {rid: "completed"}
    s.close()
    with owner.connect() as c:
        watermark = c.execute(text("SELECT watermark FROM process_discovery_runs WHERE id = :r"), {"r": rid}).scalar()

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as sess:
            yield sess

    api = FastAPI()
    api.include_router(route.router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D", [])

    async def scenario():
        h, viewer = {"X-User-Role": "analyst"}, {"X-User-Role": "viewer"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            cat = (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()
            assert len(cat) == 13
            by = {r["l1"]: r for r in cat}
            assert by["PTP"]["coverage"] == "partial" and by["PTP"]["reason"] is None
            assert by["PTP"]["last_run"]["id"] == rid and by["PTP"]["last_run"]["cases"] == 2
            assert {"table": "EKKO", "rows": 1, "partial": False} in by["PTP"]["sources"]
            assert by["SFX"]["coverage"] == "reference" and by["SFX"]["last_run"] is None
            assert by["SFX"]["reason"].startswith("Connect the SuccessFactors")
            assert (await c.get(f"{BASE}/systems/{uuid.uuid4()}/catalogue", headers=h)).status_code == 404

            # start: PTP incremental from the watermark, SFX completes as reference without a job
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=viewer, json={"l1s": ["PTP"]})).status_code == 403
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["NOPE"]})).status_code == 422
            r = await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["SFX", "PTP"], "mode": "incremental"})
            assert r.status_code == 200, r.text
            started_ids = r.json()["run_ids"]
            assert r.json()["job_id"] == f"pd-{started_ids[0]}" and len(started_ids) == 2
            (sigs, errback), = FakeChain.calls
            extract, disc = sigs
            want_from = (watermark.astimezone(route.ZoneInfo("Africa/Johannesburg")).date() - timedelta(days=14))
            assert extract.args[2] == ["process_events_ptp"]
            assert extract.kwargs["scope"]["date_from"] == want_from.isoformat()
            assert extract.kwargs["include_config"] is False and extract.kwargs["analyse"] is False
            assert disc.args[2] == [started_ids[0]] and errback.args[2] == [started_ids[0]]  # l1s sorted: PTP, SFX
            assert started[0][0][2] == "process_discovery"
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})).status_code == 409
            redis.delete(rpd.lock_key(tid, sid))

            runs = (await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer, params={"l1": "SFX"})).json()
            assert runs[0]["status"] == "completed" and runs[0]["coverage"] == "reference"
            assert runs[0]["stats"]["reason"].startswith("Connect the SuccessFactors")
            ptp_new = (await c.get(f"{BASE}/runs/{started_ids[0]}", headers=viewer)).json()
            assert ptp_new["status"] == "queued" and ptp_new["mode"] == "incremental"
            assert ptp_new["window_from"] == want_from.isoformat()

            r = await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["SFX"]})
            assert r.json()["job_id"] is None and rpd.lock_key(tid, sid) not in redis.data
            assert len(FakeChain.calls) == 1

            # stored views
            model = (await c.get(f"{BASE}/runs/{rid}/model", headers=viewer)).json()
            assert model["source"] == "discovered" and [x["id"] for x in model["l1"]] == ["PTP"]
            assert (await c.get(f"{BASE}/runs/{rid}", headers=viewer)).json()["coverage"] == "partial"
            assert (await c.get(f"{BASE}/runs/{uuid.uuid4()}", headers=viewer)).status_code == 404
            assert (await c.get(f"{BASE}/runs/not-a-uuid", headers=viewer)).status_code == 422

            g = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer)).json()
            assert g["level"] == 2 and g["node"]["id"] == "PTP" and g["cached"] is False
            assert g["edges"] and {e["source"] for e in g["edges"]} >= {"START"}
            f = {"doc_type": "NB"}
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is False
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is True
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={"node_id": "NOPE"})).status_code == 404

            v = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer)).json()
            assert v["case_type"] == "po_item" and v["total"] == len(v["items"]) > 0
            vf = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer, params=f)).json()
            assert [x["hash"] for x in vf["items"]] == [x["hash"] for x in v["items"]]
            conf = (await c.get(f"{BASE}/runs/{rid}/conformance", headers=viewer)).json()
            assert conf["case_type"] == "po_item" and conf["steps"]

            # case explorer and export need export_process
            assert (await c.get(f"{BASE}/runs/{rid}/cases", headers=viewer)).status_code == 403
            cases = (await c.get(f"{BASE}/runs/{rid}/cases", headers=h)).json()
            assert cases["total"] == 2
            one = cases["items"][0]
            assert (await c.get(f"{BASE}/runs/{rid}/cases", headers=h,
                                params={"variant": one["variant"]})).json()["items"][0]["case_id"] == one["case_id"]
            ev = (await c.get(f"{BASE}/runs/{rid}/cases/{one['case_id']}", headers=h)).json()
            assert ev["events"] and ev["events"][0]["source_table"]
            assert (await c.get(f"{BASE}/runs/{rid}/cases/nope", headers=h)).status_code == 404

            assert (await c.get(f"{BASE}/runs/{rid}/export/signavio", headers=viewer)).status_code == 403
            z = await c.get(f"{BASE}/runs/{rid}/export/signavio", headers=h)
            assert z.status_code == 200, z.text
            assert z.headers["content-disposition"].startswith('attachment; filename="meridian-asis-PTP-')
            zf = zipfile.ZipFile(io.BytesIO(z.content))
            manifest = json.loads(zf.read(next(n for n in zf.namelist() if n.endswith("/manifest.json"))))
            assert manifest["discovery"]["run_id"] == rid
            assert audit[-1]["action"] == "process_discovery.export"
            assert audit[-1]["before_json"] == {"run_id": rid, "l1": "PTP", "node_id": None,
                                                "filters": json.loads(route.ProcessFilter().model_dump_json())}
            x = await c.get(f"{BASE}/runs/{rid}/export/bpmn/PTP", headers=h)
            assert x.headers["content-type"].startswith("application/xml") and b"<bpmn:definitions" in x.content
            assert audit[-1]["before_json"]["node_id"] == "PTP" and len(audit) == 2
            assert (await c.get(f"{BASE}/runs/{rid}/export/bpmn/NOPE", headers=h)).status_code == 404

            # Redis down: no lock, no run
            monkeypatch.setattr(route, "_redis_client", lambda: None)
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})).status_code == 503

    asyncio.run(scenario())
    asyncio.run(aeng.dispose())
```

- [ ] **Step 2: Run them (FAIL)**

Run: `pytest tests/test_process_discovery_jobs.py tests/test_process_discovery_api.py -q`
Expected: FAIL, collection errors `ImportError: cannot import name 'reason' from 'api.services.process_discovery'` and `ModuleNotFoundError: No module named 'api.routes.process_discovery'` (the second error appears inside the test body).

- [ ] **Step 3: Add `reason` and `reference_model`**

At the end of `api/services/process_discovery/__init__.py`, append:

```python
CLOUD_L1S: tuple[str, ...] = ("SFX", "ARB", "CNQ")
ABAP_SYSTEM_TYPES_WITH_EVENTS: tuple[str, ...] = ("ecc", "s4hana_onprem", "ewm")


def reason(l1: str, system_type: str) -> str | None:
    """Spec §10: why ``l1`` stays ``reference`` on ``system_type``; None when the system type has a source."""
    if l1 in L1S_BY_SYSTEM.get(system_type, ()):
        return None
    if system_type in ABAP_SYSTEM_TYPES_WITH_EVENTS and l1 in CLOUD_L1S:
        return "Connect the SuccessFactors / Ariba / Concur system to discover this process."
    if system_type in ("successfactors", "ariba", "concur") and l1 not in CLOUD_L1S:
        return "Discovered from an ABAP system."
    return "Event tables are not exposed by this connector; showing the reference model and configuration."
```

In `api/services/process_discovery/generate.py`, add `from api.services.process_discovery import primary_case_type` directly above `from api.services.process_discovery.events import ActivityMap`. Then append at the end of the file:

```python
def reference_model(base: ProcessModelDocument, l1: str, system_type: Optional[str] = None) -> ProcessModelDocument:
    """Spec §10 ``reference`` coverage: the L1 of ``base`` with every node ``observed = False`` and the base's
    ``source`` (template or config) kept, so the UI and README say "reference, not discovered"."""
    doc = generate(base, MiningResult(l1, primary_case_type(l1, system_type or ""), {}), (),
                   system_type=system_type).document
    doc.source = base.source
    return doc
```

- [ ] **Step 4: Register the job kind**

In `api/services/jobs.py`, add the last entry to `STAGES`:

```python
    "process_discovery": [("extraction", "Extracting"), ("building", "Building event log"), ("mining", "Mining"),
                          ("generating", "Generating model")],
```

Add the last entry to `TOUCHES`:

```python
    "process_discovery": ["process", "run"],
```

- [ ] **Step 5: Write the job**

`workers/tasks/run_process_discovery.py`:

```python
"""Celery tasks: process discovery (spec §8).

``discover_process`` runs after the chain's own extraction. It builds the event log of each requested L1 from the
extraction bundle, mines it in Postgres and stores the generated as-is model on the run. ``abort_runs`` is the
chain's error callback. ``prune_events`` is the nightly retention job.
"""

from __future__ import annotations

import json
import logging
import os
import resource
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Callable, Iterable, Optional, Sequence
from zoneinfo import ZoneInfo

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session
from sqlalchemy.types import Text

from api.models.process_model import ProcessModelDocument
from api.services import jobs
from api.services.process_discovery import primary_case_type
from api.services.process_discovery.builders import builder
from api.services.process_discovery.events import DEFAULT_TZ, BundleFrames, EventRow, Frames, collect, make_context
from api.services.process_discovery.generate import generate, reference_model, write_back
from api.services.process_discovery.mining import MiningResult, Scope, mine, store_variants
from api.services.task_progress import _redis_client
from sap.process_definitions import reference_document
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.process_discovery")

LOCK_TTL = 21600            # spec §8.1: SET NX EX 21600
BATCH = 50_000              # spec §2.1: delete-and-insert batches
MIN_BATCH = 1_000
SOFT_BYTES = 1536 * 1024 * 1024
HARD_BYTES = 2048 * 1024 * 1024
WAIT_RETRIES = 24           # 24 x 300 s = 2 hours (spec §8.2 step 1)
WAIT_COUNTDOWN = 300
MIN_CASES = 50              # spec §10: below this the DFG is anecdotes, not a process
EVENT_DAYS = 730            # retention: 24 months of events
KEEP_RUNS = 20              # retention: runs kept per (system, l1)
EXCLUSIVE_KINDS = ("extraction", "config_sync")
LIVE = frozenset({"live", "delta", "delta_fallback"})

WAIT_ERROR = "Extraction on this system still running after 2 hours."
NO_DATA_ERROR = "Extraction produced no data"
MEMORY_ERROR = "Memory budget exceeded; narrow the period."

INSERT_EVENT_SQL = text("""
INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, l5_id, ts, ts_precision, seq,
                            resource, automated, doc_type, org, object_refs, attributes, source_table, run_id)
VALUES (:t, :s, :l1, :case_type, :case_id, :activity, :l5_id, :ts, :ts_precision, :seq, :resource, :automated,
        :doc_type, CAST(:org AS jsonb), CAST(:object_refs AS jsonb), CAST(:attributes AS jsonb), :source_table,
        :run_id)""")

DELETE_SCOPE_SQL = text("DELETE FROM process_events WHERE tenant_id = :t AND system_id = :s AND l1 = :l1")

DELETE_TOUCHED_SQL = text("""
DELETE FROM process_events
WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND ts >= :since
  AND (case_type, case_id) IN (SELECT * FROM unnest(:cts, :cids))""").bindparams(
    bindparam("cts", type_=ARRAY(Text)), bindparam("cids", type_=ARRAY(Text)))

BASE_SQL = text("""
SELECT document FROM (SELECT document, created_at FROM process_derivations WHERE tenant_id = :t
                      UNION ALL SELECT derivation, created_at FROM config_loads WHERE tenant_id = :t
                      AND derivation IS NOT NULL) d ORDER BY created_at DESC LIMIT 1""")


def lock_key(tenant_id: str, system_id: str) -> str:
    return f"pd:lock:{tenant_id}:{system_id}"


def release_lock(tenant_id: str, system_id: str) -> None:
    client = _redis_client()
    if client is not None:
        client.delete(lock_key(tenant_id, system_id))


def job_id_of(run_ids: Sequence[str]) -> str:
    return f"pd-{run_ids[0]}"


# --- memory budget (spec §8.3) ------------------------------------------------------------------------------


class MemoryBudgetExceeded(RuntimeError):
    pass


def current_rss() -> int:
    """Resident set size now, in bytes. ``ru_maxrss`` is the peak, which never falls again, so after one large
    L1 every later L1 would fail too; Linux reads the current value from /proc instead."""
    try:
        with open("/proc/self/statm") as f:
            return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
    except OSError:  # macOS dev machines: peak in bytes
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak if sys.platform == "darwin" else peak * 1024


@dataclass
class MemoryGuard:
    """Checked after every insert batch: above ``soft`` the batch halves, above ``hard`` the L1 fails."""
    batch: int = BATCH
    soft: int = SOFT_BYTES
    hard: int = HARD_BYTES
    rss: Callable[[], int] = field(default=current_rss)

    def check(self) -> int:
        used = self.rss()
        if used > self.hard:
            raise MemoryBudgetExceeded(MEMORY_ERROR)
        if used > self.soft:
            self.batch = max(MIN_BATCH, self.batch // 2)
        return self.batch


# --- event storage ------------------------------------------------------------------------------------------


def _row(scope: Scope, run_id: str, e: EventRow) -> dict[str, object]:
    r = e.as_row()
    for k in ("org", "object_refs", "attributes"):
        r[k] = json.dumps(r[k], sort_keys=True)
    return {**r, "t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1, "run_id": run_id}


def window_start(window_from: date, tz: str) -> datetime:
    """Midnight SAP-local time of the first window day, as an instant."""
    return datetime.combine(window_from, time(), ZoneInfo(tz))


def store_events(session: Session, scope: Scope, run_id: str, events: Sequence[EventRow], mode: str,
                 window_from: Optional[date], guard: MemoryGuard) -> int:
    """Replace the scope's events with ``events`` (full), or rebuild only the window of the touched cases
    (incremental). Incremental keeps each touched case's events older than the window, so a case's history
    survives windowed extractions; events the builder dated before the window are dropped, because the stored
    copies of those are already there. Returns the rows inserted. The caller commits."""
    if mode == "incremental" and window_from is not None:
        since = window_start(window_from, scope.tz)
        events = [e for e in events if e.ts >= since]
        touched = sorted({(e.case_type, e.case_id) for e in events})
        if touched:
            session.execute(DELETE_TOUCHED_SQL, {"t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1,
                                                 "since": since, "cts": [c[0] for c in touched],
                                                 "cids": [c[1] for c in touched]})
    else:
        session.execute(DELETE_SCOPE_SQL, {"t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1})
    done = 0
    size = guard.batch
    while done < len(events):
        chunk = events[done:done + size]
        session.execute(INSERT_EVENT_SQL, [_row(scope, run_id, e) for e in chunk])
        done += len(chunk)
        size = guard.check()
    return done


# --- inputs -------------------------------------------------------------------------------------------------


class RecordingFrames:
    """Frames proxy that records which bundle tables a builder read (for ``stats.tables``)."""

    def __init__(self, inner: Frames) -> None:
        self.inner = inner
        self.read: set[str] = set()

    def has(self, table: str) -> bool:
        return self.inner.has(table)

    def get(self, table: str, cols):
        self.read.add(table)
        return self.inner.get(table, cols)


def base_document(session: Session, tenant_id: str) -> ProcessModelDocument:
    """Sync twin of ``api/routes/process_designer._reference`` (latest derivation, else the template)."""
    row = session.execute(BASE_SQL, {"t": tenant_id}).fetchone()
    if row is None:
        return reference_document()
    from sap.spro_paths import enrich_evidence
    return ProcessModelDocument.model_validate(enrich_evidence(row[0], row[0].get("system_type", "")))


def source_tables(coverage: Iterable[dict], read: Iterable[str]) -> dict[str, dict]:
    """``{table: {rows, partial}}`` for the tables a builder read. A table is partial when it was not read live,
    or was read incompletely."""
    by_table = {c["table"]: c for c in coverage}
    out = {}
    for t in sorted(read):
        c = by_table.get(t)
        out[t] = {"rows": int(c.get("rows") or 0) if c else 0,
                  "partial": c is None or c.get("status") not in LIVE or c.get("complete") is False}
    return out


def coverage_of(mining: MiningResult, tables: dict[str, dict]) -> str:
    """Spec §10: discovered needs 50 primary cases and no partial table; partial has some cases."""
    if not any(r.cases for r in mining.by_type.values()):
        return "reference"
    primary = mining.by_type.get(mining.primary)
    if primary and primary.cases >= MIN_CASES and not any(t["partial"] for t in tables.values()):
        return "discovered"
    return "partial"


# --- the job ------------------------------------------------------------------------------------------------


@dataclass
class _Run:
    id: str
    l1: str
    mode: str
    window_from: Optional[date]
    failed: bool = False
    tables: dict = field(default_factory=dict)
    mining: Optional[MiningResult] = None


def _set(session: Session, run_ids: Sequence[str], **cols) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    session.execute(text(f"UPDATE process_discovery_runs SET {sets} WHERE id = ANY(CAST(:ids AS uuid[]))"),
                    {"ids": list(run_ids), **cols})


def _fail(session: Session, run_ids: Sequence[str], error: str) -> None:
    session.rollback()
    session.execute(text("UPDATE process_discovery_runs SET status = 'failed', error = :e, finished_at = now() "
                         "WHERE id = ANY(CAST(:ids AS uuid[])) AND status <> 'completed'"),
                    {"ids": list(run_ids), "e": error[:500]})
    session.commit()


def discover(session: Session, tenant_id: str, system_id: str, run_ids: Sequence[str], version_id: Optional[str],
             *, frames_for: Callable[[str], Frames] = BundleFrames, guard: Optional[MemoryGuard] = None,
             progress: Callable[[str, int, str], None] = lambda stage, pct, msg: None,
             today: Optional[date] = None) -> dict[str, str]:
    """Build, mine and generate every run in ``run_ids``. One L1 failing never stops the others.
    Returns ``{run_id: final status}``. Three passes (build all, mine all, generate all) keep job stages
    moving forward, as §8.4's percent bands expect."""
    sysrow = session.execute(text("SELECT system_type, timezone FROM sap_systems WHERE id = :s"),
                             {"s": system_id}).fetchone()
    system_type, tz = sysrow[0], sysrow[1] or DEFAULT_TZ
    meta = None
    if version_id:
        meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                               {"v": version_id}).scalar()
    if not meta or not meta.get("dataset_path"):
        _fail(session, run_ids, NO_DATA_ERROR)
        return {r: "failed" for r in run_ids}
    runs = [_Run(str(r[0]), r[1], r[2], r[3]) for r in session.execute(text(
        "SELECT id, l1, mode, window_from FROM process_discovery_runs WHERE id = ANY(CAST(:ids AS uuid[])) "
        "ORDER BY l1"), {"ids": list(run_ids)})]
    frames = frames_for(meta["dataset_path"])
    guard = guard or MemoryGuard()
    coverage = meta.get("coverage") or []
    n = len(runs)

    for i, run in enumerate(runs):  # 50-80
        progress("building", 50 + 30 * i // n, f"Building the {run.l1} event log")
        _set(session, [run.id], status="building", extraction_version_id=version_id)
        session.commit()
        try:
            rec = RecordingFrames(frames)
            ctx = make_context(rec, tenant_id, system_type, today or date.today(), tz,
                               window_from=run.window_from if run.mode == "incremental" else None)
            events = collect(builder(run.l1).build, rec, ctx)
            store_events(session, Scope(tenant_id, system_id, run.l1, tz), run.id, events, run.mode,
                         run.window_from, guard)
            run.tables = source_tables(coverage, rec.read)
            del events
            session.commit()
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.exception("process discovery build %s %s failed", system_id, run.l1)
            run.failed = True
            _fail(session, [run.id], str(e) or e.__class__.__name__)

    live = [r for r in runs if not r.failed]
    for i, run in enumerate(live):  # 80-95
        progress("mining", 80 + 15 * i // len(live), f"Mining {run.l1}")
        _set(session, [run.id], status="mining")
        try:
            mapping = builder(run.l1).MAPPING
            run.mining = mine(session, Scope(tenant_id, system_id, run.l1, tz), mapping,
                              primary_case_type(run.l1, system_type))
            session.execute(text("DELETE FROM process_discovery_variants WHERE run_id = :r"), {"r": run.id})
            for result in run.mining.by_type.values():
                store_variants(session, run.id, tenant_id, result)
            session.commit()
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.exception("process discovery mining %s %s failed", system_id, run.l1)
            run.failed = True
            _fail(session, [run.id], str(e) or e.__class__.__name__)

    base = base_document(session, tenant_id)
    live = [r for r in runs if not r.failed]
    for i, run in enumerate(live):  # 95-100
        progress("generating", 95 + 5 * i // len(live), f"Generating the {run.l1} model")
        scope = Scope(tenant_id, system_id, run.l1, tz)
        try:
            cov = coverage_of(run.mining, run.tables)
            if cov == "reference":
                model = reference_model(base, run.l1, system_type)
            else:
                gen = generate(base, run.mining, builder(run.l1).MAPPING, system_type=system_type)
                write_back(session, scope, gen.l5_of)
                model = gen.document
            session.execute(text("""
                UPDATE process_discovery_runs
                   SET status = 'completed', coverage = :cov, model = CAST(:model AS jsonb),
                       stats = CAST(:stats AS jsonb), finished_at = now(),
                       watermark = (SELECT max(ts) FROM process_events
                                    WHERE tenant_id = :t AND system_id = :s AND l1 = :l1)
                 WHERE id = :id"""), {
                "cov": cov, "model": model.model_dump_json(), "id": run.id, "t": tenant_id, "s": system_id,
                "l1": run.l1, "stats": json.dumps(run.mining.stats(tables=run.tables), default=str)})
            session.commit()
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.exception("process discovery generation %s %s failed", system_id, run.l1)
            run.failed = True
            _fail(session, [run.id], str(e) or e.__class__.__name__)
    return {r.id: "failed" if r.failed else "completed" for r in runs}


def other_extraction_active(tenant_id: str, system_id: str, version_id: Optional[str]) -> bool:
    """Spec §8.2 step 1: an extraction or sync job on this system other than this chain's own."""
    return any(j.get("kind") in EXCLUSIVE_KINDS and str(j.get("system_id")) == str(system_id)
               and j.get("version_id") != version_id for j in jobs.list_jobs(tenant_id, active_only=True))


@celery_app.task(bind=True, name="workers.tasks.run_process_discovery.discover_process", acks_late=True,
                 soft_time_limit=7200, time_limit=7500, max_retries=WAIT_RETRIES)
def discover_process(self, tenant_id: str, system_id: str, run_ids: list[str],
                     version_id: Optional[str]) -> dict[str, str]:
    job_id = job_id_of(run_ids)
    session = tenant_session(get_sync_engine(), tenant_id)
    keep_lock = False
    try:
        if other_extraction_active(tenant_id, system_id, version_id):
            if self.request.retries >= WAIT_RETRIES:
                _fail(session, run_ids, WAIT_ERROR)
                jobs.finish_job(tenant_id, job_id, "failed", error=WAIT_ERROR)
                return {r: "failed" for r in run_ids}
            _set(session, run_ids, status="waiting")
            session.commit()
            jobs.update_job(tenant_id, job_id, stage="extraction",
                            message="Waiting for another extraction on this system to finish")
            keep_lock = True
            raise self.retry(countdown=WAIT_COUNTDOWN)

        def progress(stage: str, pct: int, msg: str) -> None:
            jobs.update_job(tenant_id, job_id, stage=stage, percent=pct, message=msg)

        result = discover(session, tenant_id, system_id, run_ids, version_id, progress=progress)
        failed = [r for r, s in result.items() if s == "failed"]
        if len(failed) == len(result):
            jobs.finish_job(tenant_id, job_id, "failed", error="Every process failed", result=result)
        else:
            jobs.finish_job(tenant_id, job_id, result=result,
                            message=f"{len(result) - len(failed)} of {len(result)} processes discovered")
        return result
    except SoftTimeLimitExceeded:
        _fail(session, run_ids, "Timed out")
        jobs.finish_job(tenant_id, job_id, "failed", error="Timed out")
        return {r: "failed" for r in run_ids}
    except Exception as e:
        if keep_lock:  # the Retry exception
            raise
        _fail(session, run_ids, str(e) or e.__class__.__name__)
        jobs.finish_job(tenant_id, job_id, "failed", error=str(e) or e.__class__.__name__)
        raise
    finally:
        session.close()
        if not keep_lock:
            release_lock(tenant_id, system_id)


@celery_app.task(name="workers.tasks.run_process_discovery.abort_runs")
def abort_runs(tenant_id: str, system_id: str, run_ids: list[str]) -> None:
    """Chain error callback: the extraction raised, so ``discover_process`` never runs. Fails the runs, finishes
    the job and frees the lock (otherwise held for the full 6-hour TTL)."""
    session = tenant_session(get_sync_engine(), tenant_id)
    try:
        _fail(session, run_ids, "Extraction failed")
    finally:
        session.close()
        jobs.finish_job(tenant_id, job_id_of(run_ids), "failed", error="Extraction failed")
        release_lock(tenant_id, system_id)


PRUNE_EVENTS_SQL = text("DELETE FROM process_events WHERE ts < now() - make_interval(days => :days)")

# A run still referenced by events is kept: process_events.run_id cascades, so deleting the run would delete
# events newer than the retention window (incremental runs leave old cases pointing at older runs).
PRUNE_RUNS_SQL = text("""
DELETE FROM process_discovery_runs r
USING (SELECT id, row_number() OVER (PARTITION BY tenant_id, system_id, l1 ORDER BY started_at DESC) AS n
       FROM process_discovery_runs WHERE status IN ('completed', 'failed')) old
WHERE r.id = old.id AND old.n > :keep
  AND NOT EXISTS (SELECT 1 FROM process_events e WHERE e.run_id = r.id)""")


def prune(session: Session, days: int = EVENT_DAYS, keep: int = KEEP_RUNS) -> tuple[int, int]:
    """(events deleted, runs deleted). The session must bypass RLS (owner role) to see every tenant."""
    events = session.execute(PRUNE_EVENTS_SQL, {"days": days}).rowcount
    runs = session.execute(PRUNE_RUNS_SQL, {"keep": keep}).rowcount
    session.commit()
    return events, runs


@celery_app.task(name="workers.tasks.run_process_discovery.prune_events")
def prune_events() -> dict[str, int]:
    with Session(get_sync_engine()) as session:
        events, runs = prune(session)
    logger.info("process discovery prune: %d events, %d runs", events, runs)
    return {"events": events, "runs": runs}
```

In `workers/celery_app.py`, directly above `import workers.scheduler`, add:

```python
import workers.tasks.run_process_discovery  # noqa: F401 — as-is process discovery + nightly prune (beat)
```

In `workers/scheduler.py`, add the last entry of the beat schedule dict:

```python
    "prune-process-events-0315": {
        "task": "workers.tasks.run_process_discovery.prune_events",
        "schedule": crontab(hour=3, minute=15),  # beat runs in celery_app timezone (Africa/Johannesburg)
    },
```

- [ ] **Step 6: Write the routes**

`api/routes/process_discovery.py`:

```python
"""As-is process discovery: catalogue, runs, mined views and Signavio export (spec §5.3).

Reads go through RLS (``_rls``). Mined views with filters re-mine the system's current event log in SQL
(``mining.mine_case_type``); without filters they read what the run stored. Exports write their own audit row,
as ``api/routes/process_export.py`` does, because GET is not covered by the audit middleware.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from celery import chain
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.audit import _insert_audit_row
from api.models.process_model import ProcessModelDocument
from api.routes.process_designer import _invalid, _reference, _rls
from api.services import jobs
from api.services.bpmn_export import BpmnExportError, export_node, export_zip, landscape_edges
from api.services.process_discovery import L1S, L1S_BY_SYSTEM, MODULE_OF, primary_case_type, reason
from api.services.process_discovery.builders import builder
from api.services.process_discovery.events import DEFAULT_TZ
from api.services.process_discovery.filters import ProcessFilter
from api.services.process_discovery.generate import EDGE_THRESHOLD, generate, reference_model
from api.services.process_discovery.mining import (CACHE_TTL, CASE_TYPES_SQL, MiningResult, Scope, cache_key,
                                                   mine_case_type)
from api.services.process_model_validator import validate_document
from api.services.rbac import require_permission
from api.services.task_progress import _redis_client
from sap.process_definitions import reference_document

logger = logging.getLogger("meridian.process_discovery")
router = APIRouter(prefix="/api/v1/process-discovery", tags=["process-discovery"])

VIEW = [Depends(require_permission("view"))]
EXPORT = [Depends(require_permission("export_process"))]

OVERLAP_DAYS = 14  # spec §8.2 step 3: incremental scope starts at watermark - 14 days

RUN_COLS = ("id, l1, mode, status, coverage, window_from, window_to, watermark, extraction_version_id, job_id, "
            "filters, stats, error, started_at, finished_at")


class RunRequest(BaseModel):
    l1s: list[str]
    mode: Literal["full", "incremental"] = "full"
    period_from: Optional[date] = None

    @field_validator("l1s")
    @classmethod
    def _known(cls, v: list[str]) -> list[str]:
        bad = [x for x in v if x not in L1S]
        if bad or not v:
            raise ValueError(f"unknown L1: {', '.join(bad) or '(none)'}")
        return sorted(set(v))


def _id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid id")


def _row(r: Any) -> dict[str, Any]:
    d = dict(r._mapping)
    for k in ("id", "extraction_version_id"):
        d[k] = str(d[k]) if d.get(k) else None
    return d


async def _system(db: AsyncSession, tenant: Tenant, system_id: str) -> tuple[str, str]:
    await _rls(db, tenant)
    row = (await db.execute(text("SELECT system_type, timezone FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                            {"s": system_id, "t": str(tenant.id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="System not found")
    return row[0], row[1] or DEFAULT_TZ


async def _run(db: AsyncSession, tenant: Tenant, run_id: str) -> dict[str, Any]:
    await _rls(db, tenant)
    row = (await db.execute(text(f"SELECT {RUN_COLS}, system_id, model FROM process_discovery_runs "
                                 "WHERE id = :id AND tenant_id = :t"), {"id": _id(run_id), "t": str(tenant.id)})
           ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    run = _row(row)
    run["system_id"] = str(run["system_id"])
    run["system_type"], run["tz"] = await _system(db, tenant, run["system_id"])
    return run


def _scope(tenant: Tenant, run: dict[str, Any]) -> Scope:
    return Scope(str(tenant.id), run["system_id"], run["l1"], run["tz"])


def _filter(request: Request, run: dict[str, Any]) -> tuple[ProcessFilter, str]:
    try:
        flt = ProcessFilter.from_query(request.query_params)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return flt, flt.case_type or primary_case_type(run["l1"], run["system_type"])


async def _mine(db: AsyncSession, tenant: Tenant, run: dict[str, Any], flt: ProcessFilter, case_type: str):
    mapping = builder(run["l1"]).MAPPING
    return await db.run_sync(lambda s: mine_case_type(s, _scope(tenant, run), case_type, flt, mapping))


async def _document(db: AsyncSession, tenant: Tenant, run: dict[str, Any],
                    flt: ProcessFilter) -> ProcessModelDocument:
    """The run's stored model, or one generated from the current event log under ``flt``."""
    if run["model"] is None:
        raise HTTPException(status_code=409, detail="Run has no model yet")
    if flt == ProcessFilter():
        return ProcessModelDocument.model_validate(run["model"])
    base = await _reference(db, tenant)
    scope, mapping = _scope(tenant, run), builder(run["l1"]).MAPPING
    primary = primary_case_type(run["l1"], run["system_type"])

    def build(s) -> ProcessModelDocument:
        types = [flt.case_type] if flt.case_type else [r[0] for r in s.execute(text(CASE_TYPES_SQL),
                                                                                  scope.params(""))]
        mined = MiningResult(run["l1"], primary, {ct: mine_case_type(s, scope, ct, flt, mapping) for ct in types})
        if not any(r.cases for r in mined.by_type.values()):
            return reference_model(base, run["l1"], run["system_type"])
        return generate(base, mined, mapping, system_type=run["system_type"]).document

    await _rls(db, tenant)
    return await db.run_sync(build)


# --- catalogue and runs ---------------------------------------------------------------------------------------


@router.get("/systems/{system_id}/catalogue", dependencies=VIEW)
async def catalogue(system_id: str, tenant: Tenant = Depends(get_tenant),
                    db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    system_type, _ = await _system(db, tenant, _id(system_id))
    rows = (await db.execute(text(f"""
        SELECT DISTINCT ON (l1) {RUN_COLS} FROM process_discovery_runs
        WHERE tenant_id = :t AND system_id = :s ORDER BY l1, started_at DESC"""),
        {"t": str(tenant.id), "s": _id(system_id)})).fetchall()
    last = {r.l1: _row(r) for r in rows}
    names = {x.id: x.name for x in reference_document().l1}
    out = []
    for l1 in L1S:
        r = last.get(l1)
        stats = (r or {}).get("stats") or {}
        out.append({
            "l1": l1, "name": names.get(l1, l1),
            "coverage": r["coverage"] if r and r["status"] == "completed" else "reference",
            "reason": reason(l1, system_type),
            "last_run": None if r is None else {
                "id": r["id"], "status": r["status"], "finished_at": r["finished_at"],
                "cases": (stats.get("case_types") or {}).get(primary_case_type(l1, system_type)),
                "fitness": (stats.get("conformance") or {}).get("fitness")},
            "sources": [{"table": t, **v} for t, v in sorted((stats.get("tables") or {}).items())]})
    return out


@router.post("/systems/{system_id}/runs", dependencies=[Depends(require_permission("run_process_discovery"))])
async def start_runs(system_id: str, body: RunRequest, request: Request, tenant: Tenant = Depends(get_tenant),
                     db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    from workers.tasks.run_extraction import run_extraction
    from workers.tasks.run_process_discovery import abort_runs, discover_process, lock_key, release_lock

    system_id = _id(system_id)
    system_type, tz = await _system(db, tenant, system_id)
    client = _redis_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Job queue unavailable")
    tid = str(tenant.id)
    if not client.set(lock_key(tid, system_id), uuid.uuid4().hex, nx=True, ex=21600):
        raise HTTPException(status_code=409, detail="A process discovery run is already active for this system")
    try:
        sourced = [l1 for l1 in body.l1s if l1 in L1S_BY_SYSTEM.get(system_type, ())]
        today = datetime.now(ZoneInfo(tz)).date()
        window: dict[str, Optional[date]] = {}
        for l1 in sourced:
            wm = None
            if body.mode == "incremental":
                wm = (await db.execute(text(
                    "SELECT max(watermark) FROM process_discovery_runs WHERE tenant_id = :t AND system_id = :s "
                    "AND l1 = :l1 AND status = 'completed'"), {"t": tid, "s": system_id, "l1": l1})).scalar()
            window[l1] = (wm.astimezone(ZoneInfo(tz)).date() - timedelta(days=OVERLAP_DAYS)) if wm \
                else body.period_from
        version_id = str(uuid.uuid4()) if sourced else None
        run_ids: list[str] = []
        base = await _reference(db, tenant) if len(sourced) < len(body.l1s) else None
        for l1 in body.l1s:
            rid = str(uuid.uuid4())
            run_ids.append(rid)
            mode = body.mode if l1 in sourced and window.get(l1) and body.mode == "incremental" else "full"
            args = {"id": rid, "t": tid, "s": system_id, "l1": l1, "mode": mode, "wf": window.get(l1),
                    "wt": today, "u": getattr(request.state, "local_user_id", None), "job": None}
            if l1 in sourced:
                await db.execute(text(
                    "INSERT INTO process_discovery_runs (id, tenant_id, system_id, l1, mode, status, window_from, "
                    "window_to, created_by) VALUES (:id, :t, :s, :l1, :mode, 'queued', :wf, :wt, :u)"), args)
            else:  # spec §8.1 step 4: no source on this system type, completes straight away as reference
                model = reference_model(base, l1, system_type)
                await db.execute(text(
                    "INSERT INTO process_discovery_runs (id, tenant_id, system_id, l1, mode, status, coverage, "
                    "window_to, stats, model, created_by, finished_at) VALUES (:id, :t, :s, :l1, :mode, "
                    "'completed', 'reference', :wt, CAST(:stats AS jsonb), CAST(:model AS jsonb), :u, now())"),
                    {**args, "stats": json.dumps({"reason": reason(l1, system_type)}),
                     "model": model.model_dump_json()})
        job_id = f"pd-{run_ids[0]}"
        await db.execute(text("UPDATE process_discovery_runs SET job_id = :j WHERE id = ANY(CAST(:ids AS uuid[]))"),
                         {"j": job_id, "ids": run_ids})
        await db.commit()
    except BaseException:
        release_lock(tid, system_id)
        raise

    queued = [r for r, l1 in zip(run_ids, body.l1s) if l1 in sourced]
    if not queued:
        release_lock(tid, system_id)
        return {"job_id": None, "run_ids": run_ids}
    starts = [w for w in window.values() if w]
    scope = {"date_from": min(starts).isoformat(), "date_to": today.isoformat()} if starts else None
    jobs.start_job(tid, job_id, "process_discovery", f"Process discovery: {', '.join(sourced)}",
                   system_id=system_id, run_ids=queued, version_id=version_id)
    jobs.update_job(tid, job_id, stage="extraction", percent=0, message="Extracting event tables")
    chain(run_extraction.si(tid, system_id, [MODULE_OF[l1] for l1 in sourced], include_config=False,
                            sync_type="data", scope=scope, analyse=False, label="Process discovery",
                            version_id=version_id),
          discover_process.si(tid, system_id, queued, version_id)).apply_async(
        link_error=abort_runs.si(tid, system_id, queued))
    return {"job_id": job_id, "run_ids": run_ids}


@router.get("/systems/{system_id}/runs", dependencies=VIEW)
async def list_runs(system_id: str, l1: Optional[str] = None, limit: int = Query(50, ge=1, le=200),
                    tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> list[dict]:
    await _rls(db, tenant)
    rows = await db.execute(text(f"""
        SELECT {RUN_COLS} FROM process_discovery_runs WHERE tenant_id = :t AND system_id = :s
          AND (CAST(:l1 AS text) IS NULL OR l1 = :l1) ORDER BY started_at DESC, l1 LIMIT :n"""),
        {"t": str(tenant.id), "s": _id(system_id), "l1": l1, "n": limit})
    return [_row(r) for r in rows]


@router.get("/runs/{run_id}", dependencies=VIEW)
async def get_run(run_id: str, tenant: Tenant = Depends(get_tenant),
                  db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await _run(db, tenant, run_id)
    return {k: v for k, v in run.items() if k not in ("model", "tz")}


@router.get("/runs/{run_id}/model", dependencies=VIEW)
async def get_model(run_id: str, tenant: Tenant = Depends(get_tenant),
                    db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await _run(db, tenant, run_id)
    return (await _document(db, tenant, run, ProcessFilter())).model_dump()


# --- mined views ----------------------------------------------------------------------------------------------


def _children(doc: ProcessModelDocument, node_id: Optional[str]) -> tuple[int, Any, list[Any]]:
    """(level of the children, parent, children) for an L1-L4 parent; the L1 when ``node_id`` is None."""
    for l1 in doc.l1:
        if node_id in (None, l1.id):
            return 2, l1, l1.l2
        for l2 in l1.l2:
            if l2.id == node_id:
                return 3, l2, l2.l3
            for l3 in l2.l3:
                if l3.id == node_id:
                    return 4, l3, l3.l4
                for l4 in l3.l4:
                    if l4.id == node_id:
                        return 5, l4, l4.activities
    raise HTTPException(status_code=404, detail="Node not found")


def _stats(node: Any) -> dict[str, Any]:
    d = node.discovery
    return {"id": node.id, "name": node.name, "source": node.source, "observed": bool(d and d.observed),
            "case_count": d.case_count if d else 0, "share": d.share if d else 0.0,
            "median_seconds": d.median_seconds if d else None, "fitness": d.fitness if d else None}


@router.get("/runs/{run_id}/dfg", dependencies=VIEW)
async def dfg(run_id: str, request: Request, level: Optional[int] = Query(None, ge=2, le=5),
              node_id: Optional[str] = None, tenant: Tenant = Depends(get_tenant),
              db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Nodes and as-is edges between the children of ``node_id`` (default: the L1), pruned as in the export,
    so the flow view and the Signavio file draw the same edges."""
    run = await _run(db, tenant, run_id)
    flt, _ = _filter(request, run)
    client = _redis_client() if flt != ProcessFilter() else None
    key = f"{cache_key(_scope(tenant, run), flt, run['id'])}:{node_id or ''}"
    if client is not None and (hit := client.get(key)):
        return {**json.loads(hit), "cached": True}
    doc = await _document(db, tenant, run, flt)
    lvl, parent, kids = _children(doc, node_id)
    if level is not None and level != lvl:
        raise HTTPException(status_code=422, detail=f"Children of {parent.id} are level {lvl}")
    edges = landscape_edges(parent, kids) or []
    out = {"level": lvl, "node": _stats(parent), "nodes": [_stats(k) for k in kids],
           "edges": [{"source": s, "target": t, "count": int(lbl.split()[0].replace(",", ""))}
                     for s, t, lbl in edges], "edge_threshold": EDGE_THRESHOLD}
    if client is not None:
        client.setex(key, CACHE_TTL, json.dumps(out, default=str))
    return {**out, "cached": False}


def _variant(v: Any) -> dict[str, Any]:
    return {"hash": v.hash, "activities": list(v.activities), "case_count": v.case_count, "share": v.share,
            "median_seconds": v.median_seconds, "p90_seconds": v.p90_seconds, "fitness": v.fitness,
            "sample_case_ids": list(v.sample_case_ids)}


@router.get("/runs/{run_id}/variants", dependencies=VIEW)
async def variants(run_id: str, request: Request, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                   tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await _run(db, tenant, run_id)
    flt, ct = _filter(request, run)
    if flt.model_copy(update={"case_type": None}) == ProcessFilter():
        rows = (await db.execute(text("""
            SELECT variant_hash AS hash, activities, case_count, share, median_seconds, p90_seconds, fitness,
                   sample_case_ids, count(*) OVER () AS total
            FROM process_discovery_variants WHERE run_id = :r AND case_type = :ct
            ORDER BY case_count DESC, variant_hash LIMIT :n OFFSET :o"""),
            {"r": run["id"], "ct": ct, "n": limit, "o": offset})).fetchall()
        items = [{k: v for k, v in r._mapping.items() if k != "total"} for r in rows]
        return {"case_type": ct, "total": rows[0].total if rows else 0, "items": items}
    mined = (await _mine(db, tenant, run, flt, ct)).stored()
    return {"case_type": ct, "total": len(mined), "items": [_variant(v) for v in mined[offset:offset + limit]]}


@router.get("/runs/{run_id}/conformance", dependencies=VIEW)
async def conformance(run_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                      db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await _run(db, tenant, run_id)
    flt, ct = _filter(request, run)
    c = (await _mine(db, tenant, run, flt, ct)).conformance
    steps = sorted(set(c.step_fitness) | set(c.out_of_order))
    return {"case_type": ct, "fitness": c.fitness, "missing": c.missing,
            "steps": [{"activity": a, "step_fitness": c.step_fitness.get(a), "out_of_order": c.out_of_order.get(a, 0.0)}
                      for a in steps]}


CASES_SQL = """
WITH f AS (SELECT case_id FROM process_events WHERE tenant_id = :t AND system_id = :s AND l1 = :l1
           AND case_type = :ct GROUP BY case_id HAVING {having}),
c AS (SELECT case_id, min(ts) AS first_ts, max(ts) AS last_ts, count(*) AS events,
             md5(string_agg(activity, '>' ORDER BY ts, seq, id)) AS variant,
             bool_or(activity = :act) AS has_act
      FROM process_events JOIN f USING (case_id)
      WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct GROUP BY case_id)
SELECT case_id, first_ts, last_ts, events, variant, count(*) OVER () AS total FROM c
WHERE (CAST(:act AS text) IS NULL OR has_act) AND (CAST(:variant AS text) IS NULL OR variant = :variant)
ORDER BY first_ts DESC, case_id LIMIT :n OFFSET :o"""


@router.get("/runs/{run_id}/cases", dependencies=EXPORT)
async def cases(run_id: str, request: Request, activity: Optional[str] = None, variant: Optional[str] = None,
                limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    from api.services.process_discovery.filters import case_filter_sql

    run = await _run(db, tenant, run_id)
    flt, ct = _filter(request, run)
    having, p = case_filter_sql(flt, run["tz"])
    rows = (await db.execute(text(CASES_SQL.format(having=having)), {
        **_scope(tenant, run).params(ct), **p, "act": activity, "variant": variant, "n": limit, "o": offset})
            ).fetchall()
    return {"case_type": ct, "total": rows[0].total if rows else 0,
            "items": [{k: v for k, v in r._mapping.items() if k != "total"} for r in rows]}


@router.get("/runs/{run_id}/cases/{case_id:path}", dependencies=EXPORT)  # PTP case ids are "EBELN/EBELP"
async def case_events(run_id: str, case_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                      db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await _run(db, tenant, run_id)
    _, ct = _filter(request, run)
    rows = await db.execute(text("""
        SELECT activity, l5_id, ts, ts_precision, seq, resource, automated, doc_type, org, object_refs,
               attributes, source_table FROM process_events
        WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct AND case_id = :c
        ORDER BY ts, seq, id"""), {**_scope(tenant, run).params(ct), "c": case_id})
    events = [dict(r._mapping) for r in rows]
    if not events:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"case_type": ct, "case_id": case_id, "events": events}


# --- export ---------------------------------------------------------------------------------------------------


async def _export(request: Request, tenant: Tenant, db: AsyncSession, run_id: str,
                  node_id: Optional[str]) -> Response:
    run = await _run(db, tenant, run_id)
    flt, _ = _filter(request, run)
    doc = await _document(db, tenant, run, flt)
    result = validate_document(doc)
    if result.errors:
        return _invalid(result.errors)
    now = datetime.now(timezone.utc)
    meta = {"model_id": None, "name": f"{run['l1']} as-is", "version_no": 1,
            "exported_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "app_version": request.app.version,
            "discovery": {"run_id": run["id"], "edge_threshold": EDGE_THRESHOLD,
                          "window": {"from": str(run["window_from"]) if run["window_from"] else None,
                                     "to": str(run["window_to"]) if run["window_to"] else None},
                          "filters": json.loads(flt.model_dump_json())}}
    try:
        data = export_zip(doc, None, meta)  # validates the whole package once, also for one-node downloads
        if node_id:
            fname, data = export_node(doc, node_id, None, meta)
    except KeyError:
        raise HTTPException(status_code=404, detail="Node not found")
    except BpmnExportError as e:
        logger.error("process discovery export failed validation: %s", e.errors)
        return JSONResponse(status_code=500, content={"detail": "Export failed validation"})
    if not node_id:
        fname = f"meridian-asis-{run['l1']}-{now:%Y%m%d}.zip"
    await asyncio.to_thread(_insert_audit_row, {
        "tenant_id": tenant.id,
        "actor_user_id": getattr(request.state, "local_user_id", None),
        "actor_email": getattr(request.state, "local_user_email", None),
        "action": "process_discovery.export", "entity_type": "process_discovery_run", "entity_id": run["id"],
        "method": "GET", "path": request.url.path, "status_code": 200,
        "ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "before_json": {"run_id": run["id"], "l1": run["l1"], "node_id": node_id,
                        "filters": meta["discovery"]["filters"]},
        "after_json": None})
    return Response(content=data, media_type="application/xml" if node_id else "application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/runs/{run_id}/export/signavio", dependencies=EXPORT)
async def export_signavio(run_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                          db: AsyncSession = Depends(get_db)) -> Response:
    return await _export(request, tenant, db, run_id, None)


@router.get("/runs/{run_id}/export/bpmn/{node_id}", dependencies=EXPORT)
async def export_bpmn(run_id: str, node_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                      db: AsyncSession = Depends(get_db)) -> Response:
    return await _export(request, tenant, db, run_id, node_id)
```

In `api/main.py`, below `from api.routes.process_export import router as process_export_router`, add:

```python
from api.routes.process_discovery import router as process_discovery_router
```

Below `app.include_router(process_export_router)`, add:

```python
app.include_router(process_discovery_router)
```

- [ ] **Step 7: Run them (PASS)**

Run: `pytest tests/test_process_discovery_jobs.py tests/test_process_discovery_api.py -q`
Expected without `MERIDIAN_TEST_DB_URL`: `7 passed, 6 skipped`.

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/meridian_test pytest tests/test_process_discovery_jobs.py tests/test_process_discovery_api.py tests/test_process_designer_api.py -q`
Expected: no failures. With the database: `13 passed` for the two new files.

Run: `pytest tests/process_discovery tests/test_process_discovery_export.py -q`
Expected: no failures.

Run: `pytest --collect-only -q tests/process_discovery tests/test_process_discovery_export.py tests/test_process_discovery_jobs.py tests/test_process_discovery_api.py | tail -1`
Expected: `128 tests collected`.

- [ ] **Step 8: Commit**

```bash
git add workers/tasks/run_process_discovery.py api/routes/process_discovery.py \
        api/services/process_discovery/__init__.py api/services/process_discovery/generate.py \
        api/services/jobs.py workers/celery_app.py workers/scheduler.py api/main.py \
        tests/test_process_discovery_jobs.py tests/test_process_discovery_api.py
git commit -m "$(cat <<'MSG'
feat(process): discovery job and API

A Celery chain extracts the event tables, then builds, mines and generates
each requested L1 under a per-system lock and a memory budget. The API
lists the 13 L1s with their coverage, starts runs, serves the mined flow,
variants, conformance and cases, and exports the as-is model to Signavio.
Old events and runs are pruned nightly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 28: RBAC (wave 28): the process_analyst persona and the `process` resource

**Files:**
- Modify: `api/services/rbac.py` (`PERMISSIONS["admin"]`, `PERMISSIONS["manager"]`, `PERSONA_ROLES`, `PERSONA_HOME`, `RESOURCES`, `_NO_EXPORT`, `LEGACY_ACTION_MAP`, `_expand`, `BUILTIN_NAMES`)
- Modify: `tests/test_rbac_legacy_snapshot.py` (the `admin` and `manager` rows)
- Modify: `tests/test_process_discovery_api.py` (drop the Task 27 monkeypatch)
- Modify: `frontend/hooks/use-role.ts` (`Role`, `ROLES`)
- Modify: `frontend/lib/persona.ts` (`Persona`, `PERSONA_BY_ROLE`, `homeHrefForRole`)
- Modify: `frontend/lib/rbac.ts` (`RESOURCES`, `NO_EXPORT`, `LEGACY_ACTION_MAP`, `resourceMatrix`)
- Modify: `frontend/e2e/fixtures/legacy-permissions.ts` (`admin`, `manager`)
- Modify: `docs/superpowers/specs/premium-redesign/rbac.md` (§1.1, §2.1, §2.2)
- Test: `tests/test_rbac_process_discovery.py` (new)
- Test: `frontend/lib/__tests__/rbac-process.test.ts` (new), `frontend/lib/__tests__/persona.test.ts`

**Interfaces:**
- Consumes:
  - From Task 27: the routes guarded by `require_permission("run_process_discovery")` (POST runs) and `require_permission("export_process")` (cases, case events, Signavio and BPMN downloads); `tests/test_process_discovery_api.py`.
  - Existing: `api/services/rbac.py` `_READ`, `PERMISSIONS`, `PERSONA_ROLES`, `PERSONA_HOME`, `home_for`, `permissions_for`, `has_permission`, `VALID_ROLES`, `RESOURCES`, `_NO_VIEW`, `LEGACY_ACTION_MAP`, `_expand`, `resource_matrix`, `legacy_actions_for_pairs`, `BUILTIN_NAMES`; `tests/test_rbac_legacy_snapshot.py` `ALL_ACTIONS`, `LEGACY_SNAPSHOT`; `frontend/lib/rbac.ts` (the port of the same model), `frontend/lib/persona.ts`, `frontend/e2e/fixtures/legacy-permissions.ts` `permissionsPayload`.
- Produces:
  - Actions `run_process_discovery` (held by `admin`, `platform_admin`, `process_analyst`) and `export_process` (those three plus `manager`, `programme_lead`).
  - Persona role key `process_analyst` ("Process analyst", home `/home/process`): `_READ` plus the two actions. Task 29 builds `/home/process`.
  - Resource `process` (last in `RESOURCES`): `view` through the legacy `view`; `run` only through `run_process_discovery`; `export` only through `export_process`.
  - Frontend `Role` gains `"process_analyst"`, `Persona` gains `"process"`, `homeHrefForRole("process_analyst") === "/home/process"`. Task 29's nav and home page rely on these.

Decisions this task fixes, and why:
- `process_analyst` goes into `PERSONA_ROLES`, not `PERMISSIONS` as the spec says. `PERMISSIONS` holds the legacy keys: `tests/test_rbac_legacy_snapshot.py::test_permissions_dict_unchanged` pins its keys, and `api/routes/roles.py` derives `_LEGACY` from it, so a new key there would show as "legacy" in Admin › Roles. `VALID_ROLES`, `permissions_for`, `/auth/permissions` and the roles listing already read both dicts.
- `programme_lead` and `platform_admin` reuse the `manager` and `admin` set objects, so they gain the new actions with no edit of their own.
- The legacy snapshot test is amended, not left alone. Spec §6.1 grants new rows only, and the amended lists add exactly `export_process` (admin, manager) and `run_process_discovery` (admin). `test_pre_existing_pairs_unchanged` proves every pre-existing (role, action) is unchanged.
- The legacy `export` maps to (`*`, `export`). Without an exclusion, every role with `export` (steward, analyst, approver, auditor) would hold (`process`, `export`) in `resource_matrix`. That would also let a custom role built from those pairs reach `export_process` through `legacy_actions_for_pairs`. `_NO_EXPORT = {"process"}` keeps `*` export off `process`, the same way `_NO_VIEW` keeps `*` view off `audit`.
- `frontend/lib/rbac.ts` is a hand port of the Python model. It gets the same three changes, and `e2e/fixtures/legacy-permissions.ts` gets the new admin and manager actions, so the nav identity test and the e2e mocks keep matching the backend.
- The frontend `Role` union lists only the legacy keys. The other persona keys (`programme_lead`, `data_steward` and so on) are still absent, and `useRole` maps an unknown role to `viewer`. `process_analyst` is added because its home differs from `/home/lead`. The others are out of scope.
- `/home/process` returns 404 until Task 29. Nobody holds `process_analyst` until an admin grants it, so the gap is only between two commits.

- [ ] **Step 1: Write the failing tests**

`tests/test_rbac_process_discovery.py`:

```python
"""Process discovery rights (spec §6): the process_analyst persona and the `process` resource."""

from api.services import rbac
from api.services.rbac import (
    LEGACY_ACTION_MAP, RESOURCES, VALID_ROLES, _expand, has_permission, home_for, legacy_actions_for_pairs,
    permissions_for, resource_matrix,
)
from tests.test_rbac_legacy_snapshot import ALL_ACTIONS, LEGACY_SNAPSHOT

NEW = {"run_process_discovery", "export_process"}


def test_pre_existing_pairs_unchanged() -> None:
    for role, acts in LEGACY_SNAPSHOT.items():
        for action in sorted(set(ALL_ACTIONS) - NEW):
            assert has_permission(role, action) is (action in acts), (role, action)


def test_who_holds_the_new_actions() -> None:
    run = {r for r in VALID_ROLES if has_permission(r, "run_process_discovery")}
    export = {r for r in VALID_ROLES if has_permission(r, "export_process")}
    assert run == {"admin", "platform_admin", "process_analyst"}
    assert export == run | {"manager", "programme_lead"}
    assert has_permission("viewer", "export_process") is False
    assert has_permission("manager", "run_process_discovery") is False


def test_process_analyst_is_read_plus_process() -> None:
    assert set(permissions_for("process_analyst")) == rbac._READ | NEW
    assert has_permission("process_analyst", "manage_rules") is False
    assert has_permission("process_analyst", "export") is False
    assert "process_analyst" in VALID_ROLES and home_for("process_analyst") == "/home/process"
    assert rbac.BUILTIN_NAMES["process_analyst"] == "Process analyst"


def test_process_resource() -> None:
    assert RESOURCES[-1] == "process"
    assert LEGACY_ACTION_MAP["run_process_discovery"] == {("process", "run")}
    assert LEGACY_ACTION_MAP["export_process"] == {("process", "export")}
    assert ("process", "export") not in _expand({("*", "export")})
    assert ("process", "view") in _expand({("*", "view")})
    analyst = resource_matrix(set(permissions_for("analyst")))["process"]
    assert analyst["view"] and not analyst["export"] and not analyst["run"]
    pa = resource_matrix(set(permissions_for("process_analyst")))["process"]
    assert pa["view"] and pa["export"] and pa["run"]


def test_every_export_holder_gains_nothing_on_process() -> None:
    for role in VALID_ROLES:
        acts = set(permissions_for(role))
        got = resource_matrix(acts)["process"]["export"]
        assert got is ("export_process" in acts), role


def test_custom_role_with_all_export_pairs_does_not_reach_export_process() -> None:
    pairs = _expand({("*", "export")})
    assert "export" in legacy_actions_for_pairs(pairs)
    assert "export_process" not in legacy_actions_for_pairs(pairs)
    assert "export_process" in legacy_actions_for_pairs(pairs | {("process", "export")})
```

`frontend/lib/__tests__/rbac-process.test.ts`:

```ts
// Mirrors tests/test_rbac_process_discovery.py: the `process` resource in the lib/rbac.ts port.
import { describe, expect, it } from "vitest";
import { RESOURCES, requestTargetFor, resourceMatrix } from "../rbac";
import { permissionsPayload } from "../../e2e/fixtures/legacy-permissions";

describe("process resource", () => {
  it("is the last resource", () => {
    expect(RESOURCES[RESOURCES.length - 1]).toBe("process");
  });

  it("legacy export does not reach process export; view does reach process view", () => {
    const m = resourceMatrix(["view", "export"]).process;
    expect(m).toMatchObject({ view: true, export: false, run: false });
    expect(resourceMatrix(["export_process", "run_process_discovery"]).process).toMatchObject({ export: true, run: true });
  });

  it("matches the backend for the legacy roles", () => {
    expect(permissionsPayload("admin").resources.process).toMatchObject({ view: true, run: true, export: true });
    expect(permissionsPayload("manager").resources.process).toMatchObject({ view: true, run: false, export: true });
    expect(permissionsPayload("analyst").resources.process).toMatchObject({ view: true, run: false, export: false });
  });

  it("turns a 403 on the new actions into a requestable pair", () => {
    expect(requestTargetFor({ resource: null, action: "run_process_discovery" })).toEqual({ resource: "process", action: "run" });
    expect(requestTargetFor({ resource: null, action: "export_process" })).toEqual({ resource: "process", action: "export" });
  });
});
```

In `frontend/lib/__tests__/persona.test.ts`, add `process_analyst: "process",` as the last key of the expected map in "maps every legacy role to a persona", so the object reads:

```ts
    expect(got).toEqual({
      admin: "lead", manager: "lead", auditor: "lead", viewer: "lead",
      steward: "steward", approver: "steward", analyst: "analyst", ai_reviewer: "analyst",
      process_analyst: "process",
    });
```

Add this last line to "sends steward-persona roles to the steward home and everyone else to lead":

```ts
    expect(homeHrefForRole("process_analyst")).toBe("/home/process");
```

In `frontend/hooks/use-role.ts`, add the key to the type and the array now, so the persona test compiles:

```ts
  | "viewer"
  | "process_analyst";

export const ROLES: readonly Role[] = [
  "admin", "manager", "steward", "analyst", "approver", "auditor", "ai_reviewer", "viewer", "process_analyst",
];
```

- [ ] **Step 2: Run them (FAIL)**

Run: `pytest tests/test_rbac_process_discovery.py -q`
Expected: FAIL, `5 failed, 1 passed`. `test_pre_existing_pairs_unchanged` passes, and the others fail on the missing actions, persona and resource.

Run: `cd frontend && npx vitest run lib/__tests__/rbac-process.test.ts lib/__tests__/persona.test.ts`
Expected: FAIL, `6 failed`, for example `AssertionError: expected 'audit' to be 'process'` and `expected '/home/lead' to be '/home/process'`.

- [ ] **Step 3: Extend the role table**

In `api/services/rbac.py`:

At the end of `PERMISSIONS["admin"]`, change `"mdm.write",` to:

```python
        "mdm.write", "run_process_discovery", "export_process",
```

At the end of `PERMISSIONS["manager"]`, change `"ai_feedback", "trigger_ai", "trigger_sync", "mdm.write",` to:

```python
        "ai_feedback", "trigger_ai", "trigger_sync", "mdm.write", "export_process",
```

Add the last entry of `PERSONA_ROLES`, below `"platform_admin": PERMISSIONS["admin"],`:

```python
    # Process discovery (process-discovery spec §6.1): read everything, run discovery, export as-is models.
    "process_analyst": _READ | {"run_process_discovery", "export_process"},
```

Add the last entry of `PERSONA_HOME`:

```python
    "process_analyst": "/home/process",
```

Replace `RESOURCES` and add `_NO_EXPORT` below `_NO_VIEW`:

```python
RESOURCES: tuple[str, ...] = (
    "systems", "credentials", "extraction", "analysis", "rules", "findings", "fixes", "mdm",
    "glossary", "stewardship", "contracts", "reports", "llm", "users", "licence", "audit", "process",
)
```

```python
_NO_VIEW = {"audit", "llm", "users", "licence", "credentials"}
# The legacy `export` action predates `process`; process export is granted only by export_process.
_NO_EXPORT = {"process"}
```

Add the last two entries of `LEGACY_ACTION_MAP`:

```python
    "run_process_discovery": {("process", "run")},
    "export_process": {("process", "export")},
```

Replace `_expand`:

```python
def _expand(pairs: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """Concrete (resource, action) pairs; `*` expands to every resource (view skips _NO_VIEW, export _NO_EXPORT)."""
    out: set[tuple[str, str]] = set()
    for res, act in pairs:
        if res != "*":
            out.add((res, act))
        else:
            out |= {(r, act) for r in RESOURCES
                    if not (act == "view" and r in _NO_VIEW) and not (act == "export" and r in _NO_EXPORT)}
    return out
```

Add the last entry of `BUILTIN_NAMES`:

```python
    "process_analyst": "Process analyst",
```

In `tests/test_rbac_legacy_snapshot.py`, replace the `admin` and `manager` rows of `LEGACY_SNAPSHOT`:

```python
    "admin": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'export_process', 'manage_field_mappings', 'manage_llm', 'manage_rules', 'manage_settings', 'manage_system', 'manage_systems', 'manage_users', 'mdm.read', 'mdm.write', 'review_ai_rules', 'run_process_discovery', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence', 'view_audit'],
    "manager": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'export_process', 'manage_systems', 'mdm.read', 'mdm.write', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence', 'view_audit'],
```

In `tests/test_process_discovery_api.py`, delete `from api.services import rbac` and these three lines:

```python
    # Until Task 28 adds them to the role table.
    monkeypatch.setitem(rbac.PERMISSIONS, "analyst",
                        rbac.PERMISSIONS["analyst"] | {"run_process_discovery", "export_process"})
```

Then change `h, viewer = {"X-User-Role": "analyst"}, {"X-User-Role": "viewer"}` to:

```python
        h, viewer = {"X-User-Role": "process_analyst"}, {"X-User-Role": "viewer"}
```

- [ ] **Step 4: Mirror it in the frontend**

`frontend/lib/persona.ts`:

```ts
import type { Role } from "@/hooks/use-role";

/** rbac.md section 1.1 personas. `sap_basis` has no legacy role, so it is never derived here. */
export type Persona = "lead" | "steward" | "analyst" | "process";

/**
 * The single legacy-role -> persona mapping (rbac.md 1.1). Wave 16 replaces
 * this with `/me/permissions.home`; every caller goes through here so the swap
 * touches one file.
 */
const PERSONA_BY_ROLE: Record<Role, Persona> = {
  admin: "lead",
  manager: "lead",
  auditor: "lead",
  viewer: "lead",
  steward: "steward",
  approver: "steward", // data_owner defaults to the steward home
  analyst: "analyst",
  ai_reviewer: "analyst",
  process_analyst: "process", // spec process-discovery section 6.1: a persona key, not a legacy role
};

export function personaForRole(role: Role): Persona {
  return PERSONA_BY_ROLE[role];
}

const HOME_BY_PERSONA: Partial<Record<Persona, string>> = { steward: "/home/steward", process: "/home/process" };

/** The home route for this role's persona. The analyst persona shares the lead home. */
export function homeHrefForRole(role: Role): string {
  return HOME_BY_PERSONA[personaForRole(role)] ?? "/home/lead";
}
```

In `frontend/lib/rbac.ts`, end `RESOURCES` with `"audit", "process",`. Below `NO_VIEW`, add:

```ts
// The legacy `export` action predates `process`; process export is granted only by export_process.
const NO_EXPORT = new Set(["process"]);
```

Add the last two entries of `LEGACY_ACTION_MAP`:

```ts
  run_process_discovery: [["process", "run"]],
  export_process: [["process", "export"]],
```

In `resourceMatrix`, replace the `const rs = ...` line with:

```ts
      const rs = r === "*"
        ? RESOURCES.filter((x) => !(act === "view" && NO_VIEW.has(x)) && !(act === "export" && NO_EXPORT.has(x)))
        : [r];
```

In `frontend/e2e/fixtures/legacy-permissions.ts`, end the `admin` list with `"mdm.write", "run_process_discovery", "export_process"],` and the `manager` list with `"mdm.write", "export_process"],`.

- [ ] **Step 5: Update the RBAC spec**

In `docs/superpowers/specs/premium-redesign/rbac.md`:

Add the last row of the §1.1 table:

```markdown
| `process_analyst` | Process analyst | `/home/process` | `viewer` + `run_process_discovery`, `export_process` | none (new; process-discovery spec §6.1) |
```

In §2.1, end the Resources list with `` `audit`, `process`. ``. Change the `export` row to:

```markdown
| `export` | (`reports`, `export`) and (`*`, `export`) except `process` |
```

Add the last two rows of the legacy map:

```markdown
| `run_process_discovery` | (`process`, `run`): held by `admin` / `platform_admin` and `process_analyst` |
| `export_process` | (`process`, `export`): held by `admin` / `platform_admin`, `manager` / `programme_lead` and `process_analyst` |
```

Add the last row of the §2.2 matrix:

```markdown
| process | V X | V | V | V | V | V | V |
```

At the end of the "Derivation from the current map" paragraph below it, append:

```markdown
`process_analyst` and `platform_admin` hold V R X on `process`; nobody reaches (`process`, `export`) through the legacy `export` action, so case-level data leaves only with `export_process`.
```

- [ ] **Step 6: Run them (PASS)**

Run: `pytest tests/test_rbac_process_discovery.py tests/test_rbac_legacy_snapshot.py tests/test_rbac_scopes.py tests/test_rbac_matrix.py -q`
Expected: `64 passed`.

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/meridian_test pytest tests/test_process_discovery_api.py tests/test_process_discovery_jobs.py -q`
Expected: `13 passed`.

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: no failures (`646 passed` at the time of writing), and `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add api/services/rbac.py tests/test_rbac_legacy_snapshot.py tests/test_rbac_process_discovery.py \
        tests/test_process_discovery_api.py frontend/hooks/use-role.ts frontend/lib/persona.ts \
        frontend/lib/rbac.ts frontend/e2e/fixtures/legacy-permissions.ts \
        frontend/lib/__tests__/rbac-process.test.ts frontend/lib/__tests__/persona.test.ts \
        docs/superpowers/specs/premium-redesign/rbac.md
git commit -m "$(cat <<'MSG'
feat(rbac): process analyst persona and process resource

Adds run_process_discovery and export_process, a process_analyst persona
with its own home, and a process resource. The legacy export action does
not reach process export, so case-level data leaves only with
export_process. The frontend port of the model is updated to match.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 29: UI (wave 29): the process home, the L1 catalogue and the discovery runs

**Files:**
- Modify: `api/routes/process_discovery.py` (`catalogue`: richer `last_run`)
- Modify: `tests/test_process_discovery_api.py` (catalogue assertions)
- Modify: `frontend/types/jobs.ts` (`JobKind`, `Job.run_ids`)
- Modify: `frontend/lib/query-keys.ts` (`processCatalogue`, `processRuns`, `processRun`, `TouchedEntity`)
- Modify: `frontend/lib/nav.ts` (Process group)
- Modify: `frontend/next.config.ts` (drop the `/process` legacy redirect)
- Modify: `frontend/__tests__/legacy-redirects.test.ts` (drop the `/process` row)
- Modify: `frontend/app/(app)/systems/[systemId]/config-load-panel.tsx` (the "View in Process" link)
- Create: `frontend/lib/api/process-discovery.ts`
- Create: `frontend/app/(app)/process/_components/coverage-pill.tsx`, `shared.tsx`, `new-run-dialog.tsx`
- Create: `frontend/app/(app)/process/page.tsx`, `frontend/app/(app)/process/runs/page.tsx`, `frontend/app/(app)/process/runs/[runId]/page.tsx`
- Create: `frontend/app/(app)/home/process/page.tsx`
- Test: `frontend/app/(app)/process/__tests__/process-pages.test.tsx` (new), `frontend/lib/__tests__/nav.test.ts`

**Interfaces:**
- Consumes:
  - From Task 27: `GET /api/v1/process-discovery/systems/{id}/catalogue`, `POST .../systems/{id}/runs` (`{l1s, mode, period_from}` returning `{job_id, run_ids}`), `GET .../systems/{id}/runs?l1=&limit=`, `GET .../runs/{id}` (adds `system_id`, `system_type`), and the mined-view and export routes typed here for Task 30. The `process_discovery` job kind in `api/services/jobs.py`, with stages `extraction`, `building`, `mining`, `generating` and `touches = ["process", "run"]`.
  - From Task 20: the `process_discovery_runs` CHECK values (status `queued|waiting|extracting|building|mining|completed|failed`, coverage `discovered|partial|reference`, mode `full|incremental`).
  - From Task 28: actions `run_process_discovery` and `export_process`, resource `process`, `homeHrefForRole("process_analyst") === "/home/process"`.
  - Existing: `useJobs()` (`{jobs, active}`) and `touchedPredicate` in `hooks/use-jobs.ts`; `useRole().can`; `useUrlState`; `useSystemScope` (`lib/permissions.ts`); `getSystems` (`lib/api/connectivity.ts`); `downloadBlob` (`lib/api/download.ts`); `apiErrorMessage` (`lib/error.ts`); `formatDuration` (`lib/job-timing.ts`); `relativeTime` (`lib/format.ts`); `@/design` `InsightHeader`, `Card`, `Stat`, `DataTable`, `Dialog`, `Field`, `Select`, `Pill`, `Notice`, `EmptyState`, `ErrorState`, `Skeleton`, `DrillLink`, `Mono`, `Button`.
- Produces:
  - `frontend/lib/api/process-discovery.ts`: the typed client for every §5.3 route (`getCatalogue`, `startRuns`, `listRuns`, `getRun`, `getRunModel`, `getDfg`, `getVariants`, `getConformance`, `listCases`, `getCaseEvents`, `exportRun`) and the types `Coverage`, `RunStatus`, `ACTIVE_RUN`, `RunMode`, `CatalogueRow`, `RunStats`, `DiscoveryRun`, `DiscoveryRunDetail`, `NodeStats`, `Dfg`, `VariantRow`, `Conformance`, `CaseRow`, `CaseEvent`, `Page<T>`, `ProcessFilterParams`. Task 30 uses the mined-view functions.
  - `process/_components/shared.tsx`: `useProcessSystem`, `SystemSelect`, `NoSystem`, `l1Href(l1, systemId, runId?, tab?)`, `processInsight`, `CatalogueGrid`, `RunsTable`, `headline`, `fitnessTone`, `fmtFitness`, `fmtSeconds`, `fmtCount`, `stageLabel`. `coverage-pill.tsx`: `CoveragePill`, `RunStatusPill`. Task 30 reuses `l1Href`, `CoveragePill`, `useProcessSystem` and the formatters.
  - Routes `/home/process`, `/process`, `/process/runs` (`?system=&new=1`), `/process/runs/[runId]`. Every card and stat links to `/process/<l1>?system=&run=&tab=`, which Task 30 builds.
  - Query keys under `["process", ...]`. A `process_discovery` job's `touches` refreshes them through `touchedPredicate`.

Decisions this task fixes, and why:
- `next.config.ts` redirects `/process` to `/insights/process` today (a wave-10 legacy rule), which would make the new catalogue unreachable. The spec does not mention it. This task drops that one rule and its row in `legacy-redirects.test.ts`. It keeps `/process/designer`, so old designer bookmarks still work and "designer" never reaches the `[l1]` route. `config-load-panel.tsx` linked to `/process?tab=readiness` and relied on the redirect, so it now links to `/insights/process?tab=readiness` directly. `e2e/aurora-smoke.spec.ts` "every legacy route still resolves" accepts 200, so it keeps passing.
- `/home/process` is its own page, not `PersonaHomePage` as spec §7.2 says. `home/_persona-home.tsx` is built around DQ runs, objects and dimension weights, and none of its sections apply to process discovery. The page uses the same building blocks (InsightHeader, a Stat row, cards, a table).
- The catalogue's `last_run` gains `job_id`, `error`, `variants`, `median_seconds` and `automation_rate`. The cards need variants and the median (§7.3), the home needs automation, the live stage needs `job_id`, and the failed card needs to know there is an error. All of it is already in `stats`, so the change costs no query.
- "What changed" shows when the last run finished, not the fitness change since the previous run. No route returns the previous run's stats per L1 yet. That is a gap: it needs a `previous` block in the catalogue.
- Automation rate on the home is weighted by each L1's case count, and the median fitness is the median over discovered L1s. Reference L1s and failed runs are left out of both.
- The New run Dialog shows the system as text. The page-level `SystemSelect` (`?system=`) picks it, so the Dialog and the table never disagree. The Dialog opens from `?new=1`, which is what the InsightHeader "Run discovery" action links to.
- Incremental is the default mode once any non-reference L1 has a completed run. The 14-day overlap is the server's rule (Task 27); the label states it so the user knows why the window overlaps.
- The runs page polls every 5 s only while a run is active. The jobs stream already refreshes `["process", ...]` on completion; polling covers the stage and percent in between.
- Retry on a failed run starts a new full run for that L1 and opens it. Runs are append-only (Task 20), so there is no in-place retry.
- `JobKind` lacked `process_discovery`, so it is added; `Job.run_ids` is the field `jobs.py` sets for this kind (Task 27).
- `export-dialog.tsx` is in the spec's wave-29 file list but is used only by the L1 drill. It moves to Task 30.

- [ ] **Step 1: Write the failing tests**

In `tests/test_process_discovery_api.py`, below `assert by["PTP"]["last_run"]["id"] == rid and by["PTP"]["last_run"]["cases"] == 2`, add:

```python
            last = by["PTP"]["last_run"]
            assert last["variants"] >= 1 and last["error"] is None and "job_id" in last
            assert "median_seconds" in last and "automation_rate" in last
```

`frontend/app/(app)/process/__tests__/process-pages.test.tsx`:

```tsx
// frontend/app/(app)/process/__tests__/process-pages.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as pdApi from "@/lib/api/process-discovery";
import * as jobsHook from "@/hooks/use-jobs";
import type { CatalogueRow, DiscoveryRun, DiscoveryRunDetail } from "@/lib/api/process-discovery";
import type { SAPSystemExtended } from "@/types/api";
import type { Job } from "@/types/jobs";
import ProcessCataloguePage from "../page";
import ProcessRunsPage from "../runs/page";
import ProcessRunPage from "../runs/[runId]/page";
import { headline } from "../_components/shared";

const h = vi.hoisted(() => ({ qs: "", can: (() => true) as (action: string) => boolean, push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
  usePathname: () => "/process",
  useSearchParams: () => new URLSearchParams(h.qs),
  useParams: () => ({ runId: "run-1" }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.can(a) }) }));

const L1S = ["PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG", "SFX", "ARB", "CNQ"];
const SYS = { id: "sys-1", name: "KSA PRD", system_type: "S4HANA" } as unknown as SAPSystemExtended;
const reference = (l1: string): CatalogueRow => ({ l1, name: `${l1} process`, coverage: "reference", reason: null, last_run: null, sources: [] });
const lastRun = (over: Partial<NonNullable<CatalogueRow["last_run"]>>): NonNullable<CatalogueRow["last_run"]> => ({
  id: "run-1", status: "completed", job_id: null, finished_at: "2026-10-10T00:00:00Z", error: null,
  cases: 100, variants: 7, median_seconds: 86_400, automation_rate: 0.5, fitness: 0.9, ...over,
});
const job = (over: Partial<Job>): Job => ({
  id: "job-1", kind: "process_discovery", status: "running", label: "PTP discovery", stage: "mining",
  stages: [{ id: "extraction", label: "Extracting", status: "done" }, { id: "mining", label: "Mining", status: "running" }],
  percent: 60, rows_done: 0, rows_total: 0, message: "", tables: [], error: null, result: null,
  started_at: 0, updated_at: 0, finished_at: null, ...over,
});
const RUN: DiscoveryRun = {
  id: "run-1", l1: "PTP", mode: "full", status: "completed", coverage: "discovered", window_from: null, window_to: null,
  watermark: null, extraction_version_id: null, job_id: null, filters: {}, stats: {}, error: null,
  started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:10:00Z",
};
const mockJobs = (jobs: Job[]) => vi.spyOn(jobsHook, "useJobs").mockReturnValue(
  { jobs, active: jobs.filter((j) => j.status === "running") } as unknown as ReturnType<typeof jobsHook.useJobs>);

beforeEach(() => {
  vi.restoreAllMocks();
  h.qs = ""; h.can = () => true; h.push = vi.fn();
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYS]);
  vi.spyOn(pdApi, "getCatalogue").mockResolvedValue(L1S.map(reference));
  vi.spyOn(pdApi, "listRuns").mockResolvedValue([]);
  mockJobs([]);
});

describe("process catalogue", () => {
  it("asks to connect a system on a fresh install", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByText("Connect a system to discover processes")).toBeTruthy();
    expect(pdApi.getCatalogue).not.toHaveBeenCalled();
  });

  it("shows 13 reference cards and a Run discovery action before any run", async () => {
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByText("0 of 13 processes discovered on KSA PRD; 13 reference only.")).toBeTruthy();
    expect(screen.getAllByText("Reference, not discovered")).toHaveLength(13);
    expect(screen.getAllByText("Never run")).toHaveLength(13);
    const action = screen.getByRole("link", { name: /Run discovery/ });
    expect(action.getAttribute("href")).toBe("/process/runs?system=sys-1&new=1");
  });

  it("offers the variants of the top L1 to a user who cannot run discovery", async () => {
    h.can = () => false;
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...reference("PTP"), coverage: "discovered", last_run: lastRun({}) }, ...L1S.slice(1).map(reference)]);
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByRole("link", { name: /Open PTP variants/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Run .*discovery/ })).toBeNull();
  });

  it("shows the live stage of a run in progress", async () => {
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...reference("PTP"), last_run: lastRun({ status: "mining", job_id: "job-1", finished_at: null, cases: null }) },
      ...L1S.slice(1).map(reference)]);
    mockJobs([job({})]);
    renderWithQuery(<ProcessCataloguePage />);
    expect(await screen.findByText("Mining")).toBeTruthy();
  });
});

describe("headline", () => {
  it("weights automation by cases and ignores reference L1s", () => {
    const rows: CatalogueRow[] = [
      { ...reference("PTP"), coverage: "discovered", last_run: lastRun({ cases: 300, automation_rate: 1, fitness: 0.9 }) },
      { ...reference("OTC"), coverage: "partial", last_run: lastRun({ cases: 100, automation_rate: 0, fitness: 0.5 }) },
      { ...reference("R2R"), last_run: lastRun({ status: "failed" }) },
    ];
    expect(headline(rows)).toEqual({ discovered: 2, cases: 400, fitness: 0.7, automation: 0.75 });
  });
});

describe("discovery runs", () => {
  it("says the run waits for a running extraction on the same system", async () => {
    mockJobs([job({ id: "x1", kind: "extraction", label: "PRD full extraction", system_id: "sys-1" })]);
    renderWithQuery(<ProcessRunsPage />);
    expect(await screen.findByText("Waiting for extraction PRD full extraction to finish.")).toBeTruthy();
  });

  it("starts a full run for the chosen L1s from the dialog", async () => {
    h.qs = "new=1";
    const start = vi.spyOn(pdApi, "startRuns").mockResolvedValue({ job_id: "job-9", run_ids: ["r1", "r2"] });
    renderWithQuery(<ProcessRunsPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /OTC/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("sys-1", {
      l1s: L1S.filter((l) => l !== "OTC"), mode: "full", period_from: null }));
  });

  it("hides New run from a user without run_process_discovery", async () => {
    h.can = () => false;
    vi.spyOn(pdApi, "listRuns").mockResolvedValue([RUN]);
    renderWithQuery(<ProcessRunsPage />);
    expect(await screen.findByText("PTP")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New run" })).toBeNull();
  });
});

describe("run detail", () => {
  it("shows the error of a failed run and retries it as a full run", async () => {
    const failed: DiscoveryRunDetail = { ...RUN, status: "failed", coverage: null, finished_at: null,
      error: "EKPO read failed: RFC_ERROR_SYSTEM_FAILURE", system_id: "sys-1", system_type: "S4HANA" };
    vi.spyOn(pdApi, "getRun").mockResolvedValue(failed);
    const start = vi.spyOn(pdApi, "startRuns").mockResolvedValue({ job_id: "job-2", run_ids: ["run-2"] });
    renderWithQuery(<ProcessRunPage />);
    expect(await screen.findByText("EKPO read failed: RFC_ERROR_SYSTEM_FAILURE")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Retry/ })[0]);
    await waitFor(() => expect(start).toHaveBeenCalledWith("sys-1", { l1s: ["PTP"], mode: "full" }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/process/runs/run-2"));
  });

  it("lists the tables read with partial and truncated flags", async () => {
    vi.spyOn(pdApi, "getRun").mockResolvedValue({ ...RUN, system_id: "sys-1", system_type: "S4HANA",
      stats: { cases: 100, tables: { EKKO: { rows: 10, partial: false }, CDHDR: { rows: 500, partial: true } }, truncated_tables: ["CDHDR"] } });
    renderWithQuery(<ProcessRunPage />);
    expect(await screen.findByText("CDHDR")).toBeTruthy();
    expect(screen.getByText("Truncated")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
  });
});
```

Append to `frontend/lib/__tests__/nav.test.ts`:

```ts
describe("Process group", () => {
  const flat = flattenNav(NAV_GROUPS.flatMap((g) => g.items));

  it("lists the catalogue and the runs, both gated on process/view", () => {
    const group = NAV_GROUPS.find((g) => g.group === "Process");
    expect(group?.items.map((i) => i.href)).toEqual(["/process", "/process/runs"]);
    for (const item of group!.items) expect(item.requires).toEqual({ resource: "process", action: "view" });
  });

  it("highlights the runs entry on a run detail and the catalogue on an L1 drill", () => {
    expect(activeHref("/process/runs/abc", new URLSearchParams(), flat)).toBe("/process/runs");
    expect(activeHref("/process/PTP", new URLSearchParams(), flat)).toBe("/process");
    expect(activeHref("/insights/process", new URLSearchParams(), flat)).toBe("/insights/process");
  });
});
```

In `frontend/__tests__/legacy-redirects.test.ts`, delete this row of `EXPECTED`:

```ts
  "/process": "/insights/process",
```

- [ ] **Step 2: Run them (FAIL)**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/meridian_test pytest tests/test_process_discovery_api.py -q -k catalogue`
Expected: FAIL with `KeyError: 'variants'`.

Run: `cd frontend && npx vitest run "app/(app)/process" lib/__tests__/nav.test.ts __tests__/legacy-redirects.test.ts`
Expected: FAIL. `process-pages.test.tsx` cannot resolve `@/lib/api/process-discovery`; "lists the catalogue and the runs" fails with `expected undefined to deeply equal [ '/process', '/process/runs' ]`; the redirect test fails because `/process` is still redirected.

- [ ] **Step 3: Extend the catalogue**

In `api/routes/process_discovery.py` `catalogue`, replace the `"last_run"` entry:

```python
            "last_run": None if r is None else {
                "id": r["id"], "status": r["status"], "job_id": r["job_id"], "finished_at": r["finished_at"],
                "error": r["error"],
                "cases": (stats.get("case_types") or {}).get(primary_case_type(l1, system_type)),
                "variants": stats.get("variants"),
                "median_seconds": (stats.get("throughput") or {}).get("median_seconds"),
                "automation_rate": stats.get("automation_rate"),
                "fitness": (stats.get("conformance") or {}).get("fitness")},
```

- [ ] **Step 4: Build the client, nav and pages**

In `frontend/types/jobs.ts`, change `JobKind` and add `run_ids` above `touches`:

```ts
export type JobKind = "extraction" | "config_sync" | "config_load" | "analysis" | "upload" | "simulation" | "process_discovery";
```

```ts
  /** process_discovery: the queued process_discovery_runs ids this job drives. */
  run_ids?: string[];
```

In `frontend/lib/query-keys.ts`, add below `alertChannels`:

```ts
  // Process discovery: first element "process" so a process_discovery job's touches (jobs.py) refreshes them.
  processCatalogue: (systemId: string) => ["process", "catalogue", systemId] as const,
  processRuns: (systemId: string) => ["process", "runs", systemId] as const,
  processRun: (runId: string) => ["process", "run", runId] as const,
```

and end `TouchedEntity` with `| "design-diff"` then `| "process";`.

In `frontend/lib/nav.ts`, add `Workflow,` to the `lucide-react` import (after `UserCog,`) and insert this group between Insights and MDM:

```ts
  {
    group: "Process",
    anyOf: ["view"],
    items: [
      { href: "/process", requires: req("process", "view"), label: "As-is processes", icon: Workflow, keywords: "process discovery mining as-is l1 l5 variants conformance signavio bpmn" },
      { href: "/process/runs", requires: req("process", "view"), label: "Discovery runs", icon: History, keywords: "process discovery run incremental extraction" },
    ],
  },
```

In `frontend/next.config.ts`, delete:

```ts
      { source: "/process", destination: "/insights/process", permanent: false },
```

In `frontend/app/(app)/systems/[systemId]/config-load-panel.tsx`, change `href="/process?tab=readiness"` to `href="/insights/process?tab=readiness"`.

`frontend/lib/api/process-discovery.ts`:

```ts
/**
 * Typed client for /api/v1/process-discovery (process-discovery spec §5.3,
 * api/routes/process_discovery.py). Shapes mirror the route's JSON exactly.
 */
import apiClient from "./client";
import { downloadBlob } from "./download";
import type { ProcessModelDocument } from "@/types/process-model";

const BASE = "/api/v1/process-discovery";

/** process_discovery_runs CHECK constraints (migration 079). */
export type Coverage = "discovered" | "partial" | "reference";
export type RunStatus = "queued" | "waiting" | "extracting" | "building" | "mining" | "completed" | "failed";
export const ACTIVE_RUN: ReadonlySet<RunStatus> = new Set(["queued", "waiting", "extracting", "building", "mining"]);
export type RunMode = "full" | "incremental";

export interface CatalogueRow {
  l1: string;
  name: string;
  coverage: Coverage;
  /** Why the L1 has no source on this system type (spec §10); null when it has one. */
  reason: string | null;
  last_run: {
    id: string;
    status: RunStatus;
    job_id: string | null;
    finished_at: string | null;
    error: string | null;
    cases: number | null;
    variants: number | null;
    median_seconds: number | null;
    automation_rate: number | null;
    fitness: number | null;
  } | null;
  sources: { table: string; rows: number; partial: boolean }[];
}

export interface RunStats {
  cases?: number;
  events?: number;
  variants?: number;
  case_types?: Record<string, number>;
  throughput?: { median_seconds: number | null; p90_seconds: number | null };
  automation_rate?: number | null;
  conformance?: { fitness: number | null; missing: Record<string, number>; out_of_order: Record<string, number> };
  rework?: Record<string, number>;
  tables?: Record<string, { rows: number; partial: boolean }>;
  truncated_tables?: string[];
  shared_objects?: number;
  unmapped?: Record<string, number>;
  /** Reference-only runs: the §10 reason. */
  reason?: string;
}

export interface DiscoveryRun {
  id: string;
  l1: string;
  mode: RunMode;
  status: RunStatus;
  coverage: Coverage | null;
  window_from: string | null;
  window_to: string | null;
  watermark: string | null;
  extraction_version_id: string | null;
  job_id: string | null;
  filters: Record<string, unknown>;
  stats: RunStats;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** GET /runs/{id} adds the system the run belongs to. */
export interface DiscoveryRunDetail extends DiscoveryRun {
  system_id: string;
  system_type: string;
}

export interface StartRunsBody {
  l1s: string[];
  mode: RunMode;
  period_from?: string | null;
}

/** URL filters the mined views accept (api/services/process_discovery/filters.py `ProcessFilter.from_query`). */
export type ProcessFilterParams = Record<string, string>;

export interface NodeStats {
  id: string;
  name: string;
  source: string;
  observed: boolean;
  case_count: number;
  share: number;
  median_seconds: number | null;
  fitness: number | null;
}

export interface Dfg {
  level: number;
  node: NodeStats;
  nodes: NodeStats[];
  edges: { source: string; target: string; count: number }[];
  edge_threshold: number;
  cached: boolean;
}

export interface VariantRow {
  hash: string;
  activities: string[];
  case_count: number;
  share: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  fitness: number | null;
  sample_case_ids: string[];
}

export interface Conformance {
  case_type: string;
  fitness: number | null;
  missing: Record<string, number>;
  steps: { activity: string; step_fitness: number | null; out_of_order: number }[];
}

export interface CaseRow {
  case_id: string;
  first_ts: string;
  last_ts: string;
  events: number;
  variant: string;
}

export interface CaseEvent {
  activity: string;
  l5_id: string | null;
  ts: string;
  ts_precision: string;
  seq: number;
  resource: string | null;
  automated: boolean | null;
  doc_type: string | null;
  org: Record<string, string> | null;
  object_refs: Record<string, string> | null;
  attributes: Record<string, unknown> | null;
  source_table: string;
}

export interface Page<T> { case_type: string; total: number; items: T[] }

export async function getCatalogue(systemId: string): Promise<CatalogueRow[]> {
  return (await apiClient.get<CatalogueRow[]>(`${BASE}/systems/${systemId}/catalogue`)).data;
}
export async function startRuns(systemId: string, body: StartRunsBody): Promise<{ job_id: string | null; run_ids: string[] }> {
  return (await apiClient.post(`${BASE}/systems/${systemId}/runs`, body)).data;
}
export async function listRuns(systemId: string, params: { l1?: string; limit?: number } = {}): Promise<DiscoveryRun[]> {
  return (await apiClient.get<DiscoveryRun[]>(`${BASE}/systems/${systemId}/runs`, { params })).data;
}
export async function getRun(runId: string): Promise<DiscoveryRunDetail> {
  return (await apiClient.get<DiscoveryRunDetail>(`${BASE}/runs/${runId}`)).data;
}
export async function getRunModel(runId: string): Promise<ProcessModelDocument> {
  return (await apiClient.get<ProcessModelDocument>(`${BASE}/runs/${runId}/model`)).data;
}
export async function getDfg(runId: string, params: ProcessFilterParams & { node_id?: string }): Promise<Dfg> {
  return (await apiClient.get<Dfg>(`${BASE}/runs/${runId}/dfg`, { params })).data;
}
export async function getVariants(runId: string, params: ProcessFilterParams & { limit?: number; offset?: number }): Promise<Page<VariantRow>> {
  return (await apiClient.get<Page<VariantRow>>(`${BASE}/runs/${runId}/variants`, { params })).data;
}
export async function getConformance(runId: string, params: ProcessFilterParams): Promise<Conformance> {
  return (await apiClient.get<Conformance>(`${BASE}/runs/${runId}/conformance`, { params })).data;
}
export async function listCases(
  runId: string, params: ProcessFilterParams & { activity?: string; variant?: string; limit?: number; offset?: number },
): Promise<Page<CaseRow>> {
  return (await apiClient.get<Page<CaseRow>>(`${BASE}/runs/${runId}/cases`, { params })).data;
}
export async function getCaseEvents(runId: string, caseId: string, params: ProcessFilterParams): Promise<{ case_type: string; case_id: string; events: CaseEvent[] }> {
  // PTP case ids are "EBELN/EBELP": the route takes the id as a path tail, so the slash stays unescaped.
  const tail = caseId.split("/").map(encodeURIComponent).join("/");
  return (await apiClient.get(`${BASE}/runs/${runId}/cases/${tail}`, { params })).data;
}
/** Whole-L1 Signavio package (.zip), or one node's .bpmn when `nodeId` is given. Writes an audit row server-side. */
export function exportRun(runId: string, l1: string, params: ProcessFilterParams, nodeId?: string): Promise<void> {
  return nodeId
    ? downloadBlob(`${BASE}/runs/${runId}/export/bpmn/${encodeURIComponent(nodeId)}`, params, `${nodeId}.bpmn`)
    : downloadBlob(`${BASE}/runs/${runId}/export/signavio`, params, `meridian-asis-${l1}.zip`);
}
```

`frontend/app/(app)/process/_components/coverage-pill.tsx`:

```tsx
import { Pill, type PillTone } from "@/design";
import type { Coverage, RunStatus } from "@/lib/api/process-discovery";

const COVERAGE: Record<Coverage, { tone: PillTone; label: string }> = {
  discovered: { tone: "go", label: "Discovered" },
  partial: { tone: "at-risk", label: "Partial" },
  reference: { tone: "neutral", label: "Reference, not discovered" },
};

export function CoveragePill({ coverage }: { coverage: Coverage }) {
  const c = COVERAGE[coverage];
  return <Pill tone={c.tone}>{c.label}</Pill>;
}

const STATUS: Record<RunStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "info", label: "Queued" },
  waiting: { tone: "info", label: "Waiting for extraction" },
  extracting: { tone: "info", label: "Extracting" },
  building: { tone: "info", label: "Building event log" },
  mining: { tone: "info", label: "Mining" },
  completed: { tone: "go", label: "Completed" },
  failed: { tone: "no-go", label: "Failed" },
};

export function RunStatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
```

`frontend/app/(app)/process/_components/shared.tsx`:

```tsx
"use client";

/**
 * Pieces shared by the process home, the catalogue and the runs pages
 * (process-discovery spec §7.3): the `?system=` choice, the L1 card grid,
 * the runs table and the InsightHeader sentences.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Card, DataTable, DrillLink, EmptyState, Mono, Select, Skeleton, type InsightHeaderProps, type PillTone,
} from "@/design";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems } from "@/lib/api/connectivity";
import { ACTIVE_RUN, type CatalogueRow, type DiscoveryRun } from "@/lib/api/process-discovery";
import { formatDuration } from "@/lib/job-timing";
import { relativeTime } from "@/lib/format";
import { useSystemScope } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";
import type { Job } from "@/types/jobs";
import { CoveragePill, RunStatusPill } from "./coverage-pill";

export const fitnessTone = (f: number | null | undefined): PillTone =>
  f == null ? "neutral" : f >= 0.8 ? "go" : f >= 0.6 ? "at-risk" : "no-go";
export const fmtFitness = (f: number | null | undefined) => (f == null ? "—" : f.toFixed(2));
export const fmtSeconds = (s: number | null | undefined) => (s == null ? "—" : formatDuration(s));
export const fmtCount = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

/** The job's current stage label, else the run status. */
export function stageLabel(job: Job | undefined): string | null {
  if (!job?.stage) return null;
  return job.stages.find((s) => s.id === job.stage)?.label ?? job.stage;
}

/** `?system=`, defaulting to the first system the user's scope allows. */
export function useProcessSystem() {
  const scope = useSystemScope();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, select: scope });
  const [raw, setSystem] = useUrlState("system", "");
  const list = systems.data ?? [];
  const system = list.find((s) => s.id === raw) ?? list[0];
  return { systems, list, system, setSystem };
}

export function SystemSelect({ value, onValueChange, systems }: {
  value: string; onValueChange: (v: string) => void; systems: { id: string; name: string }[];
}) {
  return (
    <Select label="System" value={value} onValueChange={onValueChange}
      options={systems.map((s) => ({ value: s.id, label: s.name }))} />
  );
}

/** §7.4 fresh install: no system connected yet. */
export function NoSystem() {
  return (
    <EmptyState
      title="Connect a system to discover processes"
      detail="Connect a system, run discovery, then read the as-is flow."
      ghost="stepper"
      action={<Button render={<Link href="/systems">Connect a system</Link>} />}
    />
  );
}

export const l1Href = (l1: string, systemId: string, runId?: string, tab?: string) => {
  const p = new URLSearchParams({ system: systemId });
  if (runId) p.set("run", runId);
  if (tab) p.set("tab", tab);
  return `/process/${l1}?${p}`;
};

const discovered = (r: CatalogueRow) => r.coverage !== "reference" && r.last_run?.status === "completed";

/** InsightHeader sentences for the catalogue and the process home (§7.3). */
export function processInsight(rows: CatalogueRow[], systemName: string, systemId: string,
                               canRun: boolean): InsightHeaderProps {
  const found = rows.filter(discovered);
  const finished = rows.map((r) => r.last_run?.finished_at).filter((t): t is string => !!t).sort();
  const scored = found.filter((r) => r.last_run?.fitness != null)
    .sort((a, b) => (a.last_run!.fitness as number) - (b.last_run!.fitness as number));
  const worst = scored[0];
  const top = [...found].sort((a, b) => (b.last_run?.cases ?? 0) - (a.last_run?.cases ?? 0))[0];
  return {
    situation: {
      sentence: `${found.length} of ${rows.length} processes discovered on ${systemName}; ${rows.length - found.length} reference only.`,
      tone: found.length ? "go" : "neutral",
    },
    changed: {
      sentence: finished.length ? `Last run finished ${relativeTime(finished[finished.length - 1])}.` : "No discovery run yet.",
    },
    why: worst
      ? { sentence: `${worst.l1} fitness ${fmtFitness(worst.last_run?.fitness)} is the lowest.`,
          tone: fitnessTone(worst.last_run?.fitness), href: l1Href(worst.l1, systemId, worst.last_run?.id, "conformance") }
      : { sentence: "Conformance is measured once a process is discovered." },
    next: canRun
      ? { sentence: found.length ? "Refresh the event log since the last run." : "Extract the event tables and mine every process.",
          action: { label: found.length ? "Run incremental discovery" : "Run discovery", href: `/process/runs?system=${systemId}&new=1` } }
      : top
        ? { sentence: `Read the most frequent ${top.l1} paths.`,
            action: { label: `Open ${top.l1} variants`, href: l1Href(top.l1, systemId, top.last_run?.id, "variants") } }
        : { sentence: "Ask a process analyst to run discovery." },
  };
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] leading-[14px]" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      <span className="m-numeric text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{children}</span>
    </div>
  );
}

export function CatalogueGrid({ rows, systemId, jobs }: { rows: CatalogueRow[]; systemId: string; jobs: Job[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
      {rows.map((r) => {
        const run = r.last_run;
        const active = run && ACTIVE_RUN.has(run.status);
        const done = run?.status === "completed" && r.coverage !== "reference";
        return (
          <Card key={r.l1} title={r.name} meta={<Mono>{r.l1}</Mono>} padding="sm">
            <div className="grid gap-2">
              <div><CoveragePill coverage={r.coverage} /></div>
              {r.reason && <p className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{r.reason}</p>}
              {active && (
                <div className="grid gap-1">
                  <Skeleton height={16} />
                  <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
                    {stageLabel(jobs.find((j) => j.id === run.job_id)) ?? <RunStatusPill status={run.status} />}
                  </span>
                </div>
              )}
              {run?.status === "failed" && (
                <span className="flex items-center gap-2"><RunStatusPill status="failed" />
                  <DrillLink href={`/process/runs/${run.id}`}>See the error</DrillLink></span>
              )}
              {done && (
                <div className="grid grid-cols-4 gap-2">
                  <Figure label="Cases"><DrillLink href={l1Href(r.l1, systemId, run.id, "cases")}>{fmtCount(run.cases)}</DrillLink></Figure>
                  <Figure label="Variants"><DrillLink href={l1Href(r.l1, systemId, run.id, "variants")}>{fmtCount(run.variants)}</DrillLink></Figure>
                  <Figure label="Fitness"><DrillLink href={l1Href(r.l1, systemId, run.id, "conformance")}>{fmtFitness(run.fitness)}</DrillLink></Figure>
                  <Figure label="Median">{fmtSeconds(run.median_seconds)}</Figure>
                </div>
              )}
              <div className="flex items-center justify-between text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
                <span>{run?.finished_at ? `Last run ${relativeTime(run.finished_at)}` : "Never run"}</span>
                <DrillLink href={l1Href(r.l1, systemId, done ? run.id : undefined)}>Open {r.l1}</DrillLink>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function RunsTable({ runs, jobs, systemName, hideToolbar }: {
  runs: DiscoveryRun[]; jobs: Job[]; systemName: string; hideToolbar?: boolean;
}) {
  const job = (r: DiscoveryRun) => jobs.find((j) => j.id === r.job_id);
  const columns: ColumnDef<DiscoveryRun>[] = [
    { id: "system", header: "System", cell: () => systemName },
    { accessorKey: "l1", header: "L1", cell: ({ row }) => <DrillLink href={`/process/runs/${row.original.id}`}><Mono>{row.original.l1}</Mono></DrillLink> },
    { accessorKey: "mode", header: "Mode", cell: ({ row }) => (row.original.mode === "incremental" ? "Incremental" : "Full") },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <RunStatusPill status={row.original.status} /> },
    { id: "stage", header: "Stage", cell: ({ row }) => stageLabel(job(row.original)) ?? "—" },
    { id: "percent", header: "Percent", cell: ({ row }) => { const j = job(row.original); return j && ACTIVE_RUN.has(row.original.status) ? `${Math.round(j.percent)}%` : "—"; } },
    { accessorKey: "started_at", header: "Started", cell: ({ row }) => relativeTime(row.original.started_at) },
    { id: "duration", header: "Duration", cell: ({ row }) => (row.original.finished_at
        ? fmtSeconds((Date.parse(row.original.finished_at) - Date.parse(row.original.started_at)) / 1000) : "—") },
    { id: "cases", header: "Cases", cell: ({ row }) => fmtCount(row.original.stats?.cases) },
    { accessorKey: "coverage", header: "Coverage", cell: ({ row }) => (row.original.coverage ? <CoveragePill coverage={row.original.coverage} /> : "—") },
  ];
  return <DataTable columns={columns} data={runs} getRowId={(r) => r.id} height="auto" hideToolbar={hideToolbar}
    tableId="process-runs" exportName="process-discovery-runs" />;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Headline figures over the discovered L1s; automation is weighted by each L1's case count. */
export function headline(rows: CatalogueRow[]) {
  const runs = rows.filter((r) => r.coverage !== "reference" && r.last_run?.status === "completed").map((r) => r.last_run!);
  const cases = runs.reduce((n, r) => n + (r.cases ?? 0), 0);
  const auto = runs.filter((r) => r.automation_rate != null && r.cases);
  const autoCases = auto.reduce((n, r) => n + (r.cases ?? 0), 0);
  return {
    discovered: runs.length,
    cases,
    fitness: median(runs.map((r) => r.fitness).filter((f): f is number => f != null)),
    automation: autoCases ? auto.reduce((n, r) => n + (r.automation_rate as number) * (r.cases as number), 0) / autoCases : null,
  };
}
```

`frontend/app/(app)/process/_components/new-run-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Dialog, Field, Mono, Notice } from "@/design";
import { startRuns, type CatalogueRow, type RunMode } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";

/** §7.3 "New run": L1 multi-select (all by default), mode (incremental once a run completed), period start (full only). */
export function NewRunDialog({ open, onOpenChange, systemId, systemName, rows }: {
  open: boolean; onOpenChange: (open: boolean) => void; systemId: string; systemName: string; rows: CatalogueRow[];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const hasCompleted = rows.some((r) => r.last_run?.status === "completed" && r.coverage !== "reference");
  const [l1s, setL1s] = useState<string[]>(() => rows.map((r) => r.l1));
  const [mode, setMode] = useState<RunMode>(hasCompleted ? "incremental" : "full");
  const [periodFrom, setPeriodFrom] = useState("");
  const start = useMutation({
    mutationFn: () => startRuns(systemId, { l1s, mode, period_from: mode === "full" && periodFrom ? periodFrom : null }),
    onSuccess: (res) => {
      toast(`Discovery started for ${l1s.length} ${l1s.length === 1 ? "process" : "processes"}`);
      qc.invalidateQueries({ queryKey: ["process"] });
      onOpenChange(false);
      if (res.run_ids.length === 1) router.push(`/process/runs/${res.run_ids[0]}`);
    },
  });
  const toggle = (l1: string) => setL1s((cur) => (cur.includes(l1) ? cur.filter((x) => x !== l1) : [...cur, l1]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New discovery run"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Close without starting</Button>
        <Button onClick={() => start.mutate()} pending={start.isPending} disabled={!l1s.length}>Start run</Button>
      </>}>
      <div className="grid gap-4">
        <p>System: <strong>{systemName}</strong></p>
        <fieldset className="grid gap-1">
          <legend className="m-field-label mb-1">Processes</legend>
          <div className="grid grid-cols-2 gap-1">
            {rows.map((r) => (
              <label key={r.l1} className="flex items-center gap-2">
                <input type="checkbox" checked={l1s.includes(r.l1)} onChange={() => toggle(r.l1)} />
                <Mono>{r.l1}</Mono> {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-1">
          <legend className="m-field-label mb-1">Mode</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "incremental"} onChange={() => setMode("incremental")} />
            Incremental: from the last run, with a 14-day overlap
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "full"} onChange={() => setMode("full")} />
            Full
          </label>
        </fieldset>
        {mode === "full" && (
          <Field label="Period start (blank: the whole history)">
            <input type="date" className="m-input" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </Field>
        )}
        {start.isError && <Notice tone="danger" title="Could not start the run">{apiErrorMessage(start.error)}</Notice>}
      </div>
    </Dialog>
  );
}
```

`frontend/app/(app)/process/page.tsx`:

```tsx
"use client";

/** Process › As-is processes: one card per L1 for the chosen system (process-discovery spec §7.3, §7.4). */
import { useQuery } from "@tanstack/react-query";
import { ErrorState, InsightHeader, Skeleton } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { ACTIVE_RUN, getCatalogue } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { CatalogueGrid, NoSystem, SystemSelect, processInsight, useProcessSystem } from "./_components/shared";

export default function ProcessCataloguePage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs } = useJobs();
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""),
    queryFn: () => getCatalogue(system!.id),
    enabled: !!system,
    refetchInterval: (q) => (q.state.data?.some((r) => r.last_run && ACTIVE_RUN.has(r.last_run.status)) ? 5_000 : false),
  });

  if (systems.isError) return <ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} />;
  if (systems.isSuccess && !system) return <NoSystem />;
  if (catalogue.isError) return <ErrorState message={apiErrorMessage(catalogue.error)} onRetry={() => catalogue.refetch()} />;
  const rows = catalogue.data;
  return (
    <div className="grid gap-4">
      {rows && system
        ? <InsightHeader {...processInsight(rows, system.name, system.id, can("run_process_discovery"))} />
        : <InsightHeader loading situation={{ sentence: "" }} changed={{ sentence: "" }} why={{ sentence: "" }} next={{ sentence: "" }} />}
      <div className="max-w-xs">
        {system && <SystemSelect value={system.id} onValueChange={setSystem} systems={list} />}
      </div>
      {rows && system ? <CatalogueGrid rows={rows} systemId={system.id} jobs={jobs} /> : <Skeleton height={240} />}
    </div>
  );
}
```

`frontend/app/(app)/process/runs/page.tsx`:

```tsx
"use client";

/** Process › Discovery runs (process-discovery spec §7.3): every run on the system, live stage, New run. */
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, Notice, Skeleton } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { ACTIVE_RUN, getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { NewRunDialog } from "../_components/new-run-dialog";
import { NoSystem, RunsTable, SystemSelect, useProcessSystem } from "../_components/shared";

export default function ProcessRunsPage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs, active } = useJobs();
  const [newRun, setNewRun] = useUrlState("new", "");
  const runs = useQuery({
    queryKey: queryKeys.processRuns(system?.id ?? ""),
    queryFn: () => listRuns(system!.id, { limit: 200 }),
    enabled: !!system,
    refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE_RUN.has(r.status)) ? 5_000 : false),
  });
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""),
    queryFn: () => getCatalogue(system!.id),
    enabled: !!system && can("run_process_discovery"),
  });

  if (systems.isError) return <ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} />;
  if (systems.isSuccess && !system) return <NoSystem />;
  if (!system) return <Skeleton height={240} />;
  const extraction = active.find((j) => j.kind === "extraction" && j.system_id === system.id);
  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="w-full max-w-xs"><SystemSelect value={system.id} onValueChange={setSystem} systems={list} /></div>
        {can("run_process_discovery") && (
          <Button onClick={() => setNewRun("1")} disabled={!catalogue.data}>New run</Button>
        )}
      </div>
      {extraction && (
        <Notice tone="info" title={`Waiting for extraction ${extraction.label} to finish.`}>
          Discovery runs queued on {system.name} start once this extraction completes.
        </Notice>
      )}
      {runs.isError
        ? <ErrorState message={apiErrorMessage(runs.error)} onRetry={() => runs.refetch()} />
        : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} /> : <Skeleton height={240} />}
      {catalogue.data && (
        <NewRunDialog open={newRun === "1"} onOpenChange={(o) => setNewRun(o ? "1" : "")}
          systemId={system.id} systemName={system.name} rows={catalogue.data} />
      )}
    </div>
  );
}
```

`frontend/app/(app)/process/runs/[runId]/page.tsx`:

```tsx
"use client";

/** One discovery run (process-discovery spec §7.3): stages, tables read, the failure and its retry. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, DataTable, ErrorState, InsightHeader, Mono, Notice, Pill, Skeleton, type PillTone } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { ACTIVE_RUN, getRun, startRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { JobStageStatus } from "@/types/jobs";
import { CoveragePill, RunStatusPill } from "../../_components/coverage-pill";
import { fitnessTone, fmtCount, fmtFitness, fmtSeconds, l1Href, stageLabel } from "../../_components/shared";

const STAGE: Record<JobStageStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  running: { tone: "info", label: "Running" },
  done: { tone: "go", label: "Done" },
  failed: { tone: "no-go", label: "Failed" },
  skipped: { tone: "neutral", label: "Skipped" },
};

type TableRow = { table: string; rows: number; partial: boolean; truncated: boolean };

const TABLE_COLUMNS: ColumnDef<TableRow>[] = [
  { accessorKey: "table", header: "Table", cell: ({ row }) => <Mono>{row.original.table}</Mono> },
  { accessorKey: "rows", header: "Rows", cell: ({ row }) => fmtCount(row.original.rows) },
  { id: "state", header: "State", cell: ({ row }) => (
      <span className="flex gap-1">
        {row.original.partial && <Pill tone="at-risk">Partial</Pill>}
        {row.original.truncated && <Pill tone="at-risk">Truncated</Pill>}
        {!row.original.partial && !row.original.truncated && <Pill tone="go">Complete</Pill>}
      </span>
    ) },
];

export default function ProcessRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { jobs } = useJobs();
  const run = useQuery({
    queryKey: queryKeys.processRun(runId),
    queryFn: () => getRun(runId),
    refetchInterval: (q) => (q.state.data && ACTIVE_RUN.has(q.state.data.status) ? 5_000 : false),
  });
  const retry = useMutation({
    mutationFn: () => startRuns(run.data!.system_id, { l1s: [run.data!.l1], mode: "full" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["process"] });
      if (res.run_ids[0]) router.push(`/process/runs/${res.run_ids[0]}`);
    },
  });

  if (run.isError) return <ErrorState message={apiErrorMessage(run.error)} onRetry={() => run.refetch()} />;
  if (!run.data) return <Skeleton height={320} />;
  const r = run.data;
  const job = jobs.find((j) => j.id === r.job_id);
  const s = r.stats;
  const truncated = new Set(s.truncated_tables ?? []);
  const tables: TableRow[] = Object.entries(s.tables ?? {})
    .map(([table, t]) => ({ table, rows: t.rows, partial: t.partial, truncated: truncated.has(table) }));
  const fitness = s.conformance?.fitness ?? null;
  const active = ACTIVE_RUN.has(r.status);

  return (
    <div className="grid gap-4">
      <InsightHeader
        situation={{ sentence: `${r.l1} ${r.mode === "incremental" ? "incremental" : "full"} run, ${active ? "in progress" : r.status}.`,
          tone: r.status === "failed" ? "no-go" : r.status === "completed" ? "go" : "neutral" }}
        changed={{ sentence: r.finished_at ? `Finished ${relativeTime(r.finished_at)}.` : `Started ${relativeTime(r.started_at)}.` }}
        why={r.status === "completed" && r.coverage !== "reference"
          ? { sentence: `${fmtCount(s.cases)} cases, fitness ${fmtFitness(fitness)}, median ${fmtSeconds(s.throughput?.median_seconds)}.`,
              tone: fitnessTone(fitness) }
          : { sentence: r.status === "failed" ? "No model was produced." : "Figures appear once the run completes." }}
        next={r.status === "completed"
          ? { sentence: `Read the as-is ${r.l1} flow.`,
              action: { label: `Open ${r.l1}`, href: l1Href(r.l1, r.system_id, r.coverage === "reference" ? undefined : r.id) } }
          : r.status === "failed"
            ? { sentence: "Fix the cause, then run the process again.", action: { label: "Retry", onClick: () => retry.mutate() } }
            : { sentence: "Leave this page open or come back later; the run continues in the background." }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusPill status={r.status} />
        {r.coverage && <CoveragePill coverage={r.coverage} />}
        {active && stageLabel(job) && <span>{stageLabel(job)}{job ? ` · ${Math.round(job.percent)}%` : ""}</span>}
      </div>
      {r.status === "failed" && (
        <ErrorState message={r.error ?? "The run failed without a message."} onRetry={() => retry.mutate()} />
      )}
      {retry.isError && <Notice tone="danger" title="Could not start the retry">{apiErrorMessage(retry.error)}</Notice>}
      {r.coverage === "reference" && s.reason && (
        <Notice tone="info" title="Reference only, not discovered">{s.reason}</Notice>
      )}
      {job && (
        <Card title="Stages" padding="sm">
          <ol className="grid gap-1">
            {job.stages.map((st) => (
              <li key={st.id} className="flex items-center justify-between">
                <span>{st.label}</span>
                <Pill tone={STAGE[st.status].tone}>{STAGE[st.status].label}</Pill>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {tables.length > 0 && (
        <Card title="Tables read" padding="sm">
          <DataTable columns={TABLE_COLUMNS} data={tables} getRowId={(t) => t.table} height="auto" hideToolbar
            tableId="process-run-tables" exportName={`process-run-${r.id}-tables`} />
        </Card>
      )}
    </div>
  );
}
```

`frontend/app/(app)/home/process/page.tsx`:

```tsx
"use client";

/** Process analyst home (process-discovery spec §7.2): coverage, volume, conformance, automation, latest runs. */
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorState, InsightHeader, Skeleton, Stat, type StatTone } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { ACTIVE_RUN, getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import {
  CatalogueGrid, NoSystem, RunsTable, SystemSelect, fitnessTone, fmtCount, fmtFitness, headline, processInsight, useProcessSystem,
} from "../../process/_components/shared";

export default function ProcessHomePage() {
  const { can } = useRole();
  const { systems, list, system, setSystem } = useProcessSystem();
  const { jobs } = useJobs();
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""),
    queryFn: () => getCatalogue(system!.id),
    enabled: !!system,
    refetchInterval: (q) => (q.state.data?.some((r) => r.last_run && ACTIVE_RUN.has(r.last_run.status)) ? 5_000 : false),
  });
  const runs = useQuery({
    queryKey: queryKeys.processRuns(system?.id ?? ""),
    queryFn: () => listRuns(system!.id, { limit: 5 }),
    enabled: !!system,
  });

  if (systems.isError) return <ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} />;
  if (systems.isSuccess && !system) return <NoSystem />;
  if (catalogue.isError) return <ErrorState message={apiErrorMessage(catalogue.error)} onRetry={() => catalogue.refetch()} />;
  const rows = catalogue.data;
  if (!rows || !system) return <Skeleton height={320} />;
  const h = headline(rows);
  const catalogueHref = `/process?system=${system.id}`;
  return (
    <div className="grid gap-4">
      <InsightHeader {...processInsight(rows, system.name, system.id, can("run_process_discovery"))} />
      <div className="max-w-xs"><SystemSelect value={system.id} onValueChange={setSystem} systems={list} /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Processes discovered" value={`${h.discovered} of ${rows.length}`} href={catalogueHref} />
        <Stat label="Cases" value={fmtCount(h.cases)} href={catalogueHref} />
        <Stat label="Median fitness" value={fmtFitness(h.fitness)}
          tone={h.fitness == null ? undefined : (fitnessTone(h.fitness) as StatTone)} />
        <Stat label="Automation rate" value={h.automation == null ? "—" : `${Math.round(h.automation * 100)}%`} />
      </div>
      <CatalogueGrid rows={rows} systemId={system.id} jobs={jobs} />
      <Card title="Latest runs">
        {runs.isError
          ? <ErrorState message={apiErrorMessage(runs.error)} onRetry={() => runs.refetch()} />
          : runs.data ? <RunsTable runs={runs.data} jobs={jobs} systemName={system.name} hideToolbar /> : <Skeleton height={120} />}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Run them (PASS)**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/meridian_test pytest tests/test_process_discovery_api.py -q`
Expected: no failures.

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p . && npm run lint:tokens && npx eslint "app/(app)/process" "app/(app)/home/process" lib/api/process-discovery.ts lib/nav.ts`
Expected: no failures (`658 passed` across 132 files at the time of writing: 10 new page tests, 2 new nav tests), `tsc` exits 0, `lint:tokens ok`, eslint clean (the `aurora-writing` rules reject "Cancel" and a raw stage status, which is why the Dialog says "Close without starting" and the stage Pills use a label map).

- [ ] **Step 6: Commit**

```bash
git add api/routes/process_discovery.py tests/test_process_discovery_api.py \
        frontend/types/jobs.ts frontend/lib/query-keys.ts frontend/lib/nav.ts frontend/next.config.ts \
        frontend/__tests__/legacy-redirects.test.ts "frontend/app/(app)/systems/[systemId]/config-load-panel.tsx" \
        frontend/lib/api/process-discovery.ts "frontend/app/(app)/process" "frontend/app/(app)/home/process" \
        frontend/lib/__tests__/nav.test.ts
git commit -m "$(cat <<'MSG'
feat(process): process home, L1 catalogue and discovery runs

Adds the typed process-discovery client, a Process nav group, the
process analyst home, the 13-card L1 catalogue, the runs list with the
New run dialog, and the run detail page with stages, tables read and a
retry for failed runs. The legacy /process redirect is removed so the
new catalogue is reachable; /process/designer still redirects.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

### Task 30: UI (wave 30): the L1 drill

**Files:**
- Modify: `api/routes/process_discovery.py` (`dfg`: per-edge median wait and `all_edges`; `variants`: the Other bucket sorts last)
- Modify: `tests/test_process_discovery_api.py` (dfg and variants assertions)
- Modify: `frontend/design/charts/Graph.tsx` (`title`, `weighted`)
- Modify: `frontend/lib/api/process-discovery.ts` (`ProcessFilterParams`, `Dfg.edges[].median_seconds`, `getDfg` `all_edges`)
- Modify: `frontend/lib/query-keys.ts` (`processRunView`)
- Modify: `frontend/types/process-model.ts` (`NodeSource`, `DiscoveryEdge`, `DiscoveryStats`, `source`/`discovery` on L1 to L5)
- Modify: `frontend/app/(app)/process/_components/shared.tsx` (`ViewAsTable`, `fmtShare`)
- Modify: `frontend/app/(app)/insights/process/designer/_components/discovered.tsx` ("Open as-is model")
- Create: `frontend/app/(app)/process/_components/drill.ts`, `l5-table.tsx`, `flow-view.tsx`, `variants-table.tsx`, `conformance-view.tsx`, `case-explorer.tsx`, `bpmn-view.tsx`, `export-dialog.tsx`
- Create: `frontend/app/(app)/process/[l1]/page.tsx`
- Test: `frontend/app/(app)/process/__tests__/l1-drill.test.tsx` (new)

**Interfaces:**
- Consumes:
  - From Task 27: `GET .../runs/{id}/model`, `.../dfg?node_id=&level=`, `.../variants?limit=&offset=`, `.../conformance`, `.../cases`, `.../cases/{case_id}` (the events), `GET .../runs/{id}/export/signavio` and `.../export/bpmn/{node_id}`, and the filter query parameters of `ProcessFilter.from_query` (`from`, `to`, `doc_type`, `case_type`, `automated`, `org.<key>`).
  - From Task 24: `mining.OTHER_HASH` (`"0" * 32`) and `mining.END` (`"__END__"`).
  - From Task 25: `generate.EDGE_THRESHOLD` (0.01) and `DiscoveryStats.edges[].median_seconds` and `entry_count` on the generated model.
  - From Task 26: `bpmn_export.landscape_edges`.
  - From Task 29: the typed client (`getCatalogue`, `getRun`, `getRunModel`, `getDfg`, `getVariants`, `getConformance`, `listCases`, `getCaseEvents`, `exportRun`), `processCatalogue` and `processRun` keys, `useProcessSystem`, `NoSystem`, `fitnessTone`, `fmtFitness`, `fmtSeconds`, `fmtCount`, and the `/process/<l1>?system=&run=&tab=` links the catalogue and run pages emit.
  - From Task 28: actions `export_process` and resource `process`.
  - Existing designer modules: `locate`, `Level`, `TreeItem` (`designer/_components/doc.ts`), `LevelTable`, `DesignerCanvas`, `getReference` (`lib/api/process-designer.ts`), `queryKeys.processReference`. `@/design`: `Graph`, `Pareto`, `DataTable`, `Drawer`, `Tabs`, `Stat`, `Pill`, `Notice`, `EmptyState`, `ErrorState`, `Skeleton`, `InsightHeader`, `Field`, `Select`, `Mono`, `Button`, `Dialog`. `formatDate` (`lib/format.ts`).
- Produces:
  - `dfg` edges carry `median_seconds` (null from START); `?all_edges=true` returns every mined edge instead of the export's pruned set. The cache key gains `:{0|1}`.
  - `variants` pins the Other bucket last at any page size.
  - Route `/process/[l1]` with URL state `?system=&run=&tab=&node=&case=` plus the filter keys. `useProcessDrill().set(patch)` writes them with one `router.replace`.
  - `ProcessFilterParams` widened to `Record<string, string | number | boolean | undefined>`; `queryKeys.processRunView(runId, view, params)`.
  - `Graph` gains `title` and `weighted` (radius by `size`, label by `label`). The duplicate-cluster callers are unchanged.
  - Designer "Discovered" groups link to `/process/<L1>` through `AS_IS_L1`.

Decisions this task fixes, and why:
- Spec §7.3 asks for a median wait on every edge and an "All edges" toggle. The Task 27 `dfg` route returned only `landscape_edges`, the export's pruned edges, with no wait. `_edges` reads the per-edge `median_seconds` the model already stores, and `all_edges` lists every mined edge plus the START entries. No new query.
- Spec §7.3 lists the Other row last. `ORDER BY case_count DESC` put a large Other bucket first. The SQL now sorts `variant_hash = :other` first in the key, which is false for every real variant.
- The level is derived from `node` through `locate`, not read from `?level=`. One source of truth: a hand-edited `?level=` can no longer disagree with the node.
- Without `?run=` the page reads the catalogue row's latest completed, non-reference `last_run`. The designer link carries no run id, because the designer does not know one.
- Tabs: Flow, BPMN, Variants, Conformance, Cases, Reference. Cases is hidden without `export_process`, because `/cases` returns 403 for viewers (Task 28). A reference L1, or one with no completed run, opens on Reference; the mined tabs show an EmptyState with the server's reason.
- Org filters have no picker. No route lists the distinct org keys of a run. They pass through from the URL and show as removable chips. A picker needs a `GET .../runs/{id}/orgs` route.
- The variant Drawer shows the sequence, fitness and sample cases, not per-step missing or out-of-order markers. `process_discovery_variants` stores no per-variant deviations.
- Per-step rework in Conformance is the run's `stats.rework`, which ignores the view's filters. Filtered rework needs the conformance route to return it. For SuccessFactors the tab says rework is not measured, in the words of spec §2.3 (SFX).
- The day-precision Notice appears in the case timeline only, from each event's `ts_precision`. No run-level flag exists, so Conformance cannot show it.
- Object references in the case timeline are Mono text, not links. `/cases` has no shared-object filter to link to.
- No separate "Download .bpmn" button on the BPMN tab. The Export dialog's node scope produces the same file, so there is one export path.
- The sequence fade on long variants is dropped. `lint-tokens` rejects gradients and no fade token exists.
- `AS_IS_L1` maps detector ids to discovery L1s: RTR to R2R, PTP_MFG to PP, MTO to PM. STC has no L1, so no link.

- [ ] **Step 1: Write the failing tests**

In `tests/test_process_discovery_api.py`, apply:

```diff
--- a/tests/test_process_discovery_api.py
+++ b/tests/test_process_discovery_api.py
@@ -163,6 +163,10 @@
             assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is False
             assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is True
             assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={"node_id": "NOPE"})).status_code == 404
+            assert all("median_seconds" in e for e in g["edges"])
+            every = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={"all_edges": "true"})).json()
+            pruned = {(e["source"], e["target"]) for e in g["edges"]}
+            assert pruned <= {(e["source"], e["target"]) for e in every["edges"]}
 
             v = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer)).json()
             assert v["case_type"] == "po_item" and v["total"] == len(v["items"]) > 0
@@ -170,6 +174,12 @@
             assert [x["hash"] for x in vf["items"]] == [x["hash"] for x in v["items"]]
             conf = (await c.get(f"{BASE}/runs/{rid}/conformance", headers=viewer)).json()
             assert conf["case_type"] == "po_item" and conf["steps"]
+            with owner.begin() as oc:  # an "Other" bucket larger than any variant is still listed last (§7.3)
+                oc.execute(text("INSERT INTO process_discovery_variants (run_id, tenant_id, case_type, variant_hash, "
+                                "activities, case_count, share, sample_case_ids) VALUES (:r, :t, 'po_item', :h, "
+                                "ARRAY['__OTHER__'], 999, 0.5, ARRAY[]::text[])"), {"r": rid, "t": tid, "h": "0" * 32})
+            items = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer, params={"limit": 500})).json()["items"]
+            assert len(items) > 1 and items[-1]["hash"] == "0" * 32 and items[-1]["activities"] == ["__OTHER__"]
 
             # case explorer and export need export_process
             assert (await c.get(f"{BASE}/runs/{rid}/cases", headers=viewer)).status_code == 403
```

`frontend/app/(app)/process/__tests__/l1-drill.test.tsx`:

```tsx
// frontend/app/(app)/process/__tests__/l1-drill.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as designerApi from "@/lib/api/process-designer";
import * as pdApi from "@/lib/api/process-discovery";
import type { CatalogueRow, Dfg, DiscoveryRunDetail, NodeStats, VariantRow } from "@/lib/api/process-discovery";
import type { SAPSystemExtended } from "@/types/api";
import type { DiscoveryStats, L4, ProcessModelDocument } from "@/types/process-model";
import ProcessL1Page from "../[l1]/page";
import { fmtSeconds } from "../_components/shared";

const h = vi.hoisted(() => ({ qs: "", can: (() => true) as (action: string) => boolean, replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: h.replace }),
  usePathname: () => "/process/PTP",
  useSearchParams: () => new URLSearchParams(h.qs),
  useParams: () => ({ l1: "PTP" }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.can(a) }) }));

const SYS = { id: "sys-1", name: "KSA PRD", system_type: "S4HANA" } as unknown as SAPSystemExtended;
const stats = (case_count: number, share: number, median_seconds: number): DiscoveryStats => ({
  case_count, share, event_count: case_count, median_seconds, p90_seconds: median_seconds * 2, rework_rate: 0.1,
  automation_rate: 0.5, fitness: 0.9, observed: true, case_type: "po_item", edges: [], entry_count: case_count,
});
const L4_PO: L4 = {
  id: "PTP-01-01-01", name: "Create purchase order", description: "", order: 1, tcode: "ME21N", config_dependency: null,
  variants: [], diagram: { nodes: [], flows: [] }, source: "template", discovery: stats(100, 1, 3600),
  activities: [
    { id: "PTP-01-01-01-A1", name: "Create PO item", description: "", order: 1, tcode: "ME21N", check_ids: [], sap_tables: ["EKPO"],
      fields: [{ field: "EKPO-MENGE", check_id: null, description: "Quantity", mandatory: true, config_source: null }],
      source: "discovered", discovery: stats(100, 1, 7200) },
    { id: "PTP-01-01-01-A2", name: "Release PO", description: "", order: 2, tcode: "ME29N", check_ids: [], sap_tables: ["EKKO"],
      fields: [], source: "template", discovery: stats(40, 0.4, 1800) },
  ],
};
const DOC: ProcessModelDocument = {
  schema_version: 1,
  l1: [{ id: "PTP", name: "Procure to Pay", description: "", order: 1, modules: ["MM"],
    l2: [{ id: "PTP-01", name: "Purchasing", description: "", order: 1,
      l3: [{ id: "PTP-01-01", name: "Order", description: "", order: 1, l4: [L4_PO] }] }] }],
};
const ROW: CatalogueRow = {
  l1: "PTP", name: "Procure to Pay", coverage: "discovered", reason: null, sources: [],
  last_run: { id: "run-1", status: "completed", job_id: null, finished_at: "2026-10-10T00:10:00Z", error: null,
    cases: 100, variants: 2, median_seconds: 86_400, automation_rate: 0.5, fitness: 0.9 },
};
const RUN: DiscoveryRunDetail = {
  id: "run-1", l1: "PTP", mode: "full", status: "completed", coverage: "discovered", window_from: null, window_to: null,
  watermark: null, extraction_version_id: null, job_id: null, filters: {}, error: null,
  started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:10:00Z", system_id: "sys-1", system_type: "S4HANA",
  stats: { cases: 100, variants: 2, case_types: { po_item: 100, po_header: 80 }, rework: { "Create PO item": 0.12 },
    conformance: { fitness: 0.9, missing: {}, out_of_order: {} }, throughput: { median_seconds: 86_400, p90_seconds: null } },
};
const node = (id: string, name: string, case_count: number): NodeStats => ({
  id, name, source: "template", observed: true, case_count, share: case_count / 100, median_seconds: 600, fitness: 0.9,
});
const dfg = (level: number, at: NodeStats, nodes: NodeStats[]): Dfg => ({
  level, node: at, nodes, edge_threshold: 0.01, cached: false,
  edges: [{ source: "START", target: nodes[0].id, count: 100, median_seconds: null },
    { source: nodes[0].id, target: "END", count: 100, median_seconds: 3600 }],
});
const VARIANTS: VariantRow[] = [
  { hash: "a".repeat(32), activities: ["Create PO item", "Release PO"], case_count: 60, share: 0.6, median_seconds: 3600,
    p90_seconds: 7200, fitness: 1, sample_case_ids: ["4500000001/00010"] },
  { hash: "0".repeat(32), activities: [], case_count: 5, share: 0.05, median_seconds: null, p90_seconds: null, fitness: null,
    sample_case_ids: [] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  h.qs = "system=sys-1"; h.can = () => true; h.replace = vi.fn();
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYS]);
  vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([ROW]);
  vi.spyOn(pdApi, "getRun").mockResolvedValue(RUN);
  vi.spyOn(pdApi, "getRunModel").mockResolvedValue(DOC);
  vi.spyOn(designerApi, "getReference").mockResolvedValue(DOC);
  vi.spyOn(pdApi, "getDfg").mockImplementation(async (_run, p) =>
    p.node_id === "PTP-01-01-01"
      ? dfg(5, node("PTP-01-01-01", "Create purchase order", 100), [node("PTP-01-01-01-A1", "Create PO item", 100)])
      : dfg(2, node("PTP", "Procure to Pay", 100), [node("PTP-01", "Purchasing", 100)]));
  vi.spyOn(pdApi, "getVariants").mockResolvedValue({ case_type: "po_item", total: 2, items: VARIANTS });
  vi.spyOn(pdApi, "getConformance").mockResolvedValue({ case_type: "po_item", fitness: 0.82,
    missing: { "Release PO": 0.3 }, steps: [{ activity: "Create PO item", step_fitness: 0.95, out_of_order: 0.02 }] });
  vi.spyOn(pdApi, "listCases").mockResolvedValue({ case_type: "po_item", total: 1,
    items: [{ case_id: "4500000001/00010", first_ts: "2026-01-01T00:00:00Z", last_ts: "2026-01-02T00:00:00Z", events: 2, variant: "a".repeat(32) }] });
  vi.spyOn(pdApi, "getCaseEvents").mockResolvedValue({ case_type: "po_item", case_id: "4500000001/00010", events: [] });
});

const lastReplace = () => new URL(`http://x${h.replace.mock.calls.at(-1)![0]}`).searchParams;

describe("process L1 drill", () => {
  it("opens the latest completed run on the flow tab and drills on a node click", async () => {
    renderWithQuery(<ProcessL1Page />);
    const n = await screen.findByRole("button", { name: "Node Purchasing" });
    expect(pdApi.getRun).toHaveBeenCalledWith("run-1");
    fireEvent.click(n);
    expect(lastReplace().get("node")).toBe("PTP-01");
    expect(screen.queryByRole("button", { name: "Node Start" })).toBeTruthy();
  });

  it("reaches L4 and shows the L5 table with cases, share and median", async () => {
    h.qs = "system=sys-1&node=PTP-01-01-01";
    renderWithQuery(<ProcessL1Page />);
    const row = (await screen.findByText("PTP-01-01-01-A2")).closest("tr")!;
    expect(within(row).getByText("40")).toBeTruthy();
    expect(within(row).getByText("40%")).toBeTruthy();
    expect(within(row).getByText(fmtSeconds(1800))).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Process levels" }).textContent).toContain("Create purchase order");
  });

  it("passes URL filters to the DFG and writes filter changes back to the URL", async () => {
    h.qs = "system=sys-1&from=2026-01-01&org.BUKRS=1000";
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    expect(pdApi.getDfg).toHaveBeenCalledWith("run-1", { from: "2026-01-01", "org.BUKRS": "1000" });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    expect(lastReplace().get("to")).toBe("2026-06-30");
    expect(lastReplace().get("from")).toBe("2026-01-01");
  });

  it.each([
    ["variants", "All other variants"],
    ["conformance", "Missing steps"],
    ["cases", "4500000001/00010"],
    ["bpmn", "Pick a level-4 process to see its diagram"],
    ["reference", "Reference model"],
  ])("renders ?tab=%s from the URL", async (tab, text) => {
    h.qs = `system=sys-1&tab=${tab}`;
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("pins the Other variant row last", async () => {
    h.qs = "system=sys-1&tab=variants";
    renderWithQuery(<ProcessL1Page />);
    await screen.findByText("All other variants");
    const rows = screen.getAllByRole("row");
    expect(rows.at(-1)!.textContent).toContain("All other variants");
  });

  it("shows rework per step from the run stats", async () => {
    h.qs = "system=sys-1&tab=conformance";
    renderWithQuery(<ProcessL1Page />);
    const cell = await screen.findByText("Create PO item", { selector: "td, td *" });
    expect(within(cell.closest("tr")!).getByText("12%")).toBeTruthy();
  });

  it("hides the Cases tab without export_process", async () => {
    h.can = (a) => a !== "export_process";
    h.qs = "system=sys-1&tab=cases";
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    expect(screen.queryByRole("tab", { name: "Cases" })).toBeNull();
    expect(pdApi.listCases).not.toHaveBeenCalled();
  });

  it("offers a table instead of the flow chart", async () => {
    renderWithQuery(<ProcessL1Page />);
    await screen.findByRole("button", { name: "Node Purchasing" });
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("button", { name: "View as chart" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("Purchasing").length).toBeGreaterThan(0);
  });

  it("defaults a reference-only L1 to the reference tab and explains the other tabs", async () => {
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...ROW, coverage: "reference", reason: "No PTP tables on this system.", last_run: null }]);
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByText("Reference model")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Reference" }).getAttribute("aria-selected")).toBe("true");
    expect(pdApi.getRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Flow" }));
    expect(lastReplace().get("tab")).toBe("flow");
  });

  it("explains a reference-only L1 on a mined tab", async () => {
    h.qs = "system=sys-1&tab=flow";
    vi.spyOn(pdApi, "getCatalogue").mockResolvedValue([
      { ...ROW, coverage: "reference", reason: "No PTP tables on this system.", last_run: null }]);
    renderWithQuery(<ProcessL1Page />);
    expect(await screen.findByText("Reference, not discovered")).toBeTruthy();
    expect(screen.getAllByText("No PTP tables on this system.").length).toBeGreaterThan(0);
  });

  it("shows an error state when the DFG fails", async () => {
    vi.spyOn(pdApi, "getDfg").mockRejectedValue(new Error("boom"));
    renderWithQuery(<ProcessL1Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Retry|Try again/ })).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run them (FAIL)**

Run: `PYTHONPATH=. MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/meridian_test python -m pytest tests/test_process_discovery_api.py -q`
Expected: FAIL on `assert all("median_seconds" in e for e in g["edges"])`.

Run: `cd frontend && npx vitest run "app/(app)/process/__tests__/l1-drill.test.tsx"`
Expected: FAIL, `Failed to resolve import "../[l1]/page"`.

- [ ] **Step 3: Extend the dfg and variants routes**

In `api/routes/process_discovery.py`, apply:

```diff
--- a/api/routes/process_discovery.py
+++ b/api/routes/process_discovery.py
@@ -33,8 +33,9 @@
 from api.services.process_discovery.events import DEFAULT_TZ
 from api.services.process_discovery.filters import ProcessFilter
 from api.services.process_discovery.generate import EDGE_THRESHOLD, generate, reference_model
-from api.services.process_discovery.mining import (CACHE_TTL, CASE_TYPES_SQL, MiningResult, Scope, cache_key,
-                                                   mine_case_type)
+from api.services.process_discovery.mining import END as MINED_END
+from api.services.process_discovery.mining import (CACHE_TTL, CASE_TYPES_SQL, OTHER_HASH, MiningResult, Scope,
+                                                   cache_key, mine_case_type)
 from api.services.process_model_validator import validate_document
 from api.services.rbac import require_permission
 from api.services.task_progress import _redis_client
@@ -298,27 +299,41 @@
             "case_count": d.case_count if d else 0, "share": d.share if d else 0.0,
             "median_seconds": d.median_seconds if d else None, "fitness": d.fitness if d else None}
 
+
+def _edges(parent: Any, kids: list[Any], all_edges: bool) -> list[dict[str, Any]]:
+    """As-is edges between ``kids`` with their median wait: pruned by ``landscape_edges`` (the export's edges) or,
+    with ``all_edges``, every mined edge (the flow view's "All edges" toggle, spec §7.3)."""
+    seen = [k for k in kids if k.discovery is not None and k.discovery.observed]
+    def end(target: str) -> str:
+        return "END" if target == MINED_END else target
 
+    wait = {(k.id, end(e.target)): e.median_seconds for k in seen for e in k.discovery.edges}
+    if all_edges:
+        raw = [("START", k.id, k.discovery.entry_count) for k in seen if k.discovery.entry_count]
+        raw += [(k.id, end(e.target), e.count) for k in seen for e in k.discovery.edges]
+    else:
+        raw = [(s, t, int(lbl.split()[0].replace(",", ""))) for s, t, lbl in landscape_edges(parent, kids) or []]
+    return [{"source": s, "target": t, "count": n, "median_seconds": wait.get((s, t))} for s, t, n in raw]
+
+
 @router.get("/runs/{run_id}/dfg", dependencies=VIEW)
 async def dfg(run_id: str, request: Request, level: Optional[int] = Query(None, ge=2, le=5),
-              node_id: Optional[str] = None, tenant: Tenant = Depends(get_tenant),
+              node_id: Optional[str] = None, all_edges: bool = False, tenant: Tenant = Depends(get_tenant),
               db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
     """Nodes and as-is edges between the children of ``node_id`` (default: the L1), pruned as in the export,
-    so the flow view and the Signavio file draw the same edges."""
+    so the flow view and the Signavio file draw the same edges; ``all_edges`` skips the pruning."""
     run = await _run(db, tenant, run_id)
     flt, _ = _filter(request, run)
     client = _redis_client() if flt != ProcessFilter() else None
-    key = f"{cache_key(_scope(tenant, run), flt, run['id'])}:{node_id or ''}"
+    key = f"{cache_key(_scope(tenant, run), flt, run['id'])}:{node_id or ''}:{int(all_edges)}"
     if client is not None and (hit := client.get(key)):
         return {**json.loads(hit), "cached": True}
     doc = await _document(db, tenant, run, flt)
     lvl, parent, kids = _children(doc, node_id)
     if level is not None and level != lvl:
         raise HTTPException(status_code=422, detail=f"Children of {parent.id} are level {lvl}")
-    edges = landscape_edges(parent, kids) or []
     out = {"level": lvl, "node": _stats(parent), "nodes": [_stats(k) for k in kids],
-           "edges": [{"source": s, "target": t, "count": int(lbl.split()[0].replace(",", ""))}
-                     for s, t, lbl in edges], "edge_threshold": EDGE_THRESHOLD}
+           "edges": _edges(parent, kids, all_edges), "edge_threshold": EDGE_THRESHOLD}
     if client is not None:
         client.setex(key, CACHE_TTL, json.dumps(out, default=str))
     return {**out, "cached": False}
@@ -340,8 +355,8 @@
             SELECT variant_hash AS hash, activities, case_count, share, median_seconds, p90_seconds, fitness,
                    sample_case_ids, count(*) OVER () AS total
             FROM process_discovery_variants WHERE run_id = :r AND case_type = :ct
-            ORDER BY case_count DESC, variant_hash LIMIT :n OFFSET :o"""),
-            {"r": run["id"], "ct": ct, "n": limit, "o": offset})).fetchall()
+            ORDER BY variant_hash = :other, case_count DESC, variant_hash LIMIT :n OFFSET :o"""),
+            {"r": run["id"], "ct": ct, "n": limit, "o": offset, "other": OTHER_HASH})).fetchall()
         items = [{k: v for k, v in r._mapping.items() if k != "total"} for r in rows]
         return {"case_type": ct, "total": rows[0].total if rows else 0, "items": items}
     mined = (await _mine(db, tenant, run, flt, ct)).stored()
```

- [ ] **Step 4: Extend the shared frontend modules**

```diff
--- a/frontend/design/charts/Graph.tsx
+++ b/frontend/design/charts/Graph.tsx
@@ -108,14 +108,22 @@
   masterId?: string;
   width?: number;
   height?: number;
+  /** Accessible name of the chart; defaults to the duplicate-cluster wording. */
+  title?: string;
+  /** Radius scales with `size` and nodes show `label`: the process flow view (node size is cases). */
+  weighted?: boolean;
 }) {
-  const { nodes, edges, onNodeClick, width = 600, height = 400 } = props;
-  const masterId = props.masterId ?? [...nodes].sort((a, b) => b.size - a.size)[0]?.id;
+  const { nodes, edges, onNodeClick, width = 600, height = 400, title = "Duplicate cluster graph", weighted } = props;
+  const masterId = weighted ? undefined : props.masterId ?? [...nodes].sort((a, b) => b.size - a.size)[0]?.id;
+  const maxSize = Math.max(1, ...nodes.map((n) => n.size));
+  const node = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
+  const radius = (id: string) =>
+    weighted ? 4 + 10 * Math.sqrt((node.get(id)?.size ?? 0) / maxSize) : id === masterId ? 6 : 4;
   const points = useMemo(() => layoutGraph(nodes, edges, { width, height }), [nodes, edges, width, height]);
   const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
 
   return (
-    <svg width={width} height={height} role="group" aria-label={`Duplicate cluster graph, ${nodes.length} nodes, ${edges.length} links`}>
+    <svg width={width} height={height} role="group" aria-label={`${title}, ${nodes.length} nodes, ${edges.length} links`}>
       {edges.map((e, i) => {
         const a = byId.get(e.source);
         const b = byId.get(e.target);
@@ -137,7 +145,7 @@
           className="m-graph-node"
           role={onNodeClick ? "button" : "img"}
           tabIndex={onNodeClick ? 0 : undefined}
-          aria-label={`Node ${nodes.find((n) => n.id === p.id)?.label ?? p.id}`}
+          aria-label={`Node ${node.get(p.id)?.label ?? p.id}`}
           onClick={() => onNodeClick?.(p.id)}
           onKeyDown={(e) => {
             if (onNodeClick && (e.key === "Enter" || e.key === " ")) {
@@ -147,9 +155,9 @@
           }}
           style={{ cursor: onNodeClick ? "pointer" : "default" }}
         >
-          <circle cx={p.x} cy={p.y} r={p.id === masterId ? 6 : 4} fill={p.id === masterId ? "var(--m-ink)" : "var(--m-viz-1)"} />
-          <text x={p.x} y={p.y - 10} fontSize={11} fontFamily="var(--m-font-mono)" fill="var(--m-ink-2)" textAnchor="middle">
-            {p.id}
+          <circle cx={p.x} cy={p.y} r={radius(p.id)} fill={p.id === masterId ? "var(--m-ink)" : "var(--m-viz-1)"} />
+          <text x={p.x} y={p.y - (weighted ? radius(p.id) + 6 : 10)} fontSize={11} fontFamily="var(--m-font-mono)" fill="var(--m-ink-2)" textAnchor="middle">
+            {weighted ? node.get(p.id)?.label ?? p.id : p.id}
           </text>
         </g>
       ))}
```

```diff
--- a/frontend/lib/api/process-discovery.ts
+++ b/frontend/lib/api/process-discovery.ts
@@ -83,7 +83,7 @@
 }
 
 /** URL filters the mined views accept (api/services/process_discovery/filters.py `ProcessFilter.from_query`). */
-export type ProcessFilterParams = Record<string, string>;
+export type ProcessFilterParams = Record<string, string | number | boolean | undefined>;
 
 export interface NodeStats {
   id: string;
@@ -100,7 +100,8 @@
   level: number;
   node: NodeStats;
   nodes: NodeStats[];
-  edges: { source: string; target: string; count: number }[];
+  /** START and END are pseudo-nodes; `median_seconds` is the median wait on the edge (null from START). */
+  edges: { source: string; target: string; count: number; median_seconds: number | null }[];
   edge_threshold: number;
   cached: boolean;
 }
@@ -163,7 +164,7 @@
 export async function getRunModel(runId: string): Promise<ProcessModelDocument> {
   return (await apiClient.get<ProcessModelDocument>(`${BASE}/runs/${runId}/model`)).data;
 }
-export async function getDfg(runId: string, params: ProcessFilterParams & { node_id?: string }): Promise<Dfg> {
+export async function getDfg(runId: string, params: ProcessFilterParams & { node_id?: string; all_edges?: boolean }): Promise<Dfg> {
   return (await apiClient.get<Dfg>(`${BASE}/runs/${runId}/dfg`, { params })).data;
 }
 export async function getVariants(runId: string, params: ProcessFilterParams & { limit?: number; offset?: number }): Promise<Page<VariantRow>> {
```

```diff
--- a/frontend/lib/query-keys.ts
+++ b/frontend/lib/query-keys.ts
@@ -158,6 +158,9 @@
   processCatalogue: (systemId: string) => ["process", "catalogue", systemId] as const,
   processRuns: (systemId: string) => ["process", "runs", systemId] as const,
   processRun: (runId: string) => ["process", "run", runId] as const,
+  /** One mined view of a run (dfg, variants, conformance, cases, case, model) under the URL filters. */
+  processRunView: (runId: string, view: string, params: Record<string, unknown> = {}) =>
+    ["process", "run", runId, view, params] as const,
 };
 
 /** The entity-prefix strings a job's `touches` array may contain. */
```

```diff
--- a/frontend/types/process-model.ts
+++ b/frontend/types/process-model.ts
@@ -36,7 +36,32 @@
   flows: Flow[];
 }
 
-export interface L5 {
+/** api/models/process_model.py `Source`: where a node came from. */
+export type NodeSource = "template" | "config" | "discovered";
+
+/** api/models/process_model.py `DiscoveryEdge`: as-is flow to a sibling, or "__END__". */
+export interface DiscoveryEdge { target: string; count: number; median_seconds: number | null }
+
+/** api/models/process_model.py `DiscoveryStats`: mined counts of one node, on discovered models only. */
+export interface DiscoveryStats {
+  case_count: number;
+  share: number;
+  event_count: number;
+  median_seconds: number | null;
+  p90_seconds: number | null;
+  rework_rate: number | null;
+  automation_rate: number | null;
+  fitness: number | null;
+  observed: boolean;
+  case_type: string | null;
+  edges: DiscoveryEdge[];
+  entry_count: number;
+}
+
+/** Optional on every level: absent on models stored before process discovery. */
+interface Discovered { source?: NodeSource; discovery?: DiscoveryStats | null }
+
+export interface L5 extends Discovered {
   id: string;
   name: string;
   description: string;
@@ -55,7 +80,7 @@
   classification: Classification;
 }
 
-export interface L4 {
+export interface L4 extends Discovered {
   id: string;
   name: string;
   description: string;
@@ -67,9 +92,9 @@
   variants: VariantRef[];
 }
 
-export interface L3 { id: string; name: string; description: string; order: number; l4: L4[] }
-export interface L2 { id: string; name: string; description: string; order: number; l3: L3[] }
-export interface L1 { id: string; name: string; description: string; order: number; modules: string[]; l2: L2[] }
+export interface L3 extends Discovered { id: string; name: string; description: string; order: number; l4: L4[] }
+export interface L2 extends Discovered { id: string; name: string; description: string; order: number; l3: L3[] }
+export interface L1 extends Discovered { id: string; name: string; description: string; order: number; modules: string[]; l2: L2[] }
 
 export interface ProcessModelDocument {
   schema_version: 1;
```

```diff
--- a/frontend/app/(app)/process/_components/shared.tsx
+++ b/frontend/app/(app)/process/_components/shared.tsx
@@ -5,7 +5,7 @@
  * (process-discovery spec §7.3): the `?system=` choice, the L1 card grid,
  * the runs table and the InsightHeader sentences.
  */
-import type { ReactNode } from "react";
+import { useState, type ReactNode } from "react";
 import Link from "next/link";
 import { useQuery } from "@tanstack/react-query";
 import type { ColumnDef } from "@tanstack/react-table";
@@ -199,3 +199,20 @@
     automation: autoCases ? auto.reduce((n, r) => n + (r.automation_rate as number) * (r.cases as number), 0) / autoCases : null,
   };
 }
+
+/** Spec §7.5: every chart has a DataTable alternative behind "View as table". */
+export function ViewAsTable({ chart, table }: { chart: ReactNode; table: ReactNode }) {
+  const [asTable, setAsTable] = useState(false);
+  return (
+    <div className="grid gap-2">
+      <div className="flex justify-end">
+        <Button variant="ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
+          {asTable ? "View as chart" : "View as table"}
+        </Button>
+      </div>
+      {asTable ? table : chart}
+    </div>
+  );
+}
+
+export const fmtShare = (s: number | null | undefined) => (s == null ? "—" : `${Math.round(s * 1000) / 10}%`);
```

- [ ] **Step 5: Build the drill components**

`frontend/app/(app)/process/_components/drill.ts`:

```ts
"use client";

/**
 * URL state of the L1 drill (process-discovery spec §7.1):
 * `?system=&run=&tab=&node=&case=` plus the mined-view filters of `ProcessFilter.from_query`
 * (api/services/process_discovery/filters.py): `from`, `to`, `doc_type`, `case_type`, `automated`, `org.<KEY>`.
 */
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProcessFilterParams } from "@/lib/api/process-discovery";
import type { ProcessModelDocument } from "@/types/process-model";
import { locate } from "@/app/(app)/insights/process/designer/_components/doc";

export const TABS = ["flow", "bpmn", "variants", "conformance", "cases", "reference"] as const;
export type Tab = (typeof TABS)[number];

const FILTER_KEYS = ["from", "to", "doc_type", "case_type", "automated"];

/** The filter params of a query string, ready to pass to the typed client. */
export function filterParams(search: URLSearchParams): ProcessFilterParams {
  const out: ProcessFilterParams = {};
  search.forEach((v, k) => {
    if (v && (FILTER_KEYS.includes(k) || k.startsWith("org."))) out[k] = v;
  });
  return out;
}

/**
 * Reads the drill params and patches several of them in one `router.replace`
 * (two `useUrlState` setters in a row would each start from the same stale query string).
 */
export function useProcessDrill() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search.toString();
  const filters = useMemo(() => filterParams(new URLSearchParams(qs)), [qs]);
  const set = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const next = p.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [qs, pathname, router]);
  return {
    tab: search.get("tab") ?? "",
    run: search.get("run") ?? "",
    node: search.get("node"),
    caseId: search.get("case"),
    filters,
    set,
  };
}

/** L1 › L2 › L3 › L4 from the L1 down to `node` (the L1 alone when `node` is not in `doc`). */
export function trail(doc: ProcessModelDocument, l1: string, node: string | null): { id: string; name: string; level: number }[] {
  const out: { id: string; name: string; level: number }[] = [];
  let hit = locate(doc, node);
  while (hit) {
    out.unshift({ id: hit.item.id, name: hit.item.name, level: hit.level });
    hit = hit.parent ? locate(doc, hit.parent.id) : null;
  }
  if (out[0]?.id !== l1) {
    const root = doc.l1.find((x) => x.id === l1);
    return root ? [{ id: root.id, name: root.name, level: 1 }] : [];
  }
  return out;
}
```

`frontend/app/(app)/process/_components/l5-table.tsx`:

```tsx
"use client";

/** The L5 table of one L4 (process-discovery spec §4.4): every activity with its mined figures. */
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Mono, Pill, type PillTone } from "@/design";
import type { L4, L5, NodeSource } from "@/types/process-model";
import { fmtCount, fmtFitness, fmtSeconds, fmtShare } from "./shared";

export const SOURCE: Record<NodeSource, { label: string; tone: PillTone }> = {
  template: { label: "Reference", tone: "neutral" },
  config: { label: "Config", tone: "info" },
  discovered: { label: "Discovered", tone: "go" },
};

export function L5Table({ l4, onOpen }: { l4: L4; onOpen: (id: string) => void }) {
  const columns: ColumnDef<L5>[] = [
    { accessorKey: "id", header: "ID", cell: ({ row }) => <Mono>{row.original.id}</Mono> },
    { accessorKey: "name", header: "Label", cell: ({ row }) => (
        <button type="button" className="ui-link-button" onClick={() => onOpen(row.original.id)}>{row.original.name}</button>
      ) },
    { id: "source", header: "Source", cell: ({ row }) => {
        const s = SOURCE[row.original.source ?? "template"];
        return <Pill tone={s.tone}>{s.label}</Pill>;
      } },
    { id: "cases", header: "Cases", accessorFn: (a) => a.discovery?.case_count ?? 0, cell: ({ row }) => fmtCount(row.original.discovery?.case_count ?? 0) },
    { id: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.discovery?.share ?? 0) },
    { id: "median", header: "Median", cell: ({ row }) => fmtSeconds(row.original.discovery?.median_seconds) },
    { id: "p90", header: "P90", cell: ({ row }) => fmtSeconds(row.original.discovery?.p90_seconds) },
    { id: "rework", header: "Rework", cell: ({ row }) => fmtShare(row.original.discovery?.rework_rate) },
    { id: "automation", header: "Automation", cell: ({ row }) => fmtShare(row.original.discovery?.automation_rate) },
    { id: "fitness", header: "Fitness", cell: ({ row }) => fmtFitness(row.original.discovery?.fitness) },
    { accessorKey: "tcode", header: "T-code", cell: ({ row }) => (row.original.tcode ? <Mono>{row.original.tcode}</Mono> : "—") },
    { id: "fields", header: "Fields", cell: ({ row }) => fmtCount(row.original.fields.length) },
  ];
  return (
    <DataTable columns={columns} data={l4.activities} getRowId={(a) => a.id} height="auto" dense
      tableId="process-l5" exportName={`process-${l4.id}-activities`} />
  );
}
```

`frontend/app/(app)/process/_components/flow-view.tsx`:

```tsx
"use client";

/**
 * Flow tab (process-discovery spec §7.3): the DFG between the children of the current node.
 * Node size is cases, edge width is count, the edge label is the median wait.
 * A node click drills one level, to L4 at most; at L4 the L5 nodes open a Drawer.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, EmptyState, ErrorState, Graph, Mono, Skeleton } from "@/design";
import { getDfg, type Dfg, type NodeStats, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { findActivity, locate } from "@/app/(app)/insights/process/designer/_components/doc";
import { L5Table } from "./l5-table";
import { fmtCount, fmtFitness, fmtSeconds, fmtShare, ViewAsTable } from "./shared";

type Edge = Dfg["edges"][number];
const PSEUDO = new Set(["START", "END"]);
const PSEUDO_LABEL: Record<string, string> = { START: "Start", END: "End" };

const NODE_COLUMNS: ColumnDef<NodeStats>[] = [
  { accessorKey: "id", header: "ID", cell: ({ row }) => <Mono>{row.original.id}</Mono> },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "case_count", header: "Cases", cell: ({ row }) => fmtCount(row.original.case_count) },
  { accessorKey: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.share) },
  { accessorKey: "median_seconds", header: "Median", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
  { accessorKey: "fitness", header: "Fitness", cell: ({ row }) => fmtFitness(row.original.fitness) },
];

export function FlowView({ runId, doc, node, filters, onDrill }: {
  runId: string;
  doc: ProcessModelDocument;
  node: string | null;
  filters: ProcessFilterParams;
  onDrill: (id: string) => void;
}) {
  const [allEdges, setAllEdges] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const params = { ...filters, ...(node ? { node_id: node } : {}), ...(allEdges ? { all_edges: true } : {}) };
  const dfg = useQuery({ queryKey: queryKeys.processRunView(runId, "dfg", params), queryFn: () => getDfg(runId, params) });

  if (dfg.isError) return <ErrorState message={apiErrorMessage(dfg.error)} onRetry={() => dfg.refetch()} />;
  if (!dfg.data) return <Skeleton height={400} />;
  const d = dfg.data;
  if (!d.nodes.length) return <EmptyState title="No activity below this step" detail="Go up one level to see its flow." />;

  // Rank order (most cases first) fixes the Graph's keyboard order (§7.5).
  const ranked = [...d.nodes].sort((a, b) => b.case_count - a.case_count);
  const names = new Map(d.nodes.map((n) => [n.id, n.name]));
  const name = (id: string) => PSEUDO_LABEL[id] ?? names.get(id) ?? id;
  const used = new Set(d.edges.flatMap((e) => [e.source, e.target]));
  const max = Math.max(1, ...d.edges.map((e) => e.count));
  const l4 = d.level === 5 ? (locate(doc, d.node.id)?.item as L4 | undefined) : undefined;
  const click = (id: string) => {
    if (PSEUDO.has(id)) return;
    if (d.level < 5) onDrill(id);
    else setOpen(id);
  };
  const edgeColumns: ColumnDef<Edge>[] = [
    { id: "from", header: "From", accessorFn: (e) => name(e.source) },
    { id: "to", header: "To", accessorFn: (e) => name(e.target) },
    { accessorKey: "count", header: "Cases", cell: ({ row }) => fmtCount(row.original.count) },
    { accessorKey: "median_seconds", header: "Median wait", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
          {allEdges ? "Every observed edge." : `Edges under ${fmtShare(d.edge_threshold)} of cases are hidden, as in the Signavio export.`}
        </span>
        <Button variant="secondary" aria-pressed={allEdges} onClick={() => setAllEdges((v) => !v)}>
          {allEdges ? "Show main edges" : "Show all edges"}
        </Button>
      </div>
      <ViewAsTable
        chart={
          <div className="overflow-x-auto">
            <Graph title={`${d.node.name} flow`} weighted width={900} height={420}
              nodes={[...[...PSEUDO].filter((p) => used.has(p)).map((p) => ({ id: p, size: 0, label: name(p) })),
                ...ranked.map((n) => ({ id: n.id, size: n.case_count, label: n.name }))]}
              edges={d.edges.map((e) => ({ source: e.source, target: e.target, weight: e.count / max,
                label: e.median_seconds == null ? undefined : fmtSeconds(e.median_seconds) }))}
              onNodeClick={click} />
          </div>
        }
        table={
          <div className="grid gap-3">
            <DataTable columns={NODE_COLUMNS} data={ranked} getRowId={(n) => n.id} onRowClick={(n) => click(n.id)}
              height="auto" hideToolbar dense tableId="process-flow-nodes" exportName={`process-${d.node.id}-nodes`} />
            <DataTable columns={edgeColumns} data={d.edges} getRowId={(e) => `${e.source}>${e.target}`}
              height="auto" hideToolbar dense tableId="process-flow-edges" exportName={`process-${d.node.id}-edges`} />
          </div>
        }
      />
      {l4 && <L5Table l4={l4} onOpen={setOpen} />}
      <L5Drawer doc={doc} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function L5Drawer({ doc, id, onClose }: { doc: ProcessModelDocument; id: string | null; onClose: () => void }) {
  const hit = findActivity(doc, id);
  const a = hit?.act;
  const s = a?.discovery;
  const rows: [string, string][] = [
    ["Cases", fmtCount(s?.case_count ?? 0)], ["Share", fmtShare(s?.share ?? 0)],
    ["Median to next step", fmtSeconds(s?.median_seconds)], ["P90 to next step", fmtSeconds(s?.p90_seconds)],
    ["Rework", fmtShare(s?.rework_rate)], ["Automation", fmtShare(s?.automation_rate)], ["Fitness", fmtFitness(s?.fitness)],
  ];
  return (
    <Drawer open={!!a} onOpenChange={(o) => !o && onClose()} title={a?.name ?? ""} subtitle={a ? <Mono>{a.id}</Mono> : undefined}>
      {a && (
        <div className="grid gap-4">
          {!s?.observed && <p style={{ color: "var(--m-ink-3)" }}>Reference step, not observed in this run.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt style={{ color: "var(--m-ink-3)" }}>{k}</dt><dd className="m-numeric">{v}</dd>
              </div>
            ))}
          </dl>
          <section className="grid gap-1">
            <h3 className="font-semibold">Fields</h3>
            {a.fields.length ? (
              <ul className="grid gap-1">
                {a.fields.map((f) => (
                  <li key={f.field}><Mono>{f.field}</Mono>{f.mandatory ? " · mandatory" : ""}{f.description ? ` · ${f.description}` : ""}</li>
                ))}
              </ul>
            ) : <p style={{ color: "var(--m-ink-3)" }}>No fields recorded for this step.</p>}
          </section>
        </div>
      )}
    </Drawer>
  );
}
```

`frontend/app/(app)/process/_components/variants-table.tsx`:

```tsx
"use client";

/**
 * Variants tab (process-discovery spec §7.3): ranked variants, the "Other" bucket pinned last
 * (the route orders it last). The Drawer shows the sequence, its fitness and sample cases.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton } from "@/design";
import { getVariants, type ProcessFilterParams, type VariantRow } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { fitnessTone, fmtCount, fmtFitness, fmtSeconds, fmtShare } from "./shared";

/** api/services/process_discovery/mining.py OTHER_HASH: the bucket of every variant past the cap. */
export const OTHER_HASH = "0".repeat(32);

function Sequence({ activities }: { activities: string[] }) {
  return (
    <span className="flex max-w-[480px] gap-1 overflow-x-auto">
      {activities.map((a, i) => <Mono key={i}>{a}</Mono>)}
    </span>
  );
}

export function VariantsTable({ runId, filters, canExport, onOpenCase }: {
  runId: string;
  filters: ProcessFilterParams;
  canExport: boolean;
  onOpenCase: (caseId: string) => void;
}) {
  const params = { ...filters, limit: 200 };
  const q = useQuery({ queryKey: queryKeys.processRunView(runId, "variants", params), queryFn: () => getVariants(runId, params) });
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={320} />;
  const rows = q.data.items;
  if (!rows.length) return <EmptyState title="No variants in this view" detail="Widen the filters to include more cases." />;

  const columns: ColumnDef<VariantRow>[] = [
    { id: "rank", header: "Rank", cell: ({ row }) => (row.original.hash === OTHER_HASH ? "—" : row.index + 1) },
    { id: "sequence", header: "Sequence", cell: ({ row }) => (row.original.hash === OTHER_HASH
        ? "All other variants" : <Sequence activities={row.original.activities} />) },
    { accessorKey: "case_count", header: "Cases", cell: ({ row }) => fmtCount(row.original.case_count) },
    { accessorKey: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.share) },
    { accessorKey: "median_seconds", header: "Median", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
    { accessorKey: "p90_seconds", header: "P90", cell: ({ row }) => fmtSeconds(row.original.p90_seconds) },
    { accessorKey: "fitness", header: "Fitness", cell: ({ row }) => (
        <Pill tone={fitnessTone(row.original.fitness)}>{fmtFitness(row.original.fitness)}</Pill>) },
  ];

  return (
    <DataTable columns={columns} data={rows} getRowId={(v) => v.hash} height="auto" dense
      tableId="process-variants" exportName={`process-variants-${runId}`}
      renderDrawer={(v) => (
        <div className="grid gap-4">
          {v.hash === OTHER_HASH
            ? <p>Every variant past the top {rows.length - 1}, merged into one row.</p>
            : <ol className="grid gap-1">{v.activities.map((a, i) => <li key={i}><Mono>{a}</Mono></li>)}</ol>}
          <p>Fitness against the reference: <Pill tone={fitnessTone(v.fitness)}>{fmtFitness(v.fitness)}</Pill></p>
          {canExport && v.sample_case_ids.length > 0 && (
            <section className="grid gap-1">
              <h3 className="font-semibold">Sample cases</h3>
              <ul className="flex flex-wrap gap-2">
                {v.sample_case_ids.map((id) => (
                  <li key={id}><Button variant="ghost" onClick={() => onOpenCase(id)}><Mono>{id}</Mono></Button></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )} />
  );
}
```

`frontend/app/(app)/process/_components/conformance-view.tsx`:

```tsx
"use client";

/**
 * Conformance tab (process-discovery spec §7.3): case-type fitness, the Paretos of missing and
 * out-of-order steps, and the per-step table. Rework comes from the run's unfiltered stats.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Notice, Pareto, Skeleton, Stat } from "@/design";
import { getConformance, type Conformance, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { fitnessTone, fmtFitness, fmtShare, ViewAsTable } from "./shared";

type Step = Conformance["steps"][number] & { missing: number; rework: number | undefined };
type Point = { x: string; y: number };

const POINT_COLUMNS: ColumnDef<Point>[] = [
  { accessorKey: "x", header: "Step" },
  { accessorKey: "y", header: "Share of cases", cell: ({ row }) => fmtShare(row.original.y) },
];

function ParetoPanel({ title, data, id }: { title: string; data: Point[]; id: string }) {
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold">{title}</h3>
      {data.length ? (
        <ViewAsTable
          chart={<Pareto data={data} height={220} />}
          table={<DataTable columns={POINT_COLUMNS} data={data} getRowId={(p) => p.x} height="auto" hideToolbar dense
            tableId={id} exportName={id} />} />
      ) : <p style={{ color: "var(--m-ink-3)" }}>None in this view.</p>}
    </section>
  );
}

export function ConformanceView({ runId, l1, filters, rework }: {
  runId: string;
  l1: string;
  filters: ProcessFilterParams;
  rework: Record<string, number> | undefined;
}) {
  const q = useQuery({ queryKey: queryKeys.processRunView(runId, "conformance", filters), queryFn: () => getConformance(runId, filters) });
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={320} />;
  const c = q.data;
  if (!c.steps.length) return <EmptyState title="No cases to check in this view" detail="Widen the filters to include more cases." />;

  const tone = fitnessTone(c.fitness);
  const steps: Step[] = c.steps.map((s) => ({ ...s, missing: c.missing[s.activity] ?? 0, rework: rework?.[s.activity] }));
  const columns: ColumnDef<Step>[] = [
    { accessorKey: "activity", header: "Step" },
    { accessorKey: "step_fitness", header: "Step fitness", cell: ({ row }) => fmtFitness(row.original.step_fitness) },
    { accessorKey: "missing", header: "Missing", cell: ({ row }) => fmtShare(row.original.missing) },
    { accessorKey: "out_of_order", header: "Out of order", cell: ({ row }) => fmtShare(row.original.out_of_order) },
    { id: "rework", header: "Rework", accessorFn: (s) => s.rework ?? -1, cell: ({ row }) => fmtShare(row.original.rework) },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Fitness" value={fmtFitness(c.fitness)} tone={tone === "go" || tone === "at-risk" || tone === "no-go" ? tone : undefined}
          hint="Share of reference steps each case performs in order" />
      </div>
      {l1 === "SFX" && (
        <Notice tone="info" title="Rework is not measured for SuccessFactors">
          Each application keeps only its latest status, so a repeated step leaves no trace.
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ParetoPanel title="Missing steps" id="process-missing"
          data={Object.entries(c.missing).map(([x, y]) => ({ x, y }))} />
        <ParetoPanel title="Out-of-order steps" id="process-out-of-order"
          data={c.steps.filter((s) => s.out_of_order > 0).map((s) => ({ x: s.activity, y: s.out_of_order }))} />
      </div>
      <DataTable columns={columns} data={steps} getRowId={(s) => s.activity} height="auto" dense
        tableId="process-conformance-steps" exportName={`process-conformance-${runId}`} />
    </div>
  );
}
```

`frontend/app/(app)/process/_components/case-explorer.tsx`:

```tsx
"use client";

/**
 * Cases tab (process-discovery spec §7.3, export_process only): case list and the
 * event timeline of `?case=` in a Drawer.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Drawer, EmptyState, ErrorState, Mono, Notice, Pill, Skeleton } from "@/design";
import { getCaseEvents, listCases, type CaseRow, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { fmtCount } from "./shared";

const COLUMNS: ColumnDef<CaseRow>[] = [
  { accessorKey: "case_id", header: "Case", cell: ({ row }) => <Mono>{row.original.case_id}</Mono> },
  { accessorKey: "first_ts", header: "First event", cell: ({ row }) => formatDate(row.original.first_ts, "datetime") },
  { accessorKey: "last_ts", header: "Last event", cell: ({ row }) => formatDate(row.original.last_ts, "datetime") },
  { accessorKey: "events", header: "Events", cell: ({ row }) => fmtCount(row.original.events) },
];

export function CaseExplorer({ runId, filters, caseId, onOpenCase }: {
  runId: string;
  filters: ProcessFilterParams;
  caseId: string | null;
  onOpenCase: (caseId: string | null) => void;
}) {
  const params = { ...filters, limit: 200 };
  const q = useQuery({ queryKey: queryKeys.processRunView(runId, "cases", params), queryFn: () => listCases(runId, params) });
  return (
    <>
      {q.isError ? <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
        : !q.data ? <Skeleton height={320} />
        : !q.data.items.length ? <EmptyState title="No cases in this view" detail="Widen the filters to include more cases." />
        : (
          <div className="grid gap-2">
            {q.data.total > q.data.items.length && (
              <p style={{ color: "var(--m-ink-3)" }}>
                Showing the first {fmtCount(q.data.items.length)} of {fmtCount(q.data.total)} cases. Narrow the filters to find one.
              </p>
            )}
            <DataTable columns={COLUMNS} data={q.data.items} getRowId={(c) => c.case_id} onRowClick={(c) => onOpenCase(c.case_id)}
              height="auto" dense tableId="process-cases" exportName={`process-cases-${runId}`} />
          </div>
        )}
      <CaseDrawer runId={runId} filters={filters} caseId={caseId} onClose={() => onOpenCase(null)} />
    </>
  );
}

function CaseDrawer({ runId, filters, caseId, onClose }: {
  runId: string; filters: ProcessFilterParams; caseId: string | null; onClose: () => void;
}) {
  const q = useQuery({
    queryKey: queryKeys.processRunView(runId, "case", { ...filters, caseId }),
    queryFn: () => getCaseEvents(runId, caseId!, filters),
    enabled: !!caseId,
  });
  const events = q.data?.events ?? [];
  return (
    <Drawer open={!!caseId} onOpenChange={(o) => !o && onClose()} title="Case timeline" subtitle={caseId ? <Mono>{caseId}</Mono> : undefined}>
      {q.isError ? <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
        : !q.data ? <Skeleton height={240} />
        : (
          <div className="grid gap-3">
            {events.some((e) => e.ts_precision === "day") && (
              <Notice tone="info" title="Some steps carry a date only">
                Their source table stores no time, so steps on the same day keep their table order.
              </Notice>
            )}
            <ol className="grid gap-3">
              {events.map((e) => (
                <li key={e.seq} className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{e.activity}</strong>
                    {e.automated === true && <Pill tone="info">Automated</Pill>}
                  </span>
                  <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
                    {formatDate(e.ts, "datetime")}{e.resource ? ` · ${e.resource}` : ""}{e.doc_type ? ` · document type ${e.doc_type}` : ""}
                  </span>
                  {e.object_refs && (
                    <span className="flex flex-wrap gap-2">
                      {Object.entries(e.object_refs).map(([k, v]) => <Mono key={k}>{`${k} ${v}`}</Mono>)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
    </Drawer>
  );
}
```

`frontend/app/(app)/process/_components/bpmn-view.tsx`:

```tsx
"use client";

/**
 * BPMN tab (process-discovery spec §7.3): the generated L4 diagram, read-only, in the
 * designer's canvas. Above L4 there is no diagram, so the tab asks for a level-4 process.
 */
import { EmptyState } from "@/design";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { DesignerCanvas } from "@/app/(app)/insights/process/designer/_components/canvas";
import { locate } from "@/app/(app)/insights/process/designer/_components/doc";

const noop = () => {};

export function BpmnView({ doc, node }: { doc: ProcessModelDocument; node: string | null }) {
  const hit = locate(doc, node);
  if (hit?.level !== 4) {
    return <EmptyState title="Pick a level-4 process to see its diagram" detail="Click through the flow until you reach a process with steps." />;
  }
  return (
    <DesignerCanvas l4={hit.item as L4} overlay={null} selected={null} editable={false} canDesign={false}
      onBlocked={noop} onSelect={noop} onMove={noop} onConnect={noop} onDeleteNode={noop} onDeleteFlow={noop}
      onAdd={noop} onLayout={noop} />
  );
}
```

`frontend/app/(app)/process/_components/export-dialog.tsx`:

```tsx
"use client";

/**
 * Signavio export (process-discovery spec §5.4, §7.3): whole L1 package or the current node,
 * with or without the view's filters, and the three Signavio import steps.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Mono, Notice } from "@/design";
import { exportRun, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { fmtShare } from "./shared";

/** api/services/process_discovery/generate.py EDGE_THRESHOLD: edges under 1% of cases are left out of the export. */
const EDGE_THRESHOLD = 0.01;

export function ExportDialog({ open, onOpenChange, runId, l1, node, nodeName, filters }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  l1: string;
  node: string | null;
  nodeName: string;
  filters: ProcessFilterParams;
}) {
  const [scope, setScope] = useState<"package" | "node">("package");
  const [useFilters, setUseFilters] = useState(true);
  const filtered = Object.keys(filters).length > 0;
  const run = useMutation({
    mutationFn: () => exportRun(runId, l1, useFilters ? filters : {}, scope === "node" && node ? node : undefined),
    onSuccess: () => {
      toast(scope === "node" && node ? `Exported ${nodeName} as BPMN` : `Exported the ${l1} package for Signavio`);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Export to Signavio"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Close without exporting</Button>
        <Button onClick={() => run.mutate()} pending={run.isPending}>Export</Button>
      </>}>
      <div className="grid gap-4">
        <fieldset className="grid gap-1">
          <legend className="m-field-label mb-1">Scope</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === "package"} onChange={() => setScope("package")} />
            Whole <Mono>{l1}</Mono> package (.zip, one .bpmn per process)
          </label>
          {node && node !== l1 && (
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={scope === "node"} onChange={() => setScope("node")} />
              {nodeName} only (.bpmn)
            </label>
          )}
        </fieldset>
        {filtered && (
          <fieldset className="grid gap-1">
            <legend className="m-field-label mb-1">Filters</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="filters" checked={useFilters} onChange={() => setUseFilters(true)} />
              The filters of this view
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="filters" checked={!useFilters} onChange={() => setUseFilters(false)} />
              Every case in the run
            </label>
          </fieldset>
        )}
        <p style={{ color: "var(--m-ink-3)" }}>
          Edges carried by fewer than {fmtShare(EDGE_THRESHOLD)} of cases are left out. Each step keeps its case count, share and median time.
        </p>
        <section className="grid gap-1">
          <h3 className="font-semibold">Import into Signavio</h3>
          <ol className="grid list-decimal gap-1 pl-5">
            <li>Open the target folder in Signavio Process Manager.</li>
            <li>Choose Import, then BPMN 2.0 (.bpmn), and upload the files from the zip. Start with <Mono>{`L1_${l1}.bpmn`}</Mono>, then the rest.</li>
            <li>Each call activity's called element is the process id of the exported file it refers to. Signavio may not link them on import: confirm the links after import and set any missing ones by hand.</li>
          </ol>
        </section>
        {run.isError && <Notice tone="danger" title="Could not export">{apiErrorMessage(run.error)}</Notice>}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 6: Build the page and the designer link**

`frontend/app/(app)/process/[l1]/page.tsx`:

```tsx
"use client";

/**
 * Process › one L1 (process-discovery spec §7.1, §7.3, §7.4): the drill from L1 to L4 and its
 * L5 steps over one discovery run. URL: `/process/<l1>?system=&run=&tab=&node=&case=` plus filters.
 * Without `?run=` the page reads the catalogue's latest completed run.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Button, EmptyState, ErrorState, Field, InsightHeader, Mono, Notice, Select, Skeleton, Tabs, type TabItem,
} from "@/design";
import { useRole } from "@/hooks/use-role";
import { getCatalogue, getRun, getRunModel, type DiscoveryRunDetail, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { getReference } from "@/lib/api/process-designer";
import { apiErrorMessage } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { locate, type Level, type TreeItem } from "@/app/(app)/insights/process/designer/_components/doc";
import { LevelTable } from "@/app/(app)/insights/process/designer/_components/level-table";
import { BpmnView } from "../_components/bpmn-view";
import { CaseExplorer } from "../_components/case-explorer";
import { ConformanceView } from "../_components/conformance-view";
import { TABS, trail, useProcessDrill, type Tab } from "../_components/drill";
import { ExportDialog } from "../_components/export-dialog";
import { FlowView } from "../_components/flow-view";
import { L5Table } from "../_components/l5-table";
import { NoSystem, fitnessTone, fmtCount, fmtFitness, fmtSeconds, useProcessSystem } from "../_components/shared";
import { VariantsTable } from "../_components/variants-table";

const TAB_LABEL: Record<Tab, string> = {
  flow: "Flow", bpmn: "BPMN", variants: "Variants", conformance: "Conformance", cases: "Cases", reference: "Reference",
};
const ALL = "all";
const AUTOMATED = [
  { value: ALL, label: "Manual and automated" }, { value: "true", label: "Automated only" }, { value: "false", label: "Manual only" },
];
const noop = () => {};
const READ_ONLY = { rename: noop, add: noop, remove: noop, move: noop };

export default function ProcessL1Page() {
  const { l1 } = useParams<{ l1: string }>();
  const { can } = useRole();
  const canExport = can("export_process");
  const drill = useProcessDrill();
  const { systems, system } = useProcessSystem();
  const [exporting, setExporting] = useState(false);

  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""), queryFn: () => getCatalogue(system!.id), enabled: !!system,
  });
  const row = catalogue.data?.find((r) => r.l1 === l1);
  const latest = row && row.coverage !== "reference" && row.last_run?.status === "completed" ? row.last_run.id : "";
  const runId = drill.run || latest;
  const run = useQuery({ queryKey: queryKeys.processRun(runId), queryFn: () => getRun(runId), enabled: !!runId });
  const discovered = run.data?.status === "completed" && run.data.coverage !== "reference";
  const model = useQuery({
    queryKey: queryKeys.processRunView(runId, "model"), queryFn: () => getRunModel(runId), enabled: !!runId && discovered,
  });
  const reference = useQuery({ queryKey: queryKeys.processReference(), queryFn: getReference });

  if (systems.isError) return <ErrorState message={apiErrorMessage(systems.error)} onRetry={() => systems.refetch()} />;
  if (systems.isSuccess && !system) return <NoSystem />;
  for (const q of [catalogue, run, model, reference]) {
    if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  }
  if (!catalogue.data || !reference.data || (runId && !run.data) || (discovered && !model.data)) {
    return <Skeleton height={480} />;
  }
  if (!row) {
    return <EmptyState title="This process is not in the catalogue" detail={`No level-1 process ${l1} exists.`}
      action={<Button render={<Link href="/process">Open the catalogue</Link>} />} />;
  }

  const r = run.data;
  const isReference = row.coverage === "reference" || r?.coverage === "reference";
  const reason = row.reason ?? r?.stats.reason ?? null;
  const doc = model.data ?? reference.data;
  const crumbs = trail(doc, l1, drill.node);
  const here = crumbs[crumbs.length - 1];
  const node = here && here.id !== l1 ? here.id : null;
  const available = TABS.filter((t) => t !== "cases" || canExport);
  const fallback: Tab = isReference || !discovered ? "reference" : "flow";
  const tab: Tab = (available as readonly string[]).includes(drill.tab) ? (drill.tab as Tab) : fallback;
  const filters: ProcessFilterParams = drill.filters;

  const notDiscovered = (
    <EmptyState title={isReference ? "Reference, not discovered" : "No completed discovery run yet"}
      detail={isReference ? (reason ?? "This system has no source tables for this process.") : "Run discovery for this process, then come back."}
      action={isReference ? undefined : <Button render={<Link href={`/process?system=${system!.id}`}>Open the catalogue</Link>} />} />
  );
  const mined = (content: ReactNode) => (discovered && r ? content : notDiscovered);
  const content: Record<Tab, ReactNode> = {
    flow: mined(<FlowView runId={runId} doc={doc} node={node} filters={filters} onDrill={(id) => drill.set({ node: id })} />),
    bpmn: mined(<BpmnView doc={doc} node={node} />),
    variants: mined(<VariantsTable runId={runId} filters={filters} canExport={canExport}
      onOpenCase={(id) => drill.set({ tab: "cases", case: id })} />),
    conformance: mined(<ConformanceView runId={runId} l1={l1} filters={filters} rework={r?.stats.rework} />),
    cases: mined(<CaseExplorer runId={runId} filters={filters} caseId={drill.caseId} onOpenCase={(id) => drill.set({ case: id })} />),
    reference: <ReferenceView doc={reference.data} l1={l1} node={node} onOpen={(id) => drill.set({ node: id })} />,
  };
  const items: TabItem[] = available.map((t) => ({ value: t, label: TAB_LABEL[t], content: content[t] }));

  return (
    <div className="grid gap-4">
      <Header l1={l1} name={row.name} systemName={system!.name} run={discovered ? r : undefined}
        reason={isReference ? reason : null} canExport={canExport && discovered} onExport={() => setExporting(true)} />
      <nav aria-label="Process levels">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden style={{ color: "var(--m-ink-3)" }}>›</span>}
              {i === crumbs.length - 1
                ? <span aria-current="page" className="font-semibold">{c.name}</span>
                : <button type="button" className="ui-link-button" onClick={() => drill.set({ node: c.level === 1 ? null : c.id })}>{c.name}</button>}
            </li>
          ))}
        </ol>
      </nav>
      {discovered && r && <Filters run={r} filters={filters} set={drill.set} />}
      <Tabs items={items} value={tab} onValueChange={(v) => drill.set({ tab: v, case: null })} />
      {discovered && (
        <ExportDialog open={exporting} onOpenChange={setExporting} runId={runId} l1={l1} node={node}
          nodeName={here?.name ?? l1} filters={filters} />
      )}
    </div>
  );
}

function Header({ l1, name, systemName, run, reason, canExport, onExport }: {
  l1: string; name: string; systemName: string; run: DiscoveryRunDetail | undefined; reason: string | null;
  canExport: boolean; onExport: () => void;
}) {
  if (!run) {
    return (
      <InsightHeader
        situation={{ sentence: `${name} on ${systemName} has no discovered flow.` }}
        changed={{ sentence: "No completed discovery run." }}
        why={{ sentence: reason ?? "Discovery has not run for this process yet." }}
        next={{ sentence: "Read the reference model below." }} />
    );
  }
  const s = run.stats;
  const fitness = s.conformance?.fitness ?? null;
  return (
    <InsightHeader
      situation={{ sentence: `${name} on ${systemName}: ${fmtCount(s.cases)} cases, ${fmtCount(s.variants)} variants.` }}
      changed={{ sentence: run.finished_at ? `Discovered ${relativeTime(run.finished_at)}.` : "Discovery in progress." }}
      why={{ sentence: `Fitness ${fmtFitness(fitness)} against the reference, median ${fmtSeconds(s.throughput?.median_seconds)} end to end.`,
        tone: fitnessTone(fitness) }}
      next={canExport
        ? { sentence: `Click a step to drill into it, or export ${l1} for Signavio.`, action: { label: "Export to Signavio", onClick: onExport } }
        : { sentence: "Click a step to drill into it." }} />
  );
}

function Filters({ run, filters, set }: {
  run: DiscoveryRunDetail; filters: ProcessFilterParams; set: (patch: Record<string, string | null>) => void;
}) {
  const text = (k: string) => (typeof filters[k] === "string" ? (filters[k] as string) : "");
  const caseTypes = Object.keys(run.stats.case_types ?? {});
  const org = Object.entries(filters).filter(([k]) => k.startsWith("org."));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From"><input type="date" className="m-input" value={text("from")} onChange={(e) => set({ from: e.target.value || null })} /></Field>
      <Field label="To"><input type="date" className="m-input" value={text("to")} onChange={(e) => set({ to: e.target.value || null })} /></Field>
      <Field label="Document type">
        <input className="m-input" value={text("doc_type")} placeholder="Every type" onChange={(e) => set({ doc_type: e.target.value || null })} />
      </Field>
      {caseTypes.length > 1 && (
        <Select label="Case type" value={text("case_type") || ALL} onValueChange={(v) => set({ case_type: v === ALL ? null : v })}
          options={[{ value: ALL, label: "Main case type" }, ...caseTypes.map((c) => ({ value: c, label: c }))]} />
      )}
      <Select label="Automation" value={text("automated") || ALL} onValueChange={(v) => set({ automated: v === ALL ? null : v })}
        options={AUTOMATED} />
      {org.map(([k, v]) => (
        <Button key={k} variant="ghost" onClick={() => set({ [k]: null })}>
          Remove <Mono>{`${k.slice(4)} ${String(v)}`}</Mono>
        </Button>
      ))}
    </div>
  );
}

function ReferenceView({ doc, l1, node, onOpen }: {
  doc: ProcessModelDocument; l1: string; node: string | null; onOpen: (id: string) => void;
}) {
  const hit = locate(doc, node ?? l1);
  if (!hit) return <EmptyState title="Not in the reference model" detail="This step exists only in the discovered flow." />;
  if (hit.level === 4) return <L5Table l4={hit.item as L4} onOpen={noop} />;
  return (
    <>
      <Notice tone="info" title="Reference model">The SAP best-practice steps this process is measured against.</Notice>
      <LevelTable doc={doc} parent={hit.item as TreeItem} parentLevel={hit.level as Level} colour={() => undefined}
        actions={READ_ONLY} onOpen={onOpen} editable={false} onBlocked={noop} canDesign={false} />
    </>
  );
}
```

```diff
--- a/frontend/app/(app)/insights/process/designer/_components/discovered.tsx
+++ b/frontend/app/(app)/insights/process/designer/_components/discovered.tsx
@@ -1,6 +1,7 @@
 "use client";
 
 import { useMemo } from "react";
+import Link from "next/link";
 import { Button, Mono } from "@/design";
 import type { ProcessVariant } from "@/types/process-model";
 import { addChild, newId, type Doc } from "./doc";
@@ -9,6 +10,13 @@
   PTP_MFG: "Plan to Produce", MTO: "Make to Order", RTR: "Record to Report", HTR: "Hire to Retire", STC: "Service to Cash",
 };
 
+/**
+ * Detector process_id (api/models/config_intelligence.py) to the process-discovery L1 that mines it.
+ * PTP_MFG and MTO come from AUFK order categories 10 and 30 (variant_discovery.py), i.e. the PP and PM L1s.
+ * STC has no discovery L1.
+ */
+const AS_IS_L1: Record<string, string> = { OTC: "OTC", PTP: "PTP", HTR: "HTR", RTR: "R2R", PTP_MFG: "PP", MTO: "PM" };
+
 export interface Group { process_id: string; tables: string[]; count: number }
 
 /** Unmapped variants grouped by detector. A step is one SAP table. */
@@ -63,6 +71,10 @@
               </span>
             </div>
             <Button variant="ghost" onClick={() => onCreate(g)}>Create L1 from discovered</Button>
+            {AS_IS_L1[g.process_id] && (
+              // Without ?run= the drill opens the latest completed run of that L1.
+              <Button variant="ghost" render={<Link href={`/process/${AS_IS_L1[g.process_id]}`}>Open as-is model</Link>} />
+            )}
           </li>
         ))}
       </ul>
```

- [ ] **Step 7: Run them (PASS)**

Run: `PYTHONPATH=. MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:55432/meridian_test python -m pytest tests/test_process_discovery_api.py -q`
Expected: no failures.

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p . && npm run lint:tokens && npx eslint "app/(app)/process" "app/(app)/insights/process/designer/_components/discovered.tsx" design/charts/Graph.tsx lib/api/process-discovery.ts lib/query-keys.ts types/process-model.ts`
Expected: no failures (`673 passed` across 133 files at the time of writing: 15 new drill tests), `tsc` exits 0, `lint:tokens ok`, eslint clean.

Run axe on `/process/PTP` with `e2e/` tooling before merging: the sandbox that wrote this plan did not run it.

- [ ] **Step 8: Commit**

```bash
git add api/routes/process_discovery.py tests/test_process_discovery_api.py \
        frontend/design/charts/Graph.tsx frontend/lib/api/process-discovery.ts frontend/lib/query-keys.ts \
        frontend/types/process-model.ts "frontend/app/(app)/process" \
        "frontend/app/(app)/insights/process/designer/_components/discovered.tsx"
git commit -m "$(cat <<'MSG'
feat(process): L1 drill with flow, variants, conformance and cases

Adds /process/<l1>: a breadcrumb drill from L1 to the L5 steps over one
discovery run, with URL filters and Flow, BPMN, Variants, Conformance,
Cases and Reference tabs, plus the Signavio export dialog. The dfg route
now returns each edge's median wait and an all-edges mode, and the
variants route keeps the Other bucket last. The designer's discovered
groups link to the matching as-is model.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WtZ9t33NorQFe36iMn8tQB
MSG
)"
```

## Self-Review

**Spec coverage, wave by wave (§9).**
- Wave 19 (Task 19): the process-event extraction block, monthly slices, `via` IN-lists of 60, the MATDOC guard on `s4hana_onprem`, the cloud modules, `sap/dictionaries/s4hana/tables/MATDOC.json` and the missing `tests/checks/test_joins_valid.py`.
- Wave 20 (Task 20): the event-log migration (079, renumbered from the spec's 077 because 077 and 078 are taken), the ORM models, RLS on every table, `sap_systems.timezone`, and `process_discovery_variants` in place of the spec's `process_variants`, which already exists with another meaning.
- Waves 21 to 23 (Tasks 21 to 23): every builder for the 13 L1s, mapped row by row to the §2.3 activity tables, with `ts_precision` for day-only timestamps.
- Wave 24 (Task 24): filters, DFG, variants with the Other bucket, rework, conformance and run stats in SQL and Python.
- Wave 25 (Task 25): the discovered L1 to L5 overlay on the reference, the stats roll-up, `entry_count`, the as-is L4 diagrams and the `l5_id` write-back.
- Wave 26 (Task 26): the Signavio zip, the single-node `.bpmn`, edge pruning at `EDGE_THRESHOLD`, and `landscape_edges`, which the UI reuses.
- Wave 27 (Task 27): the `discover_process` Celery task, the `process_discovery` job kind and every §5.3 route.
- Wave 28 (Task 28): the `process_analyst` persona, the `process` resource, `run_process_discovery` and `export_process`.
- Wave 29 (Task 29): `/home/process`, the `/process` catalogue, `/process/runs` and the run detail.
- Wave 30 (Task 30): `/process/<l1>` with the breadcrumb drill, the URL filters, the Flow, BPMN, Variants, Conformance, Cases and Reference tabs, the export dialog and the designer link.
- Gaps the plan names rather than invents a fix for: a previous-run fitness delta in the catalogue (Task 29), a distinct-org-keys route, per-variant deviation markers, filtered rework, a run-level day-precision flag and a shared-object case filter (all Task 30).

**Placeholder scan.** No step says "TBD", "TODO", "similar to Task N" or "add error handling". Every code block is the complete file, or a unified diff against the file that the earlier task produces. The only `...` bodies are `Protocol` method stubs in Tasks 21 and 27, which is valid Python.

**Type consistency.**
- `ProcessFilterParams` is `Record<string, string>` in Task 29 and is widened in Task 30 to `string | number | boolean | undefined`. Every Task 29 caller still type-checks, and the plan ran `tsc --noEmit` on the combined tree.
- The TypeScript `DiscoveryStats` and `DiscoveryEdge` in `types/process-model.ts` mirror the Task 25 Pydantic models field for field, including `entry_count`.
- `OTHER_HASH` is `"0" * 32` in `mining.py` (Task 24), in the variants SQL (Task 30) and in `variants-table.tsx`. `END` is `"__END__"` in `mining.py` and `DiscoveryEdge.target`, and the dfg route maps it to the `END` pseudo-node.
- The run status, coverage and mode literals match the Task 20 CHECK constraints in `RunStatus`, `Coverage` and `RunMode`.
- The `Role` union, `lib/rbac.ts` and the e2e fixture mirror `PERSONA_ROLES` and the Python permission matrix from Task 28.
- Test commands use `meridian_test` on port 55432, following the existing pytest convention. The Global Constraints example names `pd_test`. Any throwaway database on a high port works.

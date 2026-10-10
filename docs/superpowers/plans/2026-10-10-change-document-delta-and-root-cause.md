# Change-Document Delta Extraction and Root Cause by Origin Implementation Plan

> **Migration numbering (controller ruling):** this plan's migrations are 070 (down_revision 069); read every 067 below as 070 and 066 as 069. Execution order: S/4 load dry run, then change-document delta, then learned rules. The monitoring/migration-cockpit branch (migrations 067 and 068) merges first. Run `alembic heads` before writing a migration and adjust if the head moved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) After a full baseline version, re-read only the master records SAP's change documents (CDHDR) say changed, merge them over the baseline into a new version, and run that version as a nightly delta. (B) For every failing record of a finding, name who set the failing value, how and when, using CDHDR/CDPOS and USR02. Group the records by origin (interface or batch user, dialog transaction, migration load) and show the result in the finding drill-down.

**Architecture:**
- **Delta.** A new module, `sap/change_documents.py`, holds the change-document object-class map and the pure merge logic. `ConnectivityManager.extract()` gains an optional `DeltaRequest`:
  - It reads CDHDR once per class.
  - It re-reads changed keys in chunked IN-lists.
  - It merges the result over the baseline parquet.
  - It reads a table in full whenever the baseline is unusable or SAP's row count disagrees.
  - It reads everything in full when CDHDR cannot be read.
- **Running a delta.** `run_extraction(delta=True)` finds the baseline version and passes the request. A sync profile's existing `extraction_mode` column (`full` or `delta`) selects this, and the existing cron scheduler runs it nightly.
- **Root cause.** A pure service, `api/services/root_cause.py`, attributes each failing record to its last change document. A Celery task, enqueued after `run_checks`, reads CDPOS/CDHDR/USR02 read-only over RFC for the failing keys and stores one row per check in a new RLS table, `finding_root_causes`. The API reads that table, and the rule drill-down page shows it.

**Tech Stack:** Python 3.12, pandas, pyrfc (RFC_READ_TABLE through `sap/rfc.py`), Celery, SQLAlchemy and Alembic (Postgres with RLS), FastAPI, Next.js with React Query, the `@/design` components and vitest.

**Spec:** The task brief from the parent session (no separate spec file). These are its requirements, verbatim where they matter:
- **Delta reads.** After a full baseline version, a delta reads CDHDR for OBJECTCLAS MATERIAL, DEBI, KRED (and any other classes found in the code) with UDATE >= the last extraction date. It re-reads only the changed keys from the root and child tables, merges them over the baseline into a new version, then runs analysis. Records created after the baseline arrive through CDHDR too (change indicator 'I'). It handles deletions and archived records.
- **Nightly schedule.** It supports a scheduled nightly delta (`workers/scheduler.py`).
- **RFC limits.** The key re-read chunks its IN-lists, because RFC OPTIONS lines are limited to 72 characters.
- **Fallback.** When CDHDR is not authorised, the delta falls back to a full read.
- **Root cause by origin.** For each failing record of a finding, join to CDHDR/CDPOS for the field the rule checks, and get USERNAME, TCODE and the date. Classify the origin:
  - interface/batch: USR02.USTYP is B or S;
  - dialog user via a specific tcode;
  - migration-era: created before go-live, with no changes.
- **Aggregation.** Aggregate the top origins per finding, for example "73% of bad MARC.DISMM values set by user BATCH_IF01 via tcode MM02". Expose this as an API endpoint and as a section in the finding drill-down.
- **Determinism and tenancy.** No LLM. Respect RLS and set app.tenant_id.

## Global Constraints

- Python 3.12, with type hints. No `Any` / `any`.
- No customer names in code.
- Rule IDs are append-only.
- Every query is tenant-scoped.
- Alembic migrations: check the current head in `db/migrations/versions` and number from it. The head is `066`, so the new migration is `067` with `down_revision = "066"`.
- Frontend uses `@/design` only, with no raw hex. The `lint:tokens` allowlist stays empty.
- SAP access is read-only, with no writes to SAP ever.
- Deterministic logic only: no LLM in delta or root cause.
- Commit trailer lines, on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

## Facts the implementer needs

- **Object classes.** No change-document object class appears in production code today; MATERIAL, DEBI and KRED appear only in tests. This plan maps exactly these three. BUPA_BUP and EQUI stay out until they are verified on a live system.
- **CDHDR fields.** The header's change indicator field is `CHANGE_IND`, not `CHNGIND`. CDPOS uses `CHNGIND`. The DDIC keys are:
  - CDHDR: MANDANT, OBJECTCLAS, OBJECTID, CHANGENR
  - CDPOS: also TABNAME, TABKEY, FNAME, CHNGIND
  - USR02: BNAME
- **TABKEY format.** `CDPOS.TABKEY` is the 3-character client followed by each DDIC key field, padded to its DDIC length. `Dictionary.table(t).keys` excludes the client, for example MARC → `["MATNR", "WERKS"]`. RFC strips trailing blanks, so compare after `rstrip()`.
- **OBJECTID.** For MATERIAL, DEBI and KRED the OBJECTID is the MATNR, KUNNR or LIFNR value in internal format. This is the same value `finding_records.record_key` carries, for example `MATNR=000000000000000123|WERKS=1000`.
- **MBEW and MARD stay out of the delta.** Goods movements change stock and moving price without writing change documents, so a delta always reads these two tables in full.
- **Record keys.** `finding_records.record_key` is built by `checks/base.py:record_keys` as `FIELD=value|FIELD=value`, using plain field names.
- **Fake SAP in tests.** `tests/sap/fake_rfc.py` (`FakeRFCConnector`, `_filter`) is an in-memory RFC_READ_TABLE. It asserts that every OPTIONS line is 72 characters or fewer.
- **Running tests.** Run pytest from the worktree root, `/Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/market-leader`. Frontend tests are `npm --prefix frontend test -- <path>` and `npm --prefix frontend run lint:tokens`.

## File map

| File | Responsibility |
|---|---|
| `sap/extraction_plan.py` (modify) | `in_lists()`: chunked, escaped IN-list clauses. `via_filters` reuses it. |
| `sap/change_documents.py` (create) | Class map, `class_of`, `cdhdr_where`, `since_date`, `changed_keys`, `delta_tables`, `merge_delta`. |
| `api/services/connectivity_manager.py` (modify) | `DeltaRequest`, `extract(delta=…)`, `_delta_keys`, `_delta_read`, `read_rows`. |
| `workers/tasks/run_extraction.py` (modify) | `delta` flag, `delta_baseline`, `delta_plan`, `baseline_loader`, `metadata.delta`. |
| `api/routes/systems.py`, `workers/tasks/run_sync.py` (modify) | Sync profile `extraction_mode` (`full` or `delta`) and the system's `go_live`. |
| `frontend/types/api.ts`, `frontend/lib/api/systems.ts`, `frontend/app/(app)/systems/[systemId]/schedules-panel.tsx` (modify) | Picking a schedule's mode. |
| `db/migrations/versions/067_finding_root_causes.py` (create) | The `finding_root_causes` table (RLS) and `sap_systems.go_live`. |
| `api/services/root_cause.py` (create) | Pure attribution, classification and aggregation. |
| `workers/tasks/root_cause.py` (create), `workers/tasks/run_checks.py`, `workers/celery_app.py` (modify) | Computing and storing root causes after analysis. |
| `api/routes/versions.py` (modify) | `GET /api/v1/versions/{version_id}/findings/{check_id}/root-cause`. |
| `frontend/lib/api/versions.ts`, `frontend/app/(app)/objects/[object]/rules/[ruleId]/root-cause.tsx` (create), `…/page.tsx` (modify) | The "Root cause" section in the drill-down. |

---

### Task 1: Chunked IN-list helper

**Files:**
- Modify: `sap/extraction_plan.py:295-305` (`via_filters`)
- Test: `tests/sap/test_change_documents.py` (create)

**Interfaces:**
- Consumes: `sap.rfc._literal(value) -> str` and `sap.rfc.where_options(where) -> list[dict]`.
- Produces: `sap.extraction_plan.in_lists(field: str, values: Iterable[str], chunk: int = 60) -> list[str]`. The values come back stripped, de-duplicated, with empty values dropped, sorted, and quoted with quotes escaped.

- [ ] **Step 1: Write the failing test**

Create `tests/sap/test_change_documents.py`:

```python
"""Change-document delta helpers (sap/change_documents.py) and the IN-list chunker."""

import pandas as pd

from sap.ddic import get_dictionary
from sap.extraction_plan import in_lists
from sap.rfc import where_options


def test_in_lists_chunks_dedups_and_escapes():
    assert in_lists("MATNR", ["B", "A", " A ", "", "O'K"], chunk=2) == ["MATNR IN ('A','B')", "MATNR IN ('O''K')"]


def test_in_lists_lines_fit_rfc_options():
    clauses = in_lists("MATNR", [f"{i:040d}" for i in range(200)])
    assert len(clauses) == 4
    assert all(len(o["TEXT"]) <= 72 for c in clauses for o in where_options(c))


def test_in_lists_of_nothing_is_no_clause():
    assert in_lists("LIFNR", []) == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/sap/test_change_documents.py -v`
Expected: FAIL with `ImportError: cannot import name 'in_lists'`

- [ ] **Step 3: Write the minimal implementation**

In `sap/extraction_plan.py`, change the import line `from typing import Optional` to:

```python
from typing import Iterable, Optional
```

Add this function directly above `def via_filters`:

```python
def in_lists(field: str, values: Iterable[str], chunk: int = 60) -> list[str]:
    """``FIELD IN ('a','b',…)`` clauses of at most ``chunk`` values each. The values are stripped,
    de-duplicated, sorted and quote-escaped. ``where_options`` then splits each clause into
    OPTIONS lines of 72 characters or fewer."""
    from sap.rfc import _literal

    vals = sorted({str(v).strip() for v in values if str(v).strip()})
    return [f"{field} IN (" + ",".join(_literal(v) for v in vals[i:i + chunk]) + ")"
            for i in range(0, len(vals), chunk)]
```

Replace the last three lines of `via_filters`:

```python
    values = sorted({str(v).strip() for v in parent_rows[parent_f].tolist() if str(v).strip()})
    return [f"{child_f} IN (" + ",".join(f"'{v}'" for v in values[i:i + chunk]) + ")"
            for i in range(0, len(values), chunk)]
```

with:

```python
    return in_lists(child_f, parent_rows[parent_f].tolist(), chunk)
```

- [ ] **Step 4: Run the tests to verify they pass, with no regression in via reads**

Run: `pytest tests/sap/test_change_documents.py tests/sap/test_rfc_extraction.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sap/extraction_plan.py tests/sap/test_change_documents.py
git commit -m "feat(sap): chunked, escaped IN-list helper shared by via reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 2: Change-document class map and merge logic

**Files:**
- Create: `sap/change_documents.py`
- Test: `tests/sap/test_change_documents.py` (append)

**Interfaces:**
- Consumes: `sap.ddic.Dictionary` (`.table(t)` returns an object with `.keys: list[str]` and `.fields: dict[str, Field]`, where `Field.length: int`).
- Produces:
  - `CLASS_TABLES: dict[str, tuple[str, frozenset[str]]]`
  - `CDHDR_FIELDS: list[str]`
  - `CDPOS_FIELDS: list[str]`
  - `class_of(table: str) -> Optional[tuple[str, str]]`, returning (object class, key field)
  - `cdhdr_where(objclass: str, since: str) -> str`
  - `since_date(started_at: str, margin_days: int = 1) -> str`, returning YYYYMMDD
  - `changed_keys(cdhdr: pd.DataFrame) -> dict[str, set[str]]`
  - `delta_tables(tables: Iterable[str], dictionary: Dictionary) -> dict[str, tuple[str, str]]`
  - `merge_delta(baseline: pd.DataFrame, fresh: pd.DataFrame, key: str, changed: set[str]) -> pd.DataFrame`

- [ ] **Step 1: Write the failing tests**

Append to `tests/sap/test_change_documents.py`:

```python
from sap.change_documents import (
    cdhdr_where, changed_keys, class_of, delta_tables, merge_delta, since_date,
)


def test_class_of_maps_master_tables_and_leaves_stock_tables_out():
    assert class_of("MARC") == ("MATERIAL", "MATNR")
    assert class_of("KNVV") == ("DEBI", "KUNNR")
    assert class_of("LFB1") == ("KRED", "LIFNR")
    assert class_of("MBEW") is None and class_of("MARD") is None and class_of("BKPF") is None


def test_cdhdr_where_uses_the_class_prefix_and_fits_options():
    w = cdhdr_where("MATERIAL", "20261008")
    assert w == "OBJECTCLAS = 'MATERIAL' AND UDATE >= '20261008'"
    assert all(len(o["TEXT"]) <= 72 for o in where_options(w))


def test_since_date_is_a_day_before_the_baseline_start():
    assert since_date("2026-10-09T01:00:00+00:00") == "20261008"
    assert since_date("2026-01-01T00:00:00+00:00") == "20251231"


def test_changed_keys_groups_object_ids_by_class():
    cdhdr = pd.DataFrame({"OBJECTCLAS": ["MATERIAL", "MATERIAL", "KRED ", "BELEG"],
                          "OBJECTID": ["M1", "M1 ", "V9", "X"]})
    assert changed_keys(cdhdr) == {"MATERIAL": {"M1"}, "DEBI": set(), "KRED": {"V9"}}


def test_delta_tables_needs_the_class_key_among_the_ddic_keys():
    got = delta_tables(["MARA", "MARC", "MBEW", "T001", "LFB1"], get_dictionary("ecc6"))
    assert got == {"MARA": ("MATERIAL", "MATNR"), "MARC": ("MATERIAL", "MATNR"), "LFB1": ("KRED", "LIFNR")}


def test_merge_delta_replaces_changed_adds_created_drops_deleted():
    baseline = pd.DataFrame({"MATNR": ["A", "B", "C"], "MTART": ["FERT", "HALB", "ROH"]})
    fresh = pd.DataFrame({"MATNR": ["B", "D"], "MTART": ["FERT", "HAWA"]})  # C deleted, D created
    out = merge_delta(baseline, fresh, "MATNR", {"B", "C", "D"})
    assert sorted(map(tuple, out.values.tolist())) == [("A", "FERT"), ("B", "FERT"), ("D", "HAWA")]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/sap/test_change_documents.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sap.change_documents'`

- [ ] **Step 3: Write the implementation**

Create `sap/change_documents.py`:

```python
"""SAP change documents (CDHDR/CDPOS): delta extraction and root cause.

A master record's change document carries an object class and an object id. A
material is MATNR under MATERIAL, a customer is KUNNR under DEBI, and a vendor
is LIFNR under KRED. Creations carry CHANGE_IND 'I' and deletions 'D'. Only
these classes are mapped. A table outside them is always read in full.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Optional

import pandas as pd

from sap.ddic import Dictionary

# object class -> (OBJECTID key field, tables whose changes the class logs).
# MBEW/MARD are left out: goods movements change stock and price without a change document.
# ponytail: three classes; add BUPA_BUP / EQUI once verified on a live system
CLASS_TABLES: dict[str, tuple[str, frozenset[str]]] = {
    "MATERIAL": ("MATNR", frozenset({"MARA", "MAKT", "MARC", "MARM", "MVKE", "MLAN"})),
    "DEBI": ("KUNNR", frozenset({"KNA1", "KNB1", "KNVV", "KNVP", "KNBK", "KNVI"})),
    "KRED": ("LIFNR", frozenset({"LFA1", "LFB1", "LFM1", "LFBK", "LFBW"})),
}
CDHDR_FIELDS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "TCODE", "CHANGE_IND"]
CDPOS_FIELDS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND"]


def class_of(table: str) -> Optional[tuple[str, str]]:
    """(object class, OBJECTID key field) whose change documents log ``table``, else None."""
    for cls, (key, tables) in CLASS_TABLES.items():
        if table in tables:
            return cls, key
    return None


def cdhdr_where(objclass: str, since: str) -> str:
    """CDHDR rows of one class since YYYYMMDD. The class is the primary-key prefix, so the read is indexed."""
    return f"OBJECTCLAS = '{objclass}' AND UDATE >= '{since}'"


def since_date(started_at: str, margin_days: int = 1) -> str:
    """YYYYMMDD a delta reads change documents from: the baseline's start, minus a margin
    (SAP dates are system-local, the baseline start is UTC)."""
    return (date.fromisoformat(started_at[:10]) - timedelta(days=margin_days)).strftime("%Y%m%d")


def changed_keys(cdhdr: pd.DataFrame) -> dict[str, set[str]]:
    """Object ids with any change document (insert, update, delete), per mapped class."""
    out: dict[str, set[str]] = {cls: set() for cls in CLASS_TABLES}
    for cls, oid in zip(cdhdr["OBJECTCLAS"].astype(str).str.strip(), cdhdr["OBJECTID"].astype(str).str.strip()):
        if cls in out and oid:
            out[cls].add(oid)
    return out


def delta_tables(tables: Iterable[str], dictionary: Dictionary) -> dict[str, tuple[str, str]]:
    """Tables a delta can re-read by key: table -> (object class, key field). The key field
    must be one of the table's DDIC keys."""
    out: dict[str, tuple[str, str]] = {}
    for table in tables:
        c = class_of(table)
        t = dictionary.table(table)
        if c is not None and t is not None and c[1] in t.keys:
            out[table] = c
    return out


def merge_delta(baseline: pd.DataFrame, fresh: pd.DataFrame, key: str, changed: set[str]) -> pd.DataFrame:
    """The baseline rows of unchanged keys plus the re-read rows of changed keys. A changed
    key the re-read no longer returns (deleted, archived) drops out."""
    keep = baseline[~baseline[key].astype(str).str.strip().isin(changed)]
    return pd.concat([keep, fresh], ignore_index=True)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/sap/test_change_documents.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sap/change_documents.py tests/sap/test_change_documents.py
git commit -m "feat(sap): change-document class map and delta merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 3: Delta mode in `ConnectivityManager.extract`

**Files:**
- Modify: `api/services/connectivity_manager.py` (imports at lines 11-19; `extract` signature at line 190; the ABAP loop at lines 247-342)
- Test: `tests/sap/test_delta_extraction.py` (create)

**Interfaces:**
- Consumes:
  - Task 1: `in_lists`.
  - Task 2: `cdhdr_where`, `changed_keys`, `delta_tables`, `merge_delta`.
- Produces:
  - `api.services.connectivity_manager.DeltaRequest(since: str, load_baseline: Callable[[str], Optional[pd.DataFrame]])`. `load_baseline(table)` returns the baseline's frame with plain field names, or None.
  - `ConnectivityManager.extract(..., delta: Optional[DeltaRequest] = None)`.
  - A coverage entry `{"table": "CDHDR:delta", "purpose": "delta", "status": "delta" | "delta_fallback", "since"?, "changed"?: {class: n}, "detail"?}`.
  - A delta-read table's coverage entry carries `"delta": {"since", "key", "changed", "reread"}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sap/test_delta_extraction.py`:

```python
"""Delta extraction: CDHDR names the changed vendors, only they are re-read and merged over the baseline."""

import pandas as pd

from sap.ddic import get_dictionary

from tests.sap.fake_rfc import FakeRFCConnector

_COLS = ["MANDANT", "OBJECTCLAS", "OBJECTID", "CHANGENR", "UDATE", "CHANGE_IND"]


def _mgr(fake):
    from api.services import connectivity_manager as cm

    class Mgr(cm.ConnectivityManager):
        def __init__(self):
            self.tenant_id, self.session = "t", None

        def _load_system(self, sid):
            return type("R", (), {"system_type": "ecc", "id": sid})()

        def _build_connection_params(self, row):
            return {"system_type": "ecc"}

        def _get_connector(self, system_type, params):
            return fake

    return Mgr()


def _lfa1(rows):
    return pd.DataFrame({"MANDT": ["100"] * len(rows), "LIFNR": [r[0] for r in rows], "NAME1": [r[1] for r in rows],
                         "KTOKK": ["KRED"] * len(rows), "LAND1": ["ZA"] * len(rows)})


def _baseline(monkeypatch):
    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    before = {"LFA1": _lfa1([("V1", "A"), ("V2", "B"), ("V3", "C")])}
    frames, _ = _mgr(FakeRFCConnector(before)).extract("sys", ["accounts_payable"])
    return {t: f.rename(columns=lambda c: c.split(".", 1)[1]) for t, f in frames.items()}


def _cdhdr():
    return pd.DataFrame([["100", "KRED", "V2", "0000000011", "20261009", "U"],
                         ["100", "KRED", "V3", "0000000012", "20261009", "D"],
                         ["100", "KRED", "V4", "0000000013", "20261009", "I"],
                         ["100", "KRED", "V1", "0000000001", "20250101", "U"]], columns=_COLS)


def _names(frames):
    return frames["LFA1"].set_index("LFA1.LIFNR")["LFA1.NAME1"].to_dict()


def test_delta_rereads_changed_vendors_and_keeps_the_rest_from_the_baseline(monkeypatch):
    from api.services.connectivity_manager import DeltaRequest

    baseline = _baseline(monkeypatch)
    # V1's name drifted without a change document: the baseline value must survive (proves no full read)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V1", "A-silent"), ("V2", "B2"), ("V4", "D")]), "CDHDR": _cdhdr()})
    frames, coverage = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", baseline.get))

    assert _names(frames) == {"V1": "A", "V2": "B2", "V4": "D"}  # V2 updated, V3 deleted, V4 created
    cov = {c["table"]: c for c in coverage}
    assert cov["CDHDR:delta"]["status"] == "delta" and cov["CDHDR:delta"]["changed"] == {"KRED": 3}
    assert cov["LFA1"]["delta"]["changed"] == 3
    reads = [p for fm, p in fake._conn.calls
             if fm == "RFC_READ_TABLE" and p["QUERY_TABLE"] == "LFA1" and p.get("NO_DATA") != "X"]
    assert reads and all("LIFNR IN" in " ".join(o["TEXT"] for o in p["OPTIONS"]) for p in reads)


def test_unreadable_cdhdr_falls_back_to_a_full_read(monkeypatch):
    from api.services.connectivity_manager import DeltaRequest

    baseline = _baseline(monkeypatch)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V1", "A-silent"), ("V2", "B2"), ("V4", "D")])})  # no CDHDR: not authorised
    frames, coverage = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", baseline.get))

    assert _names(frames) == {"V1": "A-silent", "V2": "B2", "V4": "D"}
    cov = {c["table"]: c for c in coverage}
    assert cov["CDHDR:delta"]["status"] == "delta_fallback" and "delta" not in cov["LFA1"]


def test_row_count_disagreement_rereads_the_table_in_full(monkeypatch):
    """V1 archived (no change document): the merge keeps it, SAP's count says 2, so LFA1 is read in full."""
    from api.services.connectivity_manager import DeltaRequest

    baseline = _baseline(monkeypatch)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V2", "B2"), ("V4", "D")]), "CDHDR": _cdhdr()})
    frames, coverage = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", baseline.get))

    assert _names(frames) == {"V2": "B2", "V4": "D"}
    assert "delta" not in {c["table"]: c for c in coverage}["LFA1"]


def test_missing_baseline_table_is_read_in_full(monkeypatch):
    from api.services.connectivity_manager import DeltaRequest

    _baseline(monkeypatch)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V1", "A-silent"), ("V2", "B2"), ("V4", "D")]), "CDHDR": _cdhdr()})
    frames, _ = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", lambda t: None))
    assert _names(frames) == {"V1": "A-silent", "V2": "B2", "V4": "D"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/sap/test_delta_extraction.py -v`
Expected: FAIL with `ImportError: cannot import name 'DeltaRequest'`

- [ ] **Step 3: Add `DeltaRequest` and the signature**

In `api/services/connectivity_manager.py`, add `from dataclasses import dataclass` under `import uuid` (line 14). Then add this above `class ConnectivityManager:` (line 125):

```python
@dataclass(frozen=True)
class DeltaRequest:
    """Re-read only what SAP's change documents say changed since ``since`` (YYYYMMDD), over
    the baseline version's tables. ``load_baseline(table)`` returns the baseline's frame with
    plain field names, or None when it has none."""
    since: str
    load_baseline: Callable[[str], Optional[pd.DataFrame]]
```

Change the `extract` signature (line 190) to:

```python
    def extract(self, system_id: str, modules: list[str], max_rows: int = 0,
                scope: Optional[dict] = None,
                progress: Optional[Callable[[dict], None]] = None,
                sink: Optional[Callable[[str, pd.DataFrame, dict], None]] = None,
                delta: Optional[DeltaRequest] = None) -> tuple[dict[str, pd.DataFrame], list[dict]]:
```

Append this paragraph to the end of the `extract` docstring:

```
        ``delta`` reads CDHDR for the mapped change-document classes and re-reads only the
        changed keys of the tables those classes log, merged over the baseline. Every other
        table, and every table whose baseline is unusable or whose merged row count disagrees
        with SAP's, is read in full. An unreadable CDHDR reads everything in full.
```

- [ ] **Step 4: Add `_delta_keys` and `_delta_read`**

Add both as static methods directly above `def _payroll_totals` (line 361):

```python
    @staticmethod
    def _delta_keys(connector, dictionary, plans: dict, delta: DeltaRequest,
                    coverage: list[dict]) -> tuple[dict[str, set[str]], dict[str, tuple[str, str]]]:
        """Changed object ids per class since ``delta.since`` (from CDHDR), and the planned tables
        those classes cover. If CDHDR is missing or cannot be read (for example, not authorised),
        returns nothing, so every table is read in full."""
        from sap.change_documents import cdhdr_where, changed_keys, delta_tables

        covered = delta_tables(plans, dictionary)
        t = dictionary.table("CDHDR")
        if not covered or t is None:
            coverage.append({"table": "CDHDR:delta", "purpose": "delta", "status": "delta_fallback",
                             "detail": "CDHDR not in this system" if t is None else "no planned table has change documents"})
            return {}, {}
        classes = sorted({c for c, _ in covered.values()})
        try:
            read = [connector.read_table_full("CDHDR", ["OBJECTCLAS", "OBJECTID", "CHANGENR"], list(t.keys),
                                              where=cdhdr_where(c, delta.since)) for c in classes]
        except SAPConnectorError as e:
            coverage.append({"table": "CDHDR:delta", "purpose": "delta", "status": "delta_fallback",
                             "detail": str(e)[:300]})
            return {}, {}
        changed = changed_keys(pd.concat(read, ignore_index=True))
        coverage.append({"table": "CDHDR:delta", "purpose": "delta", "status": "delta", "since": delta.since,
                         "changed": {c: len(changed[c]) for c in classes}})
        return changed, covered

    @staticmethod
    def _delta_read(connector, table: str, cols: list[str], keys: list[str], where: Optional[str],
                    delta: DeltaRequest, changed: dict[str, set[str]], covered: dict[str, tuple[str, str]],
                    parent: Optional[pd.DataFrame], expected: Optional[int],
                    max_rows: int) -> tuple[Optional[pd.DataFrame], Optional[dict]]:
        """``table`` as the baseline plus its re-read changed keys, or (None, None) when it must be
        read in full: there is no usable baseline (missing, other columns), or the merged rows
        disagree with SAP's row count (records archived or deleted without a change document)."""
        from sap.change_documents import merge_delta
        from sap.extraction_plan import in_lists

        cls, key = covered[table]
        baseline = delta.load_baseline(table)
        if baseline is None or not set(cols) <= set(baseline.columns):
            return None, None
        ids = changed.get(cls, set())
        if parent is not None and key in parent.columns:  # a child read via its parent: only parents still read
            ids = ids & set(parent[key].astype(str).str.strip())
        parts = [connector.read_table_full(table, cols, keys, where=" AND ".join(x for x in (w, where) if x),
                                           max_rows=max_rows) for w in in_lists(key, ids)]
        fresh = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
        df = merge_delta(baseline[cols], fresh[cols], key, changed.get(cls, set()))
        if parent is not None and key in parent.columns:  # children of parents that are gone
            df = df[df[key].astype(str).str.strip().isin(set(parent[key].astype(str).str.strip()))]
        if expected is not None and expected != len(df):
            return None, None
        return df, {"since": delta.since, "key": key, "changed": len(ids), "reread": len(fresh)}
```

- [ ] **Step 5: Wire the delta into the read loop**

Directly after `order = list(read_order(plans))` (line 249), add:

```python
                delta_keys, delta_map = self._delta_keys(connector, dictionary, plans, delta, coverage) \
                    if delta else ({}, {})
```

Replace the block from `where = plan.where` / `try:` through the end of the `else:` branch (lines 293-311) with:

```python
                    where = plan.where
                    delta_info: Optional[dict] = None
                    try:
                        df, delta_info = self._delta_read(
                            connector, table, cols, list(t.keys), plan.where, delta, delta_keys, delta_map,
                            raw.get(plan.via) if plan.via else None, counts.get(table), max_rows,
                        ) if delta is not None and table in delta_map else (None, None)
                        if df is None and plan.via:
                            wheres = via_filters(table, plan.via, raw.get(plan.via))
                            parts = [connector.read_table_full(table, cols, list(t.keys),
                                     where=" AND ".join(x for x in (w, plan.where) if x), max_rows=max_rows,
                                     on_progress=lambda g, n, rows: report(table, g, n, rows))
                                     for w in wheres]
                            df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
                        elif df is None:
                            df = connector.read_table_full(table, cols, list(t.keys), where=where,
                                                           max_rows=max_rows,
                                                           on_progress=lambda g, n, rows: report(table, g, n, rows))
                            if df.empty and plan.wide_where:
                                logger.info(f"extract {system_id}: {table} empty in default window, widening")
                                where = plan.wide_where
                                df = connector.read_table_full(table, cols, list(t.keys), where=where,
                                                               max_rows=max_rows,
                                                               on_progress=lambda g, n, rows: report(table, g, n, rows))
```

After `if dup_keys: entry["duplicate_keys"] = dup_keys` (line 333-334), add:

```python
                    if delta_info:
                        entry["delta"] = delta_info
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pytest tests/sap/test_delta_extraction.py tests/sap/test_rfc_extraction.py -v`
Expected: PASS (the existing full-extraction tests are unchanged)

- [ ] **Step 7: Commit**

```bash
git add api/services/connectivity_manager.py tests/sap/test_delta_extraction.py
git commit -m "feat(extract): change-document delta reads merged over the baseline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 4: `run_extraction(delta=True)`: find the baseline and record the delta

**Files:**
- Modify: `workers/tasks/run_extraction.py` (imports at lines 10-14; task signature at line 58; the extract call at line 128; the metadata at lines 158-170)
- Test: `tests/workers/test_delta_plan.py` (create)

**Interfaces:**
- Consumes:
  - Task 2: `since_date`.
  - Task 3: `DeltaRequest` and `extract(delta=...)`.
  - `api.services.storage.download_file(bucket, object_name) -> bytes`.
  - `workers.dataset.parquet_name(table) -> str`.
- Produces:
  - `run_extraction(..., delta: bool = False)`.
  - `delta_baseline(session, tenant_id: str, system_id: str, modules: list[str]) -> Optional[dict[str, object]]`.
  - `delta_plan(baseline: Optional[dict[str, object]], now: datetime, full_days: int) -> Optional[tuple[str, str]]`, returning (since, full_at).
  - `baseline_loader(prefix: str) -> Callable[[str], Optional[pd.DataFrame]]`.
  - `metadata.delta = {"full_at": str} | {"baseline_version_id": str, "since": str, "full_at": str}`.

- [ ] **Step 1: Write the failing test**

Create `tests/workers/test_delta_plan.py`:

```python
"""When a delta may build on the previous version, and from which date."""

from datetime import datetime, timezone

from workers.tasks.run_extraction import delta_plan

NOW = datetime(2026, 10, 10, 1, 0, tzinfo=timezone.utc)


def test_no_baseline_means_a_full_read():
    assert delta_plan(None, NOW, 7) is None
    assert delta_plan({"id": "v0"}, NOW, 7) is None  # no started_at


def test_recent_full_baseline_gives_since_and_full_at():
    b = {"id": "v1", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-09T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) == ("20261008", "2026-10-09T01:00:00+00:00")


def test_delta_baseline_carries_the_last_full_read():
    b = {"id": "v2", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-05T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) == ("20261008", "2026-10-05T01:00:00+00:00")


def test_full_read_older_than_the_limit_forces_a_full_read():
    b = {"id": "v3", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-01T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) is None


def test_versions_before_delta_count_their_start_as_the_full_read():
    assert delta_plan({"id": "v4", "started_at": "2026-10-09T01:00:00+00:00"}, NOW, 7) == \
        ("20261008", "2026-10-09T01:00:00+00:00")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/workers/test_delta_plan.py -v`
Expected: FAIL with `ImportError: cannot import name 'delta_plan'`

- [ ] **Step 3: Add the helpers**

In `workers/tasks/run_extraction.py`, replace the imports at lines 10-14:

```python
import io
from datetime import datetime, timezone
import json
import logging
import uuid
```

with:

```python
import io
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import uuid
from typing import Callable, Optional
```

Add these functions below `latest_activity` (after line 47):

```python
DELTA_FULL_DAYS = int(os.getenv("MERIDIAN_DELTA_FULL_DAYS", "7"))


def delta_baseline(session, tenant_id: str, system_id: str, modules: list[str]) -> Optional[dict[str, object]]:
    """The latest stored version of the same system and objects (id plus metadata) a delta can build on."""
    row = session.execute(text("""
        SELECT id::text, metadata FROM analysis_versions
         WHERE tenant_id = :tid AND metadata->>'system_id' = :sid
           AND metadata->'modules' = CAST(:mods AS jsonb)
           AND metadata->>'dataset_path' IS NOT NULL AND status <> 'failed'
         ORDER BY run_at DESC LIMIT 1
    """), {"tid": tenant_id, "sid": system_id, "mods": json.dumps(modules)}).fetchone()
    return {**(row[1] or {}), "id": row[0]} if row else None


def delta_plan(baseline: Optional[dict[str, object]], now: datetime, full_days: int) -> Optional[tuple[str, str]]:
    """(since YYYYMMDD, full_at) when a delta may run, else None (read in full). A delta needs a
    baseline whose last full read is at most ``full_days`` old. The periodic full read catches
    records archived or deleted without a change document from tables SAP cannot count."""
    from sap.change_documents import since_date

    started = baseline.get("started_at") if baseline else None
    if not isinstance(started, str):
        return None
    prior = baseline.get("delta") if isinstance(baseline.get("delta"), dict) else {}
    full_at = str(prior.get("full_at") or started)
    if now - datetime.fromisoformat(full_at) > timedelta(days=full_days):
        return None
    return since_date(started), full_at


def baseline_loader(prefix: str) -> Callable[[str], "Optional[pd.DataFrame]"]:
    """``load(table)``: the baseline bundle's table with plain field names, or None if it has none."""
    import pandas as pd

    from api.config import settings
    from api.services.storage import download_file
    from workers.dataset import parquet_name

    def load(table: str) -> Optional[pd.DataFrame]:
        try:
            data = download_file(settings.minio_bucket_uploads, f"{prefix}{parquet_name(table)}")
        except Exception:  # ponytail: any storage miss reads the table in full; narrow once storage errors are typed
            return None
        df = pd.read_parquet(io.BytesIO(data))
        return df.fillna("").astype(str).rename(columns=lambda c: c.split(".", 1)[-1])

    return load
```

- [ ] **Step 4: Pass the delta through the task**

Change the task signature (line 58) to:

```python
def run_extraction(self, tenant_id, system_id, modules, include_config=True, sync_type="both",
                   scope=None, analyse=True, label=None, version_id=None, delta=False):
```

Append this line to its docstring:

```
    ``delta`` re-reads only what SAP's change documents say changed since the previous version.
```

Replace the extract call (line 128):

```python
            frames, coverage = manager.extract(system_id, modules, scope=scope, progress=_progress, sink=store)
```

with:

```python
            from api.services.connectivity_manager import DeltaRequest

            baseline = delta_baseline(session, tenant_id, system_id, modules) if delta else None
            dplan = delta_plan(baseline, datetime.now(timezone.utc), DELTA_FULL_DAYS) if delta else None
            request = DeltaRequest(dplan[0], baseline_loader(str(baseline["dataset_path"]))) \
                if dplan and baseline else None
            frames, coverage = manager.extract(system_id, modules, scope=scope, progress=_progress, sink=store,
                                               delta=request)
            fell_back = request is None or any(c["table"] == "CDHDR:delta" and c["status"] == "delta_fallback"
                                               for c in coverage)
            delta_meta = {"full_at": started["started_at"]} if fell_back or not dplan or not baseline else \
                {"baseline_version_id": baseline["id"], "since": dplan[0], "full_at": dplan[1]}
```

In the metadata `json.dumps({...})` (lines 158-170), add this key after `"coverage": coverage, "row_count": total_rows,`:

```python
                    "delta": delta_meta,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/workers/test_delta_plan.py tests/workers/test_run_sync_steps.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/tasks/run_extraction.py tests/workers/test_delta_plan.py
git commit -m "feat(extract): delta downloads build on the previous version of the same objects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 5: Sync profile extraction mode (nightly delta)

The nightly delta needs no new beat task. `sync_profile_scheduler` (`workers/scheduler.py:862-925`) already runs every due profile every 5 minutes, and `sync_profiles.extraction_mode` already exists (server default `full`). A nightly delta is a profile with cron `0 2 * * *` (the "Daily at 02:00" preset) and mode `delta`.

**Files:**
- Modify: `api/routes/systems.py:101-125` (models), `:641-661`, `:677-690`, `:696-739` (SQL)
- Modify: `workers/tasks/run_sync.py:69-95`
- Modify: `frontend/types/api.ts:588-597`, `frontend/lib/api/systems.ts:115-140`, `frontend/app/(app)/systems/[systemId]/schedules-panel.tsx`
- Test: `tests/test_sync_profile_mode.py` (create), `frontend/app/(app)/systems/[systemId]/__tests__/schedules-panel.test.tsx` (create)

**Interfaces:**
- Consumes: Task 4, `run_extraction(..., delta: bool)`.
- Produces:
  - API: the sync profile request and response field `extraction_mode: "full" | "delta"`.
  - TS: `SyncProfile.extraction_mode: "full" | "delta"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sync_profile_mode.py`:

```python
"""Sync profiles choose full or delta downloads."""

import pytest
from pydantic import ValidationError

from api.routes.systems import CreateSyncProfileRequest, SyncProfileResponse, UpdateSyncProfileRequest


def test_mode_defaults_to_full_and_accepts_delta():
    assert CreateSyncProfileRequest(system_id="s", domain="material_master", tables=[]).extraction_mode == "full"
    assert UpdateSyncProfileRequest(extraction_mode="delta").extraction_mode == "delta"


def test_unknown_mode_is_rejected():
    with pytest.raises(ValidationError):
        UpdateSyncProfileRequest(extraction_mode="sample")


def test_response_carries_the_mode():
    r = SyncProfileResponse(id="p", system_id="s", domain="d", tables=[], schedule_cron="0 2 * * *", active=True,
                            last_run_at=None, next_run_at=None, extraction_mode="delta")
    assert r.extraction_mode == "delta"
```

Create `frontend/app/(app)/systems/[systemId]/__tests__/schedules-panel.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import { SchedulesPanel } from "../schedules-panel";

describe("SchedulesPanel", () => {
  it("shows each schedule's download mode", async () => {
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([
      { id: "p1", system_id: "s1", domain: "material_master", tables: ["MARA"], schedule_cron: "0 2 * * *",
        active: true, last_run_at: null, next_run_at: null, extraction_mode: "delta" },
    ]);
    vi.spyOn(systemsApi, "getSystemObjects").mockResolvedValue({ objects: [] } as unknown as Awaited<ReturnType<typeof systemsApi.getSystemObjects>>);
    renderWithQuery(<SchedulesPanel id="s1" canManage={false} />);
    expect(await screen.findByText("Changes only")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_sync_profile_mode.py -v`
Expected: FAIL. `extraction_mode` is not a model field, so the first assert raises `AttributeError` and the second test does not raise.

Run: `npm --prefix frontend test -- "app/(app)/systems/[systemId]/__tests__/schedules-panel.test.tsx"`
Expected: FAIL, because the text "Changes only" is not found.

- [ ] **Step 3: API models and SQL**

In `api/routes/systems.py`, add `Literal` to the existing `typing` import. Then replace the three models:

```python
class CreateSyncProfileRequest(BaseModel):
    system_id: str
    domain: str
    tables: list[str]
    schedule_cron: Optional[str] = None
    active: bool = True
    # delta: re-read only what SAP's change documents say changed since the last download
    extraction_mode: Literal["full", "delta"] = "full"


class UpdateSyncProfileRequest(BaseModel):
    # "" clears the schedule (manual sync only)
    schedule_cron: Optional[str] = None
    active: Optional[bool] = None
    extraction_mode: Optional[Literal["full", "delta"]] = None


class SyncProfileResponse(BaseModel):
    id: str
    system_id: str
    domain: str
    tables: list[str]
    schedule_cron: Optional[str]
    active: bool
    last_run_at: Optional[str]
    next_run_at: Optional[str]
    extraction_mode: str = "full"
```

Make these changes in the create route (line 641):
- Change the INSERT column list to `(id, tenant_id, system_id, domain, tables, schedule_cron, active, extraction_mode)`.
- Change the VALUES to `(gen_random_uuid(), :tid, :sid, :domain, :tables, :cron, :active, :mode)`.
- Add `"mode": body.extraction_mode,` to the params dict.

In all three `RETURNING` / `SELECT` column lists at lines 643, 677 and 728, change:

```sql
last_run_at::text, next_run_at::text
```

to:

```sql
last_run_at::text, next_run_at::text, extraction_mode
```

In all three `SyncProfileResponse(...)` constructions (lines 658, 687 and 736), add one argument:
- at lines 658 and 736 (which use `row`): `extraction_mode=row[8] or "full",`
- at line 687 (which uses `r`): `extraction_mode=r[8] or "full",`

In `update_sync_profile`, directly after the `if body.active is not None:` block, add:

```python
    if body.extraction_mode is not None:
        sets.append("extraction_mode = :mode")
        params["mode"] = body.extraction_mode
```

- [ ] **Step 4: run_sync passes the mode**

In `workers/tasks/run_sync.py`, change the profile query (line 69) to:

```sql
                SELECT sp.domain, sp.ai_anomaly_baseline, ss.name as system_name, ss.id as system_id,
                       sp.extraction_mode
```

After `system_id = str(profile_row[3])` (line 85), add:

```python
        delta = profile_row[4] == "delta"
```

Change the call (line 95) to:

```python
        result = run_extraction(tenant_id, system_id, [domain], analyse=False,
                                label=f"Sync {system_name}", version_id=version_id, delta=delta)
```

- [ ] **Step 5: Frontend type, API and panel**

In `frontend/types/api.ts`, add this to `SyncProfile` after `next_run_at: string | null;`:

```ts
  /** "delta" re-reads only what SAP's change documents say changed since the last download. */
  extraction_mode: "full" | "delta";
```

In `frontend/lib/api/systems.ts`, add `extraction_mode?: "full" | "delta";` to the `body` type of `createSyncProfile`. Change the `updateSyncProfile` body type to:

```ts
  body: { schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" }
```

Make these changes in `frontend/app/(app)/systems/[systemId]/schedules-panel.tsx`:

1. Below the `PRESETS` array, add:

```tsx
const MODES = [
  { value: "full", label: "Full download" },
  { value: "delta", label: "Changes only" },
];
const modeLabel = (m: string | undefined) => MODES.find((x) => x.value === m)?.label ?? "Full download";
```

2. Widen the `update` mutation's body type to:

```tsx
{ schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" }
```

3. Under `const [cron, setCron] = ...`, add:

```tsx
const [mode, setMode] = useState<"full" | "delta">("full");
```

4. In `create`'s `mutationFn`, pass `extraction_mode: mode` in the `createSyncProfile` body.

5. Add a header cell after the Schedule header:

```tsx
<th className={th} style={thStyle}>Download</th>
```

6. Add this cell after the Schedule cell in each row:

```tsx
                  <td className={td} style={tdStyle}>
                    {canManage
                      ? <Select value={p.extraction_mode ?? "full"} options={MODES}
                          onValueChange={(v) => update.mutate({ p, body: { extraction_mode: v === "delta" ? "delta" : "full" } })} />
                      : <span>{modeLabel(p.extraction_mode)}</span>}
                  </td>
```

7. In the add row, after `<CronPicker value={cron} onChange={setCron} />`, add:

```tsx
            <div style={{ width: 160 }}>
              <Select value={mode} options={MODES} onValueChange={(v) => setMode(v === "delta" ? "delta" : "full")} />
            </div>
```

8. Extend the help paragraph with this sentence: `"Changes only" re-reads just the records SAP's change log shows changed since the last download, and does a full download at least weekly.`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pytest tests/test_sync_profile_mode.py -v`
Expected: PASS

Run: `npm --prefix frontend test -- "app/(app)/systems/[systemId]/__tests__/schedules-panel.test.tsx" && npm --prefix frontend run lint:tokens`
Expected: PASS, with no token violations

- [ ] **Step 7: Commit**

```bash
git add api/routes/systems.py workers/tasks/run_sync.py tests/test_sync_profile_mode.py frontend/types/api.ts frontend/lib/api/systems.ts "frontend/app/(app)/systems/[systemId]/schedules-panel.tsx" "frontend/app/(app)/systems/[systemId]/__tests__/schedules-panel.test.tsx"
git commit -m "feat(sync): schedules choose full or change-only (delta) downloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 6: Migration 067: `finding_root_causes` and `sap_systems.go_live`

**Files:**
- Create: `db/migrations/versions/067_finding_root_causes.py`
- Modify: `api/routes/systems.py:81-93` (`UpdateSystemRequest`) and `update_system` (the SET builder, lines 316-353)
- Test: `tests/db/test_migration_067.py` (create)

**Interfaces:**
- Produces:
  - The table `finding_root_causes(id, tenant_id, version_id, check_id, status, field, analysed, total, origins jsonb, summary, detail, created_at)`, with RLS on `tenant_id`.
  - `sap_systems.go_live date NULL`.
  - `UpdateSystemRequest.go_live: Optional[date]`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/test_migration_067.py`:

```python
"""Migration 067 chains from 066 and the system update accepts a go-live date."""

import importlib.util
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_067_follows_066():
    path = ROOT / "db" / "migrations" / "versions" / "067_finding_root_causes.py"
    spec = importlib.util.spec_from_file_location("m067", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (mod.revision, mod.down_revision) == ("067", "066")


def test_system_update_takes_go_live():
    from api.routes.systems import UpdateSystemRequest

    assert UpdateSystemRequest(go_live="2016-01-01").go_live == date(2016, 1, 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/db/test_migration_067.py -v`
Expected: FAIL with `FileNotFoundError` (no 067 file) and `AttributeError` on `go_live`

- [ ] **Step 3: Write the migration**

Create `db/migrations/versions/067_finding_root_causes.py`:

```python
"""finding root causes

Revision ID: 067
Revises: 066
Create Date: 2026-10-10

Who set each check's failing values, grouped by origin (interface or batch user,
dialog transaction, migration load), from SAP change documents
(workers/tasks/root_cause.py). sap_systems.go_live dates the migration cut-over:
records created before it and never changed are migration-era.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "067"
down_revision: Union[str, None] = "066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.add_column("sap_systems", sa.Column("go_live", sa.Date(), nullable=True))
    op.create_table(
        "finding_root_causes",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("analysed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("origins", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_finding_root_causes_tenant_version_check", "finding_root_causes",
                    ["tenant_id", "version_id", "check_id"])
    _rls("finding_root_causes")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS finding_root_causes_rls ON finding_root_causes")
    op.drop_index("ix_finding_root_causes_tenant_version_check", table_name="finding_root_causes")
    op.drop_table("finding_root_causes")
    op.drop_column("sap_systems", "go_live")
```

- [ ] **Step 4: Accept `go_live` on system update**

In `api/routes/systems.py`, add `from datetime import date` to the imports. Add this to `UpdateSystemRequest` after `is_active`:

```python
    # migration cut-over: records created before it and never changed are migration-era (root cause)
    go_live: Optional[date] = None
```

In `update_system`, after the `if body.is_active is not None:` block, add:

```python
    if body.go_live is not None:
        set_parts.append("go_live = :go_live")
        updates["go_live"] = body.go_live
```

- [ ] **Step 5: Run the tests and the migration**

Run: `pytest tests/db/test_migration_067.py -v`
Expected: PASS

If `MERIDIAN_TEST_DB_URL` is set, run: `DATABASE_URL_MIGRATE=$MERIDIAN_TEST_DB_URL alembic upgrade head && DATABASE_URL_MIGRATE=$MERIDIAN_TEST_DB_URL alembic downgrade 066 && DATABASE_URL_MIGRATE=$MERIDIAN_TEST_DB_URL alembic upgrade head`
Expected: all three succeed

- [ ] **Step 6: Commit**

```bash
git add db/migrations/versions/067_finding_root_causes.py api/routes/systems.py tests/db/test_migration_067.py
git commit -m "feat(db): finding_root_causes table (RLS) and system go-live date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 7: Root-cause attribution service (pure)

**Files:**
- Create: `api/services/root_cause.py`
- Test: `tests/services/test_root_cause.py` (create)

**Interfaces:**
- Consumes:
  - Task 1: `in_lists`.
  - Task 2: `class_of`, `CDHDR_FIELDS`, `CDPOS_FIELDS`.
  - `api.services.tenant_seed.raw_rules()`.
  - `sap.base.SAPConnectorError`.
- Produces:
  - `Reader = Callable[[str, list[str], list[str]], pd.DataFrame]`, called as (table, fields, wheres) and returning rows. A reader given no wheres returns an empty frame.
  - `Attribution(origin: str, username: str, tcode: str, udate: str)`. The origin is one of `interface`, `dialog`, `migration`, `unknown`.
  - `RootCause(check_id, status, field, analysed, total, origins, summary, detail)`. The status is one of `computed`, `not_applicable`, `unavailable`. `origins` is a list of `{"origin", "username", "tcode", "records", "share"}`.
  - `rule_field(module: str, check_id: str) -> Optional[str]`
  - `parse_record_key(key: str) -> dict[str, str]`
  - `tabkey(table: str, values: dict[str, str], dictionary: Dictionary) -> Optional[str]`
  - `classify(username: str, udate: str, ustyp: str, created_only: bool, go_live: Optional[str]) -> str`
  - `aggregate(field: str, attributions: list[Attribution]) -> tuple[list[dict[str, str | int | float]], str]`
  - `root_causes(read: Reader, records: dict[tuple[str, str], list[str]], go_live: Optional[str], dictionary: Dictionary) -> list[RootCause]`, where `records` is keyed by (module, check_id).

- [ ] **Step 1: Write the failing tests**

Create `tests/services/test_root_cause.py`:

```python
"""Root cause by origin from change documents: deterministic, read-only."""

import pandas as pd
import pytest

from api.services import root_cause as rc
from sap.base import SAPConnectorError
from sap.ddic import get_dictionary

from tests.sap.fake_rfc import _filter

D = get_dictionary("ecc6")


def _tk(matnr: str, werks: str) -> str:
    return "100" + matnr.ljust(18) + werks


def _sap() -> dict[str, pd.DataFrame]:
    cdpos = pd.DataFrame([
        ["MATERIAL", "M1", "0000000010", "MARC", _tk("M1", "1000"), "DISMM", "U"],
        ["MATERIAL", "M2", "0000000011", "MARC", _tk("M2", "1000"), "DISMM", "U"],
        ["MATERIAL", "M3", "0000000001", "MARC", _tk("M3", "1000"), "KEY", "I"],
        ["MATERIAL", "M4", "0000000012", "MARC", _tk("M4", "1000"), "DISMM", "U"],
        ["MATERIAL", "M4", "0000000013", "MARC", _tk("M4", "2000"), "DISMM", "U"],  # other plant: ignored
    ], columns=["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND"])
    cdhdr = pd.DataFrame([
        ["MATERIAL", "M1", "0000000010", "BATCH_IF01", "20240301", "MM02", "U"],
        ["MATERIAL", "M2", "0000000011", "BATCH_IF01", "20240302", "MM02", "U"],
        ["MATERIAL", "M3", "0000000001", "JDOE", "20150101", "MM01", "I"],
        ["MATERIAL", "M4", "0000000012", "JDOE", "20240303", "MM02", "U"],
        ["MATERIAL", "M4", "0000000013", "XUSER", "20240304", "MM02", "U"],
    ], columns=["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "TCODE", "CHANGE_IND"])
    usr02 = pd.DataFrame({"BNAME": ["BATCH_IF01", "JDOE", "XUSER"], "USTYP": ["B", "A", "A"]})
    return {"CDPOS": cdpos, "CDHDR": cdhdr, "USR02": usr02}


def _reader(db: dict[str, pd.DataFrame], deny: frozenset[str] = frozenset()) -> rc.Reader:
    def read(table: str, fields: list[str], wheres: list[str]) -> pd.DataFrame:
        if table in deny:
            raise SAPConnectorError("NOT_AUTHORIZED")
        parts = [_filter(db[table], w) for w in wheres]
        return (pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=fields))[fields]
    return read


RECORDS = {("material_master", "MMTEST"): [f"MATNR={m}|WERKS=1000" for m in ("M1", "M2", "M3", "M4")]}


@pytest.fixture(autouse=True)
def _field(monkeypatch):
    monkeypatch.setattr(rc, "rule_field", lambda module, check_id: "MARC.DISMM" if check_id == "MMTEST" else None)


def test_parse_record_key_and_tabkey():
    v = rc.parse_record_key("MATNR=M1|WERKS=1000")
    assert v == {"MATNR": "M1", "WERKS": "1000"}
    assert rc.tabkey("MARC", v, D) == ("M1".ljust(18) + "1000")
    assert rc.tabkey("MARC", {"MATNR": "M1"}, D) is None


def test_classify_orders_migration_then_interface_then_dialog():
    assert rc.classify("BATCH", "20150101", "B", True, "20160101") == "migration"
    assert rc.classify("BATCH", "20240101", "S", False, "20160101") == "interface"
    assert rc.classify("JDOE", "20240101", "A", False, None) == "dialog"
    assert rc.classify("", "", "", False, None) == "unknown"


def test_root_causes_group_failing_values_by_origin():
    (out,) = rc.root_causes(_reader(_sap()), RECORDS, "20160101", D)
    assert (out.status, out.field, out.analysed, out.total) == ("computed", "MARC.DISMM", 4, 4)
    assert out.origins == [
        {"origin": "interface", "username": "BATCH_IF01", "tcode": "MM02", "records": 2, "share": 50.0},
        {"origin": "dialog", "username": "JDOE", "tcode": "MM02", "records": 1, "share": 25.0},
        {"origin": "migration", "username": "JDOE", "tcode": "MM01", "records": 1, "share": 25.0},
    ]
    assert out.summary == "50% of failing MARC.DISMM values were last set by interface/batch user BATCH_IF01 via MM02."


def test_record_without_change_documents_is_unknown():
    (out,) = rc.root_causes(_reader(_sap()), {("material_master", "MMTEST"): ["MATNR=M9|WERKS=1000"]}, None, D)
    assert out.origins == [{"origin": "unknown", "username": "", "tcode": "", "records": 1, "share": 100.0}]
    assert out.summary == "100% of failing MARC.DISMM values have no change document."


def test_unauthorised_usr02_classifies_users_as_dialog():
    (out,) = rc.root_causes(_reader(_sap(), frozenset({"USR02"})), RECORDS, "20160101", D)
    assert out.origins[0]["origin"] == "dialog" and out.origins[0]["username"] == "BATCH_IF01"


def test_unauthorised_cdpos_marks_the_check_unavailable():
    (out,) = rc.root_causes(_reader(_sap(), frozenset({"CDPOS"})), RECORDS, None, D)
    assert out.status == "unavailable" and "NOT_AUTHORIZED" in out.detail and out.total == 4


def test_rule_on_a_table_without_change_documents_is_not_applicable():
    (out,) = rc.root_causes(_reader(_sap()), {("x", "OTHER"): ["BELNR=1"]}, None, D)
    assert out.status == "not_applicable" and out.total == 1


def test_rule_field_reads_the_shipped_yaml():
    from api.services.tenant_seed import raw_rules
    module, r = next((m, r) for _, _, m, r in raw_rules() if isinstance(r.get("field"), str))
    assert rc._rule_fields()[(module, str(r["id"]))] == r["field"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/services/test_root_cause.py -v`
Expected: FAIL with `ImportError: cannot import name 'root_cause'`

- [ ] **Step 3: Write the implementation**

Create `api/services/root_cause.py`:

```python
"""Root cause of a finding by origin: who set the failing values, how and when.

For each failing record of a check, the latest change document (CDPOS) for the
rule's field names the user, transaction and date. If that field was never
changed, the record's creation names them instead (CDPOS FNAME 'KEY', else
CDHDR CHANGE_IND 'I'). Origins:
  migration  created before the system's go-live and the field never changed
  interface  USR02.USTYP B (system) or S (service): an interface or batch user
  dialog     any other user, grouped by transaction
  unknown    no change document at all
Deterministic: the same SAP state gives the same answer. SAP is only read.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Callable, Optional

import pandas as pd

from sap.base import SAPConnectorError
from sap.change_documents import CDHDR_FIELDS, CDPOS_FIELDS, class_of
from sap.ddic import Dictionary

MAX_RECORDS = 5000  # ponytail: per check, first keys in sort order; stream the rest if a check needs every record
TOP = 5
INTERFACE_USER_TYPES = frozenset({"B", "S"})
_LABEL = {"interface": "interface/batch user", "dialog": "dialog user"}

Reader = Callable[[str, list[str], list[str]], pd.DataFrame]  # (table, fields, wheres) -> rows


@dataclass(frozen=True)
class Attribution:
    origin: str
    username: str
    tcode: str
    udate: str


@dataclass
class RootCause:
    check_id: str
    status: str  # computed · not_applicable · unavailable
    field: Optional[str] = None
    analysed: int = 0
    total: int = 0
    origins: list[dict[str, str | int | float]] = field(default_factory=list)
    summary: str = ""
    detail: str = ""


@lru_cache(maxsize=1)
def _rule_fields() -> dict[tuple[str, str], str]:
    from api.services.tenant_seed import raw_rules

    return {(m, str(r["id"])): r["field"] for _, _, m, r in raw_rules() if isinstance(r.get("field"), str)}


def rule_field(module: str, check_id: str) -> Optional[str]:
    """The ``TABLE.FIELD`` a shipped rule checks, None for rules without one (generated, multi-field)."""
    return _rule_fields().get((module, check_id))


def parse_record_key(key: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in key.split("|") if "=" in p)


def tabkey(table: str, values: dict[str, str], dictionary: Dictionary) -> Optional[str]:
    """CDPOS.TABKEY of a record without its 3-character client, trailing blanks stripped.
    None when the record key lacks one of the table's DDIC keys."""
    t = dictionary.table(table)
    if t is None or any(k not in values for k in t.keys):
        return None
    return "".join(values[k].ljust(t.fields[k].length) for k in t.keys).rstrip()


def classify(username: str, udate: str, ustyp: str, created_only: bool, go_live: Optional[str]) -> str:
    if not username:
        return "unknown"
    if created_only and go_live and udate < go_live:
        return "migration"
    if ustyp in INTERFACE_USER_TYPES:
        return "interface"
    return "dialog"


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    return df.astype(str).apply(lambda s: s.str.strip())


def attribute(values: dict[str, str], table: str, fname: str, key_field: str, cdpos: pd.DataFrame,
              cdhdr: pd.DataFrame, ustyp: dict[str, str], go_live: Optional[str],
              dictionary: Dictionary) -> Attribution:
    """Who last set ``table.fname`` of one record: its latest change, else its creation."""
    oid = values.get(key_field, "")
    pos = cdpos[(cdpos["OBJECTID"] == oid) & (cdpos["TABNAME"] == table) & cdpos["FNAME"].isin([fname, "KEY"])]
    tk = tabkey(table, values, dictionary)
    if tk is not None:
        pos = pos[pos["TABKEY"].str[3:].str.rstrip() == tk]
    hdr = cdhdr[cdhdr["OBJECTID"] == oid]
    if len(pos):
        last = pos.sort_values("CHANGENR").iloc[-1]
        created_only = not (pos["FNAME"] == fname).any()
        h = hdr[hdr["CHANGENR"] == last["CHANGENR"]]
    else:
        h, created_only = hdr[hdr["CHANGE_IND"] == "I"].sort_values("CHANGENR").iloc[:1], True
    if not len(h):
        return Attribution("unknown", "", "", "")
    r = h.iloc[0]
    user = str(r["USERNAME"])
    return Attribution(classify(user, str(r["UDATE"]), ustyp.get(user, ""), created_only, go_live),
                       user, str(r["TCODE"]), str(r["UDATE"]))


def _sentence(fld: str, o: dict[str, str | int | float]) -> str:
    pct = f"{float(o['share']):.0f}%"
    tcode = o["tcode"] or "no transaction"
    if o["origin"] == "unknown":
        return f"{pct} of failing {fld} values have no change document."
    if o["origin"] == "migration":
        return f"{pct} of failing {fld} values were created before go-live by {o['username']} via {tcode} and never changed."
    return f"{pct} of failing {fld} values were last set by {_LABEL[str(o['origin'])]} {o['username']} via {tcode}."


def aggregate(fld: str, attributions: list[Attribution]) -> tuple[list[dict[str, str | int | float]], str]:
    """Top origins (origin, user, transaction) by record count. Ties are broken by key, so the result is deterministic."""
    n = len(attributions)
    counts = Counter((a.origin, a.username, a.tcode) for a in attributions)
    top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP]
    origins: list[dict[str, str | int | float]] = [
        {"origin": o, "username": u, "tcode": t, "records": c, "share": round(100 * c / n, 1)}
        for (o, u, t), c in top]
    return origins, _sentence(fld, origins[0]) if origins else ""


def _read_docs(read: Reader, plans: list[tuple[str, tuple[str, str], list[dict[str, str]]]]
               ) -> tuple[dict[str, pd.DataFrame], dict[str, pd.DataFrame], dict[str, str]]:
    """CDPOS and CDHDR of every failing object, one read per class, plus USR02 user types."""
    from sap.extraction_plan import in_lists

    want: dict[str, tuple[set[str], set[str], set[str]]] = {}
    for fld, (cls, key), recs in plans:
        ids, tabs, fnames = want.setdefault(cls, (set(), set(), {"KEY"}))
        ids |= {r[key] for r in recs if r.get(key)}
        tabs.add(fld.split(".", 1)[0])
        fnames.add(fld.split(".", 1)[1])
    cdpos: dict[str, pd.DataFrame] = {}
    cdhdr: dict[str, pd.DataFrame] = {}
    for cls, (ids, tabs, fnames) in sorted(want.items()):
        head = f"OBJECTCLAS = '{cls}'"
        narrow = f"{in_lists('TABNAME', tabs, 100)[0]} AND {in_lists('FNAME', fnames, 100)[0]}"
        cdpos[cls] = _clean(read("CDPOS", CDPOS_FIELDS, [f"{head} AND {w} AND {narrow}" for w in in_lists("OBJECTID", ids)]))
        cdhdr[cls] = _clean(read("CDHDR", CDHDR_FIELDS, [f"{head} AND {w}" for w in in_lists("OBJECTID", ids)]))
    users = set().union(*(set(h["USERNAME"]) for h in cdhdr.values())) - {""}
    try:
        u = _clean(read("USR02", ["BNAME", "USTYP"], in_lists("BNAME", users)))
        ustyp = dict(zip(u["BNAME"], u["USTYP"]))
    except SAPConnectorError:
        ustyp = {}  # USR02 not authorised: users classify as dialog
    return cdpos, cdhdr, ustyp


def root_causes(read: Reader, records: dict[tuple[str, str], list[str]], go_live: Optional[str],
                dictionary: Dictionary) -> list[RootCause]:
    """One RootCause per (module, check_id). ``records`` maps each to its failing record keys.
    ``go_live`` is YYYYMMDD or None."""
    out: list[RootCause] = []
    plans: dict[tuple[str, str], tuple[str, tuple[str, str], list[dict[str, str]], int]] = {}
    for (module, check_id), keys in sorted(records.items()):
        fld = rule_field(module, check_id)
        c = class_of(fld.split(".", 1)[0]) if fld else None
        if fld is None or c is None:
            out.append(RootCause(check_id, "not_applicable", fld, 0, len(keys),
                                 detail="the rule's field has no SAP change documents"))
            continue
        plans[(module, check_id)] = (fld, c, [parse_record_key(k) for k in sorted(keys)[:MAX_RECORDS]], len(keys))
    if not plans:
        return out
    try:
        cdpos, cdhdr, ustyp = _read_docs(read, [(f, c, r) for f, c, r, _ in plans.values()])
    except SAPConnectorError as e:
        return out + [RootCause(cid, "unavailable", f, 0, n, detail=str(e)[:300])
                      for (_, cid), (f, _, _, n) in plans.items()]
    for (_, check_id), (fld, (cls, key), recs, total) in plans.items():
        table, fname = fld.split(".", 1)
        atts = [attribute(r, table, fname, key, cdpos[cls], cdhdr[cls], ustyp, go_live, dictionary) for r in recs]
        origins, summary = aggregate(fld, atts)
        out.append(RootCause(check_id, "computed", fld, len(recs), total, origins, summary))
    return out
```

The autouse fixture replaces `rc.rule_field` but not `rc._rule_fields`, so `test_rule_field_reads_the_shipped_yaml` reads the real catalogue.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/services/test_root_cause.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/root_cause.py tests/services/test_root_cause.py
git commit -m "feat(root-cause): attribute failing values to their change-document origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 8: Read-only RFC reader and the root-cause task after analysis

**Files:**
- Modify: `api/services/connectivity_manager.py` (add `read_rows` above `_payroll_totals`)
- Create: `workers/tasks/root_cause.py`
- Modify: `workers/tasks/run_checks.py` (success path, beside the `build_golden_records` enqueue)
- Modify: `workers/celery_app.py` (explicit task imports)
- Test: `tests/sap/test_delta_extraction.py` (append)

**Interfaces:**
- Consumes:
  - Task 6: the `finding_root_causes` table and `sap_systems.go_live`.
  - Task 7: `root_causes` and `RootCause`.
  - `tenant_session` and `get_sync_engine` (from `workers.db`).
- Produces:
  - `ConnectivityManager.read_rows(system_id: str, table: str, fields: list[str], wheres: list[str]) -> pd.DataFrame`. It is read-only and opens one connection per call.
  - The Celery task `workers.tasks.root_cause.root_cause_findings(version_id: str, tenant_id: str) -> dict[str, int]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/sap/test_delta_extraction.py`:

```python
def test_read_rows_reads_in_list_chunks_within_options_limits(monkeypatch):
    from sap.extraction_plan import in_lists

    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    names = [f"USER{i:08d}" for i in range(150)]
    usr02 = pd.DataFrame({"MANDT": ["100"] * 150, "BNAME": names, "USTYP": ["A"] * 149 + ["B"]})
    fake = FakeRFCConnector({"USR02": usr02})
    out = _mgr(fake).read_rows("sys", "USR02", ["BNAME", "USTYP"], in_lists("BNAME", names))
    assert len(out) == 150 and list(out.columns) == ["BNAME", "USTYP"]
    assert out.set_index("BNAME")["USTYP"][names[-1]] == "B"
    assert _mgr(fake).read_rows("sys", "USR02", ["BNAME"], []).empty
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/sap/test_delta_extraction.py::test_read_rows_reads_in_list_chunks_within_options_limits -v`
Expected: FAIL with `AttributeError: ... has no attribute 'read_rows'`

- [ ] **Step 3: Add `read_rows`**

In `api/services/connectivity_manager.py`, add this method directly above `@staticmethod def _payroll_totals`:

```python
    def read_rows(self, system_id: str, table: str, fields: list[str], wheres: list[str]) -> pd.DataFrame:
        """Rows of one ABAP table, one read-only RFC read per WHERE clause (for example, key IN-lists
        from ``in_lists``). No clause means no read. Raises SAPConnectorError if the system or
        table cannot be read."""
        from api.services.source_design import dictionary_for
        from sap.extraction_plan import ABAP_SYSTEM_TYPES

        if not wheres:
            return pd.DataFrame(columns=fields)
        row = self._load_system(system_id)
        if row.system_type not in ABAP_SYSTEM_TYPES:
            raise SAPConnectorError(f"{row.system_type} systems have no change documents over RFC")
        t = dictionary_for(self.session, system_id, row.system_type).table(table)
        if t is None:
            raise SAPConnectorError(f"{table} is not in this system")
        params = self._build_connection_params(row)
        try:
            connector = self._get_connector(row.system_type, params)
        finally:
            for key in ("password", "client_secret", "api_key"):
                params.pop(key, None)
        try:
            parts = [connector.read_table_full(table, fields, list(t.keys), where=w) for w in wheres]
        finally:
            connector.close()
        return pd.concat(parts, ignore_index=True)[fields]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/sap/test_delta_extraction.py -v`
Expected: PASS

- [ ] **Step 5: Create the task**

Create `workers/tasks/root_cause.py`:

```python
"""Celery task: root cause by origin of every finding of an analysed SAP version.

Runs after run_checks. It reads CDPOS/CDHDR/USR02 read-only over RFC for the failing
records (api/services/root_cause.py) and stores one row per check in
finding_root_causes, which GET /versions/{id}/findings/{check_id}/root-cause serves.
Uploaded and non-ABAP versions have no change documents and are skipped.
"""

import json
import logging

from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.root_cause")


@celery_app.task(bind=True, name="workers.tasks.root_cause.root_cause_findings",
                 soft_time_limit=1800, time_limit=1860)
def root_cause_findings(self, version_id: str, tenant_id: str) -> dict[str, int]:
    from api.services.connectivity_manager import ConnectivityManager
    from api.services.root_cause import root_causes
    from api.services.source_design import dictionary_for
    from sap.extraction_plan import ABAP_SYSTEM_TYPES

    engine = get_sync_engine()
    with tenant_session(engine, tenant_id) as session:
        p = {"v": version_id, "t": tenant_id}
        meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                               p).scalar() or {}
        system_id = meta.get("system_id")
        sysrow = session.execute(text("SELECT system_type, go_live FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                                 {"s": system_id, "t": tenant_id}).fetchone() if system_id else None
        if sysrow is None or sysrow[0] not in ABAP_SYSTEM_TYPES:
            return {"checks": 0}
        go_live = sysrow[1].strftime("%Y%m%d") if sysrow[1] else None
        records: dict[tuple[str, str], list[str]] = {}
        for check_id, module, key in session.execute(text(
                "SELECT check_id, module, record_key FROM finding_records WHERE version_id = :v AND tenant_id = :t"), p):
            records.setdefault((module, check_id), []).append(key)
        manager = ConnectivityManager(session, tenant_id)
        results = root_causes(lambda table, fields, wheres: manager.read_rows(system_id, table, fields, wheres),
                              records, go_live, dictionary_for(session, system_id, sysrow[0]))
        session.execute(text("DELETE FROM finding_root_causes WHERE version_id = :v AND tenant_id = :t"), p)
        for r in results:
            session.execute(text("""
                INSERT INTO finding_root_causes
                    (tenant_id, version_id, check_id, status, field, analysed, total, origins, summary, detail)
                VALUES (:t, :v, :cid, :st, :f, :a, :n, CAST(:o AS jsonb), :s, :d)
            """), {**p, "cid": r.check_id, "st": r.status, "f": r.field, "a": r.analysed, "n": r.total,
                   "o": json.dumps(r.origins), "s": r.summary, "d": r.detail})
        session.commit()
    logger.info(f"root cause {version_id}: {len(results)} checks")
    return {"checks": len(results)}
```

- [ ] **Step 6: Enqueue after analysis and register the task**

In `workers/tasks/run_checks.py`, directly after the `try/except` that enqueues `build_golden_records` (just before `return {"version_id": version_id, "status": "complete", ...}`), add:

```python
        # Root cause by origin from SAP change documents (non-blocking, non-fatal; skips uploads)
        try:
            from workers.tasks.root_cause import root_cause_findings
            root_cause_findings.delay(version_id, tenant_id)
        except Exception as e:
            logger.warning(f"Failed to enqueue root_cause_findings (non-fatal): {e}")
```

In `workers/celery_app.py`, after `import workers.tasks.run_health_check  # noqa: F401 ...`, add:

```python
import workers.tasks.root_cause  # noqa: F401 — root cause by origin after analysis
```

- [ ] **Step 7: Check that the task module imports and registers**

Run: `python -c "import workers.celery_app as c; assert 'workers.tasks.root_cause.root_cause_findings' in c.celery_app.tasks"`
Expected: exit code 0

Run: `pytest tests/sap tests/services/test_root_cause.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add api/services/connectivity_manager.py workers/tasks/root_cause.py workers/tasks/run_checks.py workers/celery_app.py tests/sap/test_delta_extraction.py
git commit -m "feat(root-cause): compute finding origins after analysis via read-only RFC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 9: Root-cause API endpoint

**Files:**
- Modify: `api/routes/versions.py` (add the route after `finding_records`, near line 278)
- Test: `tests/test_root_cause_route.py` (create)

**Interfaces:**
- Consumes:
  - Task 6: `finding_root_causes`.
  - `_scope_of(db, version_id)`.
  - `get_db` and `get_tenant`.
- Produces: `GET /api/v1/versions/{version_id}/findings/{check_id}/root-cause`. It returns `{version_id, check_id, status, field, analysed, total, origins, summary, detail}`. The status is one of `computed`, `not_applicable`, `unavailable`, `not_computed`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_root_cause_route.py`:

```python
"""GET /versions/{id}/findings/{check_id}/root-cause: tenant set first, stored row or not_computed."""

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.routes.versions import finding_root_cause


class _Res:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _DB:
    def __init__(self, rows):
        self.rows, self.calls = list(rows), []

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))
        return _Res(self.rows.pop(0))


TENANT = SimpleNamespace(id=uuid.uuid4())
VID = uuid.uuid4()


def test_returns_the_stored_root_cause_with_tenant_set_first():
    stored = SimpleNamespace(_mapping={"status": "computed", "field": "MARC.DISMM", "analysed": 4, "total": 4,
                                       "origins": [{"origin": "interface", "username": "BATCH_IF01", "tcode": "MM02",
                                                    "records": 2, "share": 50.0}],
                                       "summary": "50% …", "detail": ""})
    db = _DB([None, ("sys",), stored])
    out = asyncio.run(finding_root_cause(VID, "MMTEST", db=db, tenant=TENANT))
    assert "set_config('app.tenant_id'" in db.calls[0][0] and db.calls[0][1] == {"tid": str(TENANT.id)}
    assert db.calls[2][1]["tid"] == str(TENANT.id)
    assert out["status"] == "computed" and out["origins"][0]["username"] == "BATCH_IF01"
    assert out["version_id"] == str(VID) and out["check_id"] == "MMTEST"


def test_not_computed_until_the_task_ran():
    out = asyncio.run(finding_root_cause(VID, "MMTEST", db=_DB([None, ("sys",), None]), tenant=TENANT))
    assert out["status"] == "not_computed" and out["origins"] == []


def test_unknown_version_is_404():
    with pytest.raises(HTTPException) as e:
        asyncio.run(finding_root_cause(VID, "MMTEST", db=_DB([None, None]), tenant=TENANT))
    assert e.value.status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_root_cause_route.py -v`
Expected: FAIL with `ImportError: cannot import name 'finding_root_cause'`

- [ ] **Step 3: Write the route**

In `api/routes/versions.py`, add this directly after the `finding_records` route:

```python
@router.get("/versions/{version_id}/findings/{check_id}/root-cause")
async def finding_root_cause(
    version_id: uuid.UUID,
    check_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Who set this check's failing values, grouped by origin: an interface or batch user,
    a dialog transaction, or a migration load before go-live. The data comes from SAP change
    documents (workers/tasks/root_cause.py, after the analysis). The status is ``not_computed``
    until that task has run."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    if await _scope_of(db, version_id) is None:
        raise HTTPException(status_code=404, detail="Version not found")
    row = (await db.execute(text("""
        SELECT status, field, analysed, total, origins, summary, detail FROM finding_root_causes
         WHERE version_id = :v AND check_id = :cid AND tenant_id = :tid
         ORDER BY created_at DESC LIMIT 1
    """), {"v": version_id, "cid": check_id, "tid": str(tenant.id)})).fetchone()
    base = {"version_id": str(version_id), "check_id": check_id}
    if row is None:
        return {**base, "status": "not_computed", "field": None, "analysed": 0, "total": 0,
                "origins": [], "summary": "", "detail": ""}
    return {**base, **dict(row._mapping)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_root_cause_route.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/routes/versions.py tests/test_root_cause_route.py
git commit -m "feat(api): finding root-cause endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 10: "Root cause" section in the finding drill-down

**Files:**
- Modify: `frontend/lib/api/versions.ts` (after `getFindingRecords`, line 112)
- Create: `frontend/app/(app)/objects/[object]/rules/[ruleId]/root-cause.tsx`
- Modify: `frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx`
- Test: `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/root-cause.test.tsx` (create), `…/__tests__/page.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 9's response shape.
- Produces:
  - `getFindingRootCause(versionId: string, checkId: string): Promise<FindingRootCause>`
  - The `RootCauseOrigin` and `FindingRootCause` types.
  - `<RootCauseSection run={string} ruleId={string} />`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/root-cause.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as versionsApi from "@/lib/api/versions";
import { RootCauseSection } from "../root-cause";

const base = { version_id: "v1", check_id: "MMTEST", field: "MARC.DISMM", analysed: 4, total: 4, detail: "" };

describe("RootCauseSection", () => {
  it("shows the headline and the top origins", async () => {
    vi.spyOn(versionsApi, "getFindingRootCause").mockResolvedValue({
      ...base, status: "computed",
      summary: "50% of failing MARC.DISMM values were last set by interface/batch user BATCH_IF01 via MM02.",
      origins: [
        { origin: "interface", username: "BATCH_IF01", tcode: "MM02", records: 2, share: 50 },
        { origin: "migration", username: "JDOE", tcode: "MM01", records: 1, share: 25 },
      ],
    });
    renderWithQuery(<RootCauseSection run="v1" ruleId="MMTEST" />);
    expect(await screen.findByText(/last set by interface\/batch user BATCH_IF01/)).toBeInTheDocument();
    expect(screen.getByText("BATCH_IF01")).toBeInTheDocument();
    expect(screen.getByText("Interface / batch")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("explains a root cause that is not computed yet", async () => {
    vi.spyOn(versionsApi, "getFindingRootCause").mockResolvedValue({
      ...base, status: "not_computed", summary: "", origins: [], field: null,
    });
    renderWithQuery(<RootCauseSection run="v1" ruleId="MMTEST" />);
    expect(await screen.findByText(/not computed for this run yet/i)).toBeInTheDocument();
  });
});
```

In `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/page.test.tsx`, change the vitest import to `import { beforeEach, describe, expect, it, vi } from "vitest";`. Then add this as the first statement inside `describe("RuleDetailPage", () => {`:

```tsx
  beforeEach(() => {
    vi.spyOn(versionsApi, "getFindingRootCause").mockResolvedValue({
      version_id: "v1", check_id: "mm_missing_desc", status: "not_computed", field: null,
      analysed: 0, total: 0, origins: [], summary: "", detail: "",
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix frontend test -- "app/(app)/objects/[object]/rules/[ruleId]"`
Expected: FAIL, because `getFindingRootCause` and `../root-cause` do not exist

- [ ] **Step 3: Add the API wrapper**

In `frontend/lib/api/versions.ts`, add this after `getFindingRecords`:

```ts
/** One origin of a finding's failing values: who set them, through which transaction. */
export interface RootCauseOrigin {
  origin: "interface" | "dialog" | "migration" | "unknown";
  username: string;
  tcode: string;
  records: number;
  /** Percent of the analysed failing records. */
  share: number;
}

/** Root cause by origin of one check's failing records, from SAP change documents. */
export interface FindingRootCause {
  version_id: string;
  check_id: string;
  status: "computed" | "not_applicable" | "unavailable" | "not_computed";
  field: string | null;
  analysed: number;
  total: number;
  origins: RootCauseOrigin[];
  summary: string;
  detail: string;
}

export async function getFindingRootCause(versionId: string, checkId: string): Promise<FindingRootCause> {
  const { data } = await apiClient.get(
    `/api/v1/versions/${versionId}/findings/${encodeURIComponent(checkId)}/root-cause`);
  return data;
}
```

- [ ] **Step 4: Write the section**

Create `frontend/app/(app)/objects/[object]/rules/[ruleId]/root-cause.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Mono, Pill, Skeleton, type PillTone } from "@/design";
import { getFindingRootCause, type RootCauseOrigin } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";

const ORIGIN: Record<RootCauseOrigin["origin"], { label: string; tone: PillTone }> = {
  interface: { label: "Interface / batch", tone: "at-risk" },
  dialog: { label: "Dialog user", tone: "neutral" },
  migration: { label: "Migration load", tone: "no-go" },
  unknown: { label: "No change document", tone: "neutral" },
};

const NOTE: Record<string, string> = {
  not_computed: "Root cause is not computed for this run yet. It runs after the analysis of a live SAP download.",
  not_applicable: "This rule's field has no SAP change documents, so its origin cannot be traced.",
  unavailable: "SAP change documents could not be read for this run.",
};

export function RootCauseSection({ run, ruleId }: { run: string; ruleId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [...queryKeys.rule(ruleId, run), "root-cause"],
    queryFn: () => getFindingRootCause(run, ruleId),
    enabled: !!run,
  });

  const columns = useMemo<ColumnDef<RootCauseOrigin>[]>(
    () => [
      { accessorKey: "origin", header: "Origin",
        cell: ({ row }) => <Pill tone={ORIGIN[row.original.origin].tone}>{ORIGIN[row.original.origin].label}</Pill> },
      { accessorKey: "username", header: "User", cell: ({ row }) => <Mono>{row.original.username || "—"}</Mono> },
      { accessorKey: "tcode", header: "Transaction", cell: ({ row }) => <Mono>{row.original.tcode || "—"}</Mono> },
      { accessorKey: "records", header: "Records" },
      { accessorKey: "share", header: "Share", cell: ({ row }) => `${Math.round(row.original.share)}%` },
    ],
    [],
  );

  if (isLoading) return <Skeleton height={32} />;
  if (isError || !data) return null; // the failing records above stay usable without it

  return (
    <section className="flex flex-col gap-2">
      <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Root cause</p>
      {data.status === "computed" ? (
        <>
          <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{data.summary}</p>
          <DataTable columns={columns} data={data.origins}
            getRowId={(o) => `${o.origin}|${o.username}|${o.tcode}`} />
          {data.analysed < data.total && (
            <p className="text-[12px]" style={{ color: "var(--m-ink-2)" }}>
              Based on {data.analysed} of {data.total} failing records.
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          {NOTE[data.status]}{data.detail ? ` ${data.detail}` : ""}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Mount the section on the drill-down page**

In `frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx`, add the import:

```tsx
import { RootCauseSection } from "./root-cause";
```

In the final `return`, after the `<p …>{data.total} record…</p>` line, add:

```tsx
      <RootCauseSection run={run} ruleId={ruleId} />
```

- [ ] **Step 6: Run the tests and the token lint**

Run: `npm --prefix frontend test -- "app/(app)/objects/[object]/rules/[ruleId]" && npm --prefix frontend run lint:tokens`
Expected: PASS, with no token violations (only `var(--m-…)` tokens and `@/design` components are used)

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/versions.ts "frontend/app/(app)/objects/[object]/rules/[ruleId]/root-cause.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/root-cause.test.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/page.test.tsx"
git commit -m "feat(ui): root cause by origin in the finding drill-down

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Deliberately out of scope

- **Object classes beyond MATERIAL, DEBI and KRED.** Add more to `CLASS_TABLES` once each is verified on a live system.
- **A go-live date picker in the UI.** Set the date through `PUT /api/v1/systems/{id}` with `{"go_live": "YYYY-MM-DD"}`. Add a picker when users ask for one.
- **Root cause from the version's own CDHDR/CDPOS parquet.** The task reads over RFC instead, because the bundle holds only a 3-month window, and only for modules that plan those tables.

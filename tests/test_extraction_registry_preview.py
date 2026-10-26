"""Unverified ("preview") extraction sources: the registry flag, its API exposure and extraction logging.

Seven registry sources have no backing in the repo's dictionaries (canonical/successfactors.yaml, DDIC
files). They stay in the registry, flagged ``status="preview"`` with a one-line reason, are listed with
``preview_sources`` by the module/object APIs, and are never reported as a verified read.
"""

import asyncio
import logging
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest

from sap.extraction_registry import (
    PREVIEW,
    SYSTEM_EXTRACTIONS,
    ExtractionTarget,
    get_extraction_targets,
    preview_sources,
)

EXPECTED = {
    ("successfactors", "payroll_integration", "EmpPayrollRunResults"),
    ("successfactors", "succession_planning", "SuccessionNominee"),
    ("successfactors", "learning_management", "LearningHistoryV1"),
    ("ewms", "grc_compliance", "/api/v1/grc/risks"),
    ("ewms", "fleet_management", "VLCVEHICLE"),
    ("ewms", "transport_management", "/api/v1/tm/freightorders"),
    ("ewms", "mdg_master_data", "MDGMATERIAL"),
}


def test_exactly_the_unverified_sources_are_preview() -> None:
    flagged = {(st, m, t.source) for st, mods in SYSTEM_EXTRACTIONS.items() if st != "ewm"
               for m, ts in mods.items() for t in ts if t.status == PREVIEW}
    assert flagged == EXPECTED


def test_preview_targets_carry_a_one_line_reason_and_are_kept() -> None:
    for st, module, source in EXPECTED:
        target = next(t for t in get_extraction_targets(st, module) if t.source == source)
        assert target.verified is False
        assert target.status_reason and "\n" not in target.status_reason
        assert target.fields  # not deleted or emptied


def test_targets_default_to_verified() -> None:
    t = ExtractionTarget(source="MARA", fields=["MATNR"])
    assert t.status == "verified" and t.verified and t.status_reason == ""
    assert all(t.verified for mods in (SYSTEM_EXTRACTIONS["ecc"], SYSTEM_EXTRACTIONS["btp"])
               for ts in mods.values() for t in ts)


def test_preview_sources_helper() -> None:
    assert {(p["module"], p["source"]) for p in preview_sources("successfactors")} == {
        (m, s) for st, m, s in EXPECTED if st == "successfactors"}
    # sap_systems spells EWM as "ewm"; both keys share the registry
    assert preview_sources("ewm") == preview_sources("ewms")
    assert [p["source"] for p in preview_sources("ewms", "fleet_management")] == ["VLCVEHICLE"]
    assert preview_sources("ewms", "ewms_stock") == []
    assert preview_sources("ecc") == []
    assert preview_sources("unknown") == []


# ── API exposure ──────────────────────────────────────────────────────────────


class _Rows:
    def __init__(self, rows=(), one=None):
        self._rows, self._one = list(rows), one

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._one


class _ModulesDB:
    def __init__(self, system_type: str):
        self.system_type = system_type

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if sql.startswith("SET"):
            return _Rows()
        if "FROM sap_systems" in sql:
            return _Rows(one=(self.system_type,))
        return _Rows()  # system_module_map: nothing synced yet


def test_connectivity_modules_route_exposes_preview_sources() -> None:
    from api.routes.connectivity import list_system_modules

    tenant = SimpleNamespace(id=uuid.uuid4())
    out = asyncio.run(list_system_modules("sys-1", db=_ModulesDB("successfactors"), tenant=tenant))
    by_module = {m["module"]: m for m in out}
    assert by_module["learning_management"]["preview_sources"] == [
        {"source": "LearningHistoryV1", "reason": preview_sources("successfactors", "learning_management")[0]["reason"]}]
    assert by_module["employee_central"]["preview_sources"] == []
    assert all("preview_sources" in m for m in out)


def test_manager_module_listing_exposes_preview_sources(monkeypatch) -> None:
    from api.services.connectivity_manager import ConnectivityManager

    session = MagicMock()
    session.execute.return_value.fetchall.return_value = []
    manager = ConnectivityManager(session, str(uuid.uuid4()))
    monkeypatch.setattr(manager, "_load_system", lambda _sid: SimpleNamespace(system_type="ewm"))
    out = {m["module"]: m for m in manager.get_available_modules_for_system("sys-1")}
    assert [p["source"] for p in out["mdg_master_data"]["preview_sources"]] == ["MDGMATERIAL"]
    assert out["ewms_stock"]["preview_sources"] == []


def test_system_objects_catalogue_exposes_preview_sources(monkeypatch) -> None:
    import api.routes.system_objects as so

    monkeypatch.setattr(so, "_catalogue", lambda *_a: [
        {"object": "payroll_integration", "tables": [], "config_tables": [], "scope_filters": [], "date_window": []},
        {"object": "employee_central", "tables": ["EMPJOB"], "config_tables": [], "scope_filters": [], "date_window": []},
    ])

    class _DB:
        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "FROM sap_systems" in sql:
                return MagicMock(scalar=lambda: "successfactors")
            return MagicMock(fetchall=lambda: [])

    out = asyncio.run(so.list_objects(uuid.uuid4(), db=_DB(), tenant=SimpleNamespace(id=uuid.uuid4())))
    objs = {o["object"]: o for o in out["objects"]}
    assert [p["source"] for p in objs["payroll_integration"]["preview_sources"]] == ["EmpPayrollRunResults"]
    assert objs["employee_central"]["preview_sources"] == []


# ── extraction: logged and reported as preview, never as verified ────────────


def test_extraction_log_reports_preview_sources(caplog) -> None:
    from api.services.connectivity_manager import ConnectivityManager

    with caplog.at_level(logging.WARNING):
        entries = ConnectivityManager._preview_coverage("ewm", ["fleet_management", "ewms_stock", "fleet_management"])
    assert entries == [{
        "table": "VLCVEHICLE", "status": "preview", "entity": "VLCVEHICLE", "module": "fleet_management",
        "detail": "Source name not yet verified against SAP; extraction may fail. "
                  + preview_sources("ewm", "fleet_management")[0]["reason"],
    }]
    assert any("VLCVEHICLE" in r.getMessage() and "not yet verified" in r.getMessage() for r in caplog.records)
    assert ConnectivityManager._preview_coverage("ecc", ["material_master"]) == []


def test_extract_module_warns_before_reading_a_preview_source(monkeypatch, caplog) -> None:
    from api.services.connectivity_manager import ConnectivityManager

    session = MagicMock()
    manager = ConnectivityManager(session, str(uuid.uuid4()))
    monkeypatch.setattr(manager, "_load_system", lambda _sid: SimpleNamespace())
    monkeypatch.setattr(manager, "_build_connection_params", lambda _row: {"system_type": "successfactors"})
    connector = MagicMock()
    monkeypatch.setattr(manager, "_get_connector", lambda *_a: connector)
    reads: list[str] = []

    def fake_read(_conn, _st, target, _max):
        reads.append(target.source)
        raise RuntimeError("404 entity set not found")

    monkeypatch.setattr(manager, "_extract_target", fake_read)
    with caplog.at_level(logging.WARNING):
        df, _cfg = manager.extract_module("sys-1", "learning_management")
    assert reads == ["LearningHistoryV1"]
    assert isinstance(df, pd.DataFrame) and df.empty
    msgs = [r.getMessage() for r in caplog.records]
    assert any(m.startswith("Extracting preview source LearningHistoryV1") for m in msgs)
    assert any("LearningHistoryV1 (preview source" in m for m in msgs)


def test_pdf_extraction_issues_name_preview_sources() -> None:
    from api.services.pdf_reports import _extraction_issues

    issues = _extraction_issues([{"table": "VLCVEHICLE", "status": "preview", "detail": "x"}])
    assert issues == [{"level": "Warning", "table": "VLCVEHICLE",
                       "text": "Preview source: name not yet verified against SAP; extraction may fail."}]


@pytest.mark.parametrize("st", ["successfactors", "ewms"])
def test_preview_does_not_change_the_module_list(st) -> None:
    from sap.extraction_registry import get_available_modules

    assert {m for _s, m, _src in EXPECTED if _s == st} <= set(get_available_modules(st))

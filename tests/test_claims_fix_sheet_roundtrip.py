"""Claim: a steward downloads the fix sheet, fills New value / Decision, uploads it, and the decisions land.

Builds the real workbook with the export's own column spec, fills it with openpyxl, and feeds it to the real
importer (database calls faked), so a header rename on either side fails here.
"""
from __future__ import annotations

import asyncio
import io
import uuid
from typing import Any

import pytest
from fastapi import HTTPException
from openpyxl import Workbook, load_workbook

from api.deps import Tenant
from api.routes import work
from api.services.branded_xlsx import SheetSpec, build_workbook

RUN = str(uuid.uuid4())
ROWS = [
    {"module": "material_master", "record_key": "MATNR=000000000000000001", "check_id": "MARA_001", "field": "MARA.MTART",
     "current_value": "ZZZZ", "suggested_value": "FERT", "valid_values": None, "rule_module": "material_master",
     "name": "Pump", "message": "Bad type", "severity": "high"},
    {"module": "material_master", "record_key": "MATNR=000000000000000002", "check_id": "MARA_002", "field": "MARA.MATKL",
     "current_value": "", "suggested_value": "100", "valid_values": None, "rule_module": "material_master",
     "name": "Valve", "message": "Missing group", "severity": "low"},
    {"module": "material_master", "record_key": "MATNR=000000000000000003", "check_id": "MARA_003", "field": "MARA.MEINS",
     "current_value": "X", "suggested_value": "EA", "valid_values": None, "rule_module": "material_master",
     "name": "Gasket", "message": "Unit", "severity": "low"},
]


def _export() -> bytes:
    cols, rows = work._readable([dict(r) for r in ROWS])
    return build_workbook(tenant_name="T", run_label=None, run_id=RUN, title="Records to fix",
                          sheets=[SheetSpec(title="Fix list", rows=rows, columns=cols)])


def _fill(data: bytes, fills: dict[str, dict[str, str]]) -> bytes:
    wb = load_workbook(io.BytesIO(data))
    ws = wb["Fix list"]
    hdr = next(r for r in ws.iter_rows(min_row=1, max_row=12) if "New value" in [c.value for c in r])
    idx = {c.value: c.column for c in hdr}
    for r in range(hdr[0].row + 1, ws.max_row + 1):
        chk = ws.cell(r, idx["Check"]).value if "Check" in idx else None
        for k, v in fills.get(chk, {}).items():
            ws.cell(r, idx[k]).value = v
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


class _Form(dict):
    pass


class _Up:
    def __init__(self, b: bytes) -> None:
        self.b = b

    async def read(self) -> bytes:
        return self.b


class _Req:
    def __init__(self, b: bytes | None) -> None:
        self.b = b

    async def form(self) -> dict[str, Any]:
        return {} if self.b is None else {"file": _Up(self.b)}


class _Res:
    def fetchall(self):
        return [("material_master", r["record_key"], r["check_id"]) for r in ROWS[:2]]  # row 3 no longer fails


class _DB:
    committed = False

    async def execute(self, *a: Any, **k: Any) -> _Res:
        return _Res()

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:  # pragma: no cover
        pass


@pytest.fixture
def applied(monkeypatch):
    got: list[Any] = []

    class _Sel:
        def version_of(self, _m: str) -> str:
            return RUN

    async def _noop(*_a: Any, **_k: Any) -> None:
        return None

    async def _rows(*_a: Any, **_k: Any) -> _Sel:
        return _Sel()

    async def _apply(body, *_a: Any, **_k: Any) -> dict[str, Any]:
        got.extend(body.items)
        return {"updated": len(body.items), "draft_batch_id": None}

    async def _mails(*_a: Any, **_k: Any) -> list:
        return []

    monkeypatch.setattr(work, "_rls", _noop)
    monkeypatch.setattr(work, "_rows", _rows)
    monkeypatch.setattr(work, "_apply_decisions", _apply)
    monkeypatch.setattr(work, "_tell_owners", _mails)
    monkeypatch.setattr(work, "_dispatch", lambda _m: None)
    return got


def _run(b: bytes | None, db: _DB | None = None) -> dict[str, Any]:
    return asyncio.run(work.import_sheet(_Req(b), None, "run", db or _DB(), Tenant(uuid.uuid4(), "T", []), "admin"))  # type: ignore[arg-type]


def test_export_then_import_round_trips_edits_and_signoffs(applied):
    data = _fill(_export(), {
        "MARA_001": {"New value": "FERT"},
        "MARA_002": {"Decision": "accept risk", "Reason": "legacy"},
        "MARA_003": {"Decision": "fix"},
    })
    out = _run(data)
    assert out["updated"] == 2 and out["rows"] == 2
    by = {i.check_id: i for i in applied}
    assert by["MARA_001"].action == "edit" and by["MARA_001"].value == "FERT"
    assert by["MARA_002"].action == "accept_risk" and by["MARA_002"].note == "legacy"
    assert any("MARA_003" in s and "does not fail" in s for s in out["skipped"])


def test_untouched_export_imports_nothing(applied):
    assert _run(_export())["updated"] == 0 and not applied


def test_signoff_without_reason_is_skipped_not_applied(applied):
    out = _run(_fill(_export(), {"MARA_001": {"Decision": "not an issue"}}))
    assert out["updated"] == 0 and "needs a reason" in out["skipped"][0]


@pytest.mark.parametrize("blob,code", [(None, 400), (b"not a zip", 422)])
def test_bad_uploads_are_refused_with_a_reason(applied, blob, code):
    with pytest.raises(HTTPException) as e:
        _run(blob)
    assert e.value.status_code == code


def test_a_workbook_without_the_fix_columns_says_how_to_get_one(applied):
    wb = Workbook()
    wb.active.append(["a", "b"])
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(HTTPException) as e:
        _run(buf.getvalue())
    assert e.value.status_code == 422 and "export one from Meridian" in e.value.detail

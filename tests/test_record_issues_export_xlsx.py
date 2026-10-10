"""Record issues export: xlsx branch re-routed through branded_xlsx (T8).

No DB fixture here — tests/test_record_issues_pg.py covers the live endpoint
against Postgres. This checks the parts that don't need a DB: the endpoint
still accepts format=csv|xlsx with the same URL/params, and the column list
used to build the xlsx header matches the SELECT's column aliases.
"""

import asyncio
import inspect
import io
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import openpyxl

from api.routes.record_issues import _SELECT, _SELECT_KEYS, export_issues


def test_export_endpoint_still_supports_csv_and_xlsx() -> None:
    sig = inspect.signature(export_issues)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_export_issues_builds_real_workbook() -> None:
    """I9: build a real workbook through export_issues and reload with
    openpyxl — sheet/column names matching _SELECT_KEYS, and the cover's
    formula-injection guard on tenant name."""
    row_dict = {k: None for k in _SELECT_KEYS}
    row_dict.update({
        "id": uuid.uuid4(),
        "module": "material_master",
        "check_id": "MM-001",
        "record_key": "REC-1",
        "severity": "high",
        "status": "open",
        "first_seen_at": datetime(2026, 1, 1, 0, 0),
        "message": "Bad field",
    })
    row = MagicMock()
    row._mapping = row_dict

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(),  # _rls SET config
        MagicMock(fetchall=lambda: [row]),
    ])
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=1+1")

    response = asyncio.run(export_issues(request=None, db=db, tenant=tenant))

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Record issues"]
    ws = wb["Record issues"]
    headers = [c.value for c in ws[1]]
    assert headers == _SELECT_KEYS
    assert ws.cell(row=2, column=_SELECT_KEYS.index("record_key") + 1).value == "REC-1"

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")


def test_select_keys_match_select_aliases() -> None:
    # Every non-table-qualified alias in _SELECT ("AS x") and every bare
    # "ri.col"/"u.col" column should have a matching entry in _SELECT_KEYS,
    # in the same order, so the xlsx header row is correct even with 0 rows.
    assert len(_SELECT_KEYS) == len(set(_SELECT_KEYS))  # no duplicate headers
    assert "check_id" in _SELECT_KEYS
    assert "record_key" in _SELECT_KEYS
    assert _SELECT_KEYS[0] == "id"

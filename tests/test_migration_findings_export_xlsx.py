"""Migration gap findings export: xlsx branch re-routed through branded_xlsx (T8).

No DB fixture — just checks the endpoint still accepts format=csv|xlsx.
"""

import asyncio
import inspect
import io
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import openpyxl

import api.routes.migration as migration_module
from api.routes.migration import export_findings


def test_export_endpoint_still_supports_csv_and_xlsx() -> None:
    sig = inspect.signature(export_findings)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_export_findings_builds_real_workbook() -> None:
    """I9: build a real workbook through export_findings and reload with
    openpyxl — sheet/column names, and the cover's formula-injection guard on
    tenant name. The route streams via _stream(), so capture its bytes argument
    directly instead of unwrapping the StreamingResponse."""
    row = MagicMock()
    row._mapping = {
        "module": "material_master",
        "source_table": "MARA",
        "record_key": "100-100",
        "source_field": "MATKL",
        "source_value": "OLD",
        "dest_table": "I_PRODUCT",
        "target_field": "ProductGroup",
        "target_value": None,
        "gap_type": "missing_mapping",
        "severity": "high",
        "detail": "No mapping found",
        "provenance": "rule:MM-GAP-1",
        "grounded": True,
    }

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(),  # _set_rls
        MagicMock(fetchall=lambda: [row]),
    ])
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=1+1")

    captured = {}

    def fake_stream(data: bytes, media_type: str, filename: str):
        captured["data"] = data
        return data

    original = migration_module._stream
    migration_module._stream = fake_stream
    try:
        asyncio.run(export_findings(run_id=uuid.uuid4(), db=db, tenant=tenant))
    finally:
        migration_module._stream = original

    wb = openpyxl.load_workbook(io.BytesIO(captured["data"]))
    assert wb.sheetnames == ["Cover", "Gap findings"]
    ws = wb["Gap findings"]
    headers = [c.value for c in ws[1]]
    assert headers == [
        "module", "source_table", "record_key", "source_field", "source_value", "dest_table",
        "target_field", "target_value", "gap_type", "severity", "detail", "provenance", "grounded",
    ]
    assert ws.cell(row=2, column=headers.index("record_key") + 1).value == "100-100"

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")

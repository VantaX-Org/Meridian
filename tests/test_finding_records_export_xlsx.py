"""Finding records export (T9): /versions/{version_id}/findings/{check_id}/records/export.

No DB fixture — checks the endpoint signature only.
"""

import asyncio
import inspect
import io
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import openpyxl

from api.routes.versions import export_finding_records


def test_export_finding_records_signature() -> None:
    sig = inspect.signature(export_finding_records)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"
    assert "version_id" in sig.parameters
    assert "check_id" in sig.parameters


def test_export_finding_records_builds_real_workbook() -> None:
    """I9: build a real workbook through export_finding_records and reload with
    openpyxl — dynamic field-value columns, sheet name, and the cover's
    formula-injection guard on tenant name."""
    version_id = uuid.uuid4()
    record = SimpleNamespace(
        record_key="REC-1",
        grain="header",
        module="material_master",
        field_values={"MATNR": "100-100", "WERKS": "1000"},
    )

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(),  # SET config
        MagicMock(fetchone=lambda: ("S1",)),  # _scope_of
        MagicMock(fetchall=lambda: [record]),  # main select
    ])
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=1+1")

    response = asyncio.run(
        export_finding_records(version_id=version_id, check_id="MM-001", db=db, tenant=tenant)
    )

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Records"]
    ws = wb["Records"]
    headers = [c.value for c in ws[1]]
    assert headers == ["Record key", "Grain", "Module", "MATNR", "WERKS"]
    assert ws.cell(row=2, column=headers.index("MATNR") + 1).value == "100-100"

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")

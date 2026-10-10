"""Objects export endpoints (T9): /objects/export, /objects/{module}/export.

No DB fixture — checks signatures and route ordering (export must not be
shadowed by the /{module} catch-all route).
"""

import asyncio
import inspect
import io
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import openpyxl

import api.routes.objects as objects_module
from api.routes.objects import export_object, export_objects, router


def test_export_objects_signature() -> None:
    sig = inspect.signature(export_objects)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_export_objects_builds_real_workbook() -> None:
    """I9: build a real workbook through export_objects and reload with openpyxl —
    sheet/column names, the money-formatted composite score, and the cover's
    formula-injection guard on tenant name."""
    async def fake_list_objects(**kwargs):
        return {
            "run_id": "run-1",
            "objects": [{
                "module": "material_master",
                "label": "Material master",
                "composite_score": 72.5,
                "readiness": "fail",
                "failing_checks": 3,
                "affected_records": 120,
            }],
        }

    db = AsyncMock()
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=EVIL()")

    original = objects_module.list_objects
    objects_module.list_objects = fake_list_objects
    try:
        response = asyncio.run(export_objects(run="run-1", db=db, tenant=tenant))
    finally:
        objects_module.list_objects = original

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Objects"]
    ws = wb["Objects"]
    headers = [c.value for c in ws[1]]
    assert headers == ["Module", "Label", "Composite score", "Readiness", "Failing checks", "Affected records"]
    assert ws.cell(row=2, column=headers.index("Composite score") + 1).value == 72.5

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")


def test_export_object_signature() -> None:
    sig = inspect.signature(export_object)
    assert "format" in sig.parameters
    assert "module" in sig.parameters


def test_export_route_declared_before_module_catchall() -> None:
    paths = [r.path for r in router.routes]
    assert paths.index("/api/v1/objects/export") < paths.index("/api/v1/objects/{module}")

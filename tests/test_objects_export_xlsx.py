"""Objects export endpoints (T9): /objects/export, /objects/{module}/export.

No DB fixture — checks signatures and route ordering (export must not be
shadowed by the /{module} catch-all route).
"""

import inspect

from api.routes.objects import export_object, export_objects, router


def test_export_objects_signature() -> None:
    sig = inspect.signature(export_objects)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_export_object_signature() -> None:
    sig = inspect.signature(export_object)
    assert "format" in sig.parameters
    assert "module" in sig.parameters


def test_export_route_declared_before_module_catchall() -> None:
    paths = [r.path for r in router.routes]
    assert paths.index("/api/v1/objects/export") < paths.index("/api/v1/objects/{module}")

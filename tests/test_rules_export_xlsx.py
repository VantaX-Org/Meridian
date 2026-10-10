"""Rules export endpoints (T10): /rules/export, /rules/{rule_id}/history/export.

No DB fixture — checks signatures and route ordering (export must not be
shadowed by the /{rule_id} catch-all route).
"""

import inspect

from api.routes.rules import export_rule_history, export_rules, router


def test_export_rules_signature() -> None:
    sig = inspect.signature(export_rules)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"
    for name in ("category", "module", "severity", "enabled", "search", "source"):
        assert name in sig.parameters


def test_export_rule_history_signature() -> None:
    sig = inspect.signature(export_rule_history)
    assert "format" in sig.parameters
    assert "rule_id" in sig.parameters


def test_export_route_declared_before_rule_id_catchall() -> None:
    paths = [r.path for r in router.routes]
    assert paths.index("/api/v1/rules/export") < paths.index("/api/v1/rules/{rule_id}")

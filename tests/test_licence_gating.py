"""Tests for licence feature gating.

FEATURE_ROUTE_MAP only gates routes on feature keys that actually exist in
TenantFeatures (the licence-worker/admin-portal schema): export_reports and
run_sync. MDM/cleaning/exceptions/analytics/contracts/notifications/ai_features
were previously mapped to feature keys no tenant could ever have set true —
every customer 402'd on those routes permanently. They're no longer gated
here; enabled_modules/enabled_menu_items (frontend) and RBAC (per-endpoint
require_permission + tenant isolation) protect them instead.
"""

import pytest

from api.middleware.licence import FEATURE_ROUTE_MAP, _check_feature_gate


# ── FEATURE_ROUTE_MAP completeness ───────────────────────────────────────────


def test_feature_route_map_only_has_real_feature_keys():
    """Every mapped feature key must be a real TenantFeatures field."""
    real_feature_keys = {"export_reports", "run_sync"}
    for route, feature in FEATURE_ROUTE_MAP.items():
        assert feature in real_feature_keys, (
            f"{route} maps to '{feature}', which isn't a real TenantFeatures "
            f"key — no tenant could ever satisfy this gate"
        )


def test_feature_route_map_existing_routes_unchanged():
    """The only legitimate feature-gated routes."""
    expected = {
        "/api/v1/cleaning/export": "export_reports",
        "/api/v1/reports": "export_reports",
        "/api/v1/sync-trigger": "run_sync",
    }
    assert FEATURE_ROUTE_MAP == expected


def test_feature_route_map_has_no_phantom_keys():
    """mdm/cleaning/exceptions/analytics/contracts/notifications/ai_features
    must never come back — no tenant record can ever satisfy them."""
    phantom_routes = [
        "/api/v1/systems",
        "/api/v1/sync",
        "/api/v1/master-records",
        "/api/v1/stewardship",
        "/api/v1/glossary",
        "/api/v1/relationships",
        "/api/v1/match-rules",
        "/api/v1/mdm-metrics",
        "/api/v1/ai",
        "/api/v1/cleaning",
        "/api/v1/exceptions",
        "/api/v1/analytics",
        "/api/v1/contracts",
        "/api/v1/notifications",
    ]
    for route in phantom_routes:
        assert route not in FEATURE_ROUTE_MAP, f"{route} should not be feature-gated"


# ── _check_feature_gate unit tests ──────────────────────────────────────────


def test_mdm_routes_never_blocked_by_feature_gate():
    """MDM routes aren't feature-gated — RBAC/enabled_modules handle them."""
    for route in ["/api/v1/master-records", "/api/v1/systems/1", "/api/v1/stewardship/queue"]:
        assert _check_feature_gate(route, ["cleaning"]) is None
        assert _check_feature_gate(route, []) is None


def test_ai_routes_never_blocked_by_feature_gate():
    assert _check_feature_gate("/api/v1/ai/feedback", ["mdm"]) is None
    assert _check_feature_gate("/api/v1/ai/feedback", []) is None


def test_export_route_blocked_without_export_reports_feature():
    """Licence without 'export_reports' — /reports and /cleaning/export 402."""
    for route in ["/api/v1/reports", "/api/v1/cleaning/export"]:
        result = _check_feature_gate(route, ["run_sync"])
        assert result is not None
        assert result.status_code == 402
        body = result.body.decode()
        assert '"feature": "export_reports"' in body or '"feature":"export_reports"' in body


def test_export_route_allowed_with_export_reports_feature():
    result = _check_feature_gate("/api/v1/reports", ["export_reports"])
    assert result is None


def test_sync_trigger_blocked_without_run_sync_feature():
    result = _check_feature_gate("/api/v1/sync-trigger", ["export_reports"])
    assert result is not None
    assert result.status_code == 402


def test_sync_trigger_allowed_with_run_sync_feature():
    result = _check_feature_gate("/api/v1/sync-trigger", ["run_sync"])
    assert result is None


def test_wildcard_bypasses_all_gates():
    """licensed_features=['*'] — all routes accessible (dev mode)."""
    assert _check_feature_gate("/api/v1/master-records", ["*"]) is None
    assert _check_feature_gate("/api/v1/ai/feedback", ["*"]) is None
    assert _check_feature_gate("/api/v1/reports", ["*"]) is None


def test_all_mdm_subroutes_not_blocked():
    """Subroutes of former MDM paths must not be feature-gated either."""
    subroutes = [
        "/api/v1/systems/1",
        "/api/v1/sync/start",
        "/api/v1/master-records/abc",
        "/api/v1/glossary/terms",
        "/api/v1/relationships/graph",
        "/api/v1/match-rules/test",
        "/api/v1/mdm-metrics/latest",
    ]
    for route in subroutes:
        assert _check_feature_gate(route, ["cleaning"]) is None, f"{route} should not be blocked"


def test_unregistered_route_not_blocked():
    """Routes not in FEATURE_ROUTE_MAP should pass through."""
    result = _check_feature_gate("/api/v1/health", ["cleaning"])
    assert result is None

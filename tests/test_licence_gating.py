"""Tests for licence feature gating — MDM and AI routes."""

import pytest

from api.middleware.licence import FEATURE_ROUTE_MAP, _check_feature_gate


# ── FEATURE_ROUTE_MAP completeness ───────────────────────────────────────────


def test_feature_route_map_has_mdm_routes():
    """All Phase H-O MDM routes must be mapped to 'mdm' feature."""
    mdm_routes = [
        "/api/v1/systems",
        "/api/v1/sync",
        "/api/v1/master-records",
        "/api/v1/stewardship",
        "/api/v1/glossary",
        "/api/v1/relationships",
        "/api/v1/match-rules",
        "/api/v1/mdm-metrics",
    ]
    for route in mdm_routes:
        assert route in FEATURE_ROUTE_MAP, f"{route} missing from FEATURE_ROUTE_MAP"
        assert FEATURE_ROUTE_MAP[route] == "mdm"


def test_feature_route_map_has_ai_route():
    assert "/api/v1/ai" in FEATURE_ROUTE_MAP
    assert FEATURE_ROUTE_MAP["/api/v1/ai"] == "ai_features"


def test_feature_route_map_existing_routes_unchanged():
    """Original A-G routes must still be present and correct."""
    expected = {
        "/api/v1/cleaning": "cleaning",
        "/api/v1/exceptions": "exceptions",
        "/api/v1/analytics": "analytics",
        "/api/v1/nlp": "nlp",
        "/api/v1/contracts": "contracts",
        "/api/v1/notifications": "notifications",
    }
    for route, feature in expected.items():
        assert FEATURE_ROUTE_MAP.get(route) == feature


# ── _check_feature_gate unit tests ──────────────────────────────────────────


def test_mdm_route_blocked_without_mdm_feature():
    """Licence with ['cleaning'] only — MDM routes return 402."""
    result = _check_feature_gate("/api/v1/master-records", ["cleaning"])
    assert result is not None
    assert result.status_code == 402
    body = result.body.decode()
    assert '"feature": "mdm"' in body or '"feature":"mdm"' in body


def test_mdm_route_allowed_with_mdm_feature():
    """Licence with ['mdm'] — GET /master-records not blocked."""
    result = _check_feature_gate("/api/v1/master-records", ["mdm"])
    assert result is None


def test_ai_route_blocked_with_mdm_only():
    """Licence with ['mdm'] only — AI routes return 402."""
    result = _check_feature_gate("/api/v1/ai/feedback", ["mdm"])
    assert result is not None
    assert result.status_code == 402
    body = result.body.decode()
    assert '"feature": "ai_features"' in body or '"feature":"ai_features"' in body


def test_ai_route_allowed_with_ai_features():
    """Enterprise licence with ['mdm','ai_features'] — AI routes not blocked."""
    result = _check_feature_gate("/api/v1/ai/feedback", ["mdm", "ai_features"])
    assert result is None


def test_wildcard_bypasses_all_gates():
    """licensed_features=['*'] — all routes accessible (dev mode)."""
    assert _check_feature_gate("/api/v1/master-records", ["*"]) is None
    assert _check_feature_gate("/api/v1/ai/feedback", ["*"]) is None
    assert _check_feature_gate("/api/v1/cleaning", ["*"]) is None


def test_stewardship_route_requires_mdm():
    result = _check_feature_gate("/api/v1/stewardship/queue", ["cleaning", "exceptions"])
    assert result is not None
    assert result.status_code == 402


def test_all_mdm_subroutes_gated():
    """Subroutes of MDM paths must also be gated."""
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
        result = _check_feature_gate(route, ["cleaning"])
        assert result is not None, f"{route} was not blocked"
        assert result.status_code == 402


def test_unregistered_route_not_blocked():
    """Routes not in FEATURE_ROUTE_MAP should pass through."""
    result = _check_feature_gate("/api/v1/health", ["cleaning"])
    assert result is None

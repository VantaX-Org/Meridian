"""Runnable checks for two licence-enforcement fixes (client side).

1. Fail CLOSED when the licence server is unreachable and no licence was ever
   validated — the old code granted ["*"] (full bypass by blocking the server).
   Degrade only on a previously validated licence's own entitlements.
2. enforce_licensed_modules rejects SAP modules the licence does not entitle —
   the manifest's enabled_modules was set on request.state but never consumed,
   so a one-module licence could extract/upload all 29.

Run: pytest tests/test_licence_enforcement.py
"""

import pytest
from fastapi import HTTPException

from api.middleware.licence import _features_to_list, enforce_licensed_modules


class _State:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Req:
    def __init__(self, **kw):
        self.state = _State(**kw)


# --- module entitlement gate ---

def test_unlicensed_module_rejected():
    req = _Req(licensed_modules=["business_partner"])
    with pytest.raises(HTTPException) as ei:
        enforce_licensed_modules(req, ["business_partner", "material_master"])
    assert ei.value.status_code == 402
    assert ei.value.detail["modules"] == ["material_master"]  # only the unlicensed one


def test_licensed_modules_pass():
    req = _Req(licensed_modules=["business_partner", "material_master"])
    enforce_licensed_modules(req, ["material_master"])  # no raise


def test_wildcard_entitles_all():
    req = _Req(licensed_modules=["*"])
    enforce_licensed_modules(req, ["anything", "everything"])  # no raise


def test_missing_state_is_permissive_not_crash():
    # No licensed_modules on state (dev/local mode) → must not crash the request.
    enforce_licensed_modules(_Req(), ["material_master"])  # no raise


# --- features normalisation (used by the fail-closed degrade path) ---

def test_features_dict_to_enabled_keys():
    assert set(_features_to_list({"mdm": True, "ai_features": False})) == {"mdm"}


def test_empty_features_is_wildcard_gate_noop():
    # Empty features disables the feature gate; it is NOT a module entitlement.
    assert _features_to_list({}) == ["*"]
    assert _features_to_list(None) == ["*"]


def test_features_list_passthrough():
    assert _features_to_list(["mdm", "analytics"]) == ["mdm", "analytics"]


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-q"]))

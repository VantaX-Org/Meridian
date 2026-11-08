"""Role rights settled by the owner on 2026-11-08, and the licence check on analysis.

Programme leads manage the rule set of their programme; a data owner who rejects a cleansing proposal records the
reason (ai_feedback). A default re-analysis of a version that holds unlicensed modules checks only the licensed ones,
and a version with no licensed module is refused with 402."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.routes.versions import _licensed_options
from api.services.rbac import PERSONA_ROLES


def test_programme_lead_manages_rules() -> None:
    assert "manage_rules" in PERSONA_ROLES["programme_lead"]


def test_data_owner_records_reject_reasons_but_cannot_apply() -> None:
    owner = PERSONA_ROLES["data_owner"]
    assert "ai_feedback" in owner
    assert "approve" in owner
    assert "apply" not in owner


def _req(licensed):
    return SimpleNamespace(state=SimpleNamespace(licensed_modules=licensed))


def test_default_run_keeps_only_licensed_modules() -> None:
    out = _licensed_options(_req(["material_master"]), None, ["material_master", "sd_customer_master"])
    assert out == {"modules": ["material_master"]}


def test_default_run_unchanged_when_all_licensed_or_no_licence() -> None:
    assert _licensed_options(_req(["*"]), None, ["material_master"]) is None
    assert _licensed_options(_req(None), None, ["material_master"]) is None
    assert _licensed_options(_req(["material_master"]), None, ["material_master"]) is None


def test_version_with_no_licensed_module_is_refused() -> None:
    with pytest.raises(HTTPException) as e:
        _licensed_options(_req(["material_master"]), None, ["sd_customer_master"])
    assert e.value.status_code == 402


def test_named_unlicensed_module_is_refused() -> None:
    with pytest.raises(HTTPException) as e:
        _licensed_options(_req(["material_master"]), {"modules": ["sd_customer_master"]}, ["sd_customer_master"])
    assert e.value.status_code == 402

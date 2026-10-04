"""Rule studio: draft validation, expression whitelist, DDIC check and dry-run evaluation."""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest
from fastapi import HTTPException

from api.routes.rules import (CustomRuleIn, VersionCreate, _build_rule, create_version, _missing_fields, _safe_expression, evaluate_rule)
from checks.frames import TableFrames
from sap.ddic import get_dictionary


def draft(**kw) -> CustomRuleIn:
    return CustomRuleIn(**{"module": "accounts_payable", "message": "Vendor country is required", **kw})


def test_expression_whitelist():
    assert _safe_expression("`LFA1.LAND1` == 'ZA' & `LFA1.STCD1`.isna()")
    assert _safe_expression("(`EKPO.MENGE` <= 0) | ~`EKPO.NETPR`.notna()")
    assert not _safe_expression("`LFA1.LAND1`.str.len() > 2")
    assert not _safe_expression("__import__('os').system('id')")
    assert not _safe_expression("1 == 1")  # must read a column


def test_build_rule_requires_type_params_and_is_deterministic():
    with pytest.raises(HTTPException) as e:
        _build_rule(draft(check_class="regex_check", field="LFA1.STCD1"))
    assert "pattern" in e.value.detail
    with pytest.raises(HTTPException):
        _build_rule(draft(check_class="regex_check", field="LFA1.STCD1", pattern="("))
    with pytest.raises(HTTPException):
        _build_rule(draft(check_class="null_check", field="LFA1.LAND1", module="no_such_module"))
    a = _build_rule(draft(check_class="null_check", field="LFA1.LAND1", pattern="ignored"))
    assert a == _build_rule(draft(check_class="null_check", field="LFA1.LAND1"))
    assert a["id"].startswith("CR-") and a["dimension"] == "completeness" and "pattern" not in a


def test_fields_checked_against_ddic():
    d = [get_dictionary("ecc6")]
    assert _missing_fields(_build_rule(draft(check_class="null_check", field="LFA1.LAND1")), d) == []
    assert _missing_fields(_build_rule(draft(check_class="null_check", field="LFA1.NOPE")), d) == ["LFA1.NOPE"]


def test_dry_run_counts_failing_records():
    d = get_dictionary("ecc6")
    df = pd.DataFrame({"LFA1.LIFNR": ["1", "2", "3"], "LFA1.LAND1": ["ZA", None, "DE"]})
    out = evaluate_rule(_build_rule(draft(check_class="null_check", field="LFA1.LAND1")), TableFrames.from_flat(df, d))
    assert (out["population"], out["failing"], out["sample_keys"]) == (3, 1, ["LIFNR=0000000002"])


def _post_version(body: dict):
    db = AsyncMock()
    db.execute.return_value = MagicMock(mappings=lambda: MagicMock(one=lambda: {"version": 1, "body": body}))
    out = asyncio.run(create_version("CR-TEST0001", VersionCreate(body=body), db=db,
                                     tenant=SimpleNamespace(id=uuid.uuid4())))
    return out, db


def test_version_rejects_unsafe_expression():
    base = {"module": "accounts_payable", "check_class": "cross_field_check", "field": "LFA1.LAND1",
            "severity": "high", "message": "m"}
    for key in ("fail_when", "condition"):
        with pytest.raises(HTTPException) as e:
            _post_version({**base, key: "__import__('os').system('id')"})
        assert e.value.status_code == 422 and "Expression may use only" in e.value.detail
    with pytest.raises(HTTPException) as e:
        _post_version({**base, "fail_when": ["`LFA1.LAND1` == 'ZA'"]})
    assert e.value.status_code == 422


def test_version_accepts_safe_expression():
    body = {"module": "accounts_payable", "check_class": "cross_field_check", "field": "LFA1.LAND1",
            "severity": "high", "message": "m", "fail_when": "`LFA1.LAND1` == 'ZA' & `LFA1.STCD1`.isna()"}
    out, db = _post_version(body)
    assert out["body"] == body and db.commit.await_count == 1

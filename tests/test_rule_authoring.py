"""AI rule authoring: no row values in the prompt, YAML validation, masked dry run."""

import pandas as pd
import pytest

import llm.provider
from api.services import rule_authoring as ra
from api.utils import llm_logger
from checks.frames import TableFrames
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
SECRET = "ROWVALUE_7731"


def test_prompt_carries_no_row_values(monkeypatch):
    profiles = {"LFA1.LAND1": {
        "rows": 10, "blank": 1, "distinct": 3, "max_length": 2, "shapes": [{"shape": "AA", "count": 9}],
        "top_values": [{"value": SECRET, "count": 5}],
        "numeric": {"min": SECRET, "max": SECRET, "mean": 1.5, "non_numeric": 10},
        "dates": {"min": SECRET, "max": SECRET, "invalid": 0},
    }}
    seen = {}
    monkeypatch.setattr(llm.provider, "get_llm", lambda: object())
    monkeypatch.setattr(llm.provider, "safe_invoke",
                        lambda _llm, prompt, **kw: seen.setdefault("p", prompt) and "```yaml\nid: X1\n```")
    monkeypatch.setattr(llm_logger, "log_llm_call", lambda *a, **k: None)
    ctx = ra.prompt_context("accounts_payable", profiles, D)
    assert ra.generate("t", "Country must be filled", ctx) == "id: X1"
    assert SECRET not in seen["p"] and "LFA1.LAND1" in seen["p"] and "non_numeric" in seen["p"]

    ctx["fields"][0]["profile"]["top_values"] = [SECRET]  # guard rejects anything off the whitelist
    with pytest.raises(ValueError):
        ra.build_prompt("x", ctx)


def test_validate_rule_yaml():
    ok = "id: AP_NEW1\nfield: LFA1.LAND1\ncheck_class: null_check\nseverity: high\n" \
         "dimension: completeness\nmessage: Country is mandatory\n"
    rule, errors = ra.validate_rule_yaml(f"```\n{ok}```".strip("`\n"), "accounts_payable", D)
    assert errors == [] and rule["id"] == "AP_NEW1"
    _, errors = ra.validate_rule_yaml(ok.replace("LAND1", "NOPE9").replace("high", "urgent"), "accounts_payable", D)
    assert "unknown field LFA1.NOPE9" in errors and any("severity" in e for e in errors)
    _, errors = ra.validate_rule_yaml(ok.replace("AP_NEW1", "AP001"), "accounts_payable", D)
    assert errors == ["id AP001 already exists in accounts_payable"]
    assert ra.validate_rule_yaml(": [", "accounts_payable", D)[1][0].startswith("not valid YAML")


def test_dry_run_masks_sensitive_values():
    df = pd.DataFrame({"LFA1.LIFNR": ["1", "2", "3"], "LFA1.NAME1": ["ACME", "jane doe", "ok co"]})
    frames = TableFrames({"LFA1": df}, D)
    rule = {"id": "AP_N", "field": "LFA1.NAME1", "check_class": "regex_check", "pattern": "^[A-Z ]+$",
            "severity": "low", "dimension": "validity", "message": "upper case"}
    out = ra.dry_run(rule, frames)
    assert (out["hits"], out["population"]) == (2, 3)
    assert {r["LFA1.NAME1"] for r in out["sample"]} == {"***"}
    assert {r["LFA1.LIFNR"] for r in out["sample"]} == {"2", "3"}

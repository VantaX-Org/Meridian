"""Remediation batches: proposed values, current-value lookup, export layouts."""

import pandas as pd

from api.services import remediation
from checks.fix_generator import proposed_value
from checks.frames import TableFrames
from sap.ddic import get_dictionary


def test_proposed_value_sources():
    assert proposed_value({}, "X") is None  # no fix logic: manual
    assert proposed_value({"fix_value": "KG"}, "") == "KG"
    m = {"fix_value": {"KGS": "KG", "__blank__": "EA", "__other__": "ST"}}
    assert proposed_value(m, "KGS") == "KG"
    assert proposed_value(m, "  ") == "EA"
    assert proposed_value(m, None) == "EA"
    assert proposed_value(m, "LB") == "ST"
    assert proposed_value({"fix_value": {"A": "B"}}, "C") is None


def _frames():
    df = pd.DataFrame({"LFA1.LIFNR": ["0000100001", "0000100002"], "LFA1.LAND1": ["ZZ", None]})
    return TableFrames({"LFA1": df}, get_dictionary("s4hana"))


def test_build_items_reads_current_and_rule_fix(monkeypatch):
    monkeypatch.setattr(remediation, "module_rules",
                        lambda m: {"AP_T": {"id": "AP_T", "fix_value": {"__blank__": "DE"}}})
    issues = [{"issue_id": "i1", "scope": "upload", "module": "accounts_payable", "check_id": "AP_T",
               "record_key": "LIFNR=0000100002", "grain": "LFA1", "field": "LFA1.LAND1"},
              {"issue_id": "i2", "scope": "upload", "module": "accounts_payable", "check_id": "AP_T",
               "record_key": "LIFNR=0000100001", "grain": "LFA1", "field": "LFA1.LAND1"}]
    a, b = remediation.build_items(issues, _frames())
    assert (a["current_value"], a["proposed_value"], a["proposal_source"]) == (None, "DE", "rule")
    assert (b["current_value"], b["proposed_value"], b["proposal_source"]) == ("ZZ", None, "manual")


def test_exports_skip_blank_proposals():
    items = [
        {"module": "accounts_payable", "check_id": "AP005", "field": "LFB1.ZTERM", "proposed_value": "0001",
         "current_value": "", "record_key": "LIFNR=1|BUKRS=1000"},
        {"module": "accounts_payable", "check_id": "AP006", "field": "LFB1.AKONT", "proposed_value": "160000",
         "current_value": "1", "record_key": "LIFNR=1|BUKRS=1000"},
        {"module": "accounts_payable", "check_id": "AP007", "field": "LFA1.LAND1", "proposed_value": None,
         "current_value": "ZZ", "record_key": "LIFNR=2"},
    ]
    sheets = remediation.cockpit_sheets(items, get_dictionary("s4hana"))
    assert list(sheets) == ["LFB1"]
    assert sheets["LFB1"].to_dict("records") == [{"LIFNR": "1", "BUKRS": "1000", "ZTERM": "0001", "AKONT": "160000"}]
    assert list(remediation.cockpit_csv(items)["TABLE"]) == ["LFB1"]
    mc = remediation.mass_change(items)
    assert list(mc["NEW_VALUE"]) == ["0001", "160000"]
    assert mc.iloc[1][["TCODE", "TABLE", "FIELD", "OLD_VALUE"]].tolist() == ["FK02", "LFB1", "AKONT", "1"]

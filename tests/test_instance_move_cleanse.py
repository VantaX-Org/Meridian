"""Instance move auto-cleansing: a rule fix changes a cell and is logged, a human value beats the rule, and an
unfixable record is still loaded and listed."""

import re

import pandas as pd

from api.services.migration import instance_move as im
from checks.base import CheckResult
from checks.frames import TableFrames

RULE = {"id": "T1", "field": "LFA1.LAND1", "auto_fix": {"steps": [{"op": "upper"}], "confidence": "high"}}


def _frames():
    return TableFrames({"LFA1": pd.DataFrame({"LFA1.LIFNR": ["V1", "V2", "V3", "V4"],
                                              "LFA1.LAND1": ["ZA", "", "za", "XX1"]})})


def _check(frames):
    df = frames.frames["LFA1"]
    bad = [f"LIFNR={k}" for k, v in zip(df["LFA1.LIFNR"], df["LFA1.LAND1"]) if not re.fullmatch(r"[A-Z]{2}", str(v))]
    n = len(df)
    return [CheckResult(check_id="T1", module="accounts_payable", field="LFA1.LAND1", severity="medium",
                        dimension="validity", passed=not bad, affected_count=len(bad), total_count=n,
                        pass_rate=round(100 * (n - len(bad)) / n, 2), message="", details={}, error=None,
                        failing_record_keys=bad)]


def test_rule_fix_logged_and_unfixable_still_loaded():
    out = im.cleanse(_frames(), {"T1": RULE}, _check)
    assert list(out["frames"].frames["LFA1"]["LFA1.LAND1"]) == ["ZA", "", "ZA", "XX1"]
    assert out["log"] == [{"record_key": "LIFNR=V3", "field": "LFA1.LAND1", "old": "za", "new": "ZA",
                           "rule_id": "T1", "source": "rule"}]
    assert len(out["frames"].frames["LFA1"]) == 4  # no row dropped
    assert sorted(u["record_key"] for u in out["unfixable"]) == ["LIFNR=V2", "LIFNR=V4"]
    assert out["summary"]["records_still_failing"] == 2 and out["passes"] == 1


def test_steward_value_beats_rule_and_workbook():
    out = im.cleanse(_frames(), {"T1": RULE}, _check,
                     steward_fixes=[{"field": "LFA1.LAND1", "record_key": "LIFNR=V3", "proposed_value": "NA"}],
                     workbook_fixes=[{"field": "LFA1.LAND1", "record_key": "LIFNR=V3", "proposed_value": "BW"},
                                     {"field": "LFA1.LAND1", "record_key": "LIFNR=V4", "proposed_value": "MZ"}])
    land = list(out["frames"].frames["LFA1"]["LFA1.LAND1"])
    assert land == ["ZA", "", "NA", "MZ"]
    src = {c["record_key"]: c["source"] for c in out["log"]}
    assert src == {"LIFNR=V3": "steward", "LIFNR=V4": "workbook"}
    assert [u["record_key"] for u in out["unfixable"]] == ["LIFNR=V2"]

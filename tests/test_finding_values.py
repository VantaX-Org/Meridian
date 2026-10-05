"""Failing-record field values: rule columns kept, privacy-sensitive ones masked."""

import pandas as pd

from api.services.record_issues import _keyed_values
from checks.base import MASKED, CheckResult, failing_values


def test_failing_values_masks_sensitive_columns() -> None:
    df = pd.DataFrame({"LFA1.LIFNR": ["1", "2"], "LFA1.KTOKK": ["ZV01", None],
                       "LFA1.NAME1": ["Acme", "Beta"], "LFA1.STCD1": ["123", ""]})
    out = failing_values(df, ["LFA1.KTOKK", "LFA1.NAME1", "LFA1.STCD1", "LFA1.MISSING"])
    assert out == [{"LFA1.KTOKK": "ZV01", "LFA1.NAME1": MASKED, "LFA1.STCD1": MASKED},
                   {"LFA1.KTOKK": "", "LFA1.NAME1": MASKED, "LFA1.STCD1": ""}]


def test_keyed_values_first_key_wins_and_tolerates_missing() -> None:
    r = CheckResult(check_id="X", module="m", field="f", severity="low", dimension="validity", passed=False,
                    affected_count=3, total_count=3, pass_rate=0.0, message="", details={},
                    failing_record_keys=["a", "b", "a"], failing_record_values=[{"F": "1"}])
    assert _keyed_values(r) == {"a": {"F": "1"}, "b": None}


def test_sample_records_mask_sensitive_columns() -> None:
    from checks.types.domain_value_check import DomainValueCheck
    rule = {"id": "D1", "field": "LFA1.STCD1", "allowed_values": ["X"], "severity": "low",
            "dimension": "validity", "message": "m"}
    df = pd.DataFrame({"LFA1.LIFNR": ["1", "2"], "LFA1.STCD1": ["123", "456"]})
    res = DomainValueCheck(rule).run(df)
    assert res is not None
    d = res.details
    assert {r["LFA1.STCD1"] for r in d["sample_failing_records"]} == {MASKED}
    assert {r["invalid_value"] for r in d["sample_failing_records"]} == {MASKED}
    assert "distinct_invalid_values" not in d

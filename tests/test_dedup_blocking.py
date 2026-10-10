import pandas as pd

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle
from workers.tasks.mining.dedup import _find_potential_duplicates

_COLS = ["BUT000.PARTNER", "BUT000.NAME_ORG1", "ADRC.COUNTRY", "ADRC.POST_CODE1"]


def test_near_names_in_one_block_pair_up():
    df = pd.DataFrame([["1", "ALPHA TRADING", "DE", "10115"], ["2", "ALPHA TRADNG", "DE", "10115"],
                       ["3", "GAMMA METALS", "DE", "10115"]], columns=_COLS)
    dups = _find_potential_duplicates(df, "business_partner")
    assert [(d["record_a"], d["record_b"]) for d in dups] == [("1", "2")]
    assert (dups[0]["blocking_key"], dups[0]["id_field"], dups[0]["module"]) == (
        "DE|10115", "BUT000.PARTNER", "business_partner")
    assert 0.8 <= dups[0]["match_score"] < 1.0
    assert "ADRC.POST_CODE1" in dups[0]["matched_fields"]


def test_other_postcodes_are_other_blocks():
    df = pd.DataFrame([["1", "ALPHA TRADING", "DE", "10115"], ["2", "ALPHA TRADNG", "DE", "80331"]], columns=_COLS)
    assert _find_potential_duplicates(df, "business_partner") == []


def test_modules_without_match_keys_are_skipped():
    df = pd.DataFrame({"empemployment.userId": ["U1", "U1"], "empemployment.startDate": ["2020-01-01"] * 2})
    assert _find_potential_duplicates(df, "employee_central") == []

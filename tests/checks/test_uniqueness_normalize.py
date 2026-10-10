import pandas as pd

from checks.types.uniqueness_check import UniquenessCheck


def test_space_normalize_ignores_spaces_only():
    rule = {"id": "T", "field": "MARA.MATNR", "fields": ["MARA.MATNR"], "normalize": "space",
            "check_class": "uniqueness_check"}
    df = pd.DataFrame({"MARA.MATNR": ["PUMP 100", "pump100", "PUMP-100", "", "X"]})
    ev = UniquenessCheck(rule).evaluate(df)
    assert list(ev.failing) == [True, True, False, False, False]


def test_unique_across_case_normalises_owner_and_reports_it_in_evidence():
    # k1's two rows are the same owner spelled "u1" and "U1" (e.g. an upstream feed
    # that is inconsistent on case) — must NOT be flagged, since case-insensitive
    # comparison makes them one owner. k2's two rows are genuinely different owners
    # ("u1" vs "u2") and must be flagged.
    rule = {"id": "T", "field": "T.KEY", "fields": ["T.KEY"], "unique_across": "T.OWNER",
            "check_class": "uniqueness_check"}
    df = pd.DataFrame({"T.KEY": ["k1", "k1", "k2", "k2"],
                        "T.OWNER": ["u1", "U1", "u1", "u2"]})
    ev = UniquenessCheck(rule).evaluate(df)
    assert list(ev.failing) == [False, False, True, True]
    assert ev.details["unique_across"] == "T.OWNER"

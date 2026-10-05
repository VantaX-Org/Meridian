import pandas as pd

from checks.types.uniqueness_check import UniquenessCheck


def test_space_normalize_ignores_spaces_only():
    rule = {"id": "T", "field": "MARA.MATNR", "fields": ["MARA.MATNR"], "normalize": "space",
            "check_class": "uniqueness_check"}
    df = pd.DataFrame({"MARA.MATNR": ["PUMP 100", "pump100", "PUMP-100", "", "X"]})
    ev = UniquenessCheck(rule).evaluate(df)
    assert list(ev.failing) == [True, True, False, False, False]

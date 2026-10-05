"""AA048: capitalisation date later than today fails; past and blank pass."""

import pandas as pd
import yaml

from checks.types.cross_field_check import CrossFieldCheck


def test_future_capitalisation_fails() -> None:
    rules = yaml.safe_load(open("checks/rules/ecc/asset_accounting.yaml"))["rules"]
    rule = next(r for r in rules if r["id"] == "AA048")
    future = (pd.Timestamp.today() + pd.Timedelta(days=40)).strftime("%Y%m%d")
    df = pd.DataFrame({"ANLA.AKTIV": [future, "20200101", "00000000", ""]})
    ev = CrossFieldCheck(rule).evaluate(df)
    assert list(ev.failing) == [True, False, False, False]

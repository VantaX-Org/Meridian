"""checks.frames._join must not crash on NA in a `prefer` column, and an NA row is simply not preferred."""
import pandas as pd

from checks.frames import Edge, _join


def test_join_prefer_column_with_na_values():
    edge = Edge("A", "B", (("K", "K"),), "many", prefer=(("P", "x"),))
    left = pd.DataFrame({"A.K": ["1"]})
    right = pd.DataFrame({"B.K": ["1", "1", "1"], "B.P": [None, "x", pd.NA], "B.V": ["na", "preferred", "na2"]})
    out = _join(left, right, edge, ["B.V"])
    assert out["B.V"].tolist() == ["preferred"]


def test_join_prefer_all_na_keeps_first_row():
    edge = Edge("A", "B", (("K", "K"),), "many", prefer=(("P", "x"),))
    out = _join(pd.DataFrame({"A.K": ["1"]}), pd.DataFrame({"B.K": ["1", "1"], "B.P": [None, None], "B.V": ["first", "second"]}), edge, ["B.V"])
    assert out["B.V"].tolist() == ["first"]

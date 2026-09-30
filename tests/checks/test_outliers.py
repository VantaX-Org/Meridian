import numpy as np
import pandas as pd

from checks.frames import TableFrames
from checks.outliers import find
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_weight_outliers_within_peer_groups():
    n = 30
    rng = np.random.default_rng(7)
    weights = [f"{w:.3f}" for w in rng.uniform(1.8, 2.2, n)]
    weights[4] = "2000.000"          # grams entered as kilograms
    weights[9] = "0.002"             # decimal shifted
    mara = pd.DataFrame({"MARA.MATNR": [f"M{i:03d}" for i in range(n + 3)],
                         "MARA.NTGEW": weights + ["5000", "1", "2"],       # 3 materials in a small, other group
                         "MARA.MATKL": ["PUMPS"] * n + ["VALVES"] * 3, "MARA.GEWEI": ["KG"] * (n + 3)})
    res = find("material_master", TableFrames({"MARA": mara}, D, module="material_master"))["OUT-MARA-NTGEW"]
    assert res["outliers"] == 2 and {r["record_key"] for r in res["top"]} == {"MATNR=M004", "MATNR=M009"}
    assert res["checked"] == n  # the 3-member group is too small to judge
    assert res["top"][0]["factor"] in (1000.0, 0.0) or abs(res["top"][0]["factor"]) > 100


def test_identical_peers_with_one_deviation():
    mara = pd.DataFrame({"MARA.MATNR": [f"M{i}" for i in range(12)], "MARA.NTGEW": ["1.000"] * 11 + ["1000.000"],
                         "MARA.MATKL": ["G"] * 12, "MARA.GEWEI": ["KG"] * 12})
    res = find("material_master", TableFrames({"MARA": mara}, D, module="material_master"))["OUT-MARA-NTGEW"]
    assert [r["record_key"] for r in res["top"]] == ["MATNR=M11"]

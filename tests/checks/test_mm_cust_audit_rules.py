"""Material and customer master audit rules MM1109-MM1114 and SDCM860-SDCM862 flag the right rows."""
import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import module_rules, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def _affected(module, rid, frames):
    rule = {**next(r for r in module_rules(module) if r["id"] == rid), "module": module}
    _, r = run_rule(rule, TableFrames(frames, D, module=module))
    return r.affected_count


MARA = pd.DataFrame({"MARA.MATNR": ["M1", "M2", "M3"], "MARA.GENNR": [None, "M1", "GONE"],
                     "MARA.STFAK": [0, 2, -1], "MARA.SAISJ": ["2026", None, "26"]})
MARC = pd.DataFrame({"MARC.MATNR": ["M1", "M2", "M3"], "MARC.WERKS": ["P1"] * 3,
                     "MARC.UCMAT": [None, "M1", "GONE"], "MARC.XMCNG": [None, "X", None]})
MARD = pd.DataFrame({"MARD.MATNR": ["M1", "M2", "M3"], "MARD.WERKS": ["P1"] * 3, "MARD.LGORT": ["L1"] * 3,
                     "MARD.KLABS": [-1.0, -1.0, 5.0]})
MBEW = pd.DataFrame({"MBEW.MATNR": ["M1", "M2", "M3"], "MBEW.BWKEY": ["P1"] * 3,
                     "MBEW.LBKUM": [10.0, 0.0, 10.0], "MBEW.SALKV": [-5.0, -5.0, 5.0]})
KNA1 = pd.DataFrame({"KNA1.KUNNR": ["C1", "C2", "C3"]})
KNB1 = pd.DataFrame({"KNB1.KUNNR": ["C1", "C2", "C3"], "KNB1.BUKRS": ["1000"] * 3,
                     "KNB1.REMIT": [None, "C1", "GONE"], "KNB1.EKVBD": ["GONE", None, "C2"],
                     "KNB1.WEBTR": [0.0, -100.0, 50.0]})


@pytest.mark.parametrize("rid,frames,expected", [
    ("MM1109", {"MARA": MARA, "MARC": MARC}, 1),
    ("MM1110", {"MARA": MARA}, 1),
    ("MM1111", {"MARA": MARA}, 1),
    ("MM1112", {"MARA": MARA}, 1),
    ("MM1113", {"MARC": MARC, "MARD": MARD}, 1),
    ("MM1114", {"MBEW": MBEW}, 1),
])
def test_material_master_audit_rules(rid, frames, expected):
    assert _affected("material_master", rid, frames) == expected


@pytest.mark.parametrize("rid,expected", [("SDCM860", 1), ("SDCM861", 1), ("SDCM862", 1)])
def test_customer_master_audit_rules(rid, expected):
    assert _affected("sd_customer_master", rid, {"KNA1": KNA1, "KNB1": KNB1}) == expected

"""Golden dataset: the controlling pack on cost centres, cost elements and profit
centres whose correct findings are known. Clean records must produce no finding;
each seeded defect must be found exactly where it was put.

Controlling area 1000. Cost centre versions that ended (DATBI < 99991231) are
history and out of scope of the master-data rules.
"""

import pandas as pd

from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

# KOSTL, DATAB, DATBI, BUKRS, KOSAR, VERAK, WAERS, PRCTR, KHINR, OBJNR, BKZKP, BKZKS, BKZER
COST_CENTRES = [
    ("0000004120", "20200101", "99991231", "1000", "F", "T NKOSI", "ZAR", "0000001200", "H1000", "KS1000000004120", "", "", ""),
    ("0000004300", "20210101", "99991231", "1000", "V", "A DLAMINI", "ZAR", "0000001300", "H1000", "KS1000000004300", "", "", ""),
    # history: a version that ended is not judged for a missing owner
    ("0000004150", "20150101", "20191231", "1000", "F", "", "ZAR", "0000001200", "H1000", "KS1000000004150", "", "", ""),
    # defects
    ("0000004200", "20230101", "99991231", "1000", "F", "", "ZAR", "0000001200", "H1000", "KS1000000004200", "", "", ""),  # CO006 no owner
    ("0000004900", "20230101", "99991231", "1000", "F", "M PILLAY", "ZAR", "0000009999", "H1000", "KS1000000004900", "", "", ""),  # CO016 profit centre unknown
    ("0000004910", "20240101", "99991231", "1000", "F", "M PILLAY", "ZAR", "0000001200", "H1000", "KS1000000004910", "X", "X", "X"),  # CO017 fully locked
    ("0000004920", "20250101", "20241231", "1000", "F", "M PILLAY", "ZAR", "0000001200", "H1000", "KS1000000004920", "", "", ""),  # CO011 valid-from after valid-to (history)
]
PROFIT_CENTRES = [("0000001200", "20200101", "99991231", "T NKOSI", "H1000"),
                  ("0000001300", "20200101", "99991231", "A DLAMINI", "H1000")]
COST_ELEMENTS = [("0000400000", "20200101", "99991231", "01"), ("0000800000", "20200101", "99991231", "11")]


def _frames() -> TableFrames:
    csks = pd.DataFrame(COST_CENTRES, columns=[f"CSKS.{c}" for c in (
        "KOSTL", "DATAB", "DATBI", "BUKRS", "KOSAR", "VERAK", "WAERS", "PRCTR", "KHINR", "OBJNR", "BKZKP", "BKZKS", "BKZER")])
    csks.insert(0, "CSKS.KOKRS", "1000")
    cepc = pd.DataFrame(PROFIT_CENTRES, columns=[f"CEPC.{c}" for c in ("PRCTR", "DATAB", "DATBI", "VERAK", "KHINR")])
    cepc.insert(0, "CEPC.KOKRS", "1000")
    cskb = pd.DataFrame(COST_ELEMENTS, columns=[f"CSKB.{c}" for c in ("KSTAR", "DATAB", "DATBI", "KATYP")])
    cskb.insert(0, "CSKB.KOKRS", "1000")
    return TableFrames({"CSKS": csks, "CEPC": cepc, "CSKB": cskb}, D, module="controlling")


def test_controlling_golden():
    results = run_checks("controlling", _frames(), "t")
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "CO006": {"KOKRS=1000|KOSTL=0000004200|DATBI=99991231"},   # no person responsible
        "CO016": {"KOKRS=1000|KOSTL=0000004900|DATBI=99991231"},   # profit centre not in CEPC
        "CO017": {"KOKRS=1000|KOSTL=0000004910|DATBI=99991231"},   # locked for all actual postings
        "CO011": {"KOKRS=1000|KOSTL=0000004920|DATBI=20241231"},   # valid-from after valid-to
    }, found

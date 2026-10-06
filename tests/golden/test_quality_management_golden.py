"""Golden dataset: the quality-management pack (exists_check against MARC, MAPL, QINF and the
code catalog, freshness, cross-field and null checks) on a small plant whose correct findings
are known. Clean records must produce no finding; each seeded defect must be found exactly
where it was put.

Data is in SAP internal format as RFC delivers it: MATNR zero-padded to 18, dates as YYYYMMDD,
initial dates as 00000000, flags as 'X' or blank."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_checks
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
MODULE = "quality_management"


def _m(n: int) -> str:
    return f"{n:018d}"


def _frames() -> TableFrames:
    m1, m2, m3, m4 = (_m(i) for i in (1, 2, 3, 4))
    marc = pd.DataFrame({
        "MARC.MATNR": [m1, m2, m3, m4], "MARC.WERKS": ["ZA01"] * 4,
        "MARC.QMATV": ["X", "X", "", "X"],
        "MARC.SSQSS": ["", "", "01", ""], "MARC.QZGTP": [""] * 4, "MARC.QSSYS": [""] * 4,
        "MARC.LVORM": [""] * 4})
    qmat = pd.DataFrame({
        "QMAT.MATNR": [m1, m4], "QMAT.WERKS": ["ZA01", "ZA01"], "QMAT.ART": ["01", "01"],
        "QMAT.AKTIV": ["X", "X"], "QMAT.PPL": ["X", "X"], "QMAT.SPROZ": ["0.0", "0.0"],
        "QMAT.HPZ": ["", ""], "QMAT.DYN": ["", ""], "QMAT.DYNREGEL": ["", ""]})
    mapl = pd.DataFrame({
        "MAPL.MATNR": [m1], "MAPL.WERKS": ["ZA01"], "MAPL.PLNTY": ["Q"], "MAPL.PLNNR": ["00000101"],
        "MAPL.PLNAL": ["01"], "MAPL.LOEKZ": [""]})
    qinf = pd.DataFrame({
        "QINF.MATNR": [m1], "QINF.ZAEHL": ["0001"], "QINF.WERK": ["ZA01"], "QINF.LIEFERANT": ["0000100001"],
        "QINF.LOEKZ": [""], "QINF.SPERRFKT": [""], "QINF.SPERRGRUND": [""], "QINF.FREI_DAT": ["99991231"]})
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["0000100001"], "LFA1.LOEVM": [""]})
    qpcd = pd.DataFrame({"QPCD.KATALOGART": ["9"], "QPCD.CODEGRUPPE": ["MECH"], "QPCD.CODE": ["01"],
                         "QPCD.INAKTIV": [""]})
    qmel = pd.DataFrame({
        "QMEL.QMNUM": ["000300000001", "000300000002", "000300000003"],
        "QMEL.QMART": ["Q2", "Q2", "Q2"],
        "QMEL.QMDAT": ["20260901", "20200101", "20260901"],
        "QMEL.QMDAB": ["00000000"] * 3, "QMEL.STRMN": ["00000000"] * 3, "QMEL.LTRMN": ["00000000"] * 3,
        "QMEL.PHASE": ["3", "3", "3"], "QMEL.KZLOESCH": [""] * 3,
        "QMEL.MATNR": [m1] * 3, "QMEL.MAWERK": ["ZA01"] * 3,
        "QMEL.LIFNUM": ["0000100001", "0000100001", ""],
        "QMEL.KUNUM": [""] * 3,
        "QMEL.QMKAT": ["9"] * 3, "QMEL.QMGRP": ["MECH"] * 3, "QMEL.QMCOD": ["01"] * 3})
    qals = pd.DataFrame({
        "QALS.PRUEFLOS": ["010000000001", "010000000002"], "QALS.WERK": ["ZA01"] * 2,
        "QALS.MATNR": [m1, m1], "QALS.ART": ["01", "04"], "QALS.HERKUNFT": ["01", "01"],
        "QALS.ENSTEHDAT": ["20260801"] * 2})
    return TableFrames({"MARC": marc, "QMAT": qmat, "MAPL": mapl, "QINF": qinf, "LFA1": lfa1, "QPCD": qpcd,
                        "QMEL": qmel, "QALS": qals}, D, module=MODULE)


def test_quality_management_golden():
    results = run_checks(MODULE, _frames(), "t", as_of="2026-10-06")
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "QM005": {f"MATNR={_m(3)}|WERKS=ZA01"},          # QM control key active, no quality info record
        "QM006": {f"MATNR={_m(2)}|WERKS=ZA01"},          # inspection setup flag, no inspection type
        "QM010": {f"ART=01|MATNR={_m(4)}|WERKS=ZA01"},   # task-list inspection, no plan assigned
        "QM058": {"QMNUM=000300000002"},                 # vendor complaint open since 2020
        "QM067": {"QMNUM=000300000003"},                 # vendor complaint without vendor
        "QM077": {"PRUEFLOS=010000000002"},              # type 04 on a goods-receipt (01) lot
    }, found

"""Quality management audit rules (QM134 onward): presence and pass/fail fixtures."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/ecc/quality_management.yaml"))["rules"]}
NEW = [f"QM{n}" for n in range(134, 141)]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="quality_management")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_new_ids_present_with_metadata():
    for rid in NEW:
        assert rid in RULES, rid
        for k in MANDATORY:
            assert RULES[rid].get(k), (rid, k)


def test_qm134_active_inspection_type():
    marc = frame("MARC", MATNR=["A", "B"], WERKS=["P1", "P1"], QMATV=["X", "X"], LVORM=["", ""])
    qmat = frame("QMAT", MATNR=["A", "B"], WERKS=["P1", "P1"], AKTIV=["X", ""], ART=["01", "01"])
    assert fire("QM134", {"MARC": marc, "QMAT": qmat})[0] == 1


def test_qm135_136_137_qpac_parents():
    qpac = frame("QPAC", WERKS=["P1", "P9"], KATALOGART=["3", "3"], AUSWAHLMGE=["S1", "S1"], CODEGRUPPE=["G1", "GX"],
                 CODE=["C1", "C1"])
    t = {"QPAC": qpac,
         "T001W": frame("T001W", WERKS=["P1"]),
         "QPAM": frame("QPAM", WERKS=["P1"], KATALOGART=["3"], AUSWAHLMGE=["S1"]),
         "QPGR": frame("QPGR", KATALOGART=["3"], CODEGRUPPE=["G1"])}
    assert fire("QM135", t)[0] == 1
    assert fire("QM136", t)[0] == 1
    assert fire("QM137", t)[0] == 1


def test_qm138_batch_missing():
    q = frame("QALS", PRUEFLOS=["1", "2", "3"], XCHPF=["X", "X", ""], MBLNR=["M1", "M2", "M3"], CHARG=["", "B1", ""])
    assert fire("QM138", {"QALS": q})[0] == 1


def test_qm139_open_characteristics():
    q = frame("QALS", PRUEFLOS=["1", "2", "3"], STAT35=["X", "X", ""], OFFENNLZMK=[2, 0, 5], OFFEN_LZMK=[0, 0, 0])
    assert fire("QM139", {"QALS": q})[0] == 1


def test_qm140_sample_above_lot():
    q = frame("QALS", PRUEFLOS=["1", "2"], LOSMENGE=[10.0, 10.0], GESSTICHPR=[20.0, 5.0])
    assert fire("QM140", {"QALS": q})[0] == 1

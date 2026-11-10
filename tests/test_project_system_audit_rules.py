"""Project system audit rules (PS166 onward): presence and pass/fail fixtures."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/ecc/project_system.yaml"))["rules"]}
NEW = [f"PS{n}" for n in range(166, 172)]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="project_system")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_new_ids_present_with_metadata():
    for rid in NEW:
        assert rid in RULES, rid
        for k in MANDATORY:
            assert RULES[rid].get(k), (rid, k)


def test_ps166_project_without_wbs():
    proj = frame("PROJ", PSPNR=["00000001", "00000002"], LOEVM=["", ""])
    prps = frame("PRPS", PSPNR=["00000010"], PSPHI=["00000001"])
    assert fire("PS166", {"PROJ": proj, "PRPS": prps})[0] == 1


def test_ps167_valid_to_before_valid_from():
    c = frame("COBRB", OBJNR=["O1", "O2", "O3"], LFDNR=["001", "001", "001"], BUREG=["", "", ""],
              GABJA=["2025", "2025", "2025"], GABPE=["005", "005", "005"],
              GBISJ=["2025", "2026", "0000"], GBISP=["003", "001", "000"])
    assert fire("PS167", {"COBRB": c})[0] == 1


def test_ps168_169_receiver_profit_centre_and_plant():
    c = frame("COBRB", OBJNR=["O1", "O2"], LFDNR=["001", "001"], BUREG=["", ""], KOKRS=["K1", "K1"],
              PRCTR=["PC1", "PCX"], WERKS=["P1", "PX"])
    t = {"COBRB": c, "CEPC": frame("CEPC", KOKRS=["K1"], PRCTR=["PC1"]), "T001W": frame("T001W", WERKS=["P1"])}
    assert fire("PS168", t)[0] == 1
    assert fire("PS169", t)[0] == 1


def test_ps170_171_operation_key_and_work_centre():
    a = frame("AFVC", AUFPL=["1", "2"], APLZL=["1", "1"], STEUS=["PP01", "ZZZZ"], ARBID=["00000005", "00000099"])
    t = {"AFVC": a, "T430": frame("T430", STEUS=["PP01"], PLNAW=["", ""][:1]),
         "CRHD": frame("CRHD", OBJTY=["A"], OBJID=["00000005"])}
    assert fire("PS170", t)[0] == 1
    assert fire("PS171", t)[0] == 1

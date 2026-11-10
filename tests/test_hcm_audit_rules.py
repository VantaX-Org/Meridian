"""HCM audit rules (PA121 onward): pack integrity and fire/no-fire fixtures. No personal data."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/hcm.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if int(r["id"][2:]) >= 121]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")
END = "99991231"


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    frames = TableFrames(tables, DDIC, module="hcm")
    _, res = run_rule(dict(RULES[rid]), frames, None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def test_ids_unique_and_contiguous():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][2:]) for r in NEW)
    assert new == list(range(121, 121 + len(new)))
    assert len(new) == 22


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert "{" not in r["message"]


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            assert set(r["target_fields"]) <= set(_fields(r["target_table"])), r["id"]


def test_pa121_payroll_area():
    t = {"PA0001": frame("PA0001", PERNR=["1", "2"], ENDDA=[END, END], ABKRS=["A1", "ZZ"]), "T549A": frame("T549A", ABKRS=["A1"])}
    assert fire("PA121", t) == 1


def test_pa122_blocked_cost_centre():
    pa = frame("PA0001", PERNR=["1", "2"], ENDDA=[END, END], KOKRS=["K", "K"], KOSTL=["C1", "C2"])
    cs = frame("CSKS", KOKRS=["K", "K"], KOSTL=["C1", "C2"], DATBI=[END, END], BKZKP=["X", ""])
    assert fire("PA122", {"PA0001": pa, "CSKS": cs}) == 1


def test_pa124_pay_scale_type():
    t = {"PA0008": frame("PA0008", PERNR=["1", "2"], ENDDA=[END, END], TRFAR=["01", "99"]), "T510A": frame("T510A", TRFAR=["01"])}
    assert fire("PA123", t) == 1


def test_pa125_pay_scale_combination():
    p = frame("PA0008", PERNR=["1", "2"], ENDDA=[END, END], TRFAR=["01", "01"], TRFGB=["01", "01"], TRFGR=["G1", "G9"], TRFST=["01", "01"])
    c = frame("T510", TRFAR=["01"], TRFGB=["01"], TRFGR=["G1"], TRFST=["01"])
    assert fire("PA124", {"PA0008": p, "T510": c}) == 1


def test_pa126_currency():
    t = {"PA0008": frame("PA0008", PERNR=["1", "2"], ENDDA=[END, END], WAERS=["ZAR", "XXY"]), "TCURC": frame("TCURC", WAERS=["ZAR"])}
    assert fire("PA125", t) == 1


def test_pa127_active_without_wage_type():
    t = {"PA0001": frame("PA0001", PERNR=["1", "2"], ENDDA=[END, END]), "PA0000": frame("PA0000", PERNR=["1", "2"], ENDDA=[END, END], STAT2=["3", "3"]),
         "PA0008": frame("PA0008", PERNR=["1", "2"], ENDDA=[END, END], LGA01=["1000", None])}
    assert fire("PA126", t) == 1


def test_wage_type_permitted():
    p = frame("PA0008", PERNR=["1", "2"], ENDDA=[END, END], LGA01=["1000", "9999"], LGA02=["1000", "9999"], LGA03=["1000", "9999"])
    z = frame("T512Z", INFTY=["0008", "0014"], LGART=["1000", "9999"])
    for rid in ("PA127", "PA128", "PA129"):
        assert fire(rid, {"PA0008": p, "T512Z": z}) == 1, rid
    z14 = frame("PA0014", PERNR=["1", "2"], ENDDA=[END, END], LGART=["9999", "2000"])
    t = frame("T512Z", INFTY=["0014", "0015"], LGART=["2000", "2000"])
    assert fire("PA141", {"PA0014": z14, "T512Z": t}) == 1
    z15 = frame("PA0015", PERNR=["1", "2"], ENDDA=[END, END], LGART=["9999", "2000"])
    assert fire("PA142", {"PA0015": z15, "T512Z": t}) == 1


def test_format_rules():
    assert fire("PA130", {"PA0002": frame("PA0002", PERNR=["1", "2"], ENDDA=[END, END], NATIO=["ZA", "ZA"], PERID=["0000000000000", "123"])}) == 1
    assert fire("PA132", {"PA0006": frame("PA0006", PERNR=["1", "2"], ENDDA=[END, END], LAND1=["ZA", "ZA"], PSTLZ=["0001", "00012"])}) == 1
    assert fire("PA137", {"PA0009": frame("PA0009", PERNR=["1", "2"], ENDDA=[END, END], BANKS=["ZA", "ZA"], BANKN=["12345", "12A45"])}) == 1
    assert fire("PA138", {"PA0009": frame("PA0009", PERNR=["1", "2"], ENDDA=[END, END], SWIFT=["ABCDZAJJ", "ABC"])}) == 1


def test_working_time_rules():
    p = frame("PA0007", PERNR=["1", "2"], ENDDA=[END, END], MINTA=[8, 2], MAXTA=[4, 8], MINWO=[40, 10], MAXWO=[20, 40], EMPCT=[120, 100], SCHKZ=[None, "NORM"])
    for rid in ("PA134", "PA135", "PA136", "PA133"):
        assert fire(rid, {"PA0007": p}) == 1, rid


def test_user_link_rules():
    p = frame("PA0105", PERNR=["1", "2", "3"], ENDDA=[END] * 3, SUBTY=["0001"] * 3, USRID=["U1", "U1", "U2"])
    assert fire("PA139", {"PA0105": p}) == 2
    u = frame("USR02", BNAME=["U1", "U2"], USTYP=["A", "B"])
    assert fire("PA140", {"PA0105": p, "USR02": u}) == 1


def test_address_city():
    p = frame("PA0006", PERNR=["1", "2"], ENDDA=[END, END], SUBTY=["1", "1"], ORT01=["X", None])
    assert fire("PA131", {"PA0006": p}) == 1

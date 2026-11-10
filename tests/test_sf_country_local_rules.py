"""EC694-EC712: rules for country-specific person, legal entity and job classification records."""
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 694 <= int(r["id"][2:]) <= 712]
BY = {r["id"]: r for r in NEW}
DICT = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))["tables"]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message",
             "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template"]
G, LE, JC = "PER_GLOBAL_INFO", "FO_LEGAL_ENTITY_LOCAL", "FO_JOB_CLASS_LOCAL"


def fire(rule, tables):
    _, res = run_rule(dict(rule), TableFrames(tables, S4, module="employee_central"), {})
    assert res is not None and not res.error, (rule["id"], res and res.error)
    return res.affected_count


def of(table, cls):
    return [r for r in NEW if r["field"].startswith(table + ".") and r["check_class"] == cls]


def test_pack_shape():
    assert len(NEW) == 19
    assert {r["field"].split(".")[0] for r in NEW} == {G, LE, JC}
    for r in NEW:
        assert all(r.get(k) for k in MANDATORY), r["id"]
        t, f = r["field"].split(".")
        assert f in DICT[t]["fields"], r["id"]
        for m in re.findall(r"\{(\w+\.\w+)\}", r["record_fix_template"]):
            mt, mf = m.split(".")
            assert mf in DICT[mt]["fields"], (r["id"], m)


def test_global_info_rules():
    g = pd.DataFrame({f"{G}.PERSON_ID": ["P1", "P1", "P2", None], f"{G}.COUNTRY": ["USA", "USA", "ZAF", "USA"],
                      f"{G}.START_DATE": ["2024-01-01", "2024-03-01", "2024-01-01", "2024-01-01"],
                      f"{G}.END_DATE": ["2024-06-01", "2024-12-31", "2023-01-01", None]})
    per = pd.DataFrame({"PERINFO.PERSON_ID": ["P1"]})
    t = {G: g, "PERINFO": per}
    nulls = {r["field"]: r for r in of(G, "null_check")}
    assert fire(nulls[f"{G}.PERSON_ID"], t) == 1
    assert fire(of(G, "cross_field_check")[0], t) == 1
    assert fire(of(G, "interval_check")[0], t) == 1
    assert fire(of(G, "exists_check")[0], t) >= 1
    dup = g.iloc[[0, 0, 2]].reset_index(drop=True)
    assert fire(of(G, "uniqueness_check")[0], {G: dup}) == 2


def test_local_foundation_rules():
    for T, parent in ((LE, "FOCOMPANY"), (JC, "FOJOBCODE")):
        loc = pd.DataFrame({f"{T}.EXTERNAL_CODE": ["C1", "C2", "C3"], f"{T}.COUNTRY": ["USA", None, "ZAF"],
                            f"{T}.START_DATE": ["2024-01-01", "2024-01-01", None], f"{T}.STATUS": ["A", "X", "A"]})
        par = pd.DataFrame({f"{parent}.EXTERNAL_CODE": ["C1", "C3"], f"{parent}.STATUS": ["A", "I"]})
        t = {T: loc, parent: par}
        nulls = {r["field"]: r for r in of(T, "null_check")}
        assert fire(nulls[f"{T}.COUNTRY"], t) == 1
        assert fire(nulls[f"{T}.START_DATE"], t) == 1
        assert fire(of(T, "domain_value_check")[0], t) == 1
        exists = {bool(r.get("target_when")): r for r in of(T, "exists_check")}
        assert fire(exists[False], t) == 1
        assert fire(exists[True], t) == 1
        dup = loc.iloc[[0, 0]].reset_index(drop=True)
        assert fire(of(T, "uniqueness_check")[0], {T: dup}) == 2

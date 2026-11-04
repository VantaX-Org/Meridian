"""EC645-EC652 SuccessFactors Employee Central cross-entity integrity: orphan rows, missing children, status cascades.
Each fixture holds one failing and one passing record, so every rule must flag exactly 1 of 2. Synthetic values only."""
import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]}
S4 = get_dictionary("s4hana")
IDS = [f"EC{n}" for n in range(645, 653)]
MANDATORY = ["field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, S4, module="employee_central"), {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


U = ["U0001", "U0002"]
ACT = ["A", "A"]
JH = dict(START_DATE=["20200101"] * 2, END_DATE=[None, None])
CASES = {
    "EC645": {"EMPJOBHIST": frame("EMPJOBHIST", USERID=["U0009", "U0001"], START_DATE=["20200101"] * 2, SEQ_NUMBER=["1", "1"]),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["U0001"])},
    "EC646": {"PERINFO": frame("PERINFO", PERSON_ID=["P0009", "P0001"]),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["U0001"], PERSON_ID=["P0001"])},
    "EC647": {"PERINFO": frame("PERINFO", PERSON_ID=["P0001", "P0002"]),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=U, PERSON_ID=["P0001", "P0002"], STATUS=ACT),
              "PERADDRESS": frame("PERADDRESS", PERSON_ID=["P0002"])},
    "EC648": {"EMPJOBHIST": frame("EMPJOBHIST", USERID=U, MANAGER_ID=["U0009", "U0003"], STATUS=ACT, **JH),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["U0001", "U0002", "U0003"], STATUS=["A", "A", "A"])},
    "EC649": {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", USERID=U, RELATIONSHIP_TYPE=["HR", "HR"],
                                           RELATED_USER_ID=["U0009", "U0003"], **JH),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["U0001", "U0002", "U0003"], STATUS=["A", "A", "A"])},
    "EC650": {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", USERID=U, RELATIONSHIP_TYPE=["HR", "HR"],
                                           START_DATE=["20200101"] * 2, END_DATE=[None, "20210101"],
                                           RELATED_USER_ID=["U0003", "U0003"]),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=U, STATUS=["T", "T"])},
    "EC651": {"EMPJOBHIST": frame("EMPJOBHIST", USERID=U, STATUS=["A", "T"], **JH),
              "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=U, STATUS=["T", "T"])},
    "EC652": {"EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=U, STATUS=ACT),
              "EMPJOBHIST": frame("EMPJOBHIST", USERID=["U0002"], START_DATE=["20200101"], SEQ_NUMBER=["1"])},
}


def test_ids_present_enriched_and_grounded():
    assert set(CASES) == set(IDS) and all(i in RULES for i in IDS)
    for i in IDS:
        for k in MANDATORY:
            assert RULES[i].get(k), (i, k)
        assert S4.field(*RULES[i]["field"].split(".")) is not None, i
        if RULES[i].get("target_table"):
            for f in RULES[i]["target_fields"]:
                assert S4.field(RULES[i]["target_table"], f) is not None, (i, f)


@pytest.mark.parametrize("rid", IDS)
def test_rule_flags_the_bad_record_only(rid):
    affected, _ = fire(rid, CASES[rid])
    assert affected == 1

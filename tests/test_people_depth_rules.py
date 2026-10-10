"""People data depth rules (HCM PA067+, SuccessFactors packs, S4R-HCM): integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

SF = ["employee_central", "compensation", "recruiting_onboarding", "learning_management", "performance_goals",
      "succession_planning", "time_attendance", "benefits", "payroll_integration"]
FIRST_NEW = {"employee_central": ("EC", 108), "compensation": ("COMP", 26), "recruiting_onboarding": ("REC", 23),
             "learning_management": ("LMS", 23), "performance_goals": ("PERF", 19),
             "succession_planning": ("SUC", 15), "time_attendance": ("TIME", 20), "benefits": ("BEN", 17)}


def _load(path):
    d = yaml.safe_load(open(path))
    return d["rules"] if isinstance(d, dict) else d


HCM = _load("checks/rules/ecc/hcm.yaml")
S4R = [r for r in _load("checks/rules/ecc/s4_readiness.yaml") if r["id"].startswith("S4R-HCM")]
PACKS = {m: _load(f"checks/rules/successfactors/{m}.yaml") for m in SF}


def _new_sf(m, r):
    i = r["id"]
    if m == "payroll_integration":
        g = re.fullmatch(r"(HPY|PAY)(\d+)", i)
        return bool(g) and int(g.group(2)) >= (19 if g.group(1) == "HPY" else 24)
    pre, n = FIRST_NEW[m]
    g = re.fullmatch(pre + r"(\d+)", i)
    return bool(g) and int(g.group(1)) >= n


NEW_HCM = [r for r in HCM if int(r["id"][2:]) >= 67]
NEW_SF = [(m, r) for m, rs in PACKS.items() for r in rs if _new_sf(m, r)]
NEW_ALL = NEW_HCM + S4R + [r for _, r in NEW_SF]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
ECC = get_dictionary("ecc6")
S4 = get_dictionary("s4hana")
PERSONAL = re.compile(r"\{[A-Z0-9_]+\.(NACHN|VORNA|GBDAT|BANKN|IBAN|ACCOUNT_NUMBER|BET01|PERID|SALARY|EMAIL\w*|"
                      r"FIRSTNAME|LASTNAME|NATIONAL_ID|DATE_OF_BIRTH|ANSAL|STRAS|USRID\w*|PHONE\w*|ADDRESS\w*|"
                      r"GROSS_PAY|NET_PAY)\}")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rule, tables, module, ddic=ECC):
    frames = TableFrames(tables, ddic, module=module)
    _, res = run_rule(dict(rule), frames, {})
    assert res is not None and not res.error, (rule["id"], res and res.error)
    return res.affected_count, res.total_count


def hcm(rid, tables):
    return fire(next(r for r in HCM if r["id"] == rid), tables, "hcm")


def sf(m, rid, tables):
    return fire(next(r for r in PACKS[m] if r["id"] == rid), tables, m, S4)


# ---- integrity ---------------------------------------------------------------------------------------------------

def test_ids_unique_and_contiguous():
    for rules in [HCM, *PACKS.values()]:
        ids = [r["id"] for r in rules]
        assert len(ids) == len(set(ids))
    nums = sorted(int(r["id"][2:]) for r in NEW_HCM)
    assert nums == list(range(67, nums[-1] + 1))
    assert len(NEW_ALL) >= 120


def test_every_new_rule_has_full_metadata_and_hcm_grain():
    for r in NEW_ALL:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
    for r in NEW_HCM:
        assert r["id"].startswith("PA") and r.get("grain"), r["id"]


def test_no_personal_placeholders_in_text():
    for r in NEW_ALL:
        for k in ("message", "why_it_matters", "sap_impact", "record_fix_template"):
            assert not PERSONAL.search(r[k]), (r["id"], k)


def test_hcm_and_s4r_fields_exist_in_ddic():
    for r in NEW_HCM + [x for x in S4R]:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            names = {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}
            assert name in names, (r["id"], f)
        if r["check_class"] == "exists_check":
            names = {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{r['target_table']}.json"))["fields"]}
            assert set(r["target_fields"]) <= names, r["id"]


def test_sf_fields_exist_in_canonical_schema():
    for m, r in NEW_SF:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        for f in refs:
            assert S4.field(*f.split(".")) is not None, (r["id"], f)


def test_s4r_rules_and_area_tags():
    area = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]["hcm"]
    assert area["label"] == "HCM compatibility pack and employee Business Partner"
    assert len(S4R) == 8
    for r in S4R:
        assert r["s4_area"] == "hcm" and r["s4_impact"] in ("blocking", "warning")
        assert r["message"].startswith("S/4HANA readiness:") and r["rule_authority"] == "s4hana_migration"
    ids = {r["id"] for rs in [HCM, *PACKS.values()] for r in rs}
    tagged = area["related"]["blocking"] + area["related"]["warning"]
    assert tagged and set(tagged) <= ids


# ---- HCM conditional branches ------------------------------------------------------------------------------------

def _active(*pernrs):
    return {"PA0000": frame("PA0000", PERNR=list(pernrs), ENDDA=["99991231"] * len(pernrs),
                            STAT2=["3"] * len(pernrs))}


def test_pa079_flags_cost_centre_without_controlling_area_only_when_cost_centre_set():
    t = _active("1", "2", "3")
    t["PA0001"] = frame("PA0001", PERNR=["1", "2", "3"], ENDDA=["99991231"] * 3, KOSTL=["C1", "", "C2"],
                        KOKRS=["", "", "K1"])
    assert hcm("PA079", t) == (1, 1 + 1)  # employee 2 skipped (no cost centre), 3 passes


def test_pa087_birth_date_in_future():
    t = {"PA0002": frame("PA0002", PERNR=["1", "2"], ENDDA=["99991231"] * 2,
                         GBDAT=[pd.Timestamp("1990-01-01"), pd.Timestamp("2999-01-01")])}
    assert hcm("PA087", t)[0] == 1


def test_pa106_leaver_holding_position_only_when_withdrawn():
    old = pd.Timestamp("2000-01-01")
    t = {"PA0000": frame("PA0000", PERNR=["1", "2"], ENDDA=["99991231"] * 2, STAT2=["0", "3"], BEGDA=[old, old]),
         "PA0001": frame("PA0001", PERNR=["1", "2"], ENDDA=["99991231"] * 2, PLANS=["00000010", "00000011"])}
    assert hcm("PA106", t)[0] == 1  # active employee is skipped by applies_when


def test_pa105_leaver_payroll_accounted_before_leaving():
    t = {"PA0000": frame("PA0000", PERNR=["1", "2"], ENDDA=["99991231"] * 2, STAT2=["0", "3"],
                         BEGDA=[pd.Timestamp("2024-06-30")] * 2),
         "PA0001": frame("PA0001", PERNR=["1", "2"], ENDDA=["99991231"] * 2),
         "PA0003": frame("PA0003", PERNR=["1", "2"], ABRDT=[pd.Timestamp("2024-05-31")] * 2)}
    assert hcm("PA105", t)[0] == 1


# ---- S4R-HCM conditional branches --------------------------------------------------------------------------------

def _s4r(rid):
    return next(r for r in S4R if r["id"] == rid)


def test_s4r_banks_only_when_account_number_present():
    t = {"PA0009": frame("PA0009", PERNR=["1", "2", "3"], ENDDA=["99991231"] * 3, BANKN=["A", "", "B"],
                         BANKS=["", "", "ZA"])}
    assert fire(_s4r("S4R-HCM-BANKS"), t, "s4_readiness") [0] == 1


def test_s4r_land1_only_for_permanent_address_and_open_record():
    t = {"PA0006": frame("PA0006", PERNR=["1", "2", "3", "4"], SUBTY=["1", "2", "1", "1"],
                         ENDDA=["99991231", "99991231", "20200101", "99991231"], LAND1=["", "", "", "ZA"])}
    assert fire(_s4r("S4R-HCM-LAND1"), t, "s4_readiness")[0] == 1


def test_s4r_archive_only_for_withdrawn_over_ten_years():
    t = {"PA0000": frame("PA0000", PERNR=["1", "2", "3"], ENDDA=["99991231"] * 3, STAT2=["0", "0", "3"],
                         BEGDA=[pd.Timestamp("2000-01-01"), pd.Timestamp.today().normalize(),
                                pd.Timestamp("2000-01-01")]),
         "PA0001": frame("PA0001", PERNR=["1", "2", "3"], ENDDA=["99991231"] * 3)}
    assert fire(_s4r("S4R-HCM-ARCHIVE"), t, "s4_readiness")[0] == 1


# ---- SuccessFactors conditional branches -------------------------------------------------------------------------

def test_ec_leaver_on_position_only_when_terminated_and_over_90_days():
    old = pd.Timestamp("2000-01-01")
    t = {"EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u1", "u2", "u3"], STATUS=["T", "A", "T"],
                                POSITION=["P1", "P1", None], END_DATE=[old, old, old])}
    assert sf("employee_central", "EC115", t)[0] == 1


def test_time_overtime_rules_skip_absence_days():
    t = {"TIMESHEET": frame("TIMESHEET", USERID=["u1", "u2"], DATE=["2026-01-05"] * 2, HOURS=[8.0, 8.0],
                            OVERTIME_HOURS=[20.0, 20.0], ABSENCE_TYPE=["", "VACATION"])}
    assert sf("time_attendance", "TIME022", t)[0] == 1
    assert sf("time_attendance", "TIME023", t)[0] == 1


def test_pay_net_pay_reconciles_gross_less_tax_and_deductions():
    t = {"PAYRESULT": frame("PAYRESULT", USERID=["u1", "u2"], PAY_PERIOD=["202601"] * 2, GROSS_PAY=[100.0, 100.0],
                            TAX_AMOUNT=[10.0, 10.0], DEDUCTIONS=[5.0, 5.0], NET_PAY=[85.0, 90.0])}
    assert sf("payroll_integration", "PAY027", t) == (1, 2)

"""EC654-EC693: mandatory, date-order and pay-range rules for the foundation and person objects."""
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 654 <= int(r["id"][2:]) <= 693]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message",
             "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template"]
DICT = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))["tables"]


def fire(rule, tables):
    frames = TableFrames(tables, S4, module="employee_central")
    _, res = run_rule(dict(rule), frames, {})
    assert res is not None and not res.error, (rule["id"], res and res.error)
    return res.affected_count


def test_pack_shape():
    assert len(NEW) == 40
    assert len({r["id"] for r in RULES}) == len(RULES)
    for r in NEW:
        assert all(r.get(k) for k in MANDATORY), r["id"]
        t, f = r["field"].split(".")
        assert f in DICT[t]["fields"], r["id"]
        assert r["rule_authority"] in ("best_practice", "sap_hard_constraint", "customer_configured")
        for m in re.findall(r"\{(\w+\.\w+)\}", r["record_fix_template"]):
            mt, mf = m.split("."); assert mf in DICT[mt]["fields"], (r["id"], m)


def test_null_checks_fire_on_blank_only():
    for r in NEW:
        if r["check_class"] != "null_check":
            continue
        t, f = r["field"].split(".")
        key = DICT[t]["keys"][0]
        df = pd.DataFrame({f"{t}.{key}": ["A", "B"], r["field"]: [None, "x"]})
        if key == f:
            df[r["field"]] = [None, "x"]
        assert fire(r, {t: df}) == 1, r["id"]


def test_date_order_and_pay_range():
    for r in NEW:
        if r["check_class"] != "cross_field_check":
            continue
        a, b = re.findall(r"`(\w+)\.(\w+)`", r["fail_when"])
        t = a[0]
        assert a[0] == b[0]
        lo, hi = (("2024-01-01", "2024-06-01"), ("2024-06-01", "2024-01-01"))
        if t == "FOPAYRANGE":
            lo, hi = (1.0, 2.0), (2.0, 1.0)
        else:
            lo = tuple(pd.Timestamp(x) for x in lo); hi = tuple(pd.Timestamp(x) for x in hi)
        key = DICT[t]["keys"][0]
        df = pd.DataFrame({f"{t}.{key}": ["ok", "bad"],
                           f"{t}.{a[1]}": [lo[0], hi[0]], f"{t}.{b[1]}": [lo[1], hi[1]]})
        assert fire(r, {t: df}) == 1, r["id"]

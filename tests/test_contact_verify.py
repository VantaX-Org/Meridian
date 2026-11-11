"""Email, phone and postcode verification: service reasons, contact_check rules, auto_fix proposals."""
import pandas as pd
import pytest
import yaml

from api.services import contact_verify as cv
from checks.auto_fix import propose, validate_auto_fix
from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"business_partner": "checks/rules/ecc/business_partner.yaml",
         "sd_customer_master": "checks/rules/ecc/sd_customer_master.yaml",
         "employee_central": "checks/rules/successfactors/employee_central.yaml"}
RULES = {r["id"]: (m, r) for m, p in PACKS.items() for r in yaml.safe_load(open(p))["rules"]
         if r.get("check_class") == "contact_check"}


@pytest.mark.parametrize("value,reason", [
    ("anna.berg@example.com", None), ("a..b@example.com", "bad_local"), ("no-at-sign", "no_at"),
    ("x" * 65 + "@example.com", "local_too_long"), ("a@localhost", "bad_domain"), ("a@" + "b" * 64 + ".com", "label_too_long"),
    ("a@b@example.com", "no_at"), ("a@example.123", "bad_domain"), ("a" * 250 + "@x.io", "too_long")])
def test_email_reasons(value, reason):
    assert cv.email_reason(value) == reason


def test_disposable_matches_sub_domains():
    assert cv.disposable_reason("x@mailinator.com") == "disposable"
    assert cv.disposable_reason("x@eu.mailinator.com") == "disposable"
    assert cv.disposable_reason("x@example.com") is None


def test_phone_country_dial_code_and_generic():
    assert cv.phone("082 555 0100", "ZA") == (None, "+27825550100")
    assert cv.phone("082 555 0100", "ZAF") == (None, "+27825550100")
    assert cv.phone("0825550100", None, "27") == (None, "+27825550100")
    assert cv.phone("+27 82 555 0100") == (None, "+27825550100")
    assert cv.phone("5550100", "ZA")[0] == "phone_length"
    assert cv.phone("call me", "ZA")[0] == "phone_invalid"
    assert cv.phone("123", None)[0] == "phone_e164"


def test_postcode_format_by_country():
    assert cv.postcode("12", "DE")[0] == "postcode_format"
    assert cv.postcode("10115", "DEU") == (None, "10115")
    assert cv.postcode("anything", "XX") == (None, None)
    assert cv.postcode("1234ab", "NL") == ("postcode_layout", "1234 AB")  # unknown country is not judged


def test_mx_unreachable_resolver_never_condemns(monkeypatch):
    monkeypatch.setattr(cv, "_query", lambda *a, **k: None)
    cv.mx_reason.cache_clear()
    assert cv.mx_reason("example.com") is None
    monkeypatch.setattr(cv, "_query", lambda *a, **k: 0)
    cv.mx_reason.cache_clear()
    assert cv.mx_reason("example.invalid") == "no_mx"
    cv.mx_reason.cache_clear()


def test_every_pack_has_each_kind_and_valid_auto_fix():
    for module in PACKS:
        kinds = {r["kind"] for m, r in RULES.values() if m == module}
        assert kinds == {"email", "disposable", "phone", "postcode"}, module
    for rid, (_, r) in RULES.items():
        assert validate_auto_fix(r) == [], rid


def _run(rid, tables, version="ecc6"):
    module, rule = RULES[rid]
    frames = TableFrames(tables, get_dictionary(version), module=module)
    _, res = run_rule(dict(rule), frames, None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res


def test_sd_rules_fire_with_reasons_and_blank_out_of_scope():
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["C1", "C2", "C3", "C4"], "KNA1.LAND1": ["DE", "DE", "ZA", "ZA"],
                         "KNA1.PSTLZ": ["10115", "1011", "", "0001"],
                         "KNA1.TELF1": ["+49 30 1234567", "12", "082 555 0100", "abc"]})
    pc = _run("SDCM903", {"KNA1": kna1})
    assert (pc.affected_count, pc.total_count) == (1, 3)
    tel = _run("SDCM902", {"KNA1": kna1})
    assert tel.affected_count == 2
    assert set(tel.details["reasons"]) <= set(cv.REASONS)
    by_key = {r["record_key"]: r["reason"] for r in tel.details["sample_failing_records"]}
    assert by_key == {"KUNNR=C2": "phone_length", "KUNNR=C4": "phone_invalid"}
    assert all(r["reason_text"] for r in tel.details["sample_failing_records"])


def test_postcode_layout_fails_and_auto_fix_proposes_standard_layout():
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["C1", "C2"], "KNA1.LAND1": ["GB", "GB"], "KNA1.PSTLZ": ["sw1a1aa", "SW1A 1AA"]})
    res = _run("SDCM903", {"KNA1": kna1})
    assert res.affected_count == 1 and "postcode_layout" in res.details["reasons"]
    _, rule = RULES["SDCM903"]
    assert propose(rule, {"KNA1.PSTLZ": "sw1a1aa", "KNA1.LAND1": "GB"}) == ("SW1A 1AA", "medium")
    assert propose(rule, {"KNA1.PSTLZ": "12", "KNA1.LAND1": "DE"}) is None


def test_mx_rules_sit_beside_email_rules_and_ask_once_per_domain(monkeypatch):
    from checks.types.contact_check import mx_rules
    static = yaml.safe_load(open("checks/rules/ecc/sd_customer_master.yaml"))["rules"]
    rules = mx_rules(static)
    assert [r["id"] for r in rules] == ["SDCM900-MX"] and rules[0]["kind"] == "mx"
    asked = []
    cv.mx_reason.cache_clear()
    monkeypatch.setattr(cv, "_query", lambda d, *a, **k: asked.append(d) or (0 if d == "nomail.test" else 1))
    adr6 = pd.DataFrame({"ADR6.SMTP_ADDR": ["a@nomail.test", "b@nomail.test", "c@ok.test", "bad", ""]})
    _, res = run_rule(rules[0], TableFrames({"ADR6": adr6}, get_dictionary("ecc6"), module="sd_customer_master"), {})
    assert (res.affected_count, res.total_count) == (2, 4)
    assert asked.count("nomail.test") == 2 and asked.count("ok.test") == 1  # MX then A for the failing one
    cv.mx_reason.cache_clear()

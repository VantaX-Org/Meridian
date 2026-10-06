"""ECC HCM pack (PA prefix): loads, full metadata, DDIC fields, privacy, and key rules pass and fail."""

import re
from pathlib import Path

import pandas as pd
import pytest
import yaml

from checks.runner import REGISTRY

PACK = yaml.safe_load(Path("checks/rules/ecc/hcm.yaml").read_text())
RULES = PACK["rules"]
BY_ID = {r["id"]: r for r in RULES}
REQUIRED = ("id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
            "sap_impact", "fix_map", "record_fix_template")
PERSONAL = {"NACHN", "VORNA", "GBDAT", "PERID", "BANKN", "USRID", "BET01", "STEXT", "IBAN"}


def test_pack_loads():
    assert PACK["module"] == "hcm"
    assert 40 <= len(RULES) <= 80
    assert len({r["id"] for r in RULES}) == len(RULES)
    assert all(r["id"].startswith("PA") for r in RULES)


@pytest.mark.parametrize("rule", RULES, ids=lambda r: r["id"])
def test_full_metadata_and_privacy(rule):
    for k in REQUIRED:
        assert rule.get(k), f"{rule['id']} missing {k}"
    assert rule.get("grain")
    for text in (rule["message"], rule["record_fix_template"], *rule["fix_map"].values()):
        for ref in re.findall(r"\{([A-Z0-9_]+)\.([A-Z0-9_]+)\}", text):
            assert ref[1] in ("PERNR", "OBJID"), f"{rule['id']} echoes {ref}"
        assert not PERSONAL & set(re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", text))


def _run(rule_id, df):
    return REGISTRY[BY_ID[rule_id]["check_class"]](BY_ID[rule_id]).evaluate(df)


def test_zero_basic_pay_fails():
    df = pd.DataFrame({"PA0008.BET01": [0, -5, 4200]}, dtype="object")
    df["PA0008.BET01"] = pd.to_numeric(df["PA0008.BET01"])
    assert list(_run("PA022", df).failing) == [True, True, False]


def test_leaver_with_open_user_fails():
    df = pd.DataFrame({
        "PA0000.STAT2": ["0", "0", "3", "0"],
        "PA0105.USRID": ["JDOE", "JDOE", "JDOE", ""],
        "USR02.UFLAG": [0, 64, 0, 0],
        "USR02.GLTGB": [pd.NaT] * 4,
    })
    assert list(_run("PA037", df).failing) == [True, False, False, False]


def test_part_time_flag_contradiction():
    df = pd.DataFrame({"PA0007.TEILK": ["X", "X", "", ""], "PA0007.EMPCT": [100, 50, 60, 100]})
    assert list(_run("PA024", df).failing) == [True, False, True, False]


def test_overlapping_infotype_history_fails():
    df = pd.DataFrame({
        "PA0001.PERNR": ["1", "1", "2", "2"],
        "PA0001.BEGDA": ["20200101", "20210101", "20200101", "20210101"],
        "PA0001.ENDDA": ["20210630", "99991231", "20201231", "99991231"],
    })
    for c in ("BEGDA", "ENDDA"):
        df[f"PA0001.{c}"] = pd.to_datetime(df[f"PA0001.{c}"], format="%Y%m%d", errors="coerce")
    ev = _run("PA044", df)
    assert ev.failing.iloc[1] and not ev.failing.iloc[2:].any()


def test_history_gap_fails_continuous_rule():
    df = pd.DataFrame({
        "PA0001.PERNR": ["1", "1", "2", "2"],
        "PA0001.BEGDA": ["20200101", "20210301", "20200101", "20210101"],
        "PA0001.ENDDA": ["20201231", "99991231", "20201231", "99991231"],
    })
    for c in ("BEGDA", "ENDDA"):
        df[f"PA0001.{c}"] = pd.to_datetime(df[f"PA0001.{c}"], format="%Y%m%d", errors="coerce")
    ev = _run("PA052", df)
    assert ev.failing.sum() > 0 and not ev.failing.iloc[2:].any()


def _blob(res) -> str:
    return repr(res.details)


def test_similarity_evidence_has_no_names():
    rule = {**BY_ID["PA034"]}
    df = pd.DataFrame({
        "PA0002.PERNR": ["100", "101"],
        "PA0002.NACHN": ["Ramaphosaxyz", "Ramaphosaxzy"],
        "PA0002.VORNA": ["Thabo", "Thabo"],
        "PA0002.GBDAT": ["19800101", "19800101"],
    })
    res = REGISTRY[rule["check_class"]](rule).run(df, key_cols=["PA0002.PERNR"], grain="PA0002")
    assert res.details["near_duplicate_pairs"] == [["100", "101"]]
    for secret in ("Ramaphosa", "Thabo", "19800101"):
        assert secret not in _blob(res)


@pytest.mark.parametrize("rid", ["PA033", "PA040"])
def test_regex_on_personal_field_leaks_no_values(rid):
    rule = {**BY_ID[rid]}
    f = rule["field"]
    df = pd.DataFrame({"PA0002.PERNR": ["1"], f: ["Smith99SECRET" if rid == "PA033" else "bad user!SECRET"]})
    res = REGISTRY[rule["check_class"]](rule).run(df, key_cols=["PA0002.PERNR"], grain="PA0002")
    assert res is not None and "SECRET" not in _blob(res)


def test_no_value_echoing_classes_on_personal_fields():
    """referential/domain/format details list raw values; similarity needs evidence_key."""
    sensitive = {"NACHN", "VORNA", "GBDAT", "PERID", "BANKN", "BANKL", "USRID", "STRAS", "ORT01", "PSTLZ"}
    for r in RULES:
        cols = {r["field"], *(r.get("fields") or []), *(r.get("block_by") or [])}
        if not any(c.split(".")[-1] in sensitive for c in cols):
            continue
        assert r["check_class"] not in ("referential_check", "domain_value_check", "format_check"), r["id"]
        if r["check_class"] == "similarity_check":
            assert r.get("evidence_key", "").endswith(".PERNR"), r["id"]

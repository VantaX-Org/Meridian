"""checks/record_context.py: the context stored with each flagged record holds only known codes."""

import re
from collections import defaultdict

import pandas as pd

from checks import lifecycle, record_context
from checks.profiling import is_sensitive
from checks.types.null_check import NullCheck


def test_every_code_column_is_read_by_a_shipped_rule_of_its_module():
    seen: dict[str, set[str]] = defaultdict(set)
    for rule, _ in lifecycle.shipped_rules().values():
        seen[rule.get("module") or ""] |= set(re.findall(r"\b([A-Z][A-Z0-9_/]+\.[A-Z][A-Z0-9_]+)\b", str(rule)))
    missing = {m: [c for c in cols if c not in seen[m]] for m, cols in record_context.CODES.items()}
    assert not {m: c for m, c in missing.items() if c}


def test_no_code_column_is_sensitive():
    for cols in record_context.CODES.values():
        for col in cols:
            table, _, field = col.rpartition(".")
            assert not is_sensitive(table, field), col


def test_snapshot_keeps_only_allowed_codes_capped():
    rule = {"module": "material_master", "field": "MARA.MAKTX",  # free text the rule checks: not kept
            "applies_when": {"MBEW.STPRS": {"gt": 0}, "MARA.MTART": ["FERT"]}}  # amount: not kept
    df = pd.DataFrame({"MARA.MATNR": ["1", "2"], "MARA.MAKTX": ["Pump", "Valve"], "MBEW.STPRS": [10.5, 2.0],
                       "MARA.MTART": ["FERT", "  "], "MARA.MATKL": ["X" * 60, None], "PA0002.GESCH": ["1", "2"],
                       **{c: ["C", "C"] for c in record_context.CODES["material_master"][2:]}})
    snap = record_context.snapshot(df, rule)
    assert len(snap) == 2
    assert all(set(row) <= set(record_context.CODES["material_master"]) for row in snap)
    assert all(len(row) <= record_context.MAX_FIELDS for row in snap)
    assert snap[0]["MARA.MTART"] == "FERT" and snap[0]["MARA.MATKL"] == "X" * record_context.MAX_CHARS
    assert "MARA.MTART" not in snap[1] and "MARA.MATKL" not in snap[1]  # blanks left out
    assert record_context.columns(rule)[0] == "MARA.MTART"  # the rule's own code column first


def test_unknown_module_and_sensitive_columns_store_nothing():
    df = pd.DataFrame({"PERINFO.GENDER": ["M"], "PA0000.STAT2": ["3"]})
    assert record_context.snapshot(df, {"module": "employee_central", "field": "PERINFO.GENDER"}) == [{}]
    assert record_context.columns({"module": "nope", "field": "PA0000.STAT2"}) == []


def test_check_result_context_contains_only_allowed_fields():
    rule = {"id": "MM1", "module": "material_master", "field": "MARC.DISMM", "severity": "high",
            "dimension": "completeness", "message": "MRP type missing"}
    df = pd.DataFrame({"MARC.DISMM": [None, "PD", ""], "MARA.MTART": ["DIEN", "FERT", "HAWA"],
                       "MARA.MAKTX": ["Service", "Pump", "Valve"], "LFA1.NAME1": ["A", "B", "C"]})
    result = NullCheck(rule).run(df)
    assert result.failing_record_context == [{"MARA.MTART": "DIEN"}, {"MARA.MTART": "HAWA"}]

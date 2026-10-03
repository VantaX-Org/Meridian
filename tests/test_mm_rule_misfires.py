"""Material master rules that fired on valid SAP data."""
import re
from pathlib import Path

import pandas as pd
import yaml

from checks.runner import apply_context

RULES = {r["id"]: r for r in yaml.safe_load(
    (Path(__file__).parent.parent / "checks/rules/ecc/material_master.yaml").read_text())["rules"]}


def test_mm002_accepts_special_characters_sap_allows():
    pattern = re.compile(RULES["MM002"]["pattern"])
    for ok in ["04065-05220^14", "(07085-01430)", "AB@1", "A B#+", "000000000000000035", "X"]:
        assert pattern.match(ok), ok
    for bad in ["abc", "04065–01430", " AB", "AB ", "AB ", "A" * 41]:
        assert not pattern.match(bad), bad


def test_mm038_is_not_a_hard_constraint():
    assert RULES["MM038"]["rule_authority"] == "best_practice"
    assert RULES["MM038"]["severity"] == "low"


def test_production_data_rules_skip_special_procurement():
    marc = pd.DataFrame({"MARC.BESKZ": ["X", "X", "X", "E", "F"], "MARC.SOBSL": ["40", "20", "", "52", ""]})
    for rid in ("MM032", "MM083"):
        assert apply_context(marc, RULES[rid]["applies_when"]).index.tolist() == [2, 3], rid

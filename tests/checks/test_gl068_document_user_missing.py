"""GL068: accounting documents without an entering user fail."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_document_user_missing() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL068")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 3, "BKPF.BELNR": ["1", "2", "3"], "BKPF.GJAHR": ["2026"] * 3,
        "BKPF.USNAM": ["JSMITH", "", None],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    assert (r.total_count, r.affected_count) == (3, 2)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=2|GJAHR=2026", "BUKRS=1000|BELNR=3|GJAHR=2026"]

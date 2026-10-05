"""GL062: manual FI journals need a header text or a reference; documents from other modules are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_manual_journal_without_text() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL062")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 5, "BKPF.BELNR": ["1", "2", "3", "4", "5"], "BKPF.GJAHR": ["2026"] * 5,
        "BKPF.AWTYP": ["BKPF", "BKPF", "BKPF", "VBRK", "BKPF"],
        "BKPF.BKTXT": ["Accrual Q1", "", "", "", ""],
        "BKPF.XBLNR": ["", "INV-77", "", "", ""],
        "BKPF.BSTAT": ["", "", "", "", "V"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # 1 has text, 2 has reference, 3 has neither, 4 is a billing document, 5 is parked
    assert (r.total_count, r.affected_count) == (3, 1)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=3|GJAHR=2026"]

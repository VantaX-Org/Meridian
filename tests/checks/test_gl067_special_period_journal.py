"""GL067: manual FI journals posted to special periods 13-16 fail; other modules and parked documents are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_special_period_manual_journal() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL067")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 6, "BKPF.BELNR": ["1", "2", "3", "4", "5", "6"], "BKPF.GJAHR": ["2026"] * 6,
        "BKPF.AWTYP": ["BKPF", "BKPF", "BKPF", "BKPF", "VBRK", "BKPF"],
        "BKPF.MONAT": ["02", "12", "13", "16", "14", "15"],
        "BKPF.BSTAT": ["", "", "", "", "", "V"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # 1-2 regular periods, 3 and 4 special, 5 billing document, 6 parked
    assert (r.total_count, r.affected_count) == (4, 2)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=3|GJAHR=2026", "BUKRS=1000|BELNR=4|GJAHR=2026"]

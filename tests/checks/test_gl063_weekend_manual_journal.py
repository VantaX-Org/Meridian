"""GL063: manual FI journals entered on Saturday or Sunday fail; other modules and parked documents are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_weekend_manual_journal() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL063")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 5, "BKPF.BELNR": ["1", "2", "3", "4", "5"], "BKPF.GJAHR": ["2026"] * 5,
        "BKPF.AWTYP": ["BKPF", "BKPF", "BKPF", "VBRK", "BKPF"],
        # 2026-10-02 Friday, 2026-10-03 Saturday, 2026-10-04 Sunday
        "BKPF.CPUDT": ["20261002", "20261003", "20261004", "20261003", "20261004"],
        "BKPF.BSTAT": ["", "", "", "", "V"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # 1 weekday, 2 Saturday, 3 Sunday, 4 billing document, 5 parked
    assert (r.total_count, r.affected_count) == (3, 2)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=2|GJAHR=2026", "BUKRS=1000|BELNR=3|GJAHR=2026"]

"""GL061: posting date more than 31 days after entry date fails; noted items are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_forward_dated_journal() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL061")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 4, "BKPF.BELNR": ["1", "2", "3", "4"], "BKPF.GJAHR": ["2026"] * 4,
        "BKPF.CPUDT": ["20260105", "20260105", "20260105", "20260105"],
        "BKPF.BUDAT": ["20260131", "20260301", "20260301", "20251201"],
        "BKPF.BSTAT": ["", "", "V", ""],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # doc 1 same month, doc 2 forward-dated 55 days, doc 3 parked, doc 4 backdated (GL060's job)
    assert (r.total_count, r.affected_count) == (3, 1)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=2|GJAHR=2026"]

"""GL069: posted documents sharing company code, document type, reference and document date fail; reversed and parked documents are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_duplicate_posting() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL069")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 6, "BKPF.BELNR": ["1", "2", "3", "4", "5", "6"], "BKPF.GJAHR": ["2026"] * 6,
        "BKPF.BLART": ["KR", "KR", "KR", "SA", "KR", "KR"],
        "BKPF.XBLNR": ["INV-100", "inv 100", "INV-200", "INV-100", "INV-100", "INV-100"],
        "BKPF.BLDAT": ["20260301"] * 6,
        "BKPF.BSTAT": ["", "", "", "", "V", ""],
        "BKPF.STBLG": ["", "", "", "", "", "9000"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # 1 and 2 same reference after normalising, 3 other reference, 4 other type, 5 parked, 6 reversed
    assert (r.total_count, r.affected_count) == (4, 2)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=1|GJAHR=2026", "BUKRS=1000|BELNR=2|GJAHR=2026"]

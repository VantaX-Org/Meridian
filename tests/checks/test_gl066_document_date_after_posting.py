"""GL066: posted documents whose document date is after the posting date fail; parked documents are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_document_date_after_posting_date() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL066")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 5, "BKPF.BELNR": ["1", "2", "3", "4", "5"], "BKPF.GJAHR": ["2026"] * 5,
        "BKPF.BLDAT": ["20260301", "20260315", "20260316", "20260420", "20260420"],
        "BKPF.BUDAT": ["20260315", "20260315", "20260315", "20260331", "20260331"],
        "BKPF.BSTAT": ["", "", "", "", "V"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # 1 earlier, 2 same day, 3 one day later, 4 next period, 5 parked
    assert (r.total_count, r.affected_count) == (4, 2)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=3|GJAHR=2026", "BUKRS=1000|BELNR=4|GJAHR=2026"]

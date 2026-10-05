"""GL070: posted foreign-currency documents without an exchange rate fail; local-currency and parked documents are out of scope."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_fx_document_without_rate() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL070")
    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * 5, "BKPF.BELNR": ["1", "2", "3", "4", "5"], "BKPF.GJAHR": ["2026"] * 5,
        "BKPF.WAERS": ["ZAR", "USD", "USD", "EUR", "USD"],
        "BKPF.HWAER": ["ZAR"] * 5,
        "BKPF.KURSF": ["0.00000", "18.25000", "0.00000", None, None],
        "BKPF.BSTAT": ["", "", "", "", "V"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf}, D, module="fi_gl"))
    # 1 local currency, 2 rate present, 3 zero rate, 4 no rate, 5 parked
    assert (r.total_count, r.affected_count) == (4, 2)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=3|GJAHR=2026", "BUKRS=1000|BELNR=4|GJAHR=2026"]

"""GL064: large round debit lines on manual FI journals fail; small, odd, credit, other-module and parked lines do not."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_round_amount_manual_journal() -> None:
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "GL064")
    bkpf = pd.DataFrame({"BKPF.BUKRS": ["1000"] * 4, "BKPF.BELNR": ["1", "2", "3", "4"], "BKPF.GJAHR": ["2026"] * 4,
                         "BKPF.AWTYP": ["BKPF", "BKPF", "VBRK", "BKPF"], "BKPF.BSTAT": ["", "", "", "V"]})
    bseg = pd.DataFrame({
        "BSEG.BUKRS": ["1000"] * 7, "BSEG.BELNR": ["1", "1", "2", "2", "2", "3", "4"], "BSEG.GJAHR": ["2026"] * 7,
        "BSEG.BUZEI": ["001", "002", "001", "002", "003", "001", "001"],
        "BSEG.DMBTR": ["250000.00", "250000.00", "5000.00", "12345.00", "17345.00", "50000.00", "50000.00"],
        "BSEG.SHKZG": ["S", "H", "S", "S", "H", "S", "S"],
    })
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf, "BSEG": bseg}, D, module="fi_gl"))
    # doc 1 debit line round and large; doc 2 debits small or odd; doc 3 billing; doc 4 parked; credits out of scope
    assert (r.total_count, r.affected_count) == (3, 1)
    assert r.failing_record_keys == ["BUKRS=1000|BELNR=1|GJAHR=2026|BUZEI=001"]

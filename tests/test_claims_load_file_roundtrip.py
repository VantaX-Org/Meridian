"""Claim: the load files Meridian exports re-import with every value intact (leading zeros, signs, long ids)."""
import io
import zipfile

import openpyxl
import pandas as pd

from api.services.migration import export as ex

FRAME = pd.DataFrame({"MATNR": ["000000000000012345", "000000000000000007"], "KUNNR": ["0000100001", "0000100002"],
                      "BALANCE": ["-12.50", "+27 82 555 0101"], "TXT": ["a@b.co", "Café über"]})
TABLES = {"MARA": FRAME, "KNA1": FRAME.copy(), "A" * 40: FRAME.copy()}


def test_xlsx_round_trip_is_byte_for_byte_and_in_load_order():
    wb = openpyxl.load_workbook(io.BytesIO(ex.to_xlsx(TABLES, keep_order=True)))
    assert wb.sheetnames[:2] == ["MARA", "KNA1"]
    back = pd.read_excel(io.BytesIO(ex.to_xlsx(TABLES)), sheet_name="MARA", dtype=str)
    pd.testing.assert_frame_equal(back, FRAME)


def test_csv_zip_round_trip_and_step_prefixes():
    z = zipfile.ZipFile(io.BytesIO(ex.to_csv_zip(TABLES, keep_order=True)))
    assert z.namelist()[:2] == ["01_MARA.csv", "02_KNA1.csv"]
    back = pd.read_csv(io.BytesIO(z.read("01_MARA.csv")), dtype=str)
    pd.testing.assert_frame_equal(back, FRAME)


def test_readme_config_impact_rule_count_matches_seed():
    import re
    from pathlib import Path
    import yaml
    root = Path(__file__).resolve().parents[1]
    n = len(yaml.safe_load((root / "db/seeds/config_impact_rules.yaml").read_text())["rules"])
    readme = (root / "README.md").read_text()
    assert f"{n} feature impact rules" in readme and f"{n} config impact rules" in readme

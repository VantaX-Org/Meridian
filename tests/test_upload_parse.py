"""Upload parsing fidelity (synthetic data only): text kept as typed, honest encoding, zip-bomb guard, PII words."""
import io
import zipfile

import pandas as pd
import pytest
from fastapi import HTTPException

from api.routes.upload import _read_frame, _sanitise_formula_injection
from api.services import sf_roundtrip
from api.services.migration import workbook_formats
from api.utils.pii_fields import is_pii_header


def test_csv_keeps_leading_zeros_and_na_codes():
    df = _read_frame(b"KUNNR,LAND1,ORT01\n00123,NA,\n0000012345,NULL,Windhoek\n", "csv")
    assert df["KUNNR"].tolist() == ["00123", "0000012345"]
    assert df["LAND1"].tolist() == ["NA", "NULL"]
    assert df["ORT01"].isna().tolist() == [True, False]  # only an empty cell is blank


def test_xlsx_keeps_text_codes():
    buf = io.BytesIO()
    pd.DataFrame({"MATNR": ["000000000000000123"], "LAND1": ["NA"]}).to_excel(buf, index=False)
    df = _read_frame(buf.getvalue(), "xlsx")
    assert df.to_dict("list") == {"MATNR": ["000000000000000123"], "LAND1": ["NA"]}


def test_utf8_bom_is_not_part_of_the_first_header():
    df = _read_frame("﻿KUNNR,NAME1\n1,Мария\n".encode("utf-8"), "csv")
    assert list(df.columns) == ["KUNNR", "NAME1"] and df["NAME1"].tolist() == ["Мария"]


@pytest.mark.parametrize("text,encoding", [("NAME1\nMüller\n", "cp1252"), ("NAME1\nمحمد\n", "cp1256")])
def test_non_utf8_csv_is_refused_not_guessed(text, encoding):
    with pytest.raises(HTTPException) as e:
        _read_frame(text.encode(encoding), "csv")
    assert e.value.status_code == 422 and e.value.detail["error"] == "unsupported_encoding"


def test_signed_numbers_are_not_quoted_but_formulas_are():
    df = pd.DataFrame({"X": ["-12.50", "+5", "=1+1", "@SUM(A1)", "-1+cmd", "ok"]})
    out = _sanitise_formula_injection(df, set())
    assert out["X"].tolist() == ["-12.50", "+5", "'=1+1", "'@SUM(A1)", "'-1+cmd", "ok"]


def _zip(entries: int, size: int = 0) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i in range(entries):
            z.writestr(f"xl/p{i}.xml", b"\0" * size)
    return buf.getvalue()


def test_xlsx_with_too_many_parts_is_refused_before_parsing():
    with pytest.raises(HTTPException) as e:
        _read_frame(_zip(workbook_formats.MAX_ZIP_ENTRIES + 1), "xlsx")
    assert e.value.status_code == 413


def test_xlsx_too_large_unpacked_is_refused(monkeypatch):
    monkeypatch.setattr(workbook_formats, "MAX_UNPACKED_BYTES", 1000)
    with pytest.raises(HTTPException) as e:
        _read_frame(_zip(1, 2000), "xlsx")
    assert e.value.status_code == 413


def test_roundtrip_upload_has_the_same_guard():
    with pytest.raises(sf_roundtrip.RoundTripError, match="parts"):
        sf_roundtrip.read_upload(_zip(workbook_formats.MAX_ZIP_ENTRIES + 1), "edited.xlsx")


@pytest.mark.parametrize("header", ["Gender", "sex", "Marital status", "Religion", "ethnicGroup", "Race",
                                    "Disability", "healthCondition", "Medical aid", "NationalId"])
def test_special_category_headers_are_personal(header):
    assert is_pii_header(header)


def test_sf_pay_tables_are_masked_in_profiles():
    from checks.profiling import is_sensitive
    assert is_sensitive("EMPPAYCOMPRECURRING", "PAYCOMPVALUE") and is_sensitive("EMPCOMPENSATION", "X")

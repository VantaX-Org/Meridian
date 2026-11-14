"""Pure upload checks: value length and type against field metadata, download refusal (synthetic data only)."""
import pytest

from api.services import upload_checks as uc
from api.services.cleaning_workbook import DownloadRefused, refuse_download
from sap.ddic import Dictionary, Field


class _Dict:
    def __init__(self, *fields):
        self.f = {(x.table, x.name): x for x in fields}

    def field(self, t, n):
        return self.f.get((t, n))


def _e(v, field="F"):
    return {"table": "T", "field": field, "key": "k", "value": v}


def test_value_length_and_type_against_field_metadata():
    d = _Dict(Field("T", "C", False, "CHAR", 3), Field("T", "N", False, "NUMC", 4), Field("T", "D", False, "DATS", 8),
              Field("T", "Q", False, "DEC", 9, 2))
    ok = [_e("abc", "C"), _e("0012", "N"), _e("20260101", "D"), _e("12.50", "Q"), _e("", "C"), _e("x", "UNKNOWN")]
    assert uc.check_values(ok, d)["status"] == "pass"
    for bad in (_e("abcd", "C"), _e("12a", "N"), _e("1 Jan", "D"), _e("twelve", "Q")):
        assert uc.check_values([bad], d)["status"] == "fail"


def test_download_refused_for_unfinished_or_wrong_object():
    refuse_download({"status": "complete", "modules": ["a"]}, "a")
    with pytest.raises(DownloadRefused) as e:
        refuse_download({"status": "running", "modules": ["a"]}, "a")
    assert e.value.status == 409
    with pytest.raises(DownloadRefused) as e:
        refuse_download({"status": "complete", "modules": '["a"]'}, "b")
    assert e.value.status == 422


def test_fingerprint_has_every_field_and_columns_hash_is_order_sensitive():
    fp = uc.fingerprint("cleaning", "t", "s", ["A", "B"], 3)
    assert set(fp) == {"tenant", "system", "template_id", "template_version", "columns", "rows", "generated_at"}
    assert uc.columns_hash(["A", "B"]) != uc.columns_hash(["B", "A"])


def test_marker_carries_the_fingerprint():
    from api.services.sf_roundtrip import marker_rows
    keys = {r["key"] for r in marker_rows("v", "m", "cleaning", None, uc.fingerprint("cleaning", "t", "s", ["A"], 1))}
    assert {"version_id", "module", "tenant", "system", "template_id", "template_version", "columns", "rows",
            "generated_at"} <= keys

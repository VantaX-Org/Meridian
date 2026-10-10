"""Root cause by origin from change documents: deterministic, read-only."""

import pandas as pd
import pytest

from api.services import root_cause as rc
from sap.base import SAPConnectorError
from sap.ddic import get_dictionary

from tests.sap.fake_rfc import _filter

D = get_dictionary("ecc6")


def _tk(matnr: str, werks: str) -> str:
    return "100" + matnr.ljust(18) + werks


def _sap() -> dict[str, pd.DataFrame]:
    cdpos = pd.DataFrame([
        ["MATERIAL", "M1", "0000000010", "MARC", _tk("M1", "1000"), "DISMM", "U"],
        ["MATERIAL", "M2", "0000000011", "MARC", _tk("M2", "1000"), "DISMM", "U"],
        ["MATERIAL", "M3", "0000000001", "MARC", _tk("M3", "1000"), "KEY", "I"],
        ["MATERIAL", "M4", "0000000012", "MARC", _tk("M4", "1000"), "DISMM", "U"],
        ["MATERIAL", "M4", "0000000013", "MARC", _tk("M4", "2000"), "DISMM", "U"],  # other plant: ignored
    ], columns=["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND"])
    cdhdr = pd.DataFrame([
        ["MATERIAL", "M1", "0000000010", "BATCH_IF01", "20240301", "MM02", "U"],
        ["MATERIAL", "M2", "0000000011", "BATCH_IF01", "20240302", "MM02", "U"],
        ["MATERIAL", "M3", "0000000001", "JDOE", "20150101", "MM01", "I"],
        ["MATERIAL", "M4", "0000000012", "JDOE", "20240303", "MM02", "U"],
        ["MATERIAL", "M4", "0000000013", "XUSER", "20240304", "MM02", "U"],
    ], columns=["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "TCODE", "CHANGE_IND"])
    usr02 = pd.DataFrame({"BNAME": ["BATCH_IF01", "JDOE", "XUSER"], "USTYP": ["B", "A", "A"]})
    return {"CDPOS": cdpos, "CDHDR": cdhdr, "USR02": usr02}


def _reader(db: dict[str, pd.DataFrame], deny: frozenset[str] = frozenset()) -> rc.Reader:
    def read(table: str, fields: list[str], wheres: list[str]) -> pd.DataFrame:
        if table in deny:
            raise SAPConnectorError("NOT_AUTHORIZED")
        parts = [_filter(db[table], w) for w in wheres]
        return (pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=fields))[fields]
    return read


RECORDS = {("material_master", "MMTEST"): [f"MATNR={m}|WERKS=1000" for m in ("M1", "M2", "M3", "M4")]}


@pytest.fixture(autouse=True)
def _field(monkeypatch):
    monkeypatch.setattr(rc, "rule_field", lambda module, check_id: "MARC.DISMM" if check_id == "MMTEST" else None)


def test_parse_record_key_and_tabkey():
    v = rc.parse_record_key("MATNR=M1|WERKS=1000")
    assert v == {"MATNR": "M1", "WERKS": "1000"}
    assert rc.tabkey("MARC", v, D) == ("M1".ljust(18) + "1000")
    assert rc.tabkey("MARC", {"MATNR": "M1"}, D) is None


def test_classify_orders_migration_then_interface_then_dialog():
    assert rc.classify("BATCH", "20150101", "B", True, "20160101") == "migration"
    assert rc.classify("BATCH", "20240101", "S", False, "20160101") == "interface"
    assert rc.classify("JDOE", "20240101", "A", False, None) == "dialog"
    assert rc.classify("", "", "", False, None) == "unknown"


def test_root_causes_group_failing_values_by_origin():
    (out,) = rc.root_causes(_reader(_sap()), RECORDS, "20160101", D)
    assert (out.status, out.field, out.analysed, out.total) == ("computed", "MARC.DISMM", 4, 4)
    assert out.origins == [
        {"origin": "interface", "username": "BATCH_IF01", "tcode": "MM02", "records": 2, "share": 50.0},
        {"origin": "dialog", "username": "JDOE", "tcode": "MM02", "records": 1, "share": 25.0},
        {"origin": "migration", "username": "JDOE", "tcode": "MM01", "records": 1, "share": 25.0},
    ]
    assert out.summary == "50% of failing MARC.DISMM values were last set by interface/batch user BATCH_IF01 via MM02."


def test_record_without_change_documents_is_unknown():
    (out,) = rc.root_causes(_reader(_sap()), {("material_master", "MMTEST"): ["MATNR=M9|WERKS=1000"]}, None, D)
    assert out.origins == [{"origin": "unknown", "username": "", "tcode": "", "records": 1, "share": 100.0}]
    assert out.summary == "100% of failing MARC.DISMM values have no change document."


def test_unauthorised_usr02_classifies_users_as_dialog():
    (out,) = rc.root_causes(_reader(_sap(), frozenset({"USR02"})), RECORDS, "20160101", D)
    assert out.origins[0]["origin"] == "dialog" and out.origins[0]["username"] == "BATCH_IF01"


def test_unauthorised_cdpos_marks_the_check_unavailable():
    (out,) = rc.root_causes(_reader(_sap(), frozenset({"CDPOS"})), RECORDS, None, D)
    assert out.status == "unavailable" and "NOT_AUTHORIZED" in out.detail and out.total == 4


def test_rule_on_a_table_without_change_documents_is_not_applicable():
    (out,) = rc.root_causes(_reader(_sap()), {("x", "OTHER"): ["BELNR=1"]}, None, D)
    assert out.status == "not_applicable" and out.total == 1


def test_rule_field_reads_the_shipped_yaml():
    from api.services.tenant_seed import raw_rules
    module, r = next((m, r) for _, _, m, r in raw_rules() if isinstance(r.get("field"), str))
    assert rc._rule_fields()[(module, str(r["id"]))] == r["field"]


def test_fnames_beyond_the_first_100_are_still_read_from_cdpos(monkeypatch):
    """With 101+ distinct FNAMEs across the plans sharing one OBJECTCLAS, a field past the
    first IN-list chunk must still be matched in CDPOS, not silently dropped to creation."""
    n = 101
    fields = {f"C{i:03d}": f"F{i:03d}" for i in range(n)}
    monkeypatch.setattr(rc, "rule_field", lambda module, check_id: f"MARC.{fields[check_id]}")
    records = {("material_master", cid): [f"MATNR=M{cid[1:]}|WERKS=1000"] for cid in fields}

    last_id, last_fname = "C100", fields["C100"]
    cdpos = pd.DataFrame([
        ["MATERIAL", f"M{last_id[1:]}", "0000000001", "MARC", _tk(f"M{last_id[1:]}", "1000"), "KEY", "I"],
        ["MATERIAL", f"M{last_id[1:]}", "0000000002", "MARC", _tk(f"M{last_id[1:]}", "1000"), last_fname, "U"],
    ], columns=["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND"])
    cdhdr = pd.DataFrame([
        ["MATERIAL", f"M{last_id[1:]}", "0000000001", "JDOE", "20100101", "MM01", "I"],
        ["MATERIAL", f"M{last_id[1:]}", "0000000002", "BATCH_IF01", "20240301", "MM02", "U"],
    ], columns=["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "TCODE", "CHANGE_IND"])
    usr02 = pd.DataFrame({"BNAME": ["BATCH_IF01", "JDOE"], "USTYP": ["B", "A"]})
    sap = {"CDPOS": cdpos, "CDHDR": cdhdr, "USR02": usr02}

    out = {o.check_id: o for o in rc.root_causes(_reader(sap), records, "20160101", D)}
    last = out[last_id]
    # Fixed: the 101st FNAME's own change is read, attributing it to the interface user who
    # made it, not to the creator (which would wrongly classify it as "migration").
    assert last.origins == [{"origin": "interface", "username": "BATCH_IF01", "tcode": "MM02",
                             "records": 1, "share": 100.0}]

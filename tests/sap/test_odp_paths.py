"""The ODP mapping (sap/odp_mappings.yaml), the plan's per-table path choice and the extraction's fallback."""
from __future__ import annotations

import pandas as pd
import pytest

from sap.ddic import get_dictionary
from sap.extraction_plan import TablePlan, choose_read_paths, resolve_extraction_path
from sap.odp import FN_OPEN
from sap.odp_mapping import ODPMapping, best_mapping, mappings, to_table_frame
from tests.sap.fake_odp import ODPConnection, ODPState, Provider
from tests.sap.fake_rfc import FakeRFCConnector


def test_every_mapped_field_is_a_field_of_its_table():
    d = get_dictionary("ecc6")
    assert {m.odp for m in mappings()} >= {"0MATERIAL_ATTR", "0MAT_PLANT_ATTR", "0CUSTOMER_ATTR", "0VENDOR_ATTR",
                                           "0GL_ACCOUNT_ATTR", "IPRODUCT", "ICUSTOMER", "ISUPPLIER", "IBUSINESSPARTNER"}
    for m in mappings():
        for f in m.fields:
            assert d.field(m.table, f) is not None, f"{m.odp}: {m.table}.{f} is not a field of {m.table}"
        assert all(k in m.fields for k in d.keys(m.table)), f"{m.odp} must map the key of {m.table}"
        if m.context == "ABAP_CDS":
            assert m.systems == ("s4hana_onprem",) and m.confirm


def test_best_mapping_prefers_the_provider_that_covers_most():
    assert best_mapping("MARA", "ecc", ["MATNR", "MTART"]).odp == "0MATERIAL_ATTR"
    assert best_mapping("MARA", "ewm", ["MATNR"]) is None
    assert best_mapping("BUT000", "ecc", ["PARTNER"]) is None  # the CDS view is S/4 only
    assert best_mapping("BUT000", "s4hana_onprem", ["PARTNER", "TYPE"]).odp == "IBUSINESSPARTNER"


def _plans(**over) -> dict[str, TablePlan]:
    plans = {
        "KNA1": TablePlan("KNA1", fields={"LAND1", "KTOKD"}, keys=["KUNNR"]),
        "LFA1": TablePlan("LFA1", fields={"LAND1", "NAME1"}, keys=["LIFNR"]),
        "MARC": TablePlan("MARC", fields={"DISMM"}, keys=["MATNR", "WERKS"], where="WERKS IN ('1000')"),
        "LFB1": TablePlan("LFB1", fields={"AKONT"}, keys=["LIFNR", "BUKRS"]),
    }
    plans.update(over)
    return plans


def test_auto_never_chooses_odp_over_rfc_even_where_a_mapping_covers_every_field():
    """SAP Note 3255746: ODP over RFC only on an explicit choice, never by itself."""
    paths = choose_read_paths(_plans(), "auto", "ecc", odp_available=True)
    assert paths["KNA1"].path == "table_reader" and "3255746" in paths["KNA1"].reason
    assert paths["LFA1"].path == "table_reader" and paths["LFA1"].unavailable == ["NAME1"]
    assert paths["LFB1"].path == "table_reader" and paths["LFB1"].reason == "no ODP provider is mapped for this table"


def test_auto_without_the_functions_keeps_the_table_reader():
    paths = choose_read_paths(_plans(), "auto", "ecc", odp_available=False)
    assert paths["KNA1"].path == "table_reader"


def test_explicit_odp_reads_mapped_tables_through_odp_and_reports_what_it_lacks():
    paths = choose_read_paths(_plans(), "odp", "ecc", odp_available=False)
    assert paths["LFA1"].path == "odp" and paths["LFA1"].unavailable == ["NAME1"]
    assert paths["KNA1"].path == "odp"
    assert paths["LFB1"].path == "table_reader"


@pytest.mark.parametrize("setting,system", [("table_reader", "ecc"), ("odata", "s4hana_onprem"), ("odp", "s4hana_cloud")])
def test_other_settings_never_choose_odp(setting, system):
    assert {p.path for p in choose_read_paths(_plans(), setting, system, True).values()} == {"table_reader"}
    assert all(p.reason is None for p in choose_read_paths(_plans(), setting, system, True).values())


def test_resolve_extraction_path(monkeypatch):
    monkeypatch.delenv("MERIDIAN_EXTRACTION_PATH", raising=False)
    assert resolve_extraction_path(None) == "table_reader"
    assert resolve_extraction_path("AUTO") == "auto"
    monkeypatch.setenv("MERIDIAN_EXTRACTION_PATH", "odp")
    assert resolve_extraction_path("") == "odp"
    with pytest.raises(ValueError):
        resolve_extraction_path("rfc_read_table")


def test_to_table_frame_renames_and_names_what_the_provider_did_not_deliver():
    m = ODPMapping("ICUSTOMER", "ABAP_CDS", "KNA1", ("s4hana_onprem",), {"KUNNR": "Customer", "LAND1": "Country"})
    rows = pd.DataFrame({"CUSTOMER": [" C1", "C2"], "COUNTRY": ["ZA", "DE "]})
    df, missing = to_table_frame(rows, m, ["KUNNR", "LAND1", "NAME1"])
    assert list(df.columns) == ["KUNNR", "LAND1"] and df["KUNNR"].tolist() == ["C1", "C2"]
    assert df["LAND1"].tolist() == ["ZA", "DE"] and missing == ["NAME1"]


# ── End to end through ConnectivityManager.extract ─────────────────────────────

LFA1 = pd.DataFrame({"MANDT": ["100"] * 3, "LIFNR": ["V1", "V2", "V3"], "NAME1": ["A", "", "C"],
                     "KTOKK": ["KRED", "KRED", "ZZZZ"], "LAND1": ["ZA"] * 3, "ADRNR": ["1", "2", "3"]})
LFB1 = pd.DataFrame({"MANDT": ["100"] * 2, "LIFNR": ["V1", "V2"], "BUKRS": ["1000", "1000"],
                     "AKONT": ["160000", ""], "ZWELS": ["T", "C"], "ZTERM": ["0001"] * 2})
VENDOR_FIELDS = [("LIFNR", 10, True), ("LAND1", 3, False), ("ORT01", 35, False), ("PSTLZ", 10, False),
                 ("REGIO", 3, False), ("KTOKK", 4, False)]  # BRSCH is mapped but absent on this "release"


def _extract(monkeypatch, setting: str, state: ODPState, modules=("accounts_payable",)):
    from api.services import connectivity_manager as cm

    fake = FakeRFCConnector({})
    conn = fake._conn = ODPConnection({"LFA1": LFA1, "LFB1": LFB1}, state)

    class Mgr(cm.ConnectivityManager):
        def __init__(self):
            self.tenant_id, self.session = "t", None

        def _load_system(self, sid):
            return type("R", (), {"system_type": "ecc", "id": sid})()

        def _build_connection_params(self, row):
            return {"system_type": "ecc", "extraction_path": setting}

        def _get_connector(self, system_type, params):
            return fake

    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    reports: list[dict] = []
    frames, coverage = Mgr().extract("sys", list(modules), progress=reports.append)
    return frames, {c["table"]: c for c in coverage}, conn, reports


def _vendor_state(**kw) -> ODPState:
    rows = LFA1.assign(ORT01="", PSTLZ="", REGIO="")
    return ODPState(providers={("SAPI", "0VENDOR_ATTR"): Provider(VENDOR_FIELDS, rows, package_rows=2)}, **kw)


def test_explicit_odp_reads_lfa1_through_odp_and_the_rest_with_the_table_reader(monkeypatch):
    frames, cov, conn, reports = _extract(monkeypatch, "odp", _vendor_state())
    lfa1 = cov["LFA1"]
    assert lfa1["status"] == "live" and lfa1["path"] == "odp" and lfa1["odp_provider"] == "0VENDOR_ATTR"
    assert lfa1["rows"] == 3 and lfa1["odp_packages"] == 2 and lfa1["complete"] is True
    assert "NAME1" in lfa1["odp_unavailable_fields"]  # a field not in the mapping
    assert "BRSCH" not in frames["LFA1"].columns and "LFA1.NAME1" not in frames["LFA1"].columns
    assert frames["LFA1"]["LFA1.LIFNR"].tolist() == ["V1", "V2", "V3"]
    assert not any(fm == "RFC_READ_TABLE" and p["QUERY_TABLE"] == "LFA1" for fm, p in conn.calls)
    assert cov["LFB1"]["path"] == "table_reader" and cov["LFB1"]["reader"] == "RFC_READ_TABLE"
    assert cov["LFB1"]["odp_fallback"] == "no ODP provider is mapped for this table"
    first = {t["table"]: t for t in reports[0]["tables"]}
    assert first["LFA1"]["path"] == "odp" and first["LFA1"]["provider"] == "0VENDOR_ATTR"
    assert first["LFB1"]["path"] == "table_reader"


def test_auto_falls_back_to_the_table_reader_when_the_mapping_lacks_needed_fields(monkeypatch):
    frames, cov, conn, _ = _extract(monkeypatch, "auto", _vendor_state())
    assert cov["LFA1"]["path"] == "table_reader" and "NAME1" in cov["LFA1"]["odp_unavailable_fields"]
    assert "3255746" in cov["LFA1"]["odp_fallback"]
    assert "LFA1.NAME1" in frames["LFA1"].columns
    assert FN_OPEN not in conn.odp_calls()


def test_auto_keeps_the_table_reader_even_when_the_mapping_covers_the_need(monkeypatch):
    from sap import odp_mapping
    from sap.extraction_plan import plan_modules

    need = plan_modules(["accounts_payable"], get_dictionary("ecc6"))["LFA1"].columns()
    full = ODPMapping("0VENDOR_ATTR", "SAPI", "LFA1", ("ecc",), {f: f for f in need})
    monkeypatch.setattr(odp_mapping, "mappings", lambda: (full,))
    rows = pd.DataFrame({f: LFA1[f] if f in LFA1 else "" for f in need})
    state = ODPState(providers={("SAPI", "0VENDOR_ATTR"): Provider([(f, 40, f == "LIFNR") for f in need], rows)})
    frames, cov, conn, _ = _extract(monkeypatch, "auto", state)
    assert cov["LFA1"]["path"] == "table_reader" and "3255746" in cov["LFA1"]["odp_fallback"]
    assert FN_OPEN not in conn.odp_calls()


def test_auto_without_the_functions_reads_everything_with_the_table_reader(monkeypatch):
    _, cov, conn, _ = _extract(monkeypatch, "auto", _vendor_state(missing={FN_OPEN}))
    assert cov["LFA1"]["path"] == "table_reader" and cov["LFA1"]["status"] == "live"
    assert not conn.odp_calls()


def test_explicit_odp_with_a_missing_function_fails_that_table_only(monkeypatch):
    _, cov, _, _ = _extract(monkeypatch, "odp", _vendor_state(missing={FN_OPEN}))
    assert cov["LFA1"]["status"] == "failed" and cov["LFA1"]["path"] == "odp"
    assert "RODPS_REPL_ODP_OPEN is not available on this system" in cov["LFA1"]["detail"]
    assert cov["LFB1"]["status"] == "live"


def test_table_reader_setting_reports_the_reader_and_no_odp(monkeypatch):
    _, cov, conn, _ = _extract(monkeypatch, "table_reader", _vendor_state())
    assert cov["LFA1"]["path"] == "table_reader" and "odp_fallback" not in cov["LFA1"]
    assert not conn.odp_calls()

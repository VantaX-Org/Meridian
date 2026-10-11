"""Process-event extraction plan (spec §1): windows, slices, via edges, MATDOC guard, cloud targets."""

from datetime import date

import pandas as pd
import pytest

from sap import extraction_plan as ep
from sap.ddic import get_dictionary
from sap.extraction_registry import process_event_targets

TODAY = date(2026, 10, 11)
ECC, S4 = get_dictionary("ecc6"), get_dictionary("s4hana")


def _plan(modules: list[str], system_type: str = "ecc", scope: dict | None = None) -> dict[str, ep.TablePlan]:
    return ep.plan_modules(modules, S4 if system_type == "s4hana_onprem" else ECC, scope,
                           system_type=system_type, today=TODAY)


def test_month_slices_cover_window_and_last_is_open() -> None:
    s = ep.month_slices("AEDAT", date(2026, 8, 15), TODAY)
    assert s == ["AEDAT >= '20260815' AND AEDAT < '20260901'",
                 "AEDAT >= '20260901' AND AEDAT < '20261001'",
                 "AEDAT >= '20261001'"]


def test_month_slices_bounded_end_and_timestamp_suffix() -> None:
    s = ep.month_slices("CONFIRMED_AT", date(2026, 9, 20), TODAY, end=date(2026, 10, 2), suffix="000000")
    assert s == ["CONFIRMED_AT >= '20260920000000' AND CONFIRMED_AT < '20261001000000'",
                 "CONFIRMED_AT >= '20261001000000' AND CONFIRMED_AT < '20261003000000'"]


def test_day_slices_keep_the_rest_of_the_where() -> None:
    out = ep.day_slices("BUDAT >= '20260930' AND BUDAT < '20261002' AND WERKS = '1000'")
    assert out == ["BUDAT >= '20260930' AND BUDAT < '20261001' AND WERKS = '1000'",
                   "BUDAT >= '20261001' AND BUDAT < '20261002' AND WERKS = '1000'"]


def test_ptp_plan_tables_windows_and_edges() -> None:
    p = _plan(["process_events_ptp"])
    assert set(p) == {"EKKO", "EKPO", "EBAN", "EKBE", "RBKP", "BKPF", "BSAK", "CDHDR", "CDPOS", "USR02"}
    assert p["EKKO"].slices[0] == "AEDAT >= '20241011' AND AEDAT < '20241101'"
    assert len(p["EKKO"].slices) == 25 and p["EKKO"].partial
    assert p["EKPO"].via == "EKKO" and not p["EKPO"].slices
    assert p["EKBE"].via == "EKPO"
    assert (p["BSAK"].via, p["BSAK"].in_field, p["BSAK"].group_field) == ("BKPF", "BELNR", "BUKRS")
    assert all("AWTYP = 'RMRP'" in s for s in p["BKPF"].slices)
    assert all("OBJECTCLAS IN ('EINKBELEG','BANF','KRED')" in s for s in p["CDHDR"].slices)
    assert (p["CDPOS"].via, p["CDPOS"].in_field, p["CDPOS"].group_field) == ("CDHDR", "OBJECTID", "OBJECTCLAS")
    assert "FNAME IN ('FRGZU','FRGKE','MENGE','NETPR','EINDT','LOEKZ','KEY')" in p["CDPOS"].where
    assert p["USR02"].purpose == "config" and p["USR02"].fields == {"BNAME", "USTYP", "CLASS"}
    assert "VBFA" not in p and "BSEG" not in p


def test_bkpf_merges_ptp_24m_with_r2r_12m() -> None:
    s = _plan(["process_events_ptp", "process_events_r2r"])["BKPF"].slices
    assert len(s) == 25
    assert "AWTYP = 'RMRP'" in s[0]          # 2024-10: only PTP's 24 months cover it
    assert "AWTYP" not in s[-1]              # 2026-10: R2R covers it, every BKPF row is needed


def test_pp_pm_merge_autyp_and_bwart() -> None:
    p = _plan(["process_events_pp", "process_events_pm"])
    assert "((AUTYP = '10') OR (AUTYP = '30'))" in p["AUFK"].slices[0]
    assert "BWART IN ('101','102','261','262')" in p["MSEG"].where
    assert "MATDOC" not in p and p["MSEG"].via == "MKPF"


def test_matdoc_only_on_s4_onprem_with_guard() -> None:
    p = _plan(["process_events_pp"], "s4hana_onprem")
    assert "MKPF" not in p and "MSEG" not in p
    m = p["MATDOC"]
    assert m.keys == [] and m.max_slice_rows == 30000 and m.split_by == {"WERKS": "T001W"}
    assert all("RECORD_TYPE = 'MDOC'" in s and s.startswith("BUDAT >= ") for s in m.slices)
    assert len(m.fields) == 19
    assert p["T001W"].purpose == "config"
    order = ep.read_order(p)
    assert order.index("T001W") < order.index("MATDOC")


def test_jcds_reads_via_both_order_and_wbs_parents() -> None:
    p = _plan(["process_events_pp", "process_events_ps"])
    assert (p["JCDS"].via, p["JCDS"].also_via) == ("AUFK", ["PRPS"])
    order = ep.read_order(p)
    assert order.index("AUFK") < order.index("JCDS") and order.index("PRPS") < order.index("JCDS")
    assert _plan(["process_events_ps"])["JCDS"].via == "PRPS"


def test_qmel_iwerk_is_dropped_and_reported() -> None:
    p = _plan(["process_events_pm"])
    assert "IWERK" not in p["QMEL"].fields and p["QMEL"].partial
    assert ep.process_event_gaps(["process_events_pm"], ECC, "ecc") == {"QMEL": ["IWERK"]}


def test_wh_routes_by_system_type() -> None:
    assert {"LTAK", "LTAP"} <= set(_plan(["process_events_wh"]))
    ewm = _plan(["process_events_wh"], "ewm")
    assert "/SCWM/ORDIM_C" in ewm and "LTAK" not in ewm
    assert ewm["/SCWM/ORDIM_C"].slices[0] == "CONFIRMED_AT >= '20251011000000' AND CONFIRMED_AT < '20251101000000'"


def test_incremental_scope_moves_the_window_start() -> None:
    s = _plan(["process_events_otc"], scope={"date_from": "2026-09-27"})["VBAK"].slices
    assert s == ["ERDAT >= '20260927' AND ERDAT < '20261001'", "ERDAT >= '20261001'"]


def test_mixed_dq_and_process_modules_keep_dq_windows() -> None:
    dq = ep.plan_modules(["mm_purchasing"], ECC)
    mixed = ep.plan_modules(["mm_purchasing", "process_events_ptp"], ECC, today=TODAY)
    assert mixed["EKKO"].where == dq["EKKO"].where and not mixed["EKKO"].slices
    assert {"AEDAT", "ERNAM", "EKGRP"} <= mixed["EKKO"].fields
    assert "process_events_ptp" in mixed["EKKO"].modules


def test_via_filters_group_and_in_field() -> None:
    rows = pd.DataFrame({"OBJECTCLAS": ["KRED", "BANF", "KRED"], "OBJECTID": ["0001", "0002", "0003"],
                         "CHANGENR": ["9", "8", "7"]})
    out = ep.via_filters("CDPOS", "CDHDR", rows, in_field="OBJECTID", group_field="OBJECTCLAS")
    assert out == ["OBJECTCLAS = 'BANF' AND OBJECTID IN ('0002')",
                   "OBJECTCLAS = 'KRED' AND OBJECTID IN ('0001','0003')"]
    bk = pd.DataFrame({"BUKRS": ["1000"], "BELNR": ["5100000001"], "GJAHR": ["2026"]})
    assert ep.via_filters("BSAK", "BKPF", bk, extra_edges=ep.pe_edges(), in_field="BELNR",
                          group_field="BUKRS") == ["BUKRS = '1000' AND BELNR IN ('5100000001')"]


def test_matdoc_in_s4_dictionary_only() -> None:
    assert S4.table("MATDOC") is not None and ECC.table("MATDOC") is None
    assert {"RECORD_TYPE", "BUDAT", "WERKS", "VBELN_IM"} <= set(S4.table("MATDOC").fields)


@pytest.mark.parametrize("system_type,module,names", [
    ("successfactors", "process_events_sfx", ["JobRequisition", "JobApplication", "EmpJob", "EmployeeTime"]),
    ("ariba", "process_events_arb", ["suppliers", "contracts", "requisitions"]),
    ("concur", "process_events_cnq", ["reports", "entries"]),
])
def test_cloud_targets(system_type: str, module: str, names: list[str]) -> None:
    got = process_event_targets(system_type, module, today=TODAY)
    assert [n for n, _ in got] == names
    by = dict(got)
    if system_type == "successfactors":
        assert by["EmpJob"].from_date == "2024-10-11"
        assert by["EmployeeTime"].filter == "startDate ge datetime'2025-10-11T00:00:00'"
        assert by["JobRequisition"].fields == ["requisitionId", "status", "createdDate", "hiringManager"]
    if system_type == "concur":
        assert by["reports"].source == "/api/v3.0/expense/reports"


def test_read_slices_matdoc_guard_splits_plant_then_day() -> None:
    from api.services.connectivity_manager import ConnectivityManager

    calls: list[str] = []

    class Fake:
        def read_table_full(self, table, cols, keys, where=None, max_rows=0, on_progress=None):
            calls.append(where)
            full = "WERKS" not in where or ("WERKS = '1000'" in where and (
                "BUDAT >= '20260929' AND BUDAT < '20261001'" in where or "BUDAT >= '20260930'" in where))
            n = 30001 if full else 3
            return pd.DataFrame({"MBLNR": [str(i) for i in range(min(n, max_rows))]})

    plan = ep.TablePlan(table="MATDOC", slices=["BUDAT >= '20260929' AND BUDAT < '20261001' AND RECORD_TYPE = 'MDOC'"],
                        max_slice_rows=30000, split_by={"WERKS": "T001W"})
    plants = pd.DataFrame({"WERKS": ["1000", "2000"]})
    df, truncated = ConnectivityManager._read_slices(Fake(), "MATDOC", ["MBLNR"], [], plan, plants, 5_000_000,
                                                     lambda g, n, r: None)
    assert all(len(pd.DataFrame({"x": range(1)})) for _ in calls)
    assert max(len(w) for w in calls) > 0
    assert truncated and truncated[0]["plant"] == "1000" and truncated[0]["day"] == "20260930"
    assert len(df) == 30000 + 3 + 3                       # truncated day + other day + plant 2000

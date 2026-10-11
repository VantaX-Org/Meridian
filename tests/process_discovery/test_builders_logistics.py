"""PP, PM, QM, PS and WH builders against in-memory extraction frames (spec §2.2, §2.3, §9 wave 22)."""

from __future__ import annotations

import random
from datetime import datetime, timezone
from types import ModuleType

import pandas as pd
import pytest

from api.services.process_discovery import builders
from api.services.process_discovery.builders import pm, pp, ps, qm, wh
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, MemoryFrames, collect, make_context,
)
from sap.process_definitions import reference_document
from tests.process_discovery.test_builders_core import JNB, RUN, by, cd, df

PP_ORD, PM_ORD, PM_PLAN = "000001000001", "000004000001", "000004000002"


def jcds(objnr: str, *stats: tuple[str, str, str]) -> list[dict[str, str]]:
    """JCDS rows (STAT, UDATE+UTIME, INACT) for one object."""
    return [{"OBJNR": objnr, "STAT": s, "CHGNR": f"{n:03d}", "UDATE": ts[:8], "UTIME": ts[8:], "USNAM": "PLANNER1",
             "INACT": inact} for n, (s, ts, inact) in enumerate(stats, 1)]


def movements(*lines: tuple[str, str, str, str]) -> list[dict[str, str]]:
    """(MBLNR, BWART, AUFNR, CPUDT+CPUTM) material-document lines, MJAHR 2026, user WH1."""
    return [{"MBLNR": m, "MJAHR": "2026", "ZEILE": "0001", "BWART": b, "AUFNR": a, "WERKS": "1000",
             "CPUDT": ts[:8], "CPUTM": ts[8:], "USNAM": "WH1"} for m, b, a, ts in lines]


GM = movements(("4900000001", "261", PP_ORD, "20260107090000"), ("4900000002", "101", PP_ORD, "20260109160000"),
               ("4900000003", "102", PP_ORD, "20260110080000"), ("4900000004", "262", PP_ORD, "20260110081000"),
               ("4900000005", "261", PM_ORD, "20260112100000"), ("4900000006", "311", PP_ORD, "20260110090000"))


def logistics_tables(system: str = "ecc") -> dict[str, pd.DataFrame]:
    """One extraction bundle: AUFK, JCDS, CDHDR and QMEL are shared by several L1s, as in Task 19."""
    t = {
        "AUFK": df(
            {"AUFNR": PP_ORD, "AUTYP": "10", "AUART": "PP01", "WERKS": "1000", "ERDAT": "20260105",
             "ERFZEIT": "080000", "ERNAM": "PLANNER1", "OBJNR": "OR" + PP_ORD},
            {"AUFNR": PM_ORD, "AUTYP": "30", "AUART": "PM01", "WERKS": "1000", "ERDAT": "20260111",
             "ERFZEIT": "070000", "ERNAM": "MAINT1", "OBJNR": "OR" + PM_ORD},
            {"AUFNR": PM_PLAN, "AUTYP": "30", "AUART": "PM02", "WERKS": "1000", "ERDAT": "20260111",
             "ERFZEIT": "000000", "ERNAM": "BATCH", "OBJNR": "OR" + PM_PLAN},
            {"AUFNR": "000000700001", "AUTYP": "01", "AUART": "IO01", "WERKS": "", "ERDAT": "20260111",
             "ERFZEIT": "070000", "ERNAM": "CO1", "OBJNR": "OR000000700001"}),
        "AFIH": df({"AUFNR": PM_ORD, "WARPL": "", "EQUNR": "10000001", "IWERK": "1000"},
                   {"AUFNR": PM_PLAN, "WARPL": "PLAN01", "EQUNR": "10000001", "IWERK": "1000"}),
        "JCDS": df(*jcds("OR" + PP_ORD, ("I0002", "20260106080000", "X"), ("I0002", "20260106090000", ""),
                         ("I0016", "20260106090500", ""), ("I0010", "20260108100000", ""),
                         ("I0009", "20260109150000", ""), ("I0012", "20260109160000", ""),
                         ("I0045", "20260115080000", ""), ("I0046", "20260131080000", "")),
                   *jcds("OR" + PM_ORD, ("I0002", "20260111080000", ""), ("I0010", "20260112110000", ""),
                         ("I0009", "20260112150000", ""), ("I0045", "20260113080000", ""),
                         ("I0046", "20260131080000", "")),
                   *jcds("PR00000002", ("I0002", "20260103080000", ""), ("I0045", "20260301080000", ""),
                         ("I0046", "20260401080000", ""))),
        **cd(("ORDER", PP_ORD, "0000000001", "U", "20260106", "100000", "PLANNER1",
              [("AFKO", "100" + PP_ORD, "GSTRP", "U", "20260107"), ("AFKO", "100" + PP_ORD, "GLTRP", "U", "20260110"),
               ("AUFK", "100" + PP_ORD, "KTEXT", "U", "")]),
             ("STUE", "M00000001", "0000000002", "I", "20251201", "100000", "ENG1", [("STKO", "1", "KEY", "I", "")]),
             ("STUE", "M00000001", "0000000003", "U", "20251202", "100000", "ENG1",
              [("STPO", "1", "MENGE", "U", "2")]),
             ("QMEL", "000010000001", "0000000004", "U", "20260110", "120000", "MAINT1",
              [("QMEL", "100000010000001", "PRIOK", "U", "1")]),
             ("EQUI", "10000001", "0000000005", "I", "20250101", "100000", "MD1", [("EQUI", "1", "KEY", "I", "")]),
             ("EQUI", "10000001", "0000000006", "U", "20250102", "100000", "MD1",
              [("EQUZ", "1", "IWERK", "U", "1000")])),
        "QMEL": df(
            {"QMNUM": "000010000001", "QMART": "M1", "QMDAT": "20260110", "MZEIT": "090000", "ERNAM": "OPS1",
             "QMDAB": "20260114", "QMZAB": "170000", "PRIOK": "2", "AUFNR": PM_ORD, "PRUEFLOS": "", "IWERK": "1000"},
            {"QMNUM": "000010000002", "QMART": "M1", "QMDAT": "20260120", "MZEIT": "090000", "ERNAM": "OPS1",
             "QMDAB": "", "QMZAB": "", "PRIOK": "3", "AUFNR": "", "PRUEFLOS": "", "IWERK": "1000"},
            {"QMNUM": "000020000001", "QMART": "Q2", "QMDAT": "20260106", "MZEIT": "110000", "ERNAM": "QA1",
             "QMDAB": "", "QMZAB": "", "PRIOK": "", "AUFNR": "", "PRUEFLOS": "010000000001", "IWERK": "1000"},
            {"QMNUM": "000020000002", "QMART": "Q3", "QMDAT": "20260108", "MZEIT": "110000", "ERNAM": "QA1",
             "QMDAB": "20260112", "QMZAB": "150000", "PRIOK": "", "AUFNR": "", "PRUEFLOS": "", "IWERK": "1000"}),
        "TQ80": df({"QMART": "M1", "QMTYP": "01"}, {"QMART": "Q2", "QMTYP": "02"}, {"QMART": "Q3", "QMTYP": "02"}),
        "QALS": df({"PRUEFLOS": "010000000001", "ENSTEHDAT": "20260105", "ENTSTEZEIT": "100000", "ERSTELLER": "QA1",
                    "ART": "01", "HERKUNFT": "01", "WERK": "1000", "MATNR": "M1", "EBELN": "4500000001",
                    "AUFNR": "", "OBJNR": "QL010000000001"}),
        "QAVE": df({"PRUEFLOS": "010000000001", "VDATUM": "20260107", "VNAME": "QA2", "VCODE": "A",
                    "VAEDATUM": "20260109"}),
        "QMFE": df({"QMNUM": "000020000001", "FENUM": "0001", "ERDAT": "20260106", "ERZEIT": "113000",
                    "ERNAM": "QA1", "FECOD": "SCR"},
                   {"QMNUM": "000020000002", "FENUM": "0001", "ERDAT": "20260108", "ERZEIT": "113000",
                    "ERNAM": "QA1", "FECOD": "DNT"}),
        "QMSM": df({"QMNUM": "000020000002", "MANUM": "0001", "ERDAT": "20260108", "ERZEIT": "120000", "ERNAM": "QA1",
                    "PETER": "", "ERLDAT": "20260111", "ERLZEIT": "100000", "ERLNAM": "QA3"},
                   {"QMNUM": "000020000002", "MANUM": "0002", "ERDAT": "20260108", "ERZEIT": "120000", "ERNAM": "QA1",
                    "PETER": "", "ERLDAT": "", "ERLZEIT": "", "ERLNAM": ""}),
        "PROJ": df({"PSPNR": "00000001", "PSPID": "P-100", "ERDAT": "20260101", "ERNAM": "PM1", "VBUKR": "1000",
                    "OBJNR": "PD00000001"}),
        "PRPS": df({"PSPNR": "00000002", "POSID": "P-100.01", "PSPHI": "00000001", "ERDAT": "20260102",
                    "ERNAM": "PM1", "PBUKR": "1000", "OBJNR": "PR00000002"}),
        "USR02": df({"BNAME": "PLANNER1", "USTYP": "A"}, {"BNAME": "BATCH", "USTYP": "B"}),
    }
    if system == "s4hana_onprem":
        t["MATDOC"] = df(*[{**r, "RECORD_TYPE": "MDOC"} for r in GM],
                         {**GM[0], "MBLNR": "4900000099", "RECORD_TYPE": "MDAG"})  # aggregate row: no event
    else:
        t["MKPF"] = df(*[{k: r[k] for k in ("MBLNR", "MJAHR", "CPUDT", "CPUTM", "USNAM")} for r in GM])
        t["MSEG"] = df(*[{k: r[k] for k in ("MBLNR", "MJAHR", "ZEILE", "BWART", "AUFNR", "WERKS")} for r in GM])
    return t


def wm_tables(system: str = "ecc") -> dict[str, pd.DataFrame]:
    to = lambda n, betyp, vbeln: {"LGNUM": "100", "TANUM": n, "BWLVS": "101", "BDATU": "20260110",  # noqa: E731
                                  "BZEIT": "080000", "BNAME": "WH1", "BETYP": betyp, "BENUM": "", "KQUIT": "X",
                                  "VBELN": vbeln}
    item = lambda n, pos, vltyp, pquit: {"LGNUM": "100", "TANUM": n, "TAPOS": pos, "QDATU": "20260110" if pquit else "",  # noqa: E731
                                         "QZEIT": "093000" if pquit else "", "QNAME": "WH2" if pquit else "",
                                         "VLTYP": vltyp, "NLTYP": "001", "PQUIT": pquit}
    return {"LTAK": df(to("0000000001", "", ""), to("0000000002", "L", "0080000001"), to("0000000003", "", "")),
            "LTAP": df(item("0000000001", "0001", "902", "X"), item("0000000001", "0002", "001", ""),
                       item("0000000002", "0001", "001", "X"), item("0000000003", "0001", "001", "X"))}


def ewm_tables(system: str = "ewm") -> dict[str, pd.DataFrame]:
    wt = lambda n, trart, conf: {"LGNUM": "W100", "TANUM": n, "TAPOS": "0001", "TOSTAT": "C" if conf else "",  # noqa: E731
                                 "TRART": trart, "PROCTY": "S110", "CREATED_AT": "20260110060000",
                                 "CREATED_BY": "RFUSER", "CONFIRMED_AT": "20260110063000" if conf else "0",
                                 "CONFIRMED_BY": "RFUSER" if conf else "", "VLPLA": "", "NLPLA": ""}
    return {"/SCWM/ORDIM_C": df(wt("000000000001", "1", True), wt("000000000002", "2", True),
                                wt("000000000003", "3", True), wt("000000000004", "1", False))}


def run(l1: str, tables: dict[str, pd.DataFrame], system: str = "ecc") -> list[EventRow]:
    frames = MemoryFrames(tables)
    return collect(builders.builder(l1).build, frames, make_context(frames, "t1", system, RUN))


CASES = {"PP": [("ecc", logistics_tables)], "PM": [("ecc", logistics_tables)], "QM": [("ecc", logistics_tables)],
         "PS": [("ecc", logistics_tables)], "WH": [("ecc", wm_tables), ("ewm", ewm_tables)]}


def mapping_row(mod: ModuleType, e: EventRow) -> ActivityMap:
    """The MAPPING row an event came from; runtime STATUS_<STAT> events map to the template row."""
    rows = [m for m in mod.MAPPING if m.key == e.activity and m.l5_id == e.l5_id] or \
        [m for m in mod.MAPPING if m.key == "STATUS_<STAT>"]
    return next((m for m in rows if m.case_type == e.case_type), rows[0])


@pytest.mark.parametrize("l1", sorted(CASES))
def test_every_mapping_row_fires(l1: str) -> None:
    fired = {(e.case_type, e.activity, e.l5_id) for system, tables in CASES[l1] for e in run(l1, tables(system), system)}
    expected = {(m.case_type, m.key, m.l5_id) for m in builders.builder(l1).MAPPING if "<" not in m.key}
    assert expected <= fired, expected - fired


@pytest.mark.parametrize("l1", sorted(CASES))
def test_rerun_and_row_order_are_deterministic(l1: str) -> None:
    for system, tables in CASES[l1]:
        first = run(l1, tables(system), system)
        shuffled = {k: v.sample(frac=1, random_state=random.Random(7).randint(0, 999))
                    for k, v in tables(system).items()}
        assert first and run(l1, tables(system), system) == first == run(l1, shuffled, system)


# (table, key columns, column changed in the duplicate): the duplicate row differs from the original in value
DUPLICATES = [("AUFK", ["AUFNR"], "ERNAM"), ("QALS", ["PRUEFLOS"], "ERSTELLER"), ("QMEL", ["QMNUM"], "ERNAM"),
              ("LTAK", ["LGNUM", "TANUM"], "BNAME"), ("PRPS", ["PSPNR"], "ERNAM"), ("PROJ", ["PSPNR"], "ERNAM"),
              ("TQ80", ["QMART"], "QMTYP")]


def with_duplicate_keys(tables: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    out = dict(tables)
    for table, _, col in DUPLICATES:
        if table in out:
            dup = out[table].copy()
            dup[col] = dup[col].map(lambda v: "ZZ" + v)
            out[table] = pd.concat([out[table], dup], ignore_index=True)
    return out


@pytest.mark.parametrize("l1", sorted(CASES))
def test_duplicate_key_rows_are_order_independent(l1: str) -> None:
    for system, tables in CASES[l1]:
        base = with_duplicate_keys(tables(system))
        if not any(t in base for t, _, _ in DUPLICATES):  # the eWM bundle has none of these tables
            continue
        first = run(l1, base, system)
        assert first
        for seed in range(6):
            shuffled = {k: v.sample(frac=1, random_state=seed) for k, v in base.items()}
            assert run(l1, shuffled, system) == first, (l1, system, seed)


@pytest.mark.parametrize("l1", sorted(CASES))
def test_seq_is_mapping_order_and_ids_exist(l1: str) -> None:
    doc = reference_document()
    l4_ids = {l4.id for l4 in doc.all_l4()}
    l5_ids = {a.id for l4 in doc.all_l4() for a in l4.activities}
    mod = builders.builder(l1)
    for system, tables in CASES[l1]:
        for e in run(l1, tables(system), system):
            assert e.seq == mapping_row(mod, e).order, e
            if "-X_" in e.l5_id:
                assert e.l5_id.split("-X_")[0] in l4_ids, e.l5_id
            else:
                assert e.l5_id in l5_ids, e.l5_id
    assert all(m.l5_id.startswith(l1 + "-") for m in mod.MAPPING)


def test_pp_order_lifecycle_statuses_and_movements() -> None:
    ev = [e for e in run("PP", logistics_tables()) if e.case_id == PP_ORD]
    assert [e.activity for e in ev] == [
        "CREATE_PROD_ORDER", "RELEASE_ORDER", "STATUS_I0016", "RESCHEDULE_ORDER", "ISSUE_COMPONENTS",
        "PARTIAL_CONFIRM", "CONFIRM_ORDER", "GOODS_RECEIPT_ORDER", "DELIVER_ORDER", "REVERSE_MOVEMENT",
        "REVERSE_MOVEMENT", "TECO_ORDER", "CLOSE_ORDER"]
    (rel,) = by(ev, "RELEASE_ORDER")  # the INACT='X' row (status reset) is not an event
    assert rel.ts == datetime(2026, 1, 6, 9, tzinfo=JNB) and dict(rel.attributes)["STAT"] == "I0002"
    (other,) = by(ev, "STATUS_I0016")
    assert other.l5_id == "PP-ORD-CO01-X_STATUS_I0016" and other.seq == 12
    (gr,) = by(ev, "GOODS_RECEIPT_ORDER")
    assert gr.object_refs == (("MBLNR", "4900000002/2026"),) and dict(gr.org) == {"WERKS": "1000"}
    assert {e.case_id for e in run("PP", logistics_tables()) if e.case_type == "prod_order"} == {PP_ORD}
    assert [e.activity for e in run("PP", logistics_tables()) if e.case_type == "bom"] == [
        "CREATE_BOM", "CHANGE_BOM_ITEM"]


@pytest.mark.parametrize("l1", ["PP", "PM"])
def test_matdoc_on_s4_matches_mseg_on_ecc(l1: str) -> None:
    def movements_of(system: str) -> list[tuple[object, ...]]:
        return [(e.case_id, e.activity, e.l5_id, e.ts, e.resource, e.object_refs)
                for e in run(l1, logistics_tables(system), system) if e.source_table in ("MSEG", "MATDOC")]
    ecc, s4 = movements_of("ecc"), movements_of("s4hana_onprem")
    assert ecc and ecc == s4
    assert not [m for m in s4 if m[-1] == (("MBLNR", "4900000099/2026"),)]  # RECORD_TYPE 'MDAG'
    assert not [m for m in ecc if m[-1] == (("MBLNR", "4900000006/2026"),)]  # BWART 311 is unmapped


def test_pm_order_notification_and_equipment_cases() -> None:
    ev = run("PM", logistics_tables())
    assert [e.activity for e in ev if e.case_id == PM_ORD] == [
        "CREATE_NOTIFICATION", "CHANGE_PRIORITY", "CREATE_PM_ORDER", "RELEASE_ORDER", "ISSUE_SPARES",
        "PARTIAL_CONFIRM", "CONFIRM_ORDER", "TECO_ORDER", "COMPLETE_NOTIFICATION", "CLOSE_ORDER"]
    (note,) = by(ev, "CREATE_NOTIFICATION", PM_ORD)
    assert ("QMNUM", "000010000001") in note.object_refs and dict(note.org) == {"IWERK": "1000", "WERKS": "1000"}
    assert dict(by(ev, "CHANGE_PRIORITY")[0].attributes)["PRIOK"] == "1"
    (plan,) = by(ev, "CREATE_ORDER_FROM_PLAN")
    assert plan.case_id == PM_PLAN and ("WARPL", "PLAN01") in plan.object_refs and plan.automated is True
    (own,) = [e for e in ev if e.case_type == "pm_notification"]
    assert (own.case_id, own.activity, own.seq) == ("000010000002", "CREATE_NOTIFICATION", 1)
    assert [e.activity for e in ev if e.case_type == "equipment"] == ["CREATE_EQUIPMENT", "CHANGE_EQUIPMENT"]
    assert {e.case_id for e in ev if e.case_type == "pm_order"} == {PM_ORD, PM_PLAN}


def test_notification_split_by_tq80_then_prueflos() -> None:
    with_tq80 = logistics_tables()
    pm_notes = {e.case_id for e in run("PM", with_tq80) if e.case_type == "pm_notification"}
    qm_notes = {e.case_id for e in run("QM", with_tq80) if e.case_type == "qm_notification"}
    assert (pm_notes, qm_notes) == ({"000010000002"}, {"000020000002"})
    no_tq80 = {k: v for k, v in logistics_tables().items() if k != "TQ80"}
    # Without TQ80 a notification with no inspection lot is PM, so Q3 moves from QM to PM.
    assert {e.case_id for e in run("PM", no_tq80) if e.case_type == "pm_notification"} == {
        "000010000002", "000020000002"}
    assert not [e for e in run("QM", no_tq80) if e.case_type == "qm_notification"]
    assert by(run("QM", no_tq80), "CREATE_QM_NOTIFICATION", "010000000001")  # PRUEFLOS still routes to QM


def test_qm_lot_and_notification_streams() -> None:
    ev = run("QM", logistics_tables())
    assert [e.activity for e in ev if e.case_id == "010000000001"] == [
        "CREATE_LOT", "CREATE_QM_NOTIFICATION", "RECORD_DEFECT", "USAGE_DECISION", "CHANGE_USAGE_DECISION"]
    (ud,) = by(ev, "USAGE_DECISION")
    assert (ud.ts_precision, ud.resource, dict(ud.attributes)["VCODE"]) == ("day", "QA2", "A")
    (defect,) = by(ev, "RECORD_DEFECT", "010000000001")
    assert defect.seq == 3 and ("QMNUM", "000020000001") in defect.object_refs
    assert [(e.activity, e.seq) for e in ev if e.case_id == "000020000002"] == [
        ("CREATE_QM_NOTIFICATION", 1), ("RECORD_DEFECT", 2), ("COMPLETE_TASK", 3), ("COMPLETE_NOTIFICATION", 4)]
    assert by(ev, "COMPLETE_TASK")[0].resource == "QA3"  # the open task (ERLDAT '') gives no event


def test_ps_wbs_case() -> None:
    ev = run("PS", logistics_tables())
    assert [e.activity for e in ev] == ["CREATE_PROJECT", "CREATE_WBS", "RELEASE_WBS", "TECO_WBS", "CLOSE_WBS"]
    assert {e.case_id for e in ev} == {"P-100.01"}
    assert ev[0].object_refs == (("PSPID", "P-100"),) and dict(ev[0].org) == {"PBUKR": "1000"}
    assert ev[0].ts_precision == "day"


def test_wh_routing_wm_and_ewm() -> None:
    wm = run("WH", wm_tables())
    l4 = {e.case_id: e.l5_id.rsplit("-", 1)[0] for e in by(wm, "CREATE_TO")}
    assert l4 == {"100/0000000001": "WH-IN-LT06", "100/0000000002": "WH-OUT-LT03", "100/0000000003": "WH-INT-LT01"}
    assert [e.l5_id for e in by(wm, "CONFIRM_TO_ITEM", "100/0000000001")] == ["WH-IN-LT06-02"]
    assert ("VBELN", "0080000001") in by(wm, "CREATE_TO", "100/0000000002")[0].object_refs
    ewm = run("WH", ewm_tables(), "ewm")
    assert {e.case_type for e in ewm} == {"warehouse_task"}
    assert {e.case_id: e.l5_id for e in by(ewm, "CONFIRM_TASK")} == {
        "W100/000000000001": "WH-IN-SCWM_PRDI-01", "W100/000000000002": "WH-OUT-SCWM_PRDO-01",
        "W100/000000000003": "WH-INT-SCWM_MON-01"}
    (create,) = by(ewm, "CREATE_TASK", "W100/000000000004")
    assert create.ts == datetime(2026, 1, 10, 6, tzinfo=timezone.utc) and create.l5_id == "WH-IN-SCWM_PRDI-X_CREATE_TASK"
    assert not run("WH", wm_tables(), "ewm") and not run("WH", ewm_tables(), "ecc")


def test_missing_tables_yield_no_events() -> None:
    for mod in (pp, pm, qm, ps, wh):
        for system in ("ecc", "s4hana_onprem", "ewm"):
            assert collect(mod.build, MemoryFrames({}), BuildContext("t1", system, RUN)) == []

"""PM event builder (spec §2.2, §2.3 PM).

Cases: ``pm_order`` = AUFNR (AUTYP 30), ``pm_notification`` = QMNUM for a PM notification whose order is
not in the extraction, ``equipment`` = EQUI OBJECTID."""

from __future__ import annotations

from dataclasses import replace
from typing import Iterable, Iterator, Optional

from api.services.process_discovery.builders._logistics import (
    QMEL_COLS, goods_movements, notification_kind, notification_kinds, status_activity, status_sets,
)
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_ts, sorted_rows, value_attr,
)

A = ActivityMap
_JCDS = "JCDS.UDATE JCDS.UTIME"
_CD = "CDHDR.UDATE CDHDR.UTIME"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_NOTIFICATION", "Create maintenance notification", "PM-PLN-IW21-01", "pm_order", "QMEL.QMNUM QMEL.QMART",
      "QMEL, PM notification (TQ80 QMTYP '01', else PRUEFLOS='')", "QMEL.QMDAT QMEL.MZEIT", 1, False),
    A("CHANGE_PRIORITY", "Change notification priority", "PM-PLN-IW21-02", "pm_order", "QMEL.PRIOK",
      "CDPOS class QMEL, FNAME='PRIOK'", _CD, 2, False),
    A("CREATE_PM_ORDER", "Create maintenance order", "PM-PLN-IW31-01", "pm_order", "AUFK.AUFNR AFIH.WARPL",
      "AUFK AUTYP='30', AFIH WARPL=''", "AUFK.ERDAT AUFK.ERFZEIT", 3, True),
    A("CREATE_ORDER_FROM_PLAN", "Create order from maintenance plan", "PM-PLN-IP01-02", "pm_order",
      "AUFK.AUFNR AFIH.WARPL", "AUFK AUTYP='30', AFIH WARPL<>''", "AUFK.ERDAT AUFK.ERFZEIT", 3, True),
    A("RELEASE_ORDER", "Release order", "PM-PLN-IW31-X_RELEASE", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0002'", _JCDS, 4, True),
    A("ISSUE_SPARES", "Issue spare parts", "PM-PLN-IW31-02", "pm_order", "MSEG.BWART MATDOC.BWART",
      "MSEG (ecc) or MATDOC RECORD_TYPE='MDOC' (s4hana_onprem), BWART='261', AUFNR = case",
      "MKPF.CPUDT MKPF.CPUTM | MATDOC.CPUDT MATDOC.CPUTM", 5, False),
    A("PARTIAL_CONFIRM", "Partially confirm order", "PM-PLN-IW31-X_PARTIAL_CONFIRM", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0010'", _JCDS, 6, False),
    A("CONFIRM_ORDER", "Confirm order", "PM-PLN-IW31-X_CONFIRM", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0009'", _JCDS, 7, True),
    A("TECO_ORDER", "Technically complete order", "PM-PLN-IW31-X_TECO", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0045'", _JCDS, 8, True),
    A("COMPLETE_NOTIFICATION", "Complete notification", "PM-PLN-IW21-X_COMPLETE", "pm_order", "QMEL.QMDAB",
      "QMEL QMDAB<>''", "QMEL.QMDAB QMEL.QMZAB", 9, False),
    A("CLOSE_ORDER", "Close order", "PM-PLN-IW31-X_CLOSE", "pm_order", "JCDS.STAT",
      "JCDS STAT='I0046'", _JCDS, 10, False),
    A("STATUS_<STAT>", "Set status <STAT>", "PM-PLN-IW31-X_STATUS_<STAT>", "pm_order", "JCDS.STAT",
      "JCDS, any other STAT", _JCDS, 11, False),
    A("CREATE_EQUIPMENT", "Create equipment", "PM-TO-IE01-01", "equipment", "CDHDR.OBJECTID",
      "CDHDR class EQUI, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_EQUIPMENT", "Change equipment", "PM-TO-IE01-02", "equipment", "CDPOS.CHNGIND",
      "CDPOS class EQUI, CHNGIND='U'", _CD, 2, False),
)
M = {m.key: m for m in MAPPING}
STATUS = {"I0002": M["RELEASE_ORDER"], "I0010": M["PARTIAL_CONFIRM"], "I0009": M["CONFIRM_ORDER"],
          "I0045": M["TECO_ORDER"], "I0046": M["CLOSE_ORDER"]}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    aufk = frames.get("AUFK", ["AUFNR", "AUTYP", "AUART", "WERKS", "ERDAT", "ERFZEIT", "ERNAM", "OBJNR"])
    afih = frames.get("AFIH", ["AUFNR", "WARPL", "EQUNR", "IWERK"])
    pm = aufk[aufk["AUTYP"] == "30"].merge(afih, on="AUFNR", how="left").fillna("")
    orders = {r["AUFNR"]: r for r in sorted_rows(pm)}

    def ev(m: ActivityMap, aufnr: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = orders[aufnr]
        return event(ctx, m, aufnr, when, table, user=user, doc_type=h["AUART"],
                     org={"WERKS": h["WERKS"], "IWERK": h["IWERK"]},
                     refs=[*refs, ("WARPL", h["WARPL"]), ("EQUNR", h["EQUNR"])],
                     attrs={"AUART": h["AUART"], **(attrs or {})})

    for aufnr, h in orders.items():
        key = "CREATE_ORDER_FROM_PLAN" if h["WARPL"] else "CREATE_PM_ORDER"
        yield ev(M[key], aufnr, sap_ts(ctx, h["ERDAT"], h["ERFZEIT"]), "AUFK", h["ERNAM"])

    for aufnr, r in status_sets(frames, {h["OBJNR"]: a for a, h in orders.items() if h["OBJNR"]}):
        yield ev(status_activity(STATUS, M["STATUS_<STAT>"], r["STAT"]), aufnr, sap_ts(ctx, r["UDATE"], r["UTIME"]),
                 "JCDS", r["USNAM"], attrs={"STAT": r["STAT"]})

    for r, table in goods_movements(frames, ctx, set(orders)):
        if r["BWART"] == "261":
            yield ev(M["ISSUE_SPARES"], r["AUFNR"], sap_ts(ctx, r["CPUDT"], r["CPUTM"]), table, r["USNAM"],
                     refs=[("MBLNR", f"{r['MBLNR']}/{r['MJAHR']}")], attrs={"BWART": r["BWART"]})

    # Notifications: on the order's case when QMEL.AUFNR is an extracted PM order, else their own case.
    kinds = notification_kinds(frames)
    notes = {r["QMNUM"]: r for r in sorted_rows(frames.get("QMEL", QMEL_COLS)) if notification_kind(r, kinds) == "PM"}

    def note_ev(m: ActivityMap, qmnum: str, when: Optional[Stamp], table: str, user: str = "",
                attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        n = notes[qmnum]
        extra = {"QMART": n["QMART"], "PRIOK": n["PRIOK"], **(attrs or {})}
        if n["AUFNR"] in orders:
            return ev(m, n["AUFNR"], when, table, user, refs=[("QMNUM", qmnum)], attrs=extra)
        return event(ctx, replace(m, case_type="pm_notification"), qmnum, when, table, user=user,
                     doc_type=n["QMART"], org={"IWERK": n["IWERK"]}, attrs=extra)

    for qmnum, n in notes.items():
        yield note_ev(M["CREATE_NOTIFICATION"], qmnum, sap_ts(ctx, n["QMDAT"], n["MZEIT"]), "QMEL", n["ERNAM"])
        if n["QMDAB"]:
            yield note_ev(M["COMPLETE_NOTIFICATION"], qmnum, sap_ts(ctx, n["QMDAB"], n["QMZAB"]), "QMEL")

    # QMEL TABKEY = MANDT(3) + QMNUM(12).
    for r in rows(cd_changes(frames, ["QMEL"])):
        qmnum = r["TABKEY"][3:15]
        if r["FNAME"] == "PRIOK" and qmnum in notes:
            yield note_ev(M["CHANGE_PRIORITY"], qmnum, cd_stamp(ctx, r), "CDPOS", r["USERNAME"], value_attr(r))

    yield from master_data_events(frames, ctx, "EQUI", M["CREATE_EQUIPMENT"], [(M["CHANGE_EQUIPMENT"], "", "U")])

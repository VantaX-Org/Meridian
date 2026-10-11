"""QM event builder (spec §2.2, §2.3 QM). Case ``insp_lot`` = PRUEFLOS, ``qm_notification`` = QMNUM without a lot.

Activity keys repeat across the two case types with different Order, so ``M`` is keyed by (case_type, key)."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._logistics import QMEL_COLS, notification_kind, notification_kinds
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, event, rows, sap_day, sap_ts, sorted_rows,
)

A = ActivityMap
_LOT, _NOTE = "insp_lot", "qm_notification"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_LOT", "Create inspection lot", "QM-IN-QA01-01", _LOT, "QALS.PRUEFLOS QALS.ART",
      "QALS row", "QALS.ENSTEHDAT QALS.ENTSTEZEIT", 1, True),
    A("CREATE_QM_NOTIFICATION", "Raise quality notification", "QM-IN-QM01-01", _LOT, "QMEL.QMNUM QMEL.PRUEFLOS",
      "QMEL with PRUEFLOS = case", "QMEL.QMDAT QMEL.MZEIT", 2, False),
    A("RECORD_DEFECT", "Record defect", "QM-IN-QM01-02", _LOT, "QMFE.FENUM QMFE.FECOD",
      "QMFE for a notification of the lot", "QMFE.ERDAT QMFE.ERZEIT", 3, False),
    A("USAGE_DECISION", "Make usage decision", "QM-IN-QA01-X_USAGE_DECISION", _LOT, "QAVE.VCODE",
      "QAVE row", "QAVE.VDATUM", 4, True),
    A("CHANGE_USAGE_DECISION", "Change usage decision", "QM-IN-QA01-X_CHANGE_UD", _LOT, "QAVE.VAEDATUM",
      "QAVE VAEDATUM<>''", "QAVE.VAEDATUM", 5, False),
    A("CREATE_QM_NOTIFICATION", "Raise quality notification", "QM-IN-QM01-01", _NOTE, "QMEL.QMNUM QMEL.QMART",
      "QMEL, QM notification without a lot", "QMEL.QMDAT QMEL.MZEIT", 1, True),
    A("RECORD_DEFECT", "Record defect", "QM-IN-QM01-02", _NOTE, "QMFE.FENUM QMFE.FECOD",
      "QMFE", "QMFE.ERDAT QMFE.ERZEIT", 2, False),
    A("COMPLETE_TASK", "Complete task", "QM-IN-QM01-X_COMPLETE_TASK", _NOTE, "QMSM.ERLDAT",
      "QMSM ERLDAT<>''", "QMSM.ERLDAT QMSM.ERLZEIT", 3, False),
    A("COMPLETE_NOTIFICATION", "Complete notification", "QM-IN-QM01-X_COMPLETE", _NOTE, "QMEL.QMDAB",
      "QMEL QMDAB<>''", "QMEL.QMDAB QMEL.QMZAB", 4, True),
)
M = {(m.case_type, m.key): m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    lots = {r["PRUEFLOS"]: r for r in sorted_rows(frames.get(
        "QALS", ["PRUEFLOS", "ENSTEHDAT", "ENTSTEZEIT", "ERSTELLER", "ART", "HERKUNFT", "WERK", "EBELN", "AUFNR"]))}

    def lot_ev(key: str, lot: str, when: Optional[Stamp], table: str, user: str = "",
               refs: tuple[tuple[str, str], ...] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = lots[lot]
        return event(ctx, M[(_LOT, key)], lot, when, table, user=user, doc_type=h["ART"], org={"WERK": h["WERK"]},
                     refs=[("EBELN", h["EBELN"]), ("AUFNR", h["AUFNR"]), *refs],
                     attrs={"ART": h["ART"], "HERKUNFT": h["HERKUNFT"], **(attrs or {})})

    for lot, h in lots.items():
        yield lot_ev("CREATE_LOT", lot, sap_ts(ctx, h["ENSTEHDAT"], h["ENTSTEZEIT"]), "QALS", h["ERSTELLER"])
    for r in rows(frames.get("QAVE", ["PRUEFLOS", "VDATUM", "VNAME", "VCODE", "VAEDATUM"])):
        if r["PRUEFLOS"] in lots:
            ud = {"VCODE": r["VCODE"]}
            yield lot_ev("USAGE_DECISION", r["PRUEFLOS"], sap_day(ctx, r["VDATUM"]), "QAVE", r["VNAME"], attrs=ud)
            if r["VAEDATUM"]:
                yield lot_ev("CHANGE_USAGE_DECISION", r["PRUEFLOS"], sap_day(ctx, r["VAEDATUM"]), "QAVE", attrs=ud)

    # QM notifications: on the lot's case when PRUEFLOS is an extracted lot, else their own case.
    kinds = notification_kinds(frames)
    notes = {r["QMNUM"]: r for r in sorted_rows(frames.get("QMEL", QMEL_COLS)) if notification_kind(r, kinds) == "QM"}

    def note_ev(key: str, qmnum: str, when: Optional[Stamp], table: str, user: str = "",
                attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        n = notes[qmnum]
        extra = {"QMART": n["QMART"], **(attrs or {})}
        if n["PRUEFLOS"] in lots:
            if (_LOT, key) not in M:
                return None  # COMPLETE_TASK / COMPLETE_NOTIFICATION are not lot activities (spec §2.3 QM)
            return lot_ev(key, n["PRUEFLOS"], when, table, user, refs=(("QMNUM", qmnum),), attrs=extra)
        return event(ctx, M[(_NOTE, key)], qmnum, when, table, user=user, doc_type=n["QMART"],
                     org={"WERK": n["IWERK"]}, attrs=extra)

    for qmnum, n in notes.items():
        yield note_ev("CREATE_QM_NOTIFICATION", qmnum, sap_ts(ctx, n["QMDAT"], n["MZEIT"]), "QMEL", n["ERNAM"])
        if n["QMDAB"]:
            yield note_ev("COMPLETE_NOTIFICATION", qmnum, sap_ts(ctx, n["QMDAB"], n["QMZAB"]), "QMEL")
    for r in rows(frames.get("QMFE", ["QMNUM", "FENUM", "ERDAT", "ERZEIT", "ERNAM", "FECOD"])):
        if r["QMNUM"] in notes:
            yield note_ev("RECORD_DEFECT", r["QMNUM"], sap_ts(ctx, r["ERDAT"], r["ERZEIT"]), "QMFE", r["ERNAM"],
                          {"FECOD": r["FECOD"]})
    for r in rows(frames.get("QMSM", ["QMNUM", "MANUM", "ERLDAT", "ERLZEIT", "ERLNAM"])):
        if r["QMNUM"] in notes and r["ERLDAT"]:
            yield note_ev("COMPLETE_TASK", r["QMNUM"], sap_ts(ctx, r["ERLDAT"], r["ERLZEIT"]), "QMSM", r["ERLNAM"])

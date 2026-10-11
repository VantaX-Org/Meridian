"""WH event builder (spec §2.2, §2.3 WH).

``ecc`` and ``s4hana_onprem`` (WM): case ``transfer_order`` = LGNUM/TANUM from LTAK/LTAP.
``ewm``: case ``warehouse_task`` = LGNUM/TANUM from /SCWM/ORDIM_C.
The L4 is chosen per case, so one activity key (``CREATE_TO``) has one mapping row per L4."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dec15_ts, event, rows, sap_ts, sorted_rows,
)

A = ActivityMap
WM_L4 = ("WH-IN-LT06", "WH-OUT-LT03", "WH-INT-LT01")
EWM_L4 = {"1": "WH-IN-SCWM_PRDI", "2": "WH-OUT-SCWM_PRDO"}
EWM_OTHER = "WH-INT-SCWM_MON"
_ORDIM = "/SCWM/ORDIM_C"
MAPPING: tuple[ActivityMap, ...] = (
    *(row for l4 in WM_L4 for row in (
        A("CREATE_TO", "Create transfer order", f"{l4}-01", "transfer_order", "LTAK.TANUM LTAK.BWLVS",
          "LTAK row", "LTAK.BDATU LTAK.BZEIT", 1, True),
        A("CONFIRM_TO_ITEM", "Confirm transfer order item", f"{l4}-02", "transfer_order", "LTAP.PQUIT",
          "LTAP PQUIT='X'", "LTAP.QDATU LTAP.QZEIT", 2, True))),
    *(row for l4 in (*EWM_L4.values(), EWM_OTHER) for row in (
        A("CREATE_TASK", "Create warehouse task", f"{l4}-X_CREATE_TASK", "warehouse_task",
          f"{_ORDIM}.TANUM {_ORDIM}.TRART", f"{_ORDIM} row", f"{_ORDIM}.CREATED_AT", 1, True),
        A("CONFIRM_TASK", "Confirm warehouse task", f"{l4}-01", "warehouse_task", f"{_ORDIM}.CONFIRMED_AT",
          f"{_ORDIM} CONFIRMED_AT set", f"{_ORDIM}.CONFIRMED_AT", 2, True))),
)
M = {(m.key, m.l5_id.rsplit("-", 1)[0]): m for m in MAPPING}


def wm_l4(betyp: str, source_types: list[str]) -> str:
    """Spec §2.3 WH routing: any item from a storage type starting with 9 (interim/GR area) is putaway,
    else a delivery reference (BETYP 'L') is picking, else internal movement."""
    if any(t.startswith("9") for t in source_types):
        return "WH-IN-LT06"
    return "WH-OUT-LT03" if betyp == "L" else "WH-INT-LT01"


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    if ctx.system_type == "ewm":
        yield from _ewm(frames, ctx)
        return
    ltak = {(r["LGNUM"], r["TANUM"]): r for r in sorted_rows(frames.get(
        "LTAK", ["LGNUM", "TANUM", "BWLVS", "BDATU", "BZEIT", "BNAME", "BETYP", "BENUM", "VBELN"]))}
    items: dict[tuple[str, str], list[dict[str, str]]] = {k: [] for k in ltak}
    for r in rows(frames.get("LTAP", ["LGNUM", "TANUM", "TAPOS", "QDATU", "QZEIT", "QNAME", "VLTYP", "PQUIT"])):
        if (r["LGNUM"], r["TANUM"]) in items:
            items[(r["LGNUM"], r["TANUM"])].append(r)
    for key, h in ltak.items():
        l4 = wm_l4(h["BETYP"], [i["VLTYP"] for i in items[key]])
        doc_type, org = h["BWLVS"], {"LGNUM": key[0]}
        refs, attrs = [("VBELN", h["VBELN"]), ("BENUM", h["BENUM"])], {"BWLVS": h["BWLVS"], "BETYP": h["BETYP"]}
        case = "/".join(key)
        yield event(ctx, M[("CREATE_TO", l4)], case, sap_ts(ctx, h["BDATU"], h["BZEIT"]), "LTAK", user=h["BNAME"],
                    doc_type=doc_type, org=org, refs=refs, attrs=attrs)
        for i in items[key]:
            if i["PQUIT"] == "X":
                yield event(ctx, M[("CONFIRM_TO_ITEM", l4)], case, sap_ts(ctx, i["QDATU"], i["QZEIT"]), "LTAP",
                            user=i["QNAME"], doc_type=doc_type, org=org, refs=refs, attrs=attrs)


def _ewm(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    # One warehouse task (TANUM) can have several confirmed items; identical events collapse in collect().
    for r in rows(frames.get(_ORDIM, ["LGNUM", "TANUM", "TRART", "PROCTY", "CREATED_AT", "CREATED_BY",
                                      "CONFIRMED_AT", "CONFIRMED_BY"])):
        l4, case = EWM_L4.get(r["TRART"], EWM_OTHER), f"{r['LGNUM']}/{r['TANUM']}"
        org, attrs = {"LGNUM": r["LGNUM"]}, {"TRART": r["TRART"], "PROCTY": r["PROCTY"]}
        yield event(ctx, M[("CREATE_TASK", l4)], case, dec15_ts(r["CREATED_AT"]), _ORDIM, user=r["CREATED_BY"],
                    doc_type=r["PROCTY"], org=org, attrs=attrs)
        yield event(ctx, M[("CONFIRM_TASK", l4)], case, dec15_ts(r["CONFIRMED_AT"]), _ORDIM,
                    user=r["CONFIRMED_BY"], doc_type=r["PROCTY"], org=org, attrs=attrs)

"""PS event builder (spec §2.2, §2.3 PS). Case ``wbs`` = POSID."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._logistics import status_activity, status_sets
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, event, sap_day, sap_ts, sorted_rows,
)

A = ActivityMap
_JCDS = "JCDS.UDATE JCDS.UTIME"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_PROJECT", "Create project definition", "PS-PRJ-CJ01-01", "wbs", "PROJ.PSPID",
      "PROJ row for PRPS.PSPHI", "PROJ.ERDAT", 1, True),
    A("CREATE_WBS", "Create WBS element", "PS-PRJ-CJ02-01", "wbs", "PRPS.POSID", "PRPS row", "PRPS.ERDAT", 2, True),
    A("RELEASE_WBS", "Release WBS element", "PS-PRJ-CJ02-X_RELEASE", "wbs", "JCDS.STAT",
      "JCDS on PRPS.OBJNR, STAT='I0002'", _JCDS, 3, True),
    A("TECO_WBS", "Technically complete WBS", "PS-PRJ-CJ02-X_TECO", "wbs", "JCDS.STAT",
      "JCDS STAT='I0045'", _JCDS, 4, False),
    A("CLOSE_WBS", "Close WBS element", "PS-PRJ-CJ02-X_CLOSE", "wbs", "JCDS.STAT",
      "JCDS STAT='I0046'", _JCDS, 5, False),
    A("STATUS_<STAT>", "Set status <STAT>", "PS-PRJ-CJ02-X_STATUS_<STAT>", "wbs", "JCDS.STAT",
      "JCDS, any other STAT", _JCDS, 6, False),
)
M = {m.key: m for m in MAPPING}
STATUS = {"I0002": M["RELEASE_WBS"], "I0045": M["TECO_WBS"], "I0046": M["CLOSE_WBS"]}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    proj = {r["PSPNR"]: r for r in sorted_rows(frames.get("PROJ", ["PSPNR", "PSPID", "ERDAT", "ERNAM"]))}
    wbs = {r["POSID"]: r for r in sorted_rows(frames.get("PRPS", ["PSPNR", "POSID", "PSPHI", "ERDAT", "ERNAM", "PBUKR",
                                                           "OBJNR"]))}

    def ev(m: ActivityMap, posid: str, when: Optional[Stamp], table: str, user: str = "",
           attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h, p = wbs[posid], proj.get(wbs[posid]["PSPHI"])
        return event(ctx, m, posid, when, table, user=user, org={"PBUKR": h["PBUKR"]},
                     refs=[("PSPID", p["PSPID"])] if p else [], attrs=attrs)

    for posid, h in wbs.items():
        if (p := proj.get(h["PSPHI"])) is not None:
            yield ev(M["CREATE_PROJECT"], posid, sap_day(ctx, p["ERDAT"]), "PROJ", p["ERNAM"])
        yield ev(M["CREATE_WBS"], posid, sap_day(ctx, h["ERDAT"]), "PRPS", h["ERNAM"])

    for posid, r in status_sets(frames, {h["OBJNR"]: k for k, h in wbs.items() if h["OBJNR"]}):
        yield ev(status_activity(STATUS, M["STATUS_<STAT>"], r["STAT"]), posid, sap_ts(ctx, r["UDATE"], r["UTIME"]),
                 "JCDS", r["USNAM"], {"STAT": r["STAT"]})

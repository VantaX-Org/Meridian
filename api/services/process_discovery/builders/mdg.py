"""MDG event builder (spec §2.2, §2.3 MDG). Case ``change_request`` = USMD_CREQUEST.

The USMD timestamps are DEC15 UTC (``YYYYMMDDhhmmss``) and are taken as UTC."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dec15_ts, event, rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_CR", "Create change request", "MDG-CR-MDGIMG-01", "change_request", "USMD120C.USMD_CREQUEST",
      "USMD120C row", "USMD120C.USMD_CREATED_AT", 1, True),
    A("APPROVE_CR", "Approve change request", "MDG-CR-MDGIMG-02", "change_request", "USMD120C.USMD_RELEASED_AT",
      "USMD_RELEASED_AT set", "USMD120C.USMD_RELEASED_AT", 2, True),
    A("ACTIVATE_DATA", "Activate data", "MDG-CR-MDGIMG-X_ACTIVATE", "change_request", "USMD120C.USMD_DATA_CHN_AT",
      "USMD_DATA_CHN_AT set", "USMD120C.USMD_DATA_CHN_AT", 3, True),
    A("LAST_CHANGE", "Last change to request", "MDG-CR-MDGIMG-X_LAST_CHANGE", "change_request",
      "USMD120C.USMD_CHANGED_AT", "USMD_CHANGED_AT later than every timestamp above",
      "USMD120C.USMD_CHANGED_AT", 4, False),
)
M = {m.key: m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    cols = ["USMD_CREQUEST", "USMD_CREQ_TYPE", "USMD_CREQ_STATUS", "USMD_CREATED_AT", "USMD_CREATED_BY",
            "USMD_RELEASED_AT", "USMD_RELEASED_BY", "USMD_CHANGED_AT", "USMD_CHANGED_BY", "USMD_DATA_CHN_AT",
            "USMD_PRIORITY"]
    for r in rows(frames.get("USMD120C", cols)):
        case = r["USMD_CREQUEST"]
        attrs = {"USMD_CREQ_TYPE": r["USMD_CREQ_TYPE"], "USMD_CREQ_STATUS": r["USMD_CREQ_STATUS"],
                 "USMD_PRIORITY": r["USMD_PRIORITY"]}
        dt = r["USMD_CREQ_TYPE"]
        created, released = dec15_ts(r["USMD_CREATED_AT"]), dec15_ts(r["USMD_RELEASED_AT"])
        activated, changed = dec15_ts(r["USMD_DATA_CHN_AT"]), dec15_ts(r["USMD_CHANGED_AT"])
        yield event(ctx, M["CREATE_CR"], case, created, "USMD120C", user=r["USMD_CREATED_BY"], doc_type=dt,
                    attrs=attrs)
        yield event(ctx, M["APPROVE_CR"], case, released, "USMD120C", user=r["USMD_RELEASED_BY"], doc_type=dt,
                    attrs=attrs)
        yield event(ctx, M["ACTIVATE_DATA"], case, activated, "USMD120C", doc_type=dt, attrs=attrs)
        if changed and all(s is None or changed[0] > s[0] for s in (created, released, activated)):
            yield event(ctx, M["LAST_CHANGE"], case, changed, "USMD120C", user=r["USMD_CHANGED_BY"], doc_type=dt,
                        attrs=attrs)

"""CNQ (Concur) event builder (spec §2.2, §2.3 CNQ). Case ``expense_report`` = reportId.

``approvalStatus`` and ``paymentStatus`` have no timestamp in the registry, so they are attributes on
every event of the report, never activities."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._cloud import in_window
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, event, iso_ts, rows, sorted_rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("INCUR_EXPENSE", "Incur first expense", "CNQ-EXP-EXPENSE-02", "expense_report", "entries.entryId",
      "entries, min(transactionDate) per report", "entries.transactionDate", 1, True),
    A("SUBMIT_REPORT", "Submit expense report", "CNQ-EXP-EXPENSE-01", "expense_report", "reports.reportId",
      "reports row", "reports.submitDate", 2, True),
)
M = {m.key: m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    # Sorted by full row first, so the last row per reportId does not depend on input order.
    reports = {r["reportId"]: r for r in sorted_rows(frames.get(
        "reports", ["reportId", "ownerLoginId", "submitDate", "approvalStatus", "paymentStatus"]))}

    def attrs(report: str) -> dict[str, str]:
        r = reports.get(report)
        return {"approvalStatus": r["approvalStatus"], "paymentStatus": r["paymentStatus"]} if r else {}

    first: dict[str, Stamp] = {}
    entries: dict[str, list[str]] = {}
    for r in rows(frames.get("entries", ["reportId", "entryId", "transactionDate"])):
        entries.setdefault(r["reportId"], []).append(r["entryId"])
        when = iso_ts(ctx, r["transactionDate"], day=True)
        if when and (r["reportId"] not in first or when < first[r["reportId"]]):
            first[r["reportId"]] = when
    for report, when in first.items():
        yield event(ctx, M["INCUR_EXPENSE"], report, in_window(ctx, when), "entries",
                    user=reports[report]["ownerLoginId"] if report in reports else "",
                    refs=[("entryId", e) for e in sorted(entries[report])], attrs=attrs(report))
    for report, r in reports.items():
        yield event(ctx, M["SUBMIT_REPORT"], report, in_window(ctx, iso_ts(ctx, r["submitDate"])), "reports",
                    user=r["ownerLoginId"], attrs=attrs(report))

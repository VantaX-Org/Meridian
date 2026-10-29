"""Extraction dry run: what a download would read, without reading it (POST /systems/{id}/downloads, dry_run=true).

Row counts per table come from the newest profile of that table on this system (table_profiles, written by every
extraction); a table never extracted has no count and is listed as unknown. The duration estimate divides the rows
by the throughput of this system's recent finished extractions (rows read per second, the median), or by
``ASSUMED_ROWS_PER_SECOND`` when there is none, and says which it used. Pure: the route reads, this computes.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from statistics import median
from typing import Any

ASSUMED_ROWS_PER_SECOND = 5000.0


def throughput(jobs: Iterable[Mapping[str, Any]], system_id: str) -> float | None:
    """Median rows per second of this system's completed extractions (None when there is none to go by)."""
    rates = []
    for j in jobs:
        if j.get("kind") != "extraction" or j.get("status") != "completed" or str(j.get("system_id")) != system_id:
            continue
        rows, start, end = j.get("rows_done") or 0, j.get("started_at"), j.get("finished_at")
        if rows and isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start:
            rates.append(rows / (end - start))
    return round(median(rates), 1) if rates else None


def plan(objects: Iterable[Mapping[str, Any]], chosen: Iterable[str], counts: Mapping[str, int],
         rate: float | None) -> dict[str, Any]:
    """{tables: [{table, objects, rows}], total_rows, unknown_tables, seconds, rate, rate_basis}."""
    want = set(chosen)
    by_table: dict[str, list[str]] = {}
    for o in objects:
        if o.get("object") in want:
            for t in o.get("tables") or []:
                by_table.setdefault(t, []).append(str(o["object"]))
    tables = [{"table": t, "objects": sorted(set(objs)), "rows": counts.get(t)} for t, objs in sorted(by_table.items())]
    known = [t["rows"] for t in tables if t["rows"] is not None]
    total = sum(known)
    used = rate or ASSUMED_ROWS_PER_SECOND
    return {"tables": tables, "total_rows": total, "unknown_tables": sum(1 for t in tables if t["rows"] is None),
            "seconds": round(total / used) if total else 0, "rate": used,
            "rate_basis": "measured" if rate else "assumed"}

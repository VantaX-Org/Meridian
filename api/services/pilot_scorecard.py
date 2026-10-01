"""Pilot scorecard: how right Meridian is, judged by the customer's own stewards.

Precision per rule comes from the steward decisions recorded on record issues
(record_issues.steward_verdict): an issue closed as false positive, accepted risk
or fixed — by a steward, or verified fixed by a later run — is reviewed, and the
verdict stays when a later run re-opens the issue because the fix did not land.
Precision = reviewed issues that were real / reviewed issues.

Recall comes from a list of records the stewards already know are wrong (uploaded
per system): a known record is caught when any record issue of that system, in
that object, is on a record whose key contains every key part given. Key parts
compare without leading zeros on numbers, so '100001' matches LIFNR=0000100001.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

MIN_REVIEWED = 10     # rules with fewer reviewed issues are not rated
TARGET_PRECISION = 0.9


def _norm(part: str) -> str:
    v = part.split("=", 1)[1] if "=" in part else part
    v = v.strip().upper()
    return (v.lstrip("0") or "0") if v.isdigit() else v


def key_values(key: str) -> frozenset[str]:
    """Key parts of a Meridian record key ('BUKRS=1000|LIFNR=0000100001') or of an uploaded
    reference ('1000|100001', 'LIFNR=100001'), normalised."""
    return frozenset(_norm(p) for p in key.split("|") if _norm(p))


def recall(known: list[dict], issues: Iterable[tuple[str, str]]) -> tuple[list[dict], list[dict]]:
    """Split known records ({module, record_ref, ...}; module '' = any object) into caught and missed."""
    index: dict[str, dict[str, list[frozenset[str]]]] = defaultdict(lambda: defaultdict(list))
    for module, key in issues:
        values = key_values(key)
        for v in values:
            index[module][v].append(values)
            index[""][v].append(values)
    caught, missed = [], []
    for k in known:
        want = key_values(k["record_ref"])
        pool = index[k.get("module") or ""]
        hit = bool(want) and any(want <= vals for vals in pool.get(min(want, default=""), ()))
        (caught if hit else missed).append(k)
    return caught, missed


def rate_rules(rows: Iterable[dict]) -> list[dict]:
    """Per-rule precision from aggregated issue counts ({check_id, module, severity, message,
    flagged, open, false_positive, real}), worst rated first."""
    out = []
    for r in rows:
        reviewed = r["false_positive"] + r["real"]
        precision = round(r["real"] / reviewed, 4) if reviewed else None
        rated = reviewed >= MIN_REVIEWED
        out.append({**r, "reviewed": reviewed, "precision": precision, "rated": rated,
                    "needs_tuning": rated and precision is not None and precision < TARGET_PRECISION})
    return sorted(out, key=lambda r: (not r["needs_tuning"], r["precision"] if r["precision"] is not None else 2,
                                      -r["flagged"], r["check_id"]))

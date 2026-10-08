"""Deterministic owner scorecard + digest for /insights/owners (spec 8.3).

Owner grain = record_issues.assigned_to (db/schema.py's RecordIssue: assigned_to,
severity, status, first_seen_at, resolved_at). OWNER_ISSUE_SQL below is the single
raw-SQL query both the async route (Task 8, via AsyncSession) and the sync weekly
digest task (Task 9, via the sync Session) run before calling load_owner_aggregates —
the aggregation itself is plain Python so it works unchanged from either caller.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

OWNER_ISSUE_SQL = """
    SELECT ri.assigned_to AS user_id, u.name AS owner, ri.severity, ri.status,
           ri.first_seen_at, ri.resolved_at
    FROM record_issues ri JOIN users u ON u.id = ri.assigned_to AND u.tenant_id = :tid
    WHERE ri.tenant_id = :tid AND ri.assigned_to IS NOT NULL
"""

_SEVERITY_WEIGHT = {"critical": 10, "high": 5, "medium": 2, "low": 1}
_BASELINE_WINDOW = timedelta(days=7)  # matches the weekly digest cadence (Task 9)


@dataclass
class OwnerCard:
    owner: str
    score: float
    delta: float
    open_by_severity: dict
    fixed_since_baseline: int
    oldest_item_age_days: int
    digest: str = ""


def render_digest(owner: str, score: float, delta: float, open_by_severity: dict,
                   fixed_since_baseline: int, oldest_item_age_days: int) -> str:
    trend = "improved" if delta > 0 else "declined" if delta < 0 else "held steady"
    total_open = sum(open_by_severity.values())
    worst = max(open_by_severity, key=open_by_severity.get) if open_by_severity else None
    s1 = f"{owner}'s score is {score:.1f}, which has {trend} by {abs(delta):.1f} points since the baseline run."
    s2 = (
        f"{total_open} items are open" + (f", most of them {worst}" if worst else "") + "."
    )
    s3 = f"{fixed_since_baseline} items were fixed since the baseline; the oldest open item is {oldest_item_age_days} days old."
    return f"{s1} {s2} {s3}"


def build_owner_card(owner: str, score: float, delta: float, open_by_severity: dict,
                      fixed_since_baseline: int, oldest_item_age_days: int) -> OwnerCard:
    digest = render_digest(owner, score, delta, open_by_severity, fixed_since_baseline, oldest_item_age_days)
    return OwnerCard(owner, score, delta, open_by_severity, fixed_since_baseline, oldest_item_age_days, digest)


def load_owner_aggregates(rows: list[dict]) -> dict[str, dict]:
    """rows: the result of OWNER_ISSUE_SQL (one row per owned record_issue), already
    fetched by the caller — async (Task 8's route) or sync (Task 9's Celery task).
    Each row needs keys: user_id, owner, severity, status, first_seen_at, resolved_at.

    Returns {owner_name: {"user_id", "score", "delta", "open_by_severity",
    "fixed_since_baseline", "oldest_item_age_days"}} — pass straight into
    build_owner_card(owner, **{k: v for k, v in agg.items() if k != "user_id"}).
    """
    now = datetime.now(timezone.utc)
    cutoff = now - _BASELINE_WINDOW

    by_owner: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_owner[r["owner"]].append(r)

    out: dict[str, dict] = {}
    for owner, issues in by_owner.items():
        open_issues = [i for i in issues if i["status"] not in ("resolved", "accepted")]
        open_by_severity: dict[str, int] = defaultdict(int)
        for i in open_issues:
            open_by_severity[i["severity"]] += 1
        score = max(0.0, 100.0 - sum(_SEVERITY_WEIGHT.get(sev, 1) * n for sev, n in open_by_severity.items()))

        # baseline = state as of `cutoff`: still open, or resolved after the cutoff (i.e. was open then).
        baseline_open = [
            i for i in issues
            if i["status"] not in ("resolved", "accepted") or (i["resolved_at"] and i["resolved_at"] >= cutoff)
        ]
        baseline_score = max(0.0, 100.0 - sum(_SEVERITY_WEIGHT.get(i["severity"], 1) for i in baseline_open))

        fixed_since_baseline = sum(
            1 for i in issues
            if i["status"] in ("resolved", "accepted") and i["resolved_at"] and i["resolved_at"] >= cutoff
        )
        oldest_item_age_days = max((now - i["first_seen_at"]).days for i in open_issues) if open_issues else 0

        out[owner] = {
            "user_id": issues[0]["user_id"],
            "score": round(score, 1),
            "delta": round(score - baseline_score, 1),
            "open_by_severity": dict(open_by_severity),
            "fixed_since_baseline": fixed_since_baseline,
            "oldest_item_age_days": oldest_item_age_days,
        }
    return out

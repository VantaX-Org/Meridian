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

#: aggregated in SQL (not one row per record_issue) — a tenant can have 300k+ rows in
#: that table, so GROUP BY does the counting/MIN/FILTER work Postgres is built for
#: instead of materialising every row in the API process or the digest task.
#: :cutoff is baseline_cutoff() below, bound once by the caller so both the "is this
#: open" and "is this a recent fix" windows agree with _BASELINE_WINDOW.
OWNER_ISSUE_SQL = """
    SELECT ri.assigned_to AS user_id, u.name AS owner, ri.severity,
           COUNT(*) FILTER (WHERE ri.status NOT IN ('resolved', 'accepted')) AS open_count,
           COUNT(*) FILTER (
               WHERE ri.status NOT IN ('resolved', 'accepted') OR ri.resolved_at >= :cutoff
           ) AS baseline_open_count,
           COUNT(*) FILTER (
               WHERE ri.status IN ('resolved', 'accepted') AND ri.resolved_at >= :cutoff
           ) AS fixed_since_baseline,
           MIN(ri.first_seen_at) FILTER (WHERE ri.status NOT IN ('resolved', 'accepted')) AS oldest_open_first_seen
    FROM record_issues ri JOIN users u ON u.id = ri.assigned_to AND u.tenant_id = :tid
    WHERE ri.tenant_id = :tid AND ri.assigned_to IS NOT NULL
    GROUP BY ri.assigned_to, u.name, ri.severity
"""

_SEVERITY_WEIGHT = {"critical": 10, "high": 5, "medium": 2, "low": 1}
_BASELINE_WINDOW = timedelta(days=7)  # matches the weekly digest cadence (Task 9)


def baseline_cutoff() -> datetime:
    """The single `:cutoff` bind both OWNER_ISSUE_SQL callers must use, so the SQL
    window and _BASELINE_WINDOW never drift apart."""
    return datetime.now(timezone.utc) - _BASELINE_WINDOW


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
    """A pure scorer over rows already grouped by Postgres (one row per owner x
    severity — the result of OWNER_ISSUE_SQL), fetched by the caller — async
    (Task 8's route) or sync (Task 9's Celery task). Each row needs keys: user_id,
    owner, severity, open_count, baseline_open_count, fixed_since_baseline,
    oldest_open_first_seen.

    Returns {owner_name: {"user_id", "score", "delta", "open_by_severity",
    "fixed_since_baseline", "oldest_item_age_days"}} — pass straight into
    build_owner_card(owner, **{k: v for k, v in agg.items() if k != "user_id"}).
    """
    now = datetime.now(timezone.utc)

    by_owner: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_owner[r["owner"]].append(r)

    out: dict[str, dict] = {}
    for owner, groups in by_owner.items():
        open_by_severity = {g["severity"]: g["open_count"] for g in groups if g["open_count"]}
        score = max(0.0, 100.0 - sum(_SEVERITY_WEIGHT.get(sev, 1) * n for sev, n in open_by_severity.items()))

        baseline_by_severity = {g["severity"]: g["baseline_open_count"] for g in groups if g["baseline_open_count"]}
        baseline_score = max(
            0.0, 100.0 - sum(_SEVERITY_WEIGHT.get(sev, 1) * n for sev, n in baseline_by_severity.items())
        )

        fixed_since_baseline = sum(g["fixed_since_baseline"] for g in groups)
        oldest_dates = [g["oldest_open_first_seen"] for g in groups if g["oldest_open_first_seen"] is not None]
        oldest_item_age_days = max((now - d).days for d in oldest_dates) if oldest_dates else 0

        out[owner] = {
            "user_id": groups[0]["user_id"],
            "score": round(score, 1),
            "delta": round(score - baseline_score, 1),
            "open_by_severity": open_by_severity,
            "fixed_since_baseline": fixed_since_baseline,
            "oldest_item_age_days": oldest_item_age_days,
        }
    return out

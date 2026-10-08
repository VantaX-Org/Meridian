"""Determinism check for the weekly owner-digest task's text, without touching
the DB or the Celery task wrapper: seeded issue rows -> load_owner_aggregates
-> build_owner_card must match render_digest's output exactly."""
import uuid
from datetime import datetime, timedelta, timezone

from api.services.insights_owners import build_owner_card, load_owner_aggregates, render_digest


def test_digest_matches_render_digest_for_seeded_issues():
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    rows = [
        {
            "user_id": user_id, "owner": "P. Naidoo", "severity": "critical", "status": "open",
            "first_seen_at": now - timedelta(days=10), "resolved_at": None,
        },
        {
            "user_id": user_id, "owner": "P. Naidoo", "severity": "high", "status": "resolved",
            "first_seen_at": now - timedelta(days=20), "resolved_at": now - timedelta(days=1),
        },
    ]

    aggregates = load_owner_aggregates(rows)
    assert list(aggregates.keys()) == ["P. Naidoo"]
    agg = aggregates["P. Naidoo"]

    card = build_owner_card(
        "P. Naidoo", agg["score"], agg["delta"], agg["open_by_severity"],
        agg["fixed_since_baseline"], agg["oldest_item_age_days"],
    )

    assert card.digest == render_digest(
        "P. Naidoo", agg["score"], agg["delta"], agg["open_by_severity"],
        agg["fixed_since_baseline"], agg["oldest_item_age_days"],
    )
    assert agg["open_by_severity"] == {"critical": 1}
    assert agg["fixed_since_baseline"] == 1

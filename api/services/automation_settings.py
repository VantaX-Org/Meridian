"""The tenant's automation settings (tenant_settings key ``automation``): config drift alerts, rule mining from fixes
and the score.dropped webhook event. GET/PUT /api/v1/settings/automation (api/routes/webhooks.py).

  drift_alerts.enabled       notify owners and re-score when a config sync changes what rules depend on (default on)
  rule_mining.min_records    records a fix must repeat in before a rule is proposed (default 25)
  score_drop.below           score.dropped fires when an object's score falls below this (default off)
  score_drop.points          ... or falls by more than this many points since the previous run (default 5)
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text

KEY = "automation"
DEFAULTS: dict[str, dict[str, Any]] = {
    "drift_alerts": {"enabled": True},
    "rule_mining": {"min_records": 25},
    "score_drop": {"below": None, "points": 5.0},
}


def merged(stored: dict | None) -> dict[str, dict[str, Any]]:
    """Defaults with the stored values of known keys laid over them."""
    stored = stored if isinstance(stored, dict) else {}
    return {section: {**defaults, **{k: v for k, v in (stored.get(section) or {}).items() if k in defaults}}
            for section, defaults in DEFAULTS.items()}


def load_sync(session, tenant_id: str) -> dict[str, dict[str, Any]]:
    row = session.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = :k"),
                          {"t": str(tenant_id), "k": KEY}).fetchone()
    return merged(row[0] if row else None)


async def load(db, tenant_id: str) -> dict[str, dict[str, Any]]:
    row = (await db.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = :k"),
                            {"t": str(tenant_id), "k": KEY})).fetchone()
    return merged(row[0] if row else None)

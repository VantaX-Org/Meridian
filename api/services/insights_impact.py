"""Deterministic value-at-risk computation for /insights/impact (spec 8.2).

value_at_risk = value_per_record_per_feature (tenant setting, CostModel.features;
see api/routes/settings.py) x total_affected_records for that feature (the
config_impact_results columns api/routes/config_impact.py's existing
GET /api/v1/config-impact/{version_id} already reads).
"""
from functools import lru_cache
from pathlib import Path

import yaml


def value_at_risk(blocked_records: int, value_per_record: float) -> float:
    return round(blocked_records * value_per_record, 2)


DEFAULT_CURRENCY = "ZAR"


def tenant_currency(cost_model: dict | None) -> str:
    """The currency of the tenant's cost model (``tenants.cost_model->>'currency'``); ZAR when unset."""
    return str((cost_model or {}).get("currency") or DEFAULT_CURRENCY)


@lru_cache(maxsize=1)
def feature_l1() -> dict[str, str]:
    """target_feature -> L1 process, from the ``l1`` key of db/seeds/config_impact_rules.yaml."""
    path = Path(__file__).resolve().parents[2] / "db" / "seeds" / "config_impact_rules.yaml"
    rules = yaml.safe_load(path.read_text()).get("rules") or []
    return {r["target_feature"]: r["l1"] for r in rules if r.get("target_feature") and r.get("l1")}


@lru_cache(maxsize=1)
def impact_features() -> list[dict]:
    """Every feature a config impact rule can block or degrade (``target_feature`` of
    db/seeds/config_impact_rules.yaml), once each, with its L1 when the rule names one."""
    path = Path(__file__).resolve().parents[2] / "db" / "seeds" / "config_impact_rules.yaml"
    rules = yaml.safe_load(path.read_text()).get("rules") or []
    out: dict[str, str | None] = {}
    for r in rules:
        f = r.get("target_feature")
        if f and (f not in out or out[f] is None):
            out[f] = r.get("l1")
    return [{"feature": f, "l1": l1} for f, l1 in sorted(out.items())]


def by_l1(rows: list[dict]) -> dict[str, float]:
    """Value at risk per L1. There is deliberately no total across L1s: the worst L1 is a max."""
    out: dict[str, float] = {}
    for r in rows:
        key = r.get("l1") or "unassigned"
        out[key] = round(out.get(key, 0.0) + r["value_at_risk"], 2)
    return out


def worst_l1(rows: list[dict]) -> tuple[str | None, float]:
    groups = by_l1(rows)
    if not groups:
        return None, 0.0
    key = max(sorted(groups), key=groups.__getitem__)
    return key, groups[key]

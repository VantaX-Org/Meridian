"""Rule governance: which YAML checks run, and at what severity.

Sources, in order: HQ's catalogue (licence manifest → rules_hq_cache) sets
enabled + severity; the tenant's own Rules Engine toggle (rules table) can
only switch a check off. Unknown ids are ignored — HQ cannot inject logic.
"""

from __future__ import annotations

from sqlalchemy import text

SEVERITIES = {"critical", "high", "medium", "low", "info"}


def load_overrides(session) -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        for rid, enabled, severity in session.execute(
                text("SELECT id, enabled, severity FROM rules_hq_cache")).fetchall():
            out[rid] = {"enabled": bool(enabled), **({"severity": severity} if severity in SEVERITIES else {})}
    except Exception:  # table absent before migration 050 → no HQ governance yet
        session.rollback()
    for name, enabled in session.execute(text("SELECT name, enabled FROM rules")).fetchall():
        rid = (name or "").split(":", 1)[0].strip()
        if rid and not enabled:
            out.setdefault(rid, {})["enabled"] = False
    return out


def apply(rules: list[dict], overrides: dict[str, dict] | None) -> list[dict]:
    if not overrides:
        return rules
    kept = []
    for r in rules:
        o = overrides.get(r.get("id", ""))
        if o is None:
            kept.append(r)
        elif o.get("enabled", True):
            kept.append({**r, **({"severity": o["severity"]} if "severity" in o else {})})
    return kept

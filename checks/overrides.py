"""Rule governance: which YAML checks run, and at what severity.

Sources, in order: HQ's catalogue (licence manifest → rules_hq_cache) sets
enabled + severity; the tenant's own Rules Engine toggle (rules table) can
only switch a check off. Unknown ids are ignored — HQ cannot inject logic.
A tenant's approved (active) rule version (checks/lifecycle.py) is merged onto
the rule as ``body``; tenant-authored rules arrive as extra rules.
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
    from checks.lifecycle import load_active_versions
    for rid, body in load_active_versions(session).items():
        out.setdefault(rid, {})["body"] = body
    return out


def apply(rules: list[dict], overrides: dict[str, dict] | None) -> list[dict]:
    # Identity fast path: nothing to disable or re-severity. Preserves the input list
    # object (a hot path for the common case) and skips the per-rule copy.
    if not overrides and all(r.get("enabled", True) for r in rules):
        return rules
    kept = []
    for r in rules:
        o = overrides.get(r.get("id", "")) if overrides else None
        # A rule ships enabled unless its YAML says otherwise (DDIC-derived rules are
        # disabled by default). A DB override can re-enable a disabled rule or disable
        # an enabled one; absent any override, the YAML default wins.
        if o is None:
            if r.get("enabled", True):
                kept.append(r)
        elif o.get("enabled", True):
            kept.append({**r, **o.get("body", {}), "id": r["id"],
                         **({"severity": o["severity"]} if "severity" in o else {})})
    return kept

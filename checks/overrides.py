"""Rule governance: which YAML checks run, and at what severity.

Sources, in order: HQ's catalogue (licence manifest → rules_hq_cache) sets
enabled + severity; the tenant's own Rules Engine toggle (rules table) can
only switch a check off. Unknown ids are ignored — HQ cannot inject logic.
One exception: a tenant ``rules`` row with ``source='promotion'`` and
``enabled=true`` (Aletheia rule promotion, api/services/rule_promotion.py)
re-enables a rule that ships disabled, but only when the id lives in a
``<module>.generated.yaml`` pack. It never re-enables a hand-written rule that
ships disabled, and an HQ ``rules_hq_cache`` entry for the id still wins.
A tenant's approved (active) rule version (checks/lifecycle.py) is merged onto
the rule as ``body``; tenant-authored rules arrive as extra rules.
"""

from __future__ import annotations

import json

from sqlalchemy import text

SEVERITIES = {"critical", "high", "medium", "low", "info"}


def generated_rule_ids() -> set[str]:
    """Ids shipped in a ``*.generated.yaml`` sidecar (the DDIC-derived packs)."""
    from checks.runner import generated_rule_ids as _ids
    return _ids()


def load_overrides(session) -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        for rid, enabled, severity in session.execute(
                text("SELECT id, enabled, severity FROM rules_hq_cache")).fetchall():
            out[rid] = {"enabled": bool(enabled), **({"severity": severity} if severity in SEVERITIES else {})}
    except Exception:  # table absent before migration 050 → no HQ governance yet
        session.rollback()
    promoted: set[str] = set()
    for name, enabled, source in session.execute(text("SELECT name, enabled, source FROM rules")).fetchall():
        rid = (name or "").split(":", 1)[0].strip()
        if rid and not enabled:
            out.setdefault(rid, {})["enabled"] = False
        elif rid and source == "promotion":
            promoted.add(rid)
    if promoted:
        promoted = {r for r in promoted if "enabled" not in out.get(r, {})} & generated_rule_ids()
        for rid in promoted:
            out.setdefault(rid, {})["enabled"] = True
    try:  # steward-approved Aletheia fix drafts (api/services/fix_drafter.py) become the rule's auto_fix
        for (v,) in session.execute(text("SELECT value FROM tenant_settings WHERE key LIKE 'fix_draft.%'")).fetchall():
            v = json.loads(v) if isinstance(v, str) else v
            if v.get("status") == "approved" and v.get("steps"):
                out.setdefault(v["rule_id"], {})["auto_fix"] = {"steps": v["steps"], "confidence": "low"}
    except Exception:  # no tenant_settings table (older schema, unit tests)
        session.rollback()
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
        elif o.get("enabled", r.get("enabled", True) if set(o) == {"auto_fix"} else True):
            kept.append({**r, **o.get("body", {}), **({"auto_fix": o["auto_fix"]} if "auto_fix" in o else {}), "id": r["id"],
                         **({"severity": o["severity"]} if "severity" in o else {})})
    return kept

"""Rule lifecycle: tenant rule versions, suppressions, and shipped-rule identity.

Shipped rules (checks/rules/**/*.yaml) are versioned by git; at runtime their
identity is a content hash plus the app version. Tenant changes live in
``rule_versions`` (migration 054): a version for a shipped id is a partial
override merged onto the YAML rule, a version for a new id is a whole rule.
Only the ``active`` version of a rule is applied (via checks/overrides.py).

``rule_suppressions`` hides a whole rule or single records from the score until
``expires_at``; once expired the rows are simply no longer loaded.
"""

from __future__ import annotations

import difflib
import hashlib
import json
from functools import lru_cache

import yaml
from sqlalchemy import text

from checks.base import CheckResult, pass_rate_of

STATES = ("draft", "in_review", "active", "retired")
# (from, to) -> permission the actor needs (api.services.rbac actions)
TRANSITIONS = {
    ("draft", "in_review"): "manage_rules",
    ("in_review", "draft"): "approve",      # sent back by the reviewer
    ("in_review", "active"): "approve",
    ("active", "retired"): "manage_rules",
}
AUTHORED_REQUIRED = ("module", "check_class", "field", "severity", "message")


@lru_cache(maxsize=1)
def shipped_rules() -> dict[str, tuple[dict, str]]:
    """Every shipped YAML rule by id -> (rule, path relative to checks/rules)."""
    from checks.runner import CATEGORIES, RULES_DIR
    out: dict[str, tuple[dict, str]] = {}
    for path in sorted(p for c in CATEGORIES for p in (RULES_DIR / c).glob("*.yaml")):
        doc = yaml.safe_load(path.read_text()) or {}
        if not isinstance(doc, dict):
            continue
        for rule in doc.get("rules") or []:
            if isinstance(rule, dict) and rule.get("id"):
                out[rule["id"]] = ({**rule, "module": rule.get("module") or doc.get("module")},
                                   str(path.relative_to(RULES_DIR)))
    return out


def rule_hash(rule: dict) -> str:
    return hashlib.sha256(json.dumps(rule, sort_keys=True, default=str).encode()).hexdigest()[:16]


def shipped_info(rule_id: str) -> dict | None:
    hit = shipped_rules().get(rule_id)
    if not hit:
        return None
    from api.services.version import APP_VERSION
    return {"source": hit[1], "hash": rule_hash(hit[0]), "app_version": APP_VERSION, "rule": hit[0]}


def validate_body(rule_id: str, body: dict) -> str | None:
    """Reason the version body is unusable, or None."""
    from checks.runner import REGISTRY
    if "id" in body and body["id"] != rule_id:
        return "body.id must match the rule id"
    if rule_id not in shipped_rules():
        missing = [k for k in AUTHORED_REQUIRED if not body.get(k)]
        if missing:
            return f"a new rule needs: {', '.join(missing)}"
    if "check_class" in body and body["check_class"] not in REGISTRY:
        return f"unknown check_class: {body['check_class']}"
    return None


def effective(rule_id: str, body: dict) -> dict:
    base = (shipped_rules().get(rule_id) or ({}, ""))[0]
    return {**base, **body, "id": rule_id}


def diff(rule_id: str, old: dict | None, new: dict, old_label: str, new_label: str) -> str:
    def dump(b: dict | None) -> list[str]:
        return [] if b is None else yaml.safe_dump(effective(rule_id, b), sort_keys=True).splitlines(keepends=True)
    return "".join(difflib.unified_diff(dump(old), dump(new), old_label, new_label))


def load_active_versions(session) -> dict[str, dict]:
    """rule_id -> body of the tenant's active version (RLS scopes the read)."""
    try:
        rows = session.execute(text("SELECT rule_id, body FROM rule_versions WHERE state = 'active'")).fetchall()
    except Exception:  # table absent before migration 054
        session.rollback()
        return {}
    return {rid: body or {} for rid, body in rows}


def authored_rules(active: dict[str, dict]) -> list[dict]:
    """Active tenant-authored rules (ids not shipped) — run as extra rules."""
    return [{**b, "id": rid} for rid, b in active.items() if rid not in shipped_rules() and b.get("module")]


def load_suppressions(session) -> tuple[set[str], dict[str, set[str]]]:
    """Unexpired suppressions: (whole-rule ids, {check_id: record keys})."""
    try:
        rows = session.execute(text(
            "SELECT check_id, record_key FROM rule_suppressions WHERE expires_at > now()")).fetchall()
    except Exception:
        session.rollback()
        return set(), {}
    rules = {c for c, k in rows if k is None}
    records: dict[str, set[str]] = {}
    for c, k in rows:
        if k is not None and c not in rules:
            records.setdefault(c, set()).add(k)
    return rules, records


def for_scoring(results: list[CheckResult], rules: set[str],
                records: dict[str, set[str]]) -> list[CheckResult]:
    """Results with suppressed rules dropped and suppressed records not counted.

    Marks the originals (details.suppressed / suppressed_records) so findings
    show why the score ignores them. Only keys inside failing_record_keys can
    be discounted (the list is capped at MAX_FAILING_KEYS).
    """
    out = []
    for r in results:
        if r.check_id in rules:
            r.details = {**(r.details or {}), "suppressed": True}
            continue
        keys = records.get(r.check_id)
        hit = len(keys.intersection(r.failing_record_keys or ())) if keys and r.affected_count else 0
        if not hit:
            out.append(r)
            continue
        r.details = {**(r.details or {}), "suppressed_records": hit}
        affected = max(r.affected_count - hit, 0)
        out.append(r.model_copy(update={"affected_count": affected, "passed": affected == 0,
                                        "pass_rate": pass_rate_of(r.total_count, affected)}))
    return out

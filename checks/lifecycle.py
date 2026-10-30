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
from collections.abc import Callable
from functools import lru_cache

import yaml
from sqlalchemy import text

from checks.base import CheckResult, pass_rate_of

STATES = ("draft", "in_review", "active", "retired")
# (from, to) -> permissions, any one of which lets the actor make the move (api.services.rbac actions).
# A review decision (in_review -> active, or back to draft) is the checker's: `approve`, or
# `review_ai_rules` for the AI reviewer, who signs proposed rules off without writing them.
REVIEW_PERMISSIONS = ("approve", "review_ai_rules")
TRANSITIONS: dict[tuple[str, str], tuple[str, ...]] = {
    ("draft", "in_review"): ("manage_rules",),
    ("in_review", "draft"): REVIEW_PERMISSIONS,      # sent back by the reviewer
    ("in_review", "active"): REVIEW_PERMISSIONS,
    ("active", "retired"): ("manage_rules",),
}


def may_transition(src: str, dst: str, can: Callable[[str], bool]) -> bool:
    """True when ``can(action)`` holds for any permission the (src, dst) move accepts."""
    return any(can(a) for a in TRANSITIONS.get((src, dst), ()))
AUTHORED_REQUIRED = ("module", "check_class", "field", "severity", "message")


@lru_cache(maxsize=1)
def shipped_rules() -> dict[str, tuple[dict, str]]:
    """Every shipped YAML rule by id -> (rule, path relative to checks/rules)."""
    from checks.rule_files import rule_files
    return _rules_in(sorted(rule_files()))


def _rules_in(paths: list) -> dict[str, tuple[dict, str]]:
    """rule id -> (rule, path relative to checks/rules) over ``paths``; a later file wins an id."""
    from checks.rule_files import RULES_DIR, parsed
    out: dict[str, tuple[dict, str]] = {}
    for path in paths:
        doc = parsed(path)
        for rule in doc.get("rules") or []:
            if isinstance(rule, dict) and rule.get("id"):
                out[rule["id"]] = ({**rule, "module": rule.get("module") or doc.get("module")},
                                   str(path.relative_to(RULES_DIR)))
    return out


def shipped_rule(rule_id: str) -> tuple[dict, str] | None:
    """(rule, source) of one shipped rule, the same as ``shipped_rules().get(rule_id)``, parsing only the files
    that can hold it (checks/rule_files.files_with)."""
    if shipped_rules.cache_info().currsize:
        return shipped_rules().get(rule_id)
    from checks.rule_files import RULES_DIR, doc_module, files_with, rules_in_file
    hit = None
    for path in sorted(files_with(rule_id)):  # a later file wins an id, as in shipped_rules
        for rule in rules_in_file(path, rule_id):
            hit = ({**rule, "module": rule.get("module") or doc_module(path)}, str(path.relative_to(RULES_DIR)))
    return hit


def rule_hash(rule: dict) -> str:
    return hashlib.sha256(json.dumps(rule, sort_keys=True, default=str).encode()).hexdigest()[:16]


def shipped_info(rule_id: str) -> dict | None:
    hit = shipped_rule(rule_id)
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

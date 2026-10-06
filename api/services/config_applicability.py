"""Config-aware DQ score: which rules apply to a system, judged from its loaded configuration.

``checks/config_applicability.yaml`` maps a rule pack (module) or a rule to a configuration condition. A rule is
not applicable only when its condition's object was read and the condition is not met; unread, failed or
unavailable objects never switch a rule off. Score = passing rules / applicable rules (a rule passes when its
finding affected no record). Pure functions over plain dicts, tested directly.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import yaml

_YAML = Path(__file__).resolve().parents[2] / "checks" / "config_applicability.yaml"
_SEVERITY = {"critical": 0, "high": 1, "medium": 2, "low": 3}
TOP_FAILING = 5


@lru_cache(maxsize=1)
def conditions() -> dict[str, dict[str, dict]]:
    doc = yaml.safe_load(_YAML.read_text()) or {}
    return {"packs": doc.get("packs") or {}, "rules": doc.get("rules") or {}}


def required_objects() -> dict[str, set[str]]:
    """Config object -> fields the conditions read (so the loader reads them)."""
    out: dict[str, set[str]] = {}
    for group in conditions().values():
        for cond in group.values():
            req = cond["requires"]
            out.setdefault(req["object"], set()).update((req.get("where") or {}).keys())
    return out


def evaluate(module: str, check_id: str, config: dict[str, dict]) -> tuple[bool, Optional[str]]:
    """``config``: {object: {"state": loaded|empty|failed|not_available, "rows": [value dicts]}}.
    Returns (applicable, reason when not)."""
    c = conditions()
    cond = c["rules"].get(check_id) or c["packs"].get(module)
    if not cond:
        return True, None
    req = cond["requires"]
    obj = config.get(req["object"])
    if not obj or obj.get("state") not in ("loaded", "empty"):
        return True, None  # not read: never guess
    where = req.get("where") or {}
    rows = [r for r in obj.get("rows") or []
            if all(str(r.get(f, "")).strip() in {str(v) for v in vals} for f, vals in where.items())]
    if len(rows) >= int(req.get("min_rows", 1)):
        return True, None
    return False, cond.get("reason")


@lru_cache(maxsize=1)
def process_index() -> list[dict[str, Any]]:
    """[{l1, name, l2: [{l2, name, checks: set}]}] from the process reference (activity check_ids)."""
    from sap.process_definitions import PROCESS_DEFINITIONS

    out = []
    for l1 in PROCESS_DEFINITIONS:
        l2s = []
        for l2 in l1["l2"]:
            checks = {c for l3 in l2["l3"] for l4 in l3["l4"] for a in l4["activities"]
                      for c in a.get("check_ids") or []}
            l2s.append({"l2": l2["id"], "name": l2["name"], "checks": checks})
        out.append({"l1": l1["id"], "name": l1["name"], "l2": l2s})
    return out


def _tally(rules: list[dict]) -> dict[str, Any]:
    app = [r for r in rules if r["applicable"]]
    na = [r for r in rules if not r["applicable"]]
    passes = sum(1 for r in app if not r["affected_count"])
    reasons: dict[str, int] = {}
    for r in na:
        reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
    failing = sorted((r for r in app if r["affected_count"]),
                     key=lambda r: (_SEVERITY.get(r["severity"], 9), -int(r["affected_count"]), r["check_id"]))
    return {"applicable": len(app), "not_applicable": len(na), "passes": passes,
            "score": round(100.0 * passes / len(app), 2) if app else None,
            "not_applicable_reasons": [{"reason": k, "count": v} for k, v in sorted(reasons.items())],
            "top_failing": [{"check_id": r["check_id"], "module": r["module"], "severity": r["severity"],
                             "affected_count": int(r["affected_count"])} for r in failing[:TOP_FAILING]]}


def score(findings: list[dict], config: dict[str, dict]) -> dict[str, Any]:
    """Config-aware score over rule findings (module, check_id, severity, affected_count), overall and per
    process L1/L2. A check shared by several L2s counts in each of them; in the L1 and overall once."""
    rules = []
    for f in findings:
        ok, reason = evaluate(f["module"], f["check_id"], config)
        rules.append({**f, "applicable": ok, "reason": reason})
    by_id = {r["check_id"]: r for r in rules}
    seen: set[str] = set()
    procs = []
    for l1 in process_index():
        l2s, l1_ids = [], set()
        for l2 in l1["l2"]:
            ids = l2["checks"] & by_id.keys()
            if ids:
                l2s.append({"l2": l2["l2"], "name": l2["name"], **_tally([by_id[i] for i in sorted(ids)])})
                l1_ids |= ids
        if l2s:
            seen |= l1_ids
            procs.append({"l1": l1["l1"], "name": l1["name"], **_tally([by_id[i] for i in sorted(l1_ids)]), "l2": l2s})
    unmapped = [r for r in rules if r["check_id"] not in seen]
    return {"config_aware": _tally(rules), "processes": procs,
            "unmapped": _tally(unmapped) if unmapped else None}

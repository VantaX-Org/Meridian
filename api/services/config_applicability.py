"""Config-aware DQ score: which rules apply to a system, judged from its loaded configuration.

``checks/config_applicability.yaml`` maps a rule pack (module) or a rule to a configuration condition. A rule is
not applicable only when its condition's object was read and the condition is not met; unread, failed or
unavailable objects never switch a rule off. Score = passing rules / applicable rules (a rule passes when its
finding affected no record). Pure functions over plain dicts, tested directly.
"""

from __future__ import annotations

import re
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


APPLIES, DOES_NOT_APPLY, BY_DEFAULT, NOT_AVAILABLE = "applies", "does_not_apply", "applies_by_default", "not_available"


def condition(module: str, check_id: str) -> Optional[dict]:
    c = conditions()
    return c["rules"].get(check_id) or c["packs"].get(module)


def _found_reason(cond: dict, n: int) -> str:
    """'no sales document types in TVAK' -> '14 sales document types in TVAK'."""
    obj = cond["requires"]["object"]
    text = re.sub(r"\s*\(.*\)$", "", cond.get("reason") or "")
    if not text.lower().startswith("no "):
        return f"{n} rows in {obj}"
    text = f"{n} {text[3:]}"
    return text if obj in text else f"{text} in {obj}"


def judge(module: str, check_id: str, config: Optional[dict[str, dict]],
          system_type: Optional[str] = None) -> dict[str, Any]:
    """Applicability of one rule on one system: {status, reason, object}. status is applies |
    does_not_apply | applies_by_default (config not loaded or object unread) | not_available (the system
    cannot expose it). ``config`` None = no configuration loaded for the system."""
    cond = condition(module, check_id)
    obj_name = cond["requires"]["object"] if cond else None
    if config is None or (config.get("*") or {}).get("state") == NOT_AVAILABLE:
        from api.services.config_areas import no_config_api

        if system_type and no_config_api(system_type) or config is not None:
            return {"status": NOT_AVAILABLE, "reason": "Not available from this system", "object": obj_name}
        return {"status": BY_DEFAULT, "reason": "Configuration not loaded", "object": obj_name}
    if not cond:
        return {"status": APPLIES, "reason": None, "object": None}
    req = cond["requires"]
    obj = config.get(req["object"])
    if obj and obj.get("state") == NOT_AVAILABLE:
        return {"status": NOT_AVAILABLE, "reason": "Not available from this system", "object": obj_name}
    if not obj or obj.get("state") not in ("loaded", "empty"):
        return {"status": BY_DEFAULT, "reason": f"{obj_name} not read", "object": obj_name}  # never guess
    where = req.get("where") or {}
    rows = [r for r in obj.get("rows") or []
            if all(str(r.get(f, "")).strip() in {str(v) for v in vals} for f, vals in where.items())]
    if len(rows) >= int(req.get("min_rows", 1)):
        return {"status": APPLIES, "reason": _found_reason(cond, len(rows)), "object": obj_name}
    return {"status": DOES_NOT_APPLY, "reason": cond.get("reason"), "object": obj_name}


def evaluate(module: str, check_id: str, config: dict[str, dict]) -> tuple[bool, Optional[str]]:
    """``config``: {object: {"state": loaded|empty|failed|not_available, "rows": [value dicts]}}.
    Returns (applicable, reason when not)."""
    j = judge(module, check_id, config)
    return (False, j["reason"]) if j["status"] == DOES_NOT_APPLY else (True, None)


@lru_cache(maxsize=1)
def rule_titles() -> dict[str, str]:
    from api.services.tenant_seed import raw_rules

    return {str(r["id"]): str(r.get("message") or r["id"]) for _c, _f, _m, r in raw_rules()}


@lru_cache(maxsize=1)
def process_index() -> list[dict[str, Any]]:
    """[{l1, name, l2: [{l2, name, checks: set, objects: set}]}] from the process reference (activity
    check_ids; objects = the config tables its steps are probed against)."""
    from sap.process_definitions import PROCESS_DEFINITIONS
    from sap.process_templates import PROBES, VARIANT_PROBES

    out = []
    for l1 in PROCESS_DEFINITIONS:
        l2s = []
        for l2 in l1["l2"]:
            checks: set[str] = set()
            objects: set[str] = set()
            for l3 in l2["l3"]:
                for l4 in l3["l4"]:
                    nodes = [l4["id"], *(a.get("id") for a in l4["activities"])]
                    for p in [PROBES.get(n) for n in nodes] + list(VARIANT_PROBES.get(l4["id"], ())):
                        if p is not None:
                            objects.update((p.table, *p.alt))
                    checks.update(c for a in l4["activities"] for c in a.get("check_ids") or [])
            l2s.append({"l2": l2["id"], "name": l2["name"], "checks": checks, "objects": objects})
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
    titles = rule_titles()
    return {"applicable": len(app), "not_applicable": len(na), "passes": passes,
            "by_default": sum(1 for r in app if r.get("applicability") in (BY_DEFAULT, NOT_AVAILABLE)),
            "score": round(100.0 * passes / len(app), 2) if app else None,
            "not_applicable_reasons": [{"reason": k, "count": v} for k, v in sorted(reasons.items())],
            "not_applicable_rules": [{"check_id": r["check_id"], "module": r["module"], "severity": r["severity"],
                                      "title": titles.get(r["check_id"]), "reason": r["reason"]}
                                     for r in sorted(na, key=lambda r: r["check_id"])],
            "top_failing": [{"check_id": r["check_id"], "module": r["module"], "severity": r["severity"],
                             "title": titles.get(r["check_id"]), "affected_count": int(r["affected_count"])}
                            for r in failing[:TOP_FAILING]]}


def score(findings: list[dict], config: Optional[dict[str, dict]],
          system_type: Optional[str] = None) -> dict[str, Any]:
    """Config-aware score over rule findings (module, check_id, severity, affected_count), overall, per
    module and per process L1/L2. A check shared by several L2s counts in each of them; in the L1 and overall
    once. ``config`` None = configuration not loaded (every rule applies by default)."""
    from api.services.config_areas import configured_in

    rules = []
    for f in findings:
        j = judge(f["module"], f["check_id"], config, system_type)
        rules.append({**f, "applicable": j["status"] != DOES_NOT_APPLY, "applicability": j["status"],
                      "reason": j["reason"], "object": j["object"]})
    by_id = {r["check_id"]: r for r in rules}
    seen: set[str] = set()
    procs = []
    for l1 in process_index():
        l2s, l1_ids = [], set()
        for l2 in l1["l2"]:
            ids = l2["checks"] & by_id.keys()
            if ids:
                objs = l2["objects"] | {by_id[i]["object"] for i in ids if by_id[i]["object"]}
                where = configured_in(system_type, sorted(objs)) if system_type else []
                l2s.append({"l2": l2["l2"], "name": l2["name"], **_tally([by_id[i] for i in sorted(ids)]),
                            "configured_in": where})
                l1_ids |= ids
        if l2s:
            seen |= l1_ids
            procs.append({"l1": l1["l1"], "name": l1["name"], **_tally([by_id[i] for i in sorted(l1_ids)]), "l2": l2s})
    unmapped = [r for r in rules if r["check_id"] not in seen]
    modules: dict[str, list[dict]] = {}
    for r in rules:
        modules.setdefault(r["module"], []).append(r)
    titles = rule_titles()
    return {"config_aware": _tally(rules), "processes": procs,
            "unmapped": _tally(unmapped) if unmapped else None,
            "modules": [{"module": m, **_tally(rs)} for m, rs in sorted(modules.items())],
            "rules": [{"check_id": r["check_id"], "module": r["module"], "severity": r["severity"],
                       "title": titles.get(r["check_id"]), "affected_count": int(r["affected_count"] or 0),
                       "applicability": r["applicability"], "reason": r["reason"], "object": r["object"]}
                      for r in sorted(rules, key=lambda r: r["check_id"])]}

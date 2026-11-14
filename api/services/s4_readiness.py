"""S/4HANA conversion readiness roll-up.

Groups the findings of one analysis by simplification area: the rules of the
``s4_readiness`` pack (area from ``s4_area``) plus the existing rules of other
modules an S/4HANA conversion depends on (``areas.<area>.related`` in
checks/rules/ecc/s4_readiness.yaml). A finding's status uses the L1-L5
classifier (api/services/process_writer.py); a failing blocking rule is always red.
"""
from functools import lru_cache
from typing import Any

import yaml

from api.services.process_writer import _classify_finding, _worst_status
from checks.runner import _find_module_yaml

MODULE = "s4_readiness"


@lru_cache(maxsize=1)
def pack() -> dict[str, Any]:
    return yaml.safe_load(_find_module_yaml(MODULE).read_text())


def _areas(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The pack's areas as dicts: an area may be written as just its description (a string)."""
    return {a: spec if isinstance(spec, dict) else {"description": spec}
            for a, spec in (doc.get("areas") or {}).items()}


def _impact(rule: dict[str, Any]) -> str:
    """blocking / warning; a rule whose s4_impact says what fails in words is blocking at critical or high."""
    impact = rule.get("s4_impact")
    if impact in ("blocking", "warning"):
        return impact
    return "blocking" if rule.get("severity") in ("critical", "high") else "warning"


def membership() -> dict[str, tuple[str, str]]:
    """check_id -> (area, impact) for every rule the readiness roll-up counts."""
    doc = pack()
    out = {cid: (area, impact)
           for area, spec in _areas(doc).items()
           for impact, ids in (spec.get("related") or {}).items() for cid in ids}
    out.update({r["id"]: (r["s4_area"], _impact(r)) for r in doc.get("rules", [])})
    return out


def status_of(finding: dict[str, Any], impact: str) -> str:
    if not finding.get("affected_count"):
        return "green"
    status = _classify_finding({"severity": finding.get("severity"),
                                "pass_rate": finding.get("pass_rate")})  # both on the 0-100 scale
    return "red" if impact == "blocking" else status


def rollup(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Per area: rules counted, rules evaluated, failing rules and records, blocking vs
    warning failures and a green/amber/red status; plus the overall verdict."""
    doc, members = pack(), membership()
    areas: dict[str, dict[str, Any]] = {
        a: {"area": a, "label": spec.get("label", a.replace("_", " ").capitalize()), "simplification_item": spec.get("simplification_item"),
            "rules": 0, "evaluated": 0, "failing": 0, "failing_records": 0,
            "blocking_rules": 0, "blocking_evaluated": 0, "blocking_unevaluated": 0,
            "blocking_failing": 0, "warning_failing": 0, "status": "green", "checks": []}
        for a, spec in _areas(doc).items()}
    for area, impact in members.values():
        areas[area]["rules"] += 1
        areas[area]["blocking_rules"] += impact == "blocking"
    seen_blocking: dict[str, set[str]] = {a: set() for a in areas}
    for f in findings:
        if f.get("check_id") not in members or (f.get("details") or {}).get("error"):
            continue  # an errored / not-evaluated rule says nothing about readiness
        area, impact = members[f["check_id"]]
        a, status = areas[area], status_of(f, impact)
        a["evaluated"] += 1
        if impact == "blocking":
            seen_blocking[area].add(f["check_id"])  # a rule run on two objects counts once
        if f.get("affected_count"):
            a["failing"] += 1
            a["failing_records"] += int(f["affected_count"])
            a[f"{impact}_failing"] += 1
        a["status"] = _worst_status(a["status"], status)
        a["checks"].append({"check_id": f["check_id"], "module": f.get("module"), "impact": impact,
                            "status": status, "affected_count": int(f.get("affected_count") or 0),
                            "pass_rate": None if f.get("pass_rate") is None else float(f["pass_rate"])})
    rows = list(areas.values())
    overall = "green"
    for a in rows:
        a["blocking_evaluated"] = len(seen_blocking[a["area"]])
        a["blocking_unevaluated"] = max(0, a["blocking_rules"] - a["blocking_evaluated"])
        a["checks"].sort(key=lambda c: (c["impact"] != "blocking", -c["affected_count"]))
        if a["evaluated"]:
            overall = _worst_status(overall, a["status"])
        else:
            a["status"] = "not_evaluated"
    total = {k: sum(a[k] for a in rows) for k in
             ("rules", "evaluated", "failing", "failing_records", "blocking_rules", "blocking_evaluated",
              "blocking_unevaluated", "blocking_failing", "warning_failing")}
    # ready only when every blocking rule was evaluated: a blocking rule that was skipped (field
    # absent, other object not extracted) is unknown, not passed, so the verdict stays open
    assessment = ("not_assessed" if not total["evaluated"]
                  else "incomplete" if total["blocking_unevaluated"] else "complete")
    return {"status": overall, "assessment": assessment,
            "ready": total["blocking_failing"] == 0 and assessment == "complete",
            **total, "areas": rows}

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


def membership() -> dict[str, tuple[str, str]]:
    """check_id -> (area, impact) for every rule the readiness roll-up counts."""
    doc = pack()
    out = {cid: (area, impact)
           for area, spec in (doc.get("areas") or {}).items()
           for impact, ids in (spec.get("related") or {}).items() for cid in ids}
    out.update({r["id"]: (r["s4_area"], r["s4_impact"]) for r in doc.get("rules", [])})
    return out


def status_of(finding: dict[str, Any], impact: str) -> str:
    if not finding.get("affected_count"):
        return "green"
    pr = finding.get("pass_rate")  # stored 0-100; the L1-L5 thresholds are fractions
    status = _classify_finding({"severity": finding.get("severity"),
                                "pass_rate": None if pr is None else float(pr) / 100})
    return "red" if impact == "blocking" else status


def rollup(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Per area: rules counted, rules evaluated, failing rules and records, blocking vs
    warning failures and a green/amber/red status; plus the overall verdict."""
    doc, members = pack(), membership()
    areas: dict[str, dict[str, Any]] = {
        a: {"area": a, "label": spec.get("label", a), "simplification_item": spec.get("simplification_item"),
            "rules": 0, "evaluated": 0, "failing": 0, "failing_records": 0,
            "blocking_failing": 0, "warning_failing": 0, "status": "green", "checks": []}
        for a, spec in (doc.get("areas") or {}).items()}
    for area, _ in members.values():
        areas[area]["rules"] += 1
    for f in findings:
        if f.get("check_id") not in members or (f.get("details") or {}).get("error"):
            continue  # an errored / not-evaluated rule says nothing about readiness
        area, impact = members[f["check_id"]]
        a, status = areas[area], status_of(f, impact)
        a["evaluated"] += 1
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
        a["checks"].sort(key=lambda c: (c["impact"] != "blocking", -c["affected_count"]))
        if a["evaluated"]:
            overall = _worst_status(overall, a["status"])
        else:
            a["status"] = "not_evaluated"
    total = {k: sum(a[k] for a in rows) for k in
             ("rules", "evaluated", "failing", "failing_records", "blocking_failing", "warning_failing")}
    return {"status": overall, "ready": total["blocking_failing"] == 0 and total["evaluated"] > 0,
            **total, "areas": rows}

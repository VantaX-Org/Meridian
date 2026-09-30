"""Data-contract compliance — deterministic, evaluated after every analysis run
(quality, volume, schema) and hourly (freshness).

Contract JSON shapes (all optional):
  quality_contract    {"min_dqs": 80, "completeness": 95, ...}   percentages
  volume_contract     {"min_records": 100, "max_records": 10000}
  freshness_contract  {"max_age_hours": 24}
  schema_contract     {"FIELD": {"mandatory": true, "allowed_values": [...]}, ...}
Scope: "modules": [...] in any section, else a module id named in ``producer``
(e.g. "SAP business_partner"), else every module of the run.

A dimension a run did not measure is reported as not measured — never as a
pass or a fail. One open exception per contract; later violations update it.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

DIMENSIONS = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")


def declared_modules(contract: dict) -> set[str] | None:
    """The contract's module scope; None = every module."""
    from pathlib import Path

    for section in ("quality_contract", "volume_contract", "freshness_contract", "schema_contract"):
        mods = (contract.get(section) or {}).get("modules")
        if mods:
            return set(mods)
    known = {p.stem for p in (Path(__file__).resolve().parents[2] / "checks" / "rules").glob("*/*.yaml")}
    producer = (contract.get("producer") or "").lower()
    named = {m for m in known if m in producer}
    return named or None


def scope_modules(contract: dict, run_modules: list[str]) -> list[str]:
    declared = declared_modules(contract)
    return list(run_modules) if declared is None else [m for m in run_modules if m in declared]


def evaluate_quality(qc: dict, dqs: dict, modules: list[str]) -> tuple[dict, list[dict]]:
    actuals: dict[str, float] = {}
    for dim in DIMENSIONS:
        vals = [(dqs.get(m) or {}).get("dimension_scores", {}).get(dim) for m in modules]
        vals = [float(v) for v in vals if v is not None]
        if vals:
            actuals[dim] = round(sum(vals) / len(vals), 2)
    comps = [float((dqs.get(m) or {})["composite_score"]) for m in modules
             if (dqs.get(m) or {}).get("composite_score") is not None]
    if comps:
        actuals["dqs"] = round(sum(comps) / len(comps), 2)
    violations = []
    for key, threshold in qc.items():
        dim = "dqs" if key == "min_dqs" else key
        if dim not in (*DIMENSIONS, "dqs") or not isinstance(threshold, (int, float)):
            continue
        actual = actuals.get(dim)
        if actual is None:
            violations.append({"type": "quality", "dimension": dim, "threshold": float(threshold),
                               "actual": None, "reason": "not measured in this run"})
        elif actual < float(threshold):
            violations.append({"type": "quality", "dimension": dim, "threshold": float(threshold),
                               "actual": actual, "gap": round(float(threshold) - actual, 2)})
    return actuals, violations


def evaluate_volume(vc: dict, module_rows: dict, modules: list[str]) -> list[dict]:
    counted = [m for m in modules if m in module_rows]
    if not counted or not ({"min_records", "max_records"} & vc.keys()):
        return []
    n = sum(int(module_rows[m]) for m in counted)
    out = []
    if vc.get("min_records") is not None and n < int(vc["min_records"]):
        out.append({"type": "volume", "records": n, "min_records": int(vc["min_records"])})
    if vc.get("max_records") is not None and n > int(vc["max_records"]):
        out.append({"type": "volume", "records": n, "max_records": int(vc["max_records"])})
    return out


def evaluate_schema(sc: dict, golden: list[tuple[str, dict]]) -> list[dict]:
    rules = {f: r for f, r in sc.items() if isinstance(r, dict)}
    out = []
    for key, fields in golden:
        for f, r in rules.items():
            v = fields.get(f)
            if r.get("mandatory") and v in (None, ""):
                out.append({"type": "schema", "record": key, "field": f, "reason": "mandatory field empty"})
            elif v not in (None, "") and r.get("allowed_values") and v not in r["allowed_values"]:
                out.append({"type": "schema", "record": key, "field": f, "reason": f"value '{v}' not allowed"})
    return out


def _record(session, tenant_id, contract, version_id, actuals, violations) -> None:
    session.execute(text("""
        INSERT INTO contract_compliance_history
            (id, tenant_id, contract_id, version_id, completeness_actual, accuracy_actual, consistency_actual,
             timeliness_actual, uniqueness_actual, validity_actual, overall_compliant, violations, recorded_at)
        VALUES (gen_random_uuid(), :tid, :cid, :vid, :completeness, :accuracy, :consistency, :timeliness,
                :uniqueness, :validity, :ok, CAST(:v AS jsonb), now())
    """), {"tid": tenant_id, "cid": str(contract["id"]), "vid": version_id, "ok": not violations,
           "v": json.dumps(violations), **{d: actuals.get(d) for d in DIMENSIONS}})
    if not violations:
        return
    desc = "; ".join(
        f"{v['dimension']} {v['actual']} < {v['threshold']}" if v["type"] == "quality" and v.get("actual") is not None
        else f"{v.get('dimension', v['type'])}: {v.get('reason') or json.dumps(v)}"
        for v in violations[:20]
    ) + (f" (+{len(violations) - 20} more)" if len(violations) > 20 else "")
    updated = session.execute(text("""
        UPDATE exceptions SET description = :d, severity = 'high'
         WHERE tenant_id = :tid AND type = 'contract_violation' AND source_reference = :ref
           AND status NOT IN ('resolved', 'closed')
    """), {"tid": tenant_id, "ref": str(contract["id"]), "d": desc}).rowcount
    if not updated:
        session.execute(text("""
            INSERT INTO exceptions (id, tenant_id, type, category, severity, status, title, description,
                                    source_reference, escalation_tier, sla_deadline, created_at)
            VALUES (gen_random_uuid(), :tid, 'contract_violation', 'data_quality', 'high', 'open', :title, :d,
                    :ref, 1, now() + interval '24 hours', now())
        """), {"tid": tenant_id, "title": f"Contract violation: {contract['name']}", "d": desc,
               "ref": str(contract["id"])})


def _active(session) -> list[dict]:
    rows = session.execute(text("SELECT * FROM contracts WHERE status = 'active' "
                                "AND (expires_at IS NULL OR expires_at > now())")).fetchall()
    return [dict(r._mapping) for r in rows]


def evaluate_run(session, tenant_id: str, version_id: str) -> list[dict]:
    """Quality + volume + schema for every active contract touching this run's modules."""
    meta, dqs = session.execute(text("SELECT metadata, dqs_summary FROM analysis_versions WHERE id = :v"),
                                {"v": version_id}).one()
    meta, dqs = meta or {}, dqs or {}
    run_modules = list(meta.get("modules") or dqs.keys())
    results = []
    for c in _active(session):
        modules = scope_modules(c, run_modules)
        if not modules:
            continue
        actuals, violations = evaluate_quality(c.get("quality_contract") or {}, dqs, modules)
        violations += evaluate_volume(c.get("volume_contract") or {}, meta.get("module_rows") or {}, modules)
        if c.get("schema_contract"):
            golden = session.execute(text("SELECT sap_object_key, golden_fields FROM master_records "
                                          "WHERE status = 'golden' AND domain = ANY(:mods)"),
                                     {"mods": modules}).fetchall()
            violations += evaluate_schema(c["schema_contract"], [(k, f or {}) for k, f in golden])
        _record(session, tenant_id, c, version_id, actuals, violations)
        results.append({"contract_id": str(c["id"]), "compliant": not violations, "violations": len(violations)})
    return results


def evaluate_freshness(session, tenant_id: str, now: datetime | None = None) -> list[dict]:
    """Violation when the newest complete analysis of a contract's modules is older than max_age_hours."""
    now = now or datetime.now(timezone.utc)
    latest = session.execute(text("SELECT id, run_at, metadata FROM analysis_versions WHERE status = 'complete' "
                                  "ORDER BY run_at DESC LIMIT 500")).fetchall()
    results = []
    for c in _active(session):
        max_age = (c.get("freshness_contract") or {}).get("max_age_hours")
        if max_age is None:
            continue
        match = next((v for v in latest if scope_modules(c, list((v.metadata or {}).get("modules") or []))), None)
        age = (now - match.run_at).total_seconds() / 3600 if match else None
        violations = [] if age is not None and age <= float(max_age) else [{
            "type": "freshness", "max_age_hours": float(max_age),
            "age_hours": None if age is None else round(age, 1),
            "reason": "no analysis found" if age is None else f"latest analysis {round(age, 1)}h old",
        }]
        # only record a freshness row when the state is a violation (runs record compliance themselves)
        if violations:
            _record(session, tenant_id, c, str(match.id) if match else None, {}, violations)
        results.append({"contract_id": str(c["id"]), "fresh": not violations})
    return results

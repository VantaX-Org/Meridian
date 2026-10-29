"""Data contract enforcement: per object of a contract's scope, the thresholds a run must meet.

Thresholds (``contracts.thresholds``), each optional, are checked on every object of the contract's scope
(api/services/contract_compliance.scope_modules) in a run's stored dqs_summary:

  min_score               the shown score (after the critical cap) is at least this; an unmeasured object breaches
  max_critical_breaches   at most this many critical rules over tolerance (receipt_math.breach_ids)
  dimensions              {dimension: minimum} for each measured dimension (an unmeasured one is not judged)

Without ``thresholds`` the contract's quality_contract applies per object (``min_dqs`` as min_score and its dimension
minimums). A breach is ``{contract_id, name, enforce, module, metric, threshold, actual}``. After each run the
contract evaluation records them in contract_breaches (``record_run``); the receipt, the landscape and the object
contract summary compute them the same way from the stored summary. An enforced contract's breaches block pinning
the run as the baseline unless forced with a reason. Deterministic; no LLM.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text

from api.services.contract_compliance import DIMENSIONS, scope_modules
from api.services.receipt_math import breach_ids

_ACTIVE = "status = 'active' AND (expires_at IS NULL OR expires_at > now())"


def effective_thresholds(contract: dict) -> dict:
    t = contract.get("thresholds")
    if isinstance(t, dict) and t:
        return t
    q = contract.get("quality_contract") or {}
    out: dict[str, Any] = {}
    if isinstance(q.get("min_dqs"), (int, float)):
        out["min_score"] = float(q["min_dqs"])
    dims = {d: float(v) for d, v in q.items() if d in DIMENSIONS and isinstance(v, (int, float))}
    if dims:
        out["dimensions"] = dims
    return out


def object_breaches(contract: dict, module: str, summary: dict | None) -> list[dict]:
    """The contract's breaches on one object's stored summary."""
    t = effective_thresholds(contract)
    s = summary if isinstance(summary, dict) else {}
    base = {"contract_id": str(contract["id"]), "name": contract.get("name"), "enforce": bool(contract.get("enforce")),
            "module": module}
    out = []
    if isinstance(t.get("min_score"), (int, float)):
        score = s.get("composite_score")
        if score is None or float(score) < float(t["min_score"]):
            out.append({**base, "metric": "score", "threshold": float(t["min_score"]),
                        "actual": None if score is None else float(score)})
    if isinstance(t.get("max_critical_breaches"), (int, float)) and s:
        n = len(breach_ids(s))
        if n > int(t["max_critical_breaches"]):
            out.append({**base, "metric": "critical_breaches", "threshold": float(t["max_critical_breaches"]),
                        "actual": float(n)})
    coverage = s.get("dimension_coverage") or {}
    for dim, minimum in sorted((t.get("dimensions") or {}).items()):
        v = (s.get("dimension_scores") or {}).get(dim)
        if dim in DIMENSIONS and isinstance(minimum, (int, float)) and v is not None and coverage.get(dim) != 0 \
                and float(v) < float(minimum):
            out.append({**base, "metric": dim, "threshold": float(minimum), "actual": float(v)})
    return out


def breaches_of(contracts: list[dict], summary: dict, modules: list[str] | None = None) -> list[dict]:
    """Every contract's breaches over the objects of one run's summary (``modules`` narrows them)."""
    run_modules = [m for m in (modules or sorted(summary)) if isinstance(summary.get(m), dict)]
    return [b for c in contracts for m in scope_modules(c, run_modules) for b in object_breaches(c, m, summary.get(m))]


def active_sync(session, tenant_id: str) -> list[dict]:
    return [dict(r) for r in session.execute(text(f"SELECT * FROM contracts WHERE tenant_id = :t AND {_ACTIVE} "
                                                  "ORDER BY name, id"), {"t": tenant_id}).mappings().all()]


async def active(db, tenant_id: str) -> list[dict]:
    return [dict(r) for r in (await db.execute(text(f"SELECT * FROM contracts WHERE tenant_id = :t AND {_ACTIVE} "
                                                    "ORDER BY name, id"), {"t": tenant_id})).mappings().all()]


async def summary_of(db, tenant_id: str, run_id: str) -> dict:
    s = (await db.execute(text("SELECT dqs_summary FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t"),
                          {"v": run_id, "t": tenant_id})).scalar()
    return s if isinstance(s, dict) else {}


async def breaches_for_run(db, tenant_id: str, contract: dict, run_id: str, modules: list[str] | None = None) -> list[dict]:
    return breaches_of([contract], await summary_of(db, tenant_id, run_id), modules)


def record_run(session, tenant_id: str, version_id: str) -> int:
    """Write the run's breaches of every active contract (enforced or not) to contract_breaches. Idempotent."""
    summary = session.execute(text("SELECT dqs_summary FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t"),
                              {"v": version_id, "t": tenant_id}).scalar() or {}
    rows = breaches_of(active_sync(session, tenant_id), summary if isinstance(summary, dict) else {})
    session.execute(text("DELETE FROM contract_breaches WHERE tenant_id = :t AND version_id = CAST(:v AS uuid)"),
                    {"t": tenant_id, "v": version_id})
    for b in rows:
        session.execute(text("""
            INSERT INTO contract_breaches (tenant_id, contract_id, version_id, module, metric, threshold, actual, enforced)
            VALUES (:t, CAST(:c AS uuid), CAST(:v AS uuid), :m, :metric, :th, :a, :e)
            ON CONFLICT (contract_id, version_id, module, metric) DO NOTHING"""),
            {"t": tenant_id, "c": b["contract_id"], "v": version_id, "m": b["module"], "metric": b["metric"],
             "th": b["threshold"], "a": b["actual"], "e": b["enforce"]})
    return len(rows)

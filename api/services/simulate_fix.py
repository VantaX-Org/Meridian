"""Fix simulation over the stored run: what the receipt would read if chosen failures were fixed.

POST /api/v1/simulate/fix and GET /api/v1/simulate/fix/top (api/routes/simulate.py). Nothing is re-extracted and
nothing is cached: the object's stored findings of the run are rebuilt into check results, the chosen rules' failing
records are treated as passing, and the object is scored again with ``api.services.scoring.score_module`` -- the same
function the run itself scored with -- under the tenant's scoring config. The receipt fields are then read from the
two results exactly as the receipt reads them from dqs_summary (``receipt_math``): cap level, breaches, measured
dimensions, verdict. Feature impact is recomputed from the failing rules with the config impact rules
(db/seeds/config_impact_rules.yaml, ``api.services.fix_simulation.feature_impact``), before and after alike.

Deterministic throughout; no LLM, no estimate. ``method.reproduced`` says whether the rebuilt "before" equals the score
the run stored; when it does not (a summary stored by an older scoring), the delta is still exact for the rebuilt
results, and the stored score is reported next to it.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.receipt_math import DIMENSION_ORDER, breach_ids, cap_level_of
from api.services.scoring import readiness_status, score_module, scoring_config
from checks.base import CheckResult, pass_rate_of

TOP_RULES = 5
REPRODUCE_TOLERANCE = 0.05


@dataclass
class Selection:
    """What the caller fixes: whole rules, records (every rule they fail) and the items of fix batches."""
    rules: set[str] = field(default_factory=set)
    records: set[str] = field(default_factory=set)               # record keys of this object
    batch_keys: dict[str, set[str]] = field(default_factory=dict)  # check_id -> record keys from batch items


@dataclass
class ObjectRun:
    module: str
    run_id: str
    run_at: object
    system_id: str | None
    summary: dict
    findings: list[dict]
    raw_cfg: dict


def _verdict(score: float | None, breaches: int, thresholds: dict) -> str | None:
    """The landscape's verdict words (api/routes/landscape.py _verdict): go, at-risk, no-go; None when not measured."""
    if score is None:
        return None
    status = readiness_status(score, breaches, thresholds)
    return "at-risk" if status == "conditional" else status


def rebuild(findings: list[dict], module: str) -> list[CheckResult]:
    """The run's scored check results from its stored findings: anomalies and suppressed rules are out (the run
    never scored them), suppressed records are taken off the failing count as checks.lifecycle.for_scoring does."""
    out: list[CheckResult] = []
    for f in findings:
        details = f.get("details") or {}
        if f.get("finding_type") == "anomaly" or details.get("suppressed"):
            continue
        affected = max(0, int(f["affected_count"]) - int(details.get("suppressed_records") or 0))
        total = int(f["total_count"])
        stored = f.get("pass_rate")
        rate = float(stored) if stored is not None and affected == int(f["affected_count"]) else pass_rate_of(total, affected)
        out.append(CheckResult(
            check_id=f["check_id"], module=module, field=str(details.get("field_checked") or ""),
            severity=f["severity"], dimension=f["dimension"], passed=affected == 0, affected_count=affected,
            total_count=total, pass_rate=rate, message="", details={}, error=details.get("error"),
            grain=details.get("grain")))
    return out


def apply_fixes(results: list[CheckResult], resolved: dict[str, int], whole: set[str]) -> list[CheckResult]:
    """``results`` with each rule in ``whole`` fully passing and ``resolved[check_id]`` failing records fewer."""
    out = []
    for r in results:
        if r.error or r.passed:
            out.append(r)
            continue
        gone = r.affected_count if r.check_id in whole else min(r.affected_count, resolved.get(r.check_id, 0))
        if not gone:
            out.append(r)
            continue
        left = r.affected_count - gone
        out.append(r.model_copy(update={"affected_count": left, "passed": left == 0,
                                        "pass_rate": pass_rate_of(r.total_count, left)}))
    return out


def receipt_of(results: list[CheckResult], run: ObjectRun, thresholds: dict, impact_rules: dict,
               waves: list[dict]) -> dict:
    """The receipt's headline fields for one set of results."""
    from api.services.fix_simulation import feature_impact

    s = run.summary
    dqs = score_module(results, run.raw_cfg, module=run.module, skipped=int(s.get("skipped_checks") or 0),
                       not_applicable=int(s.get("not_applicable_checks") or 0)).model_dump()
    ids = breach_ids(dqs)
    impact = feature_impact(results, impact_rules)
    score = dqs["composite_score"]
    coverage = dqs.get("dimension_coverage") or {}
    return {
        "score": score, "raw_score": dqs["raw_score"], "cap_level": cap_level_of(dqs), "breaches": ids,
        "dimensions": {d: dqs["dimension_scores"][d] for d in DIMENSION_ORDER
                       if dqs["dimension_scores"].get(d) is not None and coverage.get(d)},
        "verdict": _verdict(score, len(ids), thresholds),
        "features_blocked": sum(1 for v in impact.values() if v == "full_block"),
        "features_degraded": sum(1 for v in impact.values() if v == "degraded"),
        "wave_gate": wave_gate(waves, score, ids),
    }


def wave_gate(waves: list[dict], score: float | None, breaches: list[str]) -> list[dict]:
    """Each wave holding the object: open when no critical rule is over tolerance and the score meets the wave's
    minimum DQS (when it sets one). The readiness certificate refuses on the same condition."""
    out = []
    for w in waves:
        reasons = []
        if breaches:
            reasons.append(f"{len(breaches)} critical rule(s) over tolerance")
        if w.get("min_dqs") is not None and (score is None or score < float(w["min_dqs"])):
            reasons.append(f"score below the wave minimum of {float(w['min_dqs']):g}")
        out.append({"wave_id": str(w["id"]), "name": w["name"], "open": not reasons, "reasons": reasons})
    return out


def delta_of(before: dict, after: dict) -> dict:
    def diff(k: str) -> float | None:
        a, b = after.get(k), before.get(k)
        return None if a is None or b is None else round(float(a) - float(b), 2)
    return {
        "score": diff("score"), "raw_score": diff("raw_score"),
        "breaches_cleared": [b for b in before["breaches"] if b not in after["breaches"]],
        "features_blocked": after["features_blocked"] - before["features_blocked"],
        "features_degraded": after["features_degraded"] - before["features_degraded"],
        "verdict_changed": before["verdict"] != after["verdict"],
        "gates_opened": [g["wave_id"] for g, h in zip(before["wave_gate"], after["wave_gate"])
                         if not g["open"] and h["open"]],
    }


# ── loading ──────────────────────────────────────────────────────────────────


async def load_object_run(db: AsyncSession, tenant_id: str, module: str, run_id: str | None,
                          system_id: str | None) -> ObjectRun | None:
    """The object's run (``run_id``, else its latest finished run on ``system_id`` or anywhere) with its stored
    summary and findings. None when there is no such run or the run did not score the object."""
    from api.services.run_context import latest_run

    rid = run_id or await latest_run(db, tenant_id, system_id=system_id, module=module)
    if rid is None:
        return None
    row = (await db.execute(text(
        "SELECT run_at, dqs_summary, metadata->>'system_id' FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
        {"v": str(rid), "t": tenant_id})).fetchone()
    summary = (row[1] or {}).get(module) if row and isinstance(row[1], dict) else None
    if not isinstance(summary, dict):
        return None
    if system_id and row[2] != str(system_id):
        return None
    findings = [dict(r) for r in (await db.execute(text(
        "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate, details, finding_type "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m ORDER BY check_id"),
        {"v": str(rid), "t": tenant_id, "m": module})).mappings().all()]
    raw_cfg = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"), {"t": tenant_id})).scalar() or {}
    return ObjectRun(module, str(rid), row[0], row[2], summary, findings, raw_cfg)


async def load_waves(db: AsyncSession, tenant_id: str, module: str) -> list[dict]:
    return [dict(r) for r in (await db.execute(text(
        "SELECT id, name, min_dqs FROM migration_waves WHERE tenant_id = :t AND :m = ANY(modules) ORDER BY name, id"),
        {"t": tenant_id, "m": module})).mappings().all()]


async def resolve(db: AsyncSession, tenant_id: str, run: ObjectRun, sel: Selection) -> dict[str, int]:
    """Failing records resolved per rule: the run's stored failing keys (finding_records) that the chosen records
    and batch items name, each record counted once per rule."""
    if not sel.records and not sel.batch_keys:
        return {}
    pairs = [(c, k) for c, keys in sel.batch_keys.items() for k in keys]
    rows = (await db.execute(text("""
        SELECT check_id, count(DISTINCT record_key) FROM finding_records
         WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m
           AND (record_key = ANY(:keys)
                OR (check_id, record_key) IN (SELECT * FROM unnest(CAST(:pc AS text[]), CAST(:pk AS text[]))))
         GROUP BY check_id"""), {"t": tenant_id, "v": run.run_id, "m": run.module, "keys": sorted(sel.records),
                                 "pc": [p[0] for p in pairs], "pk": [p[1] for p in pairs]})).fetchall()
    return {r[0]: int(r[1]) for r in rows}


async def batch_selection(db: AsyncSession, tenant_id: str, module: str, batch_ids: list[str]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    if not batch_ids:
        return out
    for c, k in (await db.execute(text(
            "SELECT check_id, record_key FROM remediation_items WHERE tenant_id = :t AND module = :m "
            "AND batch_id = ANY(CAST(:b AS uuid[]))"), {"t": tenant_id, "m": module, "b": batch_ids})).fetchall():
        out.setdefault(c, set()).add(k)
    return out


async def simulate(db: AsyncSession, tenant_id: str, run: ObjectRun, sel: Selection) -> dict:
    """{before, after, delta, method} for one object."""
    from agents.config_impact import _load_impact_rules

    thresholds = scoring_config(run.raw_cfg)["thresholds"]
    waves = await load_waves(db, tenant_id, run.module)
    rules = _load_impact_rules()
    base = rebuild(run.findings, run.module)
    resolved = await resolve(db, tenant_id, run, sel)
    fixed = apply_fixes(base, resolved, sel.rules)
    before = receipt_of(base, run, thresholds, rules, waves)
    after = receipt_of(fixed, run, thresholds, rules, waves)
    stored = run.summary.get("composite_score")
    reproduced = (stored is None and before["score"] is None) or (
        stored is not None and before["score"] is not None and abs(float(stored) - before["score"]) <= REPRODUCE_TOLERANCE)
    failing = {r.check_id: r.affected_count for r in base if not r.passed and not r.error}
    return {
        "module": run.module, "run_id": run.run_id, "run_at": run.run_at, "system_id": run.system_id,
        "before": before, "after": after, "delta": delta_of(before, after),
        "method": {
            "basis": "stored findings of the run, rescored with api/services/scoring.py score_module",
            "reproduced": reproduced, "stored_score": stored,
            "rules_fixed": sorted(c for c in sel.rules if c in failing),
            "rules_unknown": sorted(c for c in sel.rules if c not in {r.check_id for r in base}),
            "records_resolved": {c: (failing[c] if c in sel.rules else min(n, failing.get(c, 0)))
                                 for c, n in sorted({**resolved, **{c: 0 for c in sel.rules}}.items())
                                 if c in failing},
            "config_impact": "db/seeds/config_impact_rules.yaml over the failing rules, before and after",
            "cached": False,
        },
    }


def sentence_after(cells: list[dict], sim: dict) -> dict:
    """The landscape sentence with the simulated object's cell replaced by its after-state."""
    from api.routes.landscape import sentence_of

    out = []
    for c in cells:
        if c["module"] == sim["module"] and c["run_id"] == sim["run_id"]:
            a = sim["after"]
            c = {**c, "capped": a["cap_level"] is not None, "breaches": a["breaches"],
                 "critical_over_tolerance": len(a["breaches"])}
        out.append(c)
    return sentence_of(out)


def parse_uuid(v: str) -> str | None:
    try:
        return str(uuid.UUID(str(v)))
    except ValueError:
        return None

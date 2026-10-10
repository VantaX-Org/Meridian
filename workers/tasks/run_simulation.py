"""Fix simulation task: patch a COPY of a version's extracted frames and re-run checks.

Never writes to SAP and never changes the stored extraction or findings: the result
is a Redis document (``simulation:{tenant}:{id}``) that expires after
``SIMULATION_TTL_SECONDS``. Progress is reported through the jobs registry (kind
``simulation``) and so streams over /api/v1/jobs/events like every other job.
"""

from __future__ import annotations

import json
import logging
import os

import yaml
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import jobs
from api.services.fix_simulation import (apply_fixes, diff_results, dqs_delta, impact_delta,
                                         rank_fixes, rule_record_fixes)
from api.services.task_progress import _redis_client
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker")

SIMULATION_TTL_SECONDS = int(os.getenv("MERIDIAN_SIMULATION_TTL", str(24 * 3600)))
_LIMIT = int(os.getenv("MERIDIAN_SIMULATION_TIME_LIMIT", "3600"))


def result_key(tenant_id: str, simulation_id: str) -> str:
    return f"simulation:{tenant_id}:{simulation_id}"


def _store(tenant_id: str, simulation_id: str, doc: dict) -> None:
    client = _redis_client()
    if client is not None:
        client.setex(result_key(tenant_id, simulation_id), SIMULATION_TTL_SECONDS, json.dumps(doc, default=str))


def _load(session: Session, engine, tenant_id: str, version_id: str, modules: list[str] | None):
    """Frames + rule context exactly as ``run_checks`` builds them for this version."""
    # ponytail: mirrors workers/tasks/run_checks._run_checks setup; extract a shared loader
    # if a third caller appears (Z-table and DDIC-conformance passes are not re-run here)
    from api.services.source_design import dictionary_for
    from checks import config_rules, country_rules, value_placement
    from checks.field_status_rules import (extra_fields, generate, generate_material, load_config,
                                           material_fields, suppressed_fields)
    from checks.overrides import load_overrides
    from checks.runner import _find_module_yaml
    from sap.field_status_config import conversion_maps, resolve_all, resolve_material
    from workers.dataset import load_dataset
    from workers.tasks.run_checks import _live_reference_values

    row = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                          {"v": version_id, "t": tenant_id}).fetchone()
    metadata = (row[0] if row else None) or {}
    if not metadata.get("dataset_path"):
        raise ValueError("This version has no stored dataset to simulate on.")
    weights = (session.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                               {"t": tenant_id}).scalar() or {})
    all_modules = metadata.get("modules", [])
    modules = [m for m in (modules or all_modules) if m in all_modules]
    system_id = metadata.get("system_id")
    dictionary = dictionary_for(session, system_id)
    fs_config = load_config(session, system_id)
    fs_res = resolve_all(fs_config)
    fs_mat = resolve_material(fs_config, dictionary)
    extra = {**extra_fields(fs_res)}
    for t, fs in material_fields(fs_mat).items():
        extra[t] = extra.get(t, set()) | fs
    frames, _, rows, _ = load_dataset(metadata["dataset_path"], dictionary, modules,
                                      extra={f"{t}.{f}" for t, fs in extra.items() for f in fs},
                                      conversions=conversion_maps(fs_config))
    frames.incomplete = {c["table"] for c in metadata.get("coverage") or []
                         if c.get("complete") is False or c.get("truncated")}
    frames.partial = {c["table"] for c in metadata.get("coverage") or [] if c.get("partial")}
    generated = generate(fs_res, modules) + generate_material(fs_mat, modules)
    rules: dict[str, dict] = {}
    for m in modules:
        try:
            static = yaml.safe_load(_find_module_yaml(m).read_text()).get("rules", [])
        except FileNotFoundError:
            continue
        rules.update({r["id"]: {**r, "module": m} for r in static if r.get("id")})
        generated += value_placement.generate(m, static, dictionary)
        generated += country_rules.generate(m, static, fs_config, dictionary)
        generated += config_rules.generate(m, fs_config, dictionary)
    rules.update({r["id"]: r for r in generated if r.get("id")})
    return {
        "frames": frames, "rows": rows, "modules": modules, "weights": weights, "rules": rules,
        "run_kwargs": {"reference_values": _live_reference_values(engine, tenant_id, metadata),
                       "overrides": load_overrides(session), "extra_rules": generated,
                       "suppressed": suppressed_fields(fs_res, fs_mat)},
    }


def _batch_items(session: Session, tenant_id: str, batch_ids: list[str]) -> list[dict]:
    """Remediation batch items with a proposed value (tables from the remediation-batch
    migration; absent tables mean no batches on this deployment)."""
    if not batch_ids or not session.execute(text("SELECT to_regclass('remediation_items')")).scalar():
        return []
    rows = session.execute(text("""
        SELECT CAST(batch_id AS text) AS batch_id, check_id, field, record_key, proposed_value
          FROM remediation_items
         WHERE tenant_id = :t AND CAST(batch_id AS text) = ANY(:ids)
           AND field IS NOT NULL AND proposed_value IS NOT NULL
    """), {"t": tenant_id, "ids": batch_ids}).mappings().all()
    return [dict(r) for r in rows]


def _run(frames, modules: list[str], tenant_id: str, run_kwargs: dict) -> list:
    from checks.runner import run_checks
    out = []
    for m in modules:
        out += run_checks(m, frames, tenant_id, **run_kwargs)
        frames.clear_cache()
    return out


def simulate(tenant_id: str, simulation_id: str, version_id: str, request: dict) -> dict:
    """The simulation itself; ``request`` is the API body (value_maps, rule_fixes, batch_ids,
    modules, rank, all_rule_fixes)."""
    from agents.config_impact import _load_impact_rules
    from checks.frames import tables_of
    from checks.runner import get_required_columns, rule_columns

    engine = get_sync_engine()
    step = lambda stage, msg: jobs.update_job(tenant_id, simulation_id, stage=stage, message=msg)  # noqa: E731
    step("load", "Loading extraction")
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        ctx = _load(session, engine, tenant_id, version_id, request.get("modules"))
        batch = _batch_items(session, tenant_id, request.get("batch_ids") or [])
    frames, rules = ctx["frames"], ctx["rules"]
    value_maps: dict[str, dict[str, str]] = request.get("value_maps") or {}
    rule_fixes = {f["check_id"]: f for f in request.get("rule_fixes") or []}

    # affected modules: those reading a table the fixes can touch, plus targeted rules' modules
    fields = set(value_maps) | {i["field"] for i in batch} | {rules[c]["field"] for c in rule_fixes
                                                               if c in rules and rules[c].get("field")}
    tables = set(tables_of(list(fields)))
    affected = [m for m in ctx["modules"]
                if (tables & set(tables_of(list(get_required_columns(m)))))
                or any(rules.get(c, {}).get("module") == m for c in rule_fixes)
                or request.get("all_rule_fixes")]
    if not affected:
        raise ValueError("None of the proposed fixes touch a table of the analysed modules.")

    step("before", f"Running {len(affected)} module(s) on the extraction as is")
    before = _run(frames, affected, tenant_id, ctx["run_kwargs"])
    by_id = {r.check_id: r for r in before}

    # fix plan, grouped by source so each group can be ranked
    groups: dict[str, dict] = {}
    if request.get("all_rule_fixes"):
        for r in before:
            if not r.passed and not r.error and r.check_id in rules:
                rule_fixes.setdefault(r.check_id, {"check_id": r.check_id})
    for cid, f in rule_fixes.items():
        rule, res = rules.get(cid), by_id.get(cid)
        if rule is None or res is None or res.passed:
            continue
        if f.get("fix_value") is not None:  # a requested fix_value replaces the rule's own auto_fix
            rule = {**{k: v for k, v in rule.items() if k != "auto_fix"}, "fix_value": f["fix_value"]}
        fixes = rule_record_fixes(rule, res, frames)
        if fixes:
            groups[f"rule:{cid}"] = {"label": f"{cid} · {rule.get('field', '')}", "record_fixes": fixes}
    for field, mapping in value_maps.items():
        groups[f"map:{field}"] = {"label": f"Value map · {field}", "value_maps": {field: mapping}}
    for i in batch:
        g = groups.setdefault(f"batch:{i['batch_id']}", {"label": f"Batch {i['batch_id'][:8]}", "record_fixes": []})
        g["record_fixes"].append({"field": i["field"], "record_key": i["record_key"], "new_value": i["proposed_value"]})
    if not groups:
        raise ValueError("No applicable fixes: the targeted rules pass or have no proposed values.")

    step("patch", "Applying fixes to a copy of the extraction")
    patched, stats = apply_fixes(
        frames, {k: v for g in groups.values() for k, v in (g.get("value_maps") or {}).items()},
        [x for g in groups.values() for x in g.get("record_fixes") or []])

    step("after", "Re-running checks on the patched copy")
    after = _run(patched, affected, tenant_id, ctx["run_kwargs"])
    del patched

    step("score", "Scoring")
    targeted = {k.split(":", 1)[1] for k in groups if k.startswith("rule:")} | {i["check_id"] for i in batch}
    diff = diff_results(before, after, targeted)
    doc = {
        "simulation_id": simulation_id, "version_id": version_id, "modules": affected,
        "fixes": {"groups": len(groups), **stats},
        "dqs": dqs_delta(before, after, ctx["weights"]),
        "impact": impact_delta(before, after, _load_impact_rules()),
        **diff,
    }
    if request.get("rank"):
        b = {(r.module, r.check_id): set(r.failing_record_keys or []) for r in before if not r.error}
        a = {(r.module, r.check_id): set(r.failing_record_keys or []) for r in after if not r.error}
        gone = {k: v - a.get(k, set()) for k, v in b.items() if v - a.get(k, set())}
        cands = []
        for gid, g in groups.items():
            gf = set(g.get("value_maps") or {}) | {x["field"] for x in g.get("record_fixes") or []}
            # ponytail: a group is credited with every resolved record of a rule reading its fields
            resolves = {k: v for k, v in gone.items()
                        if gf & set(rule_columns(rules.get(k[1], {"field": ""})) or [])}
            _, s = apply_fixes(frames, g.get("value_maps"), g.get("record_fixes"))
            cands.append({"id": gid, "label": g["label"], "records_changed": s["cells_changed"],
                          "resolves": resolves})
        doc["best_next_fixes"] = rank_fixes(before, cands, ctx["weights"])
    return doc


@celery_app.task(bind=True, name="workers.tasks.run_simulation.run_simulation",
                 soft_time_limit=_LIMIT, time_limit=_LIMIT + 60)
def run_simulation(self, tenant_id: str, simulation_id: str, version_id: str, request: dict) -> dict:
    """Idempotent by ``simulation_id``: a stored result is returned, not recomputed."""
    client = _redis_client()
    if client is not None and client.exists(result_key(tenant_id, simulation_id)):
        return {"simulation_id": simulation_id, "status": "completed"}
    try:
        doc = simulate(tenant_id, simulation_id, version_id, request)
    except Exception as exc:  # noqa: BLE001 — the job carries the error to the UI
        logger.exception("simulation %s failed", simulation_id)
        msg = str(exc) if isinstance(exc, ValueError) else "Simulation failed"
        _store(tenant_id, simulation_id, {"simulation_id": simulation_id, "status": "failed", "error": msg})
        jobs.finish_job(tenant_id, simulation_id, "failed", error=msg)
        return {"simulation_id": simulation_id, "status": "failed"}
    doc["status"] = "completed"
    _store(tenant_id, simulation_id, doc)
    jobs.finish_job(tenant_id, simulation_id, result={
        "simulation_id": simulation_id, "dqs_delta": doc["dqs"]["overall"]["delta"],
        "findings_resolved": doc["findings"]["resolved"], "side_effects": len(doc["side_effects"])},
        message="Simulation complete")
    return {"simulation_id": simulation_id, "status": "completed"}

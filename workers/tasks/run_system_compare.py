"""Celery task: compare one system pair (``system_pairs``) for one module.

Deterministic, no LLM. Reads the latest complete extraction of both systems, reconciles every data table of the
module (``api.services.system_compare.compare_table``), compares their config loads, and scores both sides:
source DQS from the source's findings, projected DQS from the latest readiness run of the same pair, actual DQS
from the target's findings, with the rules that moved it. Progress goes to Redis (``compare:<id>``) and the
row's ``progress`` column after each table. The result goes to system_comparisons.
"""

import json
import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session
from workers.tasks.run_reconciliation import _findings

logger = logging.getLogger("meridian.workers.system_compare")

_JSON = ("summary", "tables", "records", "pairs", "config", "scores", "progress")
NO_ANALYSIS = "{side} system has no completed analysis with an extraction. Run an analysis of it first."


def _finish(session, cid, status, error=None, **cols) -> dict:
    sets = "".join(f", {k} = CAST(:{k} AS jsonb)" if k in _JSON else f", {k} = :{k}" for k in cols)
    session.execute(text(f"UPDATE system_comparisons SET status = :st, error_detail = :err, completed_at = now()"
                         f"{sets} WHERE id = :cid"),
                    {"cid": cid, "st": status, "err": error,
                     **{k: json.dumps(v, default=str) if k in _JSON else v for k, v in cols.items()}})
    session.commit()
    return {"comparison_id": cid, "status": status, "error": error}


def _progress(session, cid, payload: dict) -> None:
    from api.services.task_progress import publish_progress

    publish_progress(f"compare:{cid}", payload)
    session.execute(text("UPDATE system_comparisons SET progress = CAST(:p AS jsonb) WHERE id = :cid"),
                    {"cid": cid, "p": json.dumps(payload)})
    session.commit()


def _frames(session, meta, dictionary, tables):
    from workers.dataset import load_dataset

    frames, _, _, _ = load_dataset(meta["dataset_path"], dictionary, tables=tables)
    cov = meta.get("coverage") or []
    return frames, {c["table"] for c in cov if c.get("complete") is False or c.get("truncated")}, \
        {c["table"] for c in cov if c.get("partial")}


def _config(session, source_id, target_id) -> dict:
    from api.services import config_pairing as cp
    from api.services.system_compare import config_summary

    s, t = cp.latest_completed_load(session, source_id), cp.latest_completed_load(session, target_id)
    if not s or not t:
        return {"available": False, "reason": "no_config_load_source" if not s else "no_config_load_target"}
    src, tgt = cp._by_object(cp.load_items(session, s[0])), cp._by_object(cp.load_items(session, t[0]))
    common = sorted(set(src) & set(tgt))
    return {"available": True, "objects": config_summary(
        {o: cp.compare_object(o, src[o], tgt[o]) for o in common}, {o: len(tgt[o]) for o in common}),
        "only_in_source": sorted(set(src) - set(tgt)), "only_in_target": sorted(set(tgt) - set(src))}


def _scores(session, tenant_id, pair, sv, tv) -> dict:
    from api.services.migration.post_load import _rates, score_sides
    from api.services.scoring import score_module
    from checks.runner import module_rules

    m = pair.module
    cfg = session.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"), {"t": str(tenant_id)}).scalar() or {}
    run = session.execute(text(
        "SELECT id, gap_summary FROM migration_runs WHERE tenant_id = :t AND source_system_id = :s "
        "AND dest_system_id = :d AND :m = ANY(modules) AND status IN ('analysed', 'exported') "
        "ORDER BY created_at DESC LIMIT 1"),
        {"t": str(tenant_id), "s": pair.source_system_id, "d": pair.target_system_id, "m": m}).fetchone()
    src = _findings(session, tenant_id, sv, [m])
    tgt = _findings(session, tenant_id, tv, [m]) if tv else None
    rule_text = {m: {str(r.get("id")): r.get("message", "") for r in module_rules(m)}}
    row = score_sides([m], (run.gap_summary if run else None) or {}, tgt, src, cfg, rule_text)["modules"][0]
    if row["source"] is None and src[m]:
        row["source"] = score_module(list(_rates(src[m], m).values()), cfg, module=m).composite_score
    if row["projected"] is None:
        row["projected_reason"] = "no_migration_run" if not run else "no_projection_in_run"
    row["migration_run_id"] = str(run.id) if run else None
    return row


@celery_app.task(bind=True, name="workers.tasks.run_system_compare.run_system_compare",
                 soft_time_limit=1800, time_limit=1860, acks_late=True, reject_on_worker_lost=True)
def run_system_compare(self, tenant_id, comparison_id):
    with tenant_session(get_sync_engine(), tenant_id) as session:
        session.execute(text("UPDATE system_comparisons SET status = 'running' WHERE id = :cid"),
                        {"cid": comparison_id})
        session.commit()
        try:
            from api.services.source_design import dictionary_for
            from api.services.system_compare import compare_table, totals
            from checks.field_status_rules import conversions_for
            from sap.extraction_plan import plan_modules
            from workers.tasks.run_migration import load_value_maps, resolve_source_version

            pair = session.execute(text(
                "SELECT p.* FROM system_comparisons c JOIN system_pairs p ON p.id = c.pair_id WHERE c.id = :cid"),
                {"cid": comparison_id}).fetchone()
            src_id, tgt_id = str(pair.source_system_id), str(pair.target_system_id)
            sv, smeta = resolve_source_version(session, src_id, None)
            tv, tmeta = resolve_source_version(session, tgt_id, None)
            if not sv or not tv:
                side = "The source" if not sv else "The target"
                return _finish(session, comparison_id, "failed", NO_ANALYSIS.format(side=side),
                               source_version_id=sv, target_version_id=tv)
            sdict, tdict = dictionary_for(session, src_id), dictionary_for(session, tgt_id)
            wanted = {t for t, p in plan_modules([pair.module], tdict).items() if p.purpose == "data"}
            _progress(session, comparison_id, {"stage": "loading", "done": 0, "total": len(wanted)})
            sf, s_inc, s_part = _frames(session, smeta, sdict, wanted)
            tf, t_inc, t_part = _frames(session, tmeta, tdict, wanted)
            names = sorted(wanted & (set(sf.frames) | set(tf.frames)))
            maps = load_value_maps(session, pair.module, src_id, tgt_id)
            sconv, tconv = conversions_for(session, src_id), conversions_for(session, tgt_id)
            key_map = pair.key_map or {}
            tables, records, pairs = [], {}, {}
            for i, t in enumerate(names, 1):
                why = ("source_extract_incomplete" if t in s_inc else "target_extract_incomplete" if t in t_inc
                       else "source_extract_partial" if t in s_part else "target_extract_partial" if t in t_part
                       else None)
                r = compare_table(t, sf.frames.get(t), tf.frames.get(t), sdict, tdict, maps, key_map.get(t),
                                  source_conv=sconv, target_conv=tconv, not_comparable=why)
                records[t], pairs[t] = r.pop("records"), r.pop("pairs")
                tables.append(r)
                _progress(session, comparison_id, {"stage": "tables", "done": i, "total": len(names), "table": t})
            _progress(session, comparison_id, {"stage": "config", "done": len(names), "total": len(names)})
            config = _config(session, src_id, tgt_id)
            scores = _scores(session, tenant_id, pair, sv, tv)
            _progress(session, comparison_id, {"stage": "done", "done": len(names), "total": len(names)})
            return _finish(session, comparison_id, "done", None, source_version_id=sv, target_version_id=tv,
                           summary=totals(tables), tables=tables, records=records, pairs=pairs, config=config,
                           scores=scores)
        except SoftTimeLimitExceeded:
            session.rollback()
            return _finish(session, comparison_id, "failed", "time limit reached")
        except Exception as e:
            logger.exception("system comparison failed")
            session.rollback()
            return _finish(session, comparison_id, "failed", str(e)[:500])

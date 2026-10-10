"""Celery task: transfer-readiness gap analysis (source → target).

Deterministic, no LLM. Reads the source system's data from an analysis
version (live extraction bundle or upload) at record grain, and gap-analyses
every mapped field against the target: a connected target system's own live
DDIC and configuration, or — before the target exists — the SAP S/4HANA
standard dictionary (check-table values are then reported as unverified,
never assumed). Persists per-record gaps and a transfer verdict per module.
"""

import json
import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.migration")

_INSERT = text("""
    INSERT INTO migration_gap_findings
        (id, tenant_id, run_id, module, object_type, record_key, dest_table, field, gap_type, severity,
         detail, source_table, source_field, source_value, target_value, provenance, grounded,
         domain_provenance, transfer_ready)
    VALUES (gen_random_uuid(), :tid, :rid, :module, :object_type, :record_key, :dest_table, :field,
            :gap_type, :severity, :detail, :source_table, :source_field, :source_value, :target_value,
            :provenance, :grounded, :provenance, false)
""")


def resolve_source_version(session, source_system_id, source_version_id):
    """Explicit version, else the latest complete analysis of the source system."""
    if source_version_id:
        row = session.execute(text("SELECT id, metadata FROM analysis_versions WHERE id = :v"),
                              {"v": source_version_id}).fetchone()
    else:
        row = session.execute(
            text("SELECT id, metadata FROM analysis_versions WHERE metadata->>'system_id' = :sid "
                 "AND status LIKE '%complete%' AND metadata ? 'dataset_path' ORDER BY run_at DESC LIMIT 1"),
            {"sid": str(source_system_id)},
        ).fetchone()
    return (str(row[0]), row[1] or {}) if row else (None, {})


def load_mappings(session, module: str, target_type: str):
    from api.services.migration.engine import Mapping

    rows = session.execute(
        text("SELECT source_field, dest_table, dest_field, value_map, origin, transform_note "
             "FROM transfer_field_mappings WHERE module = :m AND dest_system_type = :t"),
        {"m": module, "t": target_type},
    ).fetchall()
    return [Mapping(r[0], f"{r[1]}.{r[2]}" if r[1] and r[2] else None, bool(r[3]), r[4] or "steward", r[5])
            for r in rows]


def save_seed(session, tenant_id, module, target_type, mappings) -> None:
    for m in mappings:
        t_table, _, t_field = (m.target or "").partition(".")
        session.execute(
            text("""
                INSERT INTO transfer_field_mappings
                    (id, tenant_id, module, source_field, dest_system_type, dest_table, dest_field,
                     value_map, origin, transform_note, is_confirmed)
                VALUES (gen_random_uuid(), :tid, :m, :sf, :t, :dt, :df, :vm, :origin, :note, false)
                ON CONFLICT DO NOTHING
            """),
            {"tid": tenant_id, "m": module, "sf": m.source, "t": target_type, "dt": t_table or None,
             "df": t_field or None, "vm": m.value_map, "origin": m.origin, "note": m.note},
        )


def load_value_maps(session: Session, module: str, source_system_id: str | None = None,
                    target_system_id: str | None = None) -> dict[str, dict[str, str]]:
    """Confirmed maps of ``module`` plus the 'config' module's (a config map applies to every module).
    Global rows first, then the pair's (which win); within a scope the module's own rows beat config rows."""
    from api.services.config_pairing import SCOPE_SQL

    out: dict[str, dict[str, str]] = {}
    for tf, sv, tv in session.execute(
        text(f"""
            SELECT target_field, source_value, target_value FROM transfer_value_mappings
            WHERE module IN (:m, 'config') AND status = 'confirmed' AND {SCOPE_SQL}
              AND tenant_id = CAST(current_setting('app.tenant_id') AS uuid)
            ORDER BY (source_system_id IS NOT NULL), (module = 'config') DESC
        """),
        {"m": module, "src": str(source_system_id) if source_system_id else None,
         "tgt": str(target_system_id) if target_system_id else None},
    ).fetchall():
        out.setdefault(tf, {})[sv] = tv
    return out


def _add_items(out: dict[str, set[str]], obj: str, values: dict[str, object]) -> None:
    for col, val in (values or {}).items():
        if val not in (None, ""):
            out.setdefault(f"{obj}.{col}", set()).add(str(val).strip())


def load_target_config(session: Session, dest_system_id: str | None) -> tuple[dict[str, set[str]], str]:
    """(allowed values by CHECKTABLE.FIELD, basis): the destination's latest config load, else its live
    config snapshots, else the S/4 standard baseline. The basis is 'baseline' for a best-practice source."""
    from api.services.config_pairing import BASELINE_TYPE, baseline_snapshot, latest_completed_load, load_items

    out: dict[str, set[str]] = {}
    if dest_system_id:
        load = latest_completed_load(session, str(dest_system_id))
        if load:
            for it in load_items(session, load[0]):
                _add_items(out, it.object, it.values)
            return out, "baseline" if load[1] == "best_practice" else "live"
        for table, data in session.execute(
            text("SELECT config_table, config_data FROM config_snapshots WHERE system_id = :sid AND source = 'live' "
                 "AND tenant_id = CAST(current_setting('app.tenant_id') AS uuid)"),
            {"sid": str(dest_system_id)},
        ).fetchall():
            for rec in data or []:
                _add_items(out, table, rec)
        if out:
            return out, "live"
    for it in baseline_snapshot(BASELINE_TYPE).items:
        _add_items(out, it.object, it.values)
    return out, "baseline"


def module_source_tables(module: str, frames) -> list[str]:
    from sap.extraction_plan import plan_modules

    plans = plan_modules([module], frames.dictionary)
    return [t for t, p in plans.items() if p.purpose == "data" and t in frames.frames]


@celery_app.task(bind=True, name="workers.tasks.run_migration.run_migration",
                 soft_time_limit=1800, time_limit=1860, acks_late=True, reject_on_worker_lost=True)
def run_migration(self, tenant_id, run_id, mode, source_system_id, dest_system_id, modules,
                  source_version_id=None, target_release="s4hana"):
    engine = get_sync_engine()
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        session.execute(text("UPDATE migration_runs SET status = 'running', started_at = now() WHERE id = :rid"),
                        {"rid": run_id})
        session.commit()
        try:
            if mode == "source_to_source":
                return _finish(session, run_id, "analysed", None, {})

            from api.services.migration.engine import analyze, seed_mappings
            from api.services.source_design import dictionary_for
            from sap.ddic import get_dictionary
            from workers.dataset import load_dataset

            version_id, meta = resolve_source_version(session, source_system_id, source_version_id)
            if not version_id or not meta.get("dataset_path"):
                return _finish(session, run_id, "failed",
                               "No analysed source dataset — run an extraction or upload for the source first.", {})
            source_dict = dictionary_for(session, source_system_id or meta.get("system_id"))
            from checks.field_status_rules import conversions_for
            frames, _, _, _ = load_dataset(meta["dataset_path"], source_dict, modules,
                                           conversions=conversions_for(session, source_system_id or meta.get("system_id")))

            if dest_system_id:
                target_dict = dictionary_for(session, dest_system_id)
                target_type = session.execute(text("SELECT system_type FROM sap_systems WHERE id = :s"),
                                              {"s": dest_system_id}).scalar() or target_release
            else:
                target_dict = get_dictionary(target_release)
                target_type = target_release
            target_config, config_basis = load_target_config(session, dest_system_id)

            summary, all_gaps, records, blocked = {}, 0, 0, 0
            verdicts, critical = [], 0
            for module in modules:
                tables = module_source_tables(module, frames)
                mappings = load_mappings(session, module, target_type)
                if not mappings:
                    seed = seed_mappings({t: list(frames.frames[t].columns) for t in tables}, source_dict, target_dict)
                    save_seed(session, tenant_id, module, target_type, seed)
                    session.commit()
                    mappings = seed
                gaps, res = analyze(module, frames, tables, mappings, target_dict, 
                                    load_value_maps(session, module, source_system_id, dest_system_id),
                                    target_config, None, bool(dest_system_id), config_basis=config_basis)
                rows = [{
                    "tid": tenant_id, "rid": run_id, "module": g.module, "object_type": g.source_table,
                    "record_key": g.record_key, "dest_table": g.target_table, "field": g.target_field,
                    "gap_type": g.gap_type, "severity": g.severity, "detail": g.detail,
                    "source_table": g.source_table, "source_field": g.source_field,
                    "source_value": g.source_value, "target_value": g.target_value,
                    "provenance": g.provenance, "grounded": g.grounded,
                } for g in gaps]
                for i in range(0, len(rows), 2000):
                    session.execute(_INSERT, rows[i:i + 2000])
                session.commit()
                all_gaps += len(rows)
                records += res.records
                blocked += res.blocked_records
                critical += sum(1 for g in gaps if g.severity == "critical")
                verdicts.append(res.verdict)
                summary[module] = {"records": res.records, "blocked_records": res.blocked_records,
                                   "score": res.score, "verdict": res.verdict, "gaps": res.counts,
                                   "source_tables": tables}

            verdict = "no-go" if "no-go" in verdicts else ("conditional" if "conditional" in verdicts else "go")
            score = round((records - blocked) / records * 100, 2) if records else 0.0
            session.execute(
                text("""
                    UPDATE migration_runs SET readiness_verdict = :v, readiness_score = :s, critical_count = :c,
                           records_total = :rt, records_blocked = :rb, source_version_id = :svid,
                           target_release = :tr, target_connected = :tc
                    WHERE id = :rid
                """),
                {"rid": run_id, "v": verdict, "s": score, "c": critical, "rt": records, "rb": blocked,
                 "svid": version_id, "tr": None if dest_system_id else target_release, "tc": bool(dest_system_id)},
            )
            logger.info(f"migration {run_id}: {verdict} score={score} gaps={all_gaps}")
            return _finish(session, run_id, "analysed", None, summary)
        except SoftTimeLimitExceeded:
            return _finish(session, run_id, "failed", "time limit reached", {})
        except Exception as e:
            logger.exception("migration analysis failed")
            session.rollback()
            return _finish(session, run_id, "failed", str(e)[:500], {})


def _finish(session, run_id, status, error, summary) -> dict:
    session.execute(
        text("UPDATE migration_runs SET status = :st, error_detail = :err, gap_summary = CAST(:gs AS jsonb), "
             "completed_at = now() WHERE id = :rid"),
        {"rid": run_id, "st": status, "err": error, "gs": json.dumps(summary)},
    )
    session.commit()
    return {"run_id": run_id, "status": status, "error": error}

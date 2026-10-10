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
from collections import Counter
from typing import TYPE_CHECKING

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

if TYPE_CHECKING:
    from api.services.migration.engine import Gap

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


def load_value_maps(session, module: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for tf, sv, tv in session.execute(
        text("SELECT target_field, source_value, target_value FROM transfer_value_mappings WHERE module = :m"),
        {"m": module},
    ).fetchall():
        out.setdefault(tf, {})[sv] = tv
    return out


def load_target_config(session, dest_system_id) -> dict[str, set[str]]:
    if not dest_system_id:
        return {}
    out: dict[str, set[str]] = {}
    for table, data in session.execute(
        text("SELECT config_table, config_data FROM config_snapshots WHERE system_id = :sid AND source = 'live'"),
        {"sid": str(dest_system_id)},
    ).fetchall():
        for rec in data or []:
            for col, val in rec.items():
                if val not in (None, ""):
                    out.setdefault(f"{table}.{col}", set()).add(str(val).strip())
    return out


def module_source_tables(module: str, frames) -> list[str]:
    from sap.extraction_plan import plan_modules

    plans = plan_modules([module], frames.dictionary)
    return [t for t, p in plans.items() if p.purpose == "data" and t in frames.frames]


def sim_owners(modules: list[str], frames) -> dict[str, str]:
    """Source table -> the one module of the run that records its S/4 load findings: the first
    module that reads the table natively, else the first that reads it at all (the load-sim
    tables are added to every trigger module's plan, so without this each run module would
    record every KNA1/NAST finding again)."""
    from sap.extraction_plan import plan_modules

    plans = {m: plan_modules([m], frames.dictionary) for m in modules}
    owner: dict[str, str] = {}
    for native in (True, False):
        for m in modules:
            for t, p in plans[m].items():
                if p.purpose == "data" and t in frames.frames and (not native or m in p.modules):
                    owner.setdefault(t, m)
    return owner


@celery_app.task(bind=True, name="workers.tasks.run_migration.run_migration",
                 soft_time_limit=1800, time_limit=1860, acks_late=True, reject_on_worker_lost=True)
def run_migration(self, tenant_id, run_id, mode, source_system_id, dest_system_id, modules,
                  source_version_id=None, target_release="s4hana"):
    dry_run = mode == "s4_dry_run"
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

            extra = None
            if dry_run:
                from sap.extraction_plan import S4_LOAD_CONFIG, S4_LOAD_DATA
                # ponytail: dotted TABLE.FIELD strings, not bare table names — tables_of() in
                # checks/frames.py only recognises the dotted form, and the flat-upload load_dataset
                # path prunes columns by that set, so bare names would silently drop these tables.
                extra = {f"{t}.{f}" for d in (S4_LOAD_DATA, S4_LOAD_CONFIG) for t, fs in d.items() for f in fs}
            frames, _, _, _ = load_dataset(meta["dataset_path"], source_dict, modules, extra=extra,
                                           conversions=conversions_for(session, source_system_id or meta.get("system_id")))

            if dest_system_id and not dry_run:
                target_dict = dictionary_for(session, dest_system_id)
                target_type = session.execute(text("SELECT system_type FROM sap_systems WHERE id = :s"),
                                              {"s": dest_system_id}).scalar() or target_release
            else:
                target_dict = get_dictionary(target_release)
                target_type = target_release
            target_config = load_target_config(session, None if dry_run else dest_system_id)

            owners = sim_owners(modules, frames) if dry_run else {}
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
                gaps, res = analyze(module, frames, tables, mappings, target_dict, load_value_maps(session, module),
                                    target_config, None, bool(dest_system_id) and not dry_run)
                sim: list["Gap"] = []
                if dry_run:
                    from api.services.migration import load_sim
                    grouping = {**load_sim.standard_grouping(), **load_value_maps(session, module).get("BU_GROUP", {})}
                    sim = load_sim.simulate(frames, module, grouping, {t for t, m in owners.items() if m == module})
                    res = load_sim.fold(res, sim)
                    gaps = gaps + sim
                rows = [{
                    "tid": tenant_id, "rid": run_id, "module": g.module, "object_type": g.source_table,
                    "record_key": g.record_key, "dest_table": g.target_table, "field": g.target_field,
                    "gap_type": g.gap_type, "severity": g.severity, "detail": g.detail,
                    "source_table": g.source_table, "source_field": g.source_field,
                    "source_value": g.source_value, "target_value": g.target_value,
                    "provenance": g.provenance, "grounded": g.grounded,
                } for g in gaps]
                # Idempotency: a retried run_id must not duplicate this module's findings.
                session.execute(text("DELETE FROM migration_gap_findings WHERE tenant_id = :tid AND run_id = :rid "
                                     "AND module = :module"), {"tid": tenant_id, "rid": run_id, "module": module})
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
                                   "source_tables": tables,
                                   **({"mode": "s4_dry_run", "s4_load": _count_rules(sim)} if dry_run else {})}

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


def _count_rules(gaps: list["Gap"]) -> dict[str, int]:
    return dict(Counter(g.detail.split(" ", 1)[0] for g in gaps))


def _finish(session, run_id, status, error, summary) -> dict:
    session.execute(
        text("UPDATE migration_runs SET status = :st, error_detail = :err, gap_summary = CAST(:gs AS jsonb), "
             "completed_at = now() WHERE id = :rid"),
        {"rid": run_id, "st": status, "err": error, "gs": json.dumps(summary)},
    )
    session.commit()
    return {"run_id": run_id, "status": status, "error": error}

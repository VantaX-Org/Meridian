"""Celery tasks for Move to new instance: build the plan, pre-flight it, load it, reconcile it.

The logic lives in ``api.services.migration.instance_move``; these tasks only read the source dataset, open
the target connection (one ping, never retried), and persist status, checkpoints and the cleansing log.
The source system is only ever read from its stored dataset: nothing here writes to it.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.migration import instance_move as im
from workers.celery_app import celery_app
from workers.db import get_sync_engine

log = logging.getLogger(__name__)
_OPTS = dict(bind=True, soft_time_limit=1800, time_limit=1860, acks_late=True, reject_on_worker_lost=True)
_SYSTEM_COLS = "id, name, system_type, host, client, sysnr, base_url, company_id, migration_target"


def _rls(session: Session, tid: str) -> None:
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tid)})


def _system(session: Session, sid) -> dict:
    row = session.execute(text(f"SELECT {_SYSTEM_COLS} FROM sap_systems WHERE id = :s"), {"s": str(sid)}).mappings().first()
    return dict(row) if row else {"id": str(sid)}


def _plan_row(session: Session, plan_id: str) -> dict:
    row = session.execute(text("SELECT * FROM move_plans WHERE id = :p"), {"p": plan_id}).mappings().first()
    if row is None:
        raise ValueError(f"move plan {plan_id} not found")
    return dict(row)


def _steward_fixes(session: Session, tid: str) -> list[dict]:
    """Approved steward and manual values (remediation batches); absent tables mean none."""
    if not session.execute(text("SELECT to_regclass('remediation_items')")).scalar():
        return []
    return [dict(r) for r in session.execute(text("""
        SELECT i.check_id, i.field, i.record_key, i.proposed_value
          FROM remediation_batches b JOIN remediation_items i ON i.batch_id = b.id
         WHERE b.tenant_id = :t AND b.status IN ('approved', 'exported')
           AND i.proposal_source IN ('steward', 'manual')
           AND i.field IS NOT NULL AND i.proposed_value IS NOT NULL"""), {"t": tid}).mappings().all()]


FULL_HISTORY_SQL = """SELECT id FROM analysis_versions
    WHERE metadata->>'system_id' = :sid AND metadata->>'history' = 'full' AND metadata ? 'dataset_path'
      AND status <> 'failed' AND COALESCE(metadata->'modules', '[]'::jsonb) @> CAST(:mods AS jsonb)
    ORDER BY run_at DESC LIMIT 1"""


def full_history_version(session: Session, system_id, modules) -> Optional[str]:
    """The latest full-history download (run_extraction history="full") of ``system_id`` covering ``modules``."""
    vid = session.execute(text(FULL_HISTORY_SQL), {"sid": str(system_id), "mods": json.dumps(list(modules))}).scalar()
    return str(vid) if vid else None


def _prepare(session: Session, engine, tid: str, plan: dict) -> dict:
    """The source frames (cleansed in cleansed mode), the rules and the dictionary for one plan.

    A move never loses history: the frames come from a full-history download of the source, never from the
    latest analysis (which holds the current records only). POST /plans queues that download when none exists.
    """
    from workers.tasks.run_simulation import _load, _run

    version_id = full_history_version(session, plan["source_system_id"], plan["modules"])
    if not version_id:
        raise ValueError("The source system has no full-history download of these objects yet. "
                         "Create the plan again to start one.")
    ctx = _load(session, engine, tid, version_id, list(plan["modules"]))
    ctx["version_id"] = version_id
    ctx["dictionary"] = ctx["frames"].dictionary
    ctx["check"] = lambda f: _run(f, ctx["modules"], tid, ctx["run_kwargs"])
    ctx["cleansing"] = None
    excl = plan.get("exclude_countries")
    scope = im.move_scope(ctx["frames"], ctx["dictionary"], plan.get("sample"),
                          im.EXCLUDED_COUNTRIES if excl is None else excl)
    if plan.get("mode", "cleansed") == "cleansed":
        ctx["cleansing"] = im.cleanse(ctx["frames"], ctx["rules"], ctx["check"], _steward_fixes(session, tid),
                                      weights=ctx["weights"])
        ctx["frames"] = ctx["cleansing"]["frames"]
    ctx["frames"], ctx["scope"] = im.apply_scope(ctx["frames"], ctx["dictionary"], scope)
    ctx["frames"], review, ctx["scope"]["defaults"] = im.apply_defaults(ctx["frames"], ctx["dictionary"], scope)
    ctx["scope"]["needs_review"] += review
    return ctx


def _connect(session: Session, tid: str, system_id) -> tuple[Any, Optional[str]]:
    """(connector, None) or (None, reason). A connect failure is never retried."""
    from api.services.connectivity_manager import ConnectivityManager, connect_sap_system

    cm = ConnectivityManager(session, tid)
    row = cm._load_system(str(system_id))
    try:
        return connect_sap_system(row.system_type, cm._build_connection_params(row)), None
    except Exception:  # noqa: BLE001 - the message can carry the credential
        log.warning("instance move: target %s refused the connection", system_id)
        return None, im.UNREACHABLE


def _close(conn) -> None:
    try:
        conn and conn.close()
    except Exception:  # noqa: BLE001
        pass


def _id_map(plan: dict) -> Optional[dict]:
    # ponytail: id_map_upload_id is stored but not resolved yet; identity map (same IDs) is the default
    return None


def _steps(plan: dict, ctx: dict, config: dict) -> list[dict]:
    """Plan steps with their batches of (key, payload)."""
    out = []
    for w in plan["plan"].get("waves", []):
        for s in w["steps"]:
            s = dict(s)
            if s.get("raw"):
                recs = im.raw_records(s, ctx["frames"], _id_map(plan))
                s["batches"] = (im.person_batches(s, recs) if s["method"] == "upsert"
                                else [recs[i:i + 1000] for i in range(0, len(recs), 1000)])
            elif s["method"] == "upsert":
                recs = im.config_filter(s, im.step_records(s, ctx["frames"], ctx["dictionary"], _id_map(plan)), config)
                s["batches"] = im.person_batches(s, recs)
            elif s["method"] == "config_create":
                s["batches"] = [im.config_records(s["entity"], config)] if s["entity"] in config else []
            else:
                df = ctx["frames"].plain(s["table"]) if s.get("table") else None
                keys = [] if df is None else list(df["__key__"])
                s["batches"] = [[(k, {}) for k in keys[i:i + 1000]] for i in range(0, len(keys), 1000)]
            out.append(s)
    return out


class DbStore:
    """Per-record status and per-batch checkpoints in move_record_status and move_checkpoints."""

    def __init__(self, session: Session, tid: str, run_id: str) -> None:
        self.s, self.tid, self.run = session, tid, run_id

    def record(self, entity, pass_no, batch, rows):
        if rows:
            self.s.execute(text("""
                INSERT INTO move_record_status (tenant_id, run_id, entity, pass, record_key, status, http_code,
                                                message, row_hash)
                VALUES (:t, :r, :e, :p, :k, :st, :c, :m, :h)
                ON CONFLICT (run_id, entity, pass, record_key) DO UPDATE
                   SET status = EXCLUDED.status, http_code = EXCLUDED.http_code, message = EXCLUDED.message,
                       row_hash = EXCLUDED.row_hash, updated_at = now()"""),
                [{"t": self.tid, "r": self.run, "e": entity, "p": pass_no, "k": r["key"], "st": r["status"],
                  "c": r.get("http_code"), "m": (r.get("message") or "")[:2000], "h": r.get("row_hash")} for r in rows])

    def checkpoint(self, wave, entity, pass_no, batch):
        self.s.execute(text("""
            INSERT INTO move_checkpoints (tenant_id, run_id, wave, entity, pass, batch)
            VALUES (:t, :r, :w, :e, :p, :b) ON CONFLICT (run_id, entity, pass, batch) DO NOTHING"""),
            {"t": self.tid, "r": self.run, "w": wave, "e": entity, "p": pass_no, "b": batch})
        self.s.commit()
        _rls(self.s, self.tid)

    def done(self, entity, pass_no, batch):
        return self.s.execute(text("SELECT 1 FROM move_checkpoints WHERE run_id = :r AND entity = :e AND pass = :p "
                                   "AND batch = :b"), {"r": self.run, "e": entity, "p": pass_no, "b": batch}).first() is not None

    def stopped(self):
        return self.s.execute(text("SELECT status FROM move_runs WHERE id = :r"), {"r": self.run}).scalar() == "stopping"


@celery_app.task(name="workers.tasks.run_instance_move.plan_move", **_OPTS)
def plan_move(self, tenant_id: str, plan_id: str) -> str:
    with Session(get_sync_engine()) as session:
        _rls(session, tenant_id)
        plan = _plan_row(session, plan_id)
        try:
            ctx = _prepare(session, get_sync_engine(), tenant_id, {**plan, "mode": "as_is"})
            built = im.build_move_plan(plan["modules"], ctx["dictionary"], ctx["frames"], mode=plan["mode"])
            built["scope"] = ctx["scope"]
            # the target's config is read at pre-flight (the first step that connects); until then unverified
            built["target_config"] = {"status": "unverified", "reason": "compared at pre-flight"}
        except Exception as exc:  # noqa: BLE001 - stored for the caller, no trace
            log.exception("instance move plan %s failed", plan_id)
            built = {"status": "failed", "reason": str(exc)[:500], "waves": [], "unplaced": []}
        _rls(session, tenant_id)
        session.execute(text("UPDATE move_plans SET plan = CAST(:p AS jsonb) WHERE id = :id"),
                        {"p": json.dumps(built, default=str), "id": plan_id})
        session.commit()
    return "ok"


@celery_app.task(name="workers.tasks.run_instance_move.preflight_move", **_OPTS)
def preflight_move(self, tenant_id: str, plan_id: str) -> str:
    """Ping the target once; diff config lists; check fields, required values, references and key conflicts."""
    engine = get_sync_engine()
    with Session(engine) as session:
        _rls(session, tenant_id)
        plan = _plan_row(session, plan_id)
        issues: list[dict] = []
        result: dict = {"status": "completed", "issues": issues}
        overwritten: list[dict] = []
        conn = None
        try:
            ctx = _prepare(session, engine, tenant_id, plan)
            _rls(session, tenant_id)
            conn, why = _connect(session, tenant_id, plan["target_system_id"])
            why = why or im.auth_preflight(conn)
            result["scope"] = ctx["scope"]
            if why:
                issues.append({"entity": None, "field": None, "records": [], "severity": "error", "reason": why})
                result["status"] = "failed"
                result["target_config"] = {"status": "unverified", "reason": why}
            else:
                src: dict[str, list] = {}
                for name, data in session.execute(text(
                        "SELECT config_table, config_data FROM config_snapshots WHERE system_id = :s "
                        "AND config_table <> 'ODATA_ENTITY'"), {"s": str(plan["source_system_id"])}).fetchall():
                    src.setdefault(name, []).extend(data if isinstance(data, list) else [data])
                tgt = {n: conn.read_entity_set(n).to_dict("records") for n in src}
                config = im.config_diff(src, tgt, ctx["dictionary"])
                built = im.build_move_plan(plan["modules"], ctx["dictionary"], ctx["frames"], config_lists=config,
                                           mode=plan["mode"])
                meta = im.parse_metadata(conn.metadata())
                for s in _steps({**plan, "plan": built}, ctx, config):
                    if s["method"] not in ("upsert", "config_create"):
                        continue
                    recs = [kr for b in s["batches"] for kr in b]
                    issues += im.metadata_issues(s, recs, meta)
                    issues += im.reference_issues(s, recs, ctx["dictionary"], config)
                    keys = im._key_props(ctx["dictionary"].table(s["table"]), s["entity"]) if s.get("table") and not s.get("raw") else []
                    if keys and s.get("pass", 1) == 1:
                        trows = conn.read_entity_set(s["entity"]).to_dict("records")
                        issues += im.key_conflicts(s, recs, trows, keys)
                        if im.source_wins(s["entity"]):  # D8: list each target value the source replaces
                            overwritten += im.key_overwrites(s, recs, trows, keys)
                result["config"] = built["config"]
                built["scope"] = ctx["scope"]
                built["target_config"] = result["target_config"] = {"status": "verified"}
                session.execute(text("UPDATE move_plans SET plan = CAST(:p AS jsonb) WHERE id = :id"),
                                {"p": json.dumps(built, default=str), "id": plan_id})
            if ctx["cleansing"]:
                result["cleansing"] = ctx["cleansing"]["summary"]
            result["config_lists"] = locals().get("config") or {}
            result["overwritten_in_target"] = im.overwrites(result["config_lists"]) + overwritten
        except Exception as exc:  # noqa: BLE001
            log.exception("instance move preflight %s failed", plan_id)
            result.update(status="failed", issues=issues + [{"entity": None, "field": None, "records": [],
                                                              "severity": "error", "reason": str(exc)[:500]}])
        finally:
            _close(conn)
        _rls(session, tenant_id)
        session.execute(text("UPDATE move_plans SET preflight = CAST(:p AS jsonb) WHERE id = :id"),
                        {"p": json.dumps(result, default=str), "id": plan_id})
        session.commit()
    return result["status"]


def _finish(session: Session, tid: str, run_id: str, status: str, reason, report: dict, cleansing=None) -> None:
    _rls(session, tid)
    session.execute(text("""UPDATE move_runs SET status = :s, reason = :r, report = CAST(:rep AS jsonb),
                            cleansing = COALESCE(CAST(:c AS jsonb), cleansing), finished_at = now() WHERE id = :id"""),
                    {"s": status, "r": reason, "rep": json.dumps(report, default=str),
                     "c": json.dumps(cleansing, default=str) if cleansing else None, "id": run_id})
    session.commit()


@celery_app.task(name="workers.tasks.run_instance_move.run_move", **_OPTS)
def run_move(self, tenant_id: str, run_id: str) -> str:
    """Load (or dry-run, retry or delta) one move run. Resumable: finished batches are checkpointed."""
    engine = get_sync_engine()
    with Session(engine) as session:
        _rls(session, tenant_id)
        if session.execute(text("UPDATE move_runs SET status = 'running', started_at = COALESCE(started_at, now()) "
                                "WHERE id = :r AND status IN ('queued', 'stopped') RETURNING id"),
                           {"r": run_id}).first() is None:
            session.rollback()
            return "skipped"
        session.commit()
        _rls(session, tenant_id)
        run = dict(session.execute(text("SELECT * FROM move_runs WHERE id = :r"), {"r": run_id}).mappings().one())
        plan = _plan_row(session, str(run["plan_id"]))
        why = im.check_safety(_system(session, plan["source_system_id"]), _system(session, plan["target_system_id"]),
                              run["dry_run"])
        if why:
            _finish(session, tenant_id, run_id, "refused", why, {})
            return "refused"
        conn = None
        try:
            ctx = _prepare(session, engine, tenant_id, plan)
            _rls(session, tenant_id)
            config = ((plan.get("preflight") or {}).get("config_lists")) or {}
            steps = _steps(plan, ctx, config)
            only = None
            report_extra = dict(run.get("report") or {})
            if run["kind"] == "retry":
                only = {(e, k) for e, k in session.execute(text(
                    "SELECT entity, record_key FROM move_record_status WHERE run_id = :r AND status = 'failed'"),
                    {"r": report_extra.get("retry_of")}).fetchall()}
            elif run["kind"] == "delta":
                prev: dict[str, str] = dict(session.execute(text("""
                    SELECT DISTINCT ON (s.record_key) s.record_key, s.row_hash FROM move_record_status s
                      JOIN move_runs r ON r.id = s.run_id
                     WHERE r.plan_id = :p AND r.id <> :r AND s.status = 'ok'
                     ORDER BY s.record_key, s.updated_at DESC"""), {"p": str(plan["id"]), "r": run_id}).tuples().all())
                for s in steps:
                    mods = [p for p in {p for b in s["batches"] for _, r in b for p in r} if p.lower().startswith("lastmodified")]
                    recs = im.delta_records([kr for b in s["batches"] for kr in b], run["since"], prev, mods)
                    s["batches"] = im.person_batches(s, recs) if recs else []
            if not run["dry_run"]:
                conn, why = _connect(session, tenant_id, plan["target_system_id"])
                if why:
                    _finish(session, tenant_id, run_id, "failed", why, {"waves": [], **report_extra})
                    return "failed"
            res = im.load(steps, conn, DbStore(session, tenant_id, run_id), dry_run=run["dry_run"],
                          waves=set(run["waves"]) if run["waves"] else None, only=only)
            cleansing = None
            if ctx["cleansing"]:
                c = ctx["cleansing"]
                session.execute(text("DELETE FROM move_cleansing_log WHERE run_id = :r"), {"r": run_id})
                if c["log"]:
                    session.execute(text("""
                        INSERT INTO move_cleansing_log (tenant_id, run_id, record_key, field, old_value, new_value,
                                                        rule_id, source)
                        VALUES (:t, :r, :k, :f, :o, :n, :rule, :src)"""),
                        [{"t": tenant_id, "r": run_id, "k": x["record_key"], "f": x["field"], "o": x["old"],
                          "n": x["new"], "rule": x["rule_id"], "src": x["source"]} for x in c["log"]])
                cleansing = {"summary": c["summary"], "unfixable": c["unfixable"], "passes": c["passes"]}
            status = "stopped" if res["status"] == "stopped" else \
                ("failed" if res["status"] in ("failed", "stopped_error_rate") else "completed")
            _finish(session, tenant_id, run_id, status, res["reason"], {**report_extra, **res, "scope": ctx["scope"],
                                                                  "overwritten_in_target": (plan.get("preflight") or {}).get("overwritten_in_target", [])}, cleansing)
            return status
        except Exception as exc:  # noqa: BLE001
            log.exception("instance move run %s failed", run_id)
            session.rollback()
            _finish(session, tenant_id, run_id, "failed", str(exc)[:500], {})
            return "failed"
        finally:
            _close(conn)


@celery_app.task(name="workers.tasks.run_instance_move.reconcile_move", **_OPTS)
def reconcile_move(self, tenant_id: str, recon_id: str) -> str:
    """Compare what the plan sends with what the target holds, entity by entity, plus the three DQS."""
    engine = get_sync_engine()
    with Session(engine) as session:
        _rls(session, tenant_id)
        plan_id = session.execute(text("SELECT plan_id FROM move_reconciliations WHERE id = :i"), {"i": recon_id}).scalar()
        plan = _plan_row(session, str(plan_id))
        conn = None
        result: dict[str, Any] = {"entities": [], "dqs": None}
        status = "completed"
        try:
            ctx = _prepare(session, engine, tenant_id, plan)
            _rls(session, tenant_id)
            conn, why = _connect(session, tenant_id, plan["target_system_id"])
            why = why or im.auth_preflight(conn)
            if why:
                raise ValueError(why)
            config = ((plan.get("preflight") or {}).get("config_lists")) or {}
            for s in _steps(plan, ctx, config):
                if s["method"] != "upsert" or s.get("pass", 1) != 1:
                    continue
                keys = im._key_props(ctx["dictionary"].table(s["table"]), s["entity"])
                src = [r for b in s["batches"] for _, r in b]
                result["entities"].append(im.reconcile_entity(
                    s["entity"], src, conn.read_entity_set(s["entity"]).to_dict("records"), keys))
            failed = session.execute(text("""SELECT count(DISTINCT s.record_key) FROM move_record_status s
                JOIN move_runs r ON r.id = s.run_id WHERE r.plan_id = :p AND r.dry_run = false AND s.status = 'failed'"""),
                {"p": str(plan_id)}).scalar() or 0
            c = ctx["cleansing"]
            result["dqs"] = im.dqs_block(c["before_results"] if c else None, c["after_results"] if c else None, None,
                                         ctx["weights"], len(c["log"]) if c else 0, failed)
            if not c:
                result["dqs"] = im.dqs_block(ctx["check"](ctx["frames"]), None, None, ctx["weights"], 0, failed)
        except Exception as exc:  # noqa: BLE001
            log.exception("instance move reconcile %s failed", recon_id)
            status, result["reason"] = "failed", str(exc)[:500]
        finally:
            _close(conn)
        _rls(session, tenant_id)
        session.execute(text("UPDATE move_reconciliations SET status = :s, result = CAST(:r AS jsonb) WHERE id = :i"),
                        {"s": status, "r": json.dumps(result, default=str), "i": recon_id})
        session.commit()
    return status

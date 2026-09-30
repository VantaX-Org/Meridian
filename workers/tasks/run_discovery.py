"""Celery task: discover a connected system's design (runs automatically after connect).

ABAP systems (ECC, S/4HANA on-prem, EWM, GRC/MDG hubs):
  1. system info — release, SID, software components (ECC vs S/4HANA)
  2. live DDIC for every table the rules, joins and value checks use, plus all
     customer Z/Y tables
  3. live configuration: every check table behind a value rule (T134, TVAK,
     T077K, T052, T042Z …) and the organisational structure
SuccessFactors:
  $metadata of every entity behind the canonical views (which properties this
  tenant actually exposes) and the picklists behind domain rules.

Everything is stored with provenance and a per-table coverage report; nothing
is silently replaced by baseline values.
"""

from __future__ import annotations

import json
import logging
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.discovery")

ORG_STRUCTURE = {
    "T001": ["BUKRS", "BUTXT", "LAND1", "WAERS", "KTOPL", "PERIV"],
    "T001W": ["WERKS", "NAME1", "BWKEY", "LAND1", "VKORG"],
    "T001K": ["BWKEY", "BUKRS"],
    "T001L": ["WERKS", "LGORT", "LGOBE"],
    "TKA01": ["KOKRS", "BEZEI", "WAERS", "KTOPL"],
    "TVKO": ["VKORG", "BUKRS", "WAERS"],
    "T024E": ["EKORG", "EKOTX", "BUKRS"],
}


def _set_status(session, system_id: str, status: str, **extra) -> None:
    sets = ", ".join([f"{k} = :{k}" for k in extra] + ["discovery_status = :status"])
    session.execute(text(f"UPDATE sap_systems SET {sets} WHERE id = :sid"),
                    {"sid": system_id, "status": status, **extra})
    session.commit()


@celery_app.task(bind=True, name="workers.tasks.run_discovery.discover_system",
                 soft_time_limit=1500, time_limit=1560, acks_late=True, reject_on_worker_lost=True)
def discover_system(self, tenant_id: str, system_id: str) -> dict:
    engine = get_sync_engine()
    snapshot_id = str(uuid.uuid4())
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        from api.services.connectivity_manager import ConnectivityManager, connect_sap_system
        manager = ConnectivityManager(session, tenant_id)
        system = manager._load_system(system_id)
        system_type = system.system_type
        session.execute(
            text("INSERT INTO ddic_snapshots (id, tenant_id, system_id, status, source, task_id) "
                 "VALUES (:id, :tid, :sid, 'running', :src, :task)"),
            {"id": snapshot_id, "tid": tenant_id, "sid": system_id, "task": getattr(self.request, "id", None),
             "src": "live_rfc" if system_type in ("ecc", "s4hana_onprem", "ewm") else "live_odata_metadata"},
        )
        _set_status(session, system_id, "running")
        params = manager._build_connection_params(system)
        try:
            conn = connect_sap_system(system_type, params)
        except Exception as e:
            return _finish(session, snapshot_id, system_id, "failed", error=f"connection: {str(e)[:400]}")
        finally:
            for k in ("password", "client_secret", "api_key"):
                params.pop(k, None)
        try:
            if system_type in ("ecc", "s4hana_onprem", "ewm"):
                result = _discover_abap(session, tenant_id, system_id, snapshot_id, system_type, conn)
            elif system_type == "successfactors":
                result = _discover_successfactors(session, tenant_id, system_id, snapshot_id, conn)
            else:
                result = {"status": "complete", "coverage": [], "note": f"{system_type}: fixed API schema"}
            return _finish(session, snapshot_id, system_id, result.pop("status"), **result)
        except SoftTimeLimitExceeded:
            return _finish(session, snapshot_id, system_id, "partial", error="time limit reached")
        except Exception as e:
            logger.exception("discovery failed")
            return _finish(session, snapshot_id, system_id, "failed", error=str(e)[:400])
        finally:
            try:
                conn.close()
            except Exception:
                pass


def _discover_abap(session, tenant_id, system_id, snapshot_id, system_type, conn) -> dict:
    from api.services.source_design import store_snapshot
    from sap import ddic_reader
    from sap.ddic import dictionary_for_system
    from sap.extraction_plan import MODULES_BY_SYSTEM, plan_modules

    base = dictionary_for_system(system_type)
    plans = plan_modules(MODULES_BY_SYSTEM.get(system_type, []), base)
    wanted = sorted(set(plans) | set(ORG_STRUCTURE))
    snap = ddic_reader.snapshot(conn, wanted)
    counts = store_snapshot(session, tenant_id, system_id, snapshot_id, snap)
    info = snap["system_info"]

    # live configuration — check tables + org structure, read with the live definition
    config_status = []
    live = base.overlay(snap["tables"], snap["domains"])
    config_tables = {t: sorted(p.fields | set(p.keys)) for t, p in plans.items() if p.purpose == "config"}
    config_tables.update(ORG_STRUCTURE)
    for table, fields in sorted(config_tables.items()):
        t = live.table(table)
        cols = [f for f in fields if t is None or f in t.fields]
        if t is None or not cols:
            config_status.append({"table": table, "status": "not_found"})
            continue
        try:
            df = conn.read_table_full(table, cols, list(t.keys), max_rows=50_000)
        except Exception as e:
            config_status.append({"table": table, "status": "failed", "detail": str(e)[:200]})
            continue
        module = "org_structure" if table in ORG_STRUCTURE else "*"
        _store_config(session, tenant_id, system_id, module, table, df.to_dict(orient="records"))
        config_status.append({"table": table, "status": "live", "rows": len(df)})

    failed = [s for s in snap["status"] + config_status if s["status"] == "failed"]
    session.execute(
        text("UPDATE sap_systems SET sap_release = :rel, sap_product = :prod, "
             "config_last_synced_at = now(), config_sync_status = :cs WHERE id = :sid"),
        {"sid": system_id, "rel": info.get("sap_release"), "prod": info.get("product"),
         "cs": "partial" if any(c["status"] == "failed" for c in config_status) else "synced"},
    )
    return {
        "status": "partial" if failed else "complete",
        "system_info": info,
        "coverage": {"ddic": snap["status"], "config": config_status},
        "counts": counts,
    }


def _discover_successfactors(session, tenant_id, system_id, snapshot_id, conn) -> dict:
    """Which canonical source properties this tenant exposes, and its picklists."""
    from api.services.source_design import store_snapshot
    from sap.ddic import get_dictionary
    from sap.ddic_reader import parse_odata_metadata

    d = get_dictionary("s4hana")
    canon = {n: t for n, t in d.tables.items() if t.provenance == "canonical:successfactors"}
    entities = sorted({f.source.split(".")[0] for t in canon.values() for f in t.fields.values()
                       if f.source and "." in f.source and f.source[0].isupper()})
    meta: dict[str, dict] = {}
    coverage = []
    for ent in entities:
        try:
            meta.update(parse_odata_metadata(conn.metadata(ent)))
            coverage.append({"table": ent, "status": "live"})
        except Exception as e:
            coverage.append({"table": ent, "status": "failed", "detail": str(e)[:200]})

    tables = {}
    for name, t in canon.items():
        fields = []
        for f in t.fields.values():
            ent, _, prop = (f.source or "").partition(".")
            et = meta.get(ent)
            info = (et or {}).get("properties", {}).get(prop.split(" ")[0])
            fields.append({
                "name": f.name, "key": f.key, "type": f.type,
                "length": (info or {}).get("max_length") or f.length, "decimals": f.decimals,
                "description": f.description, "check_table": f.check_table,
                "source": f.source, "available": bool(info) if et else None,
            })
        tables[name] = {"table": name, "description": t.description, "category": "VIEW", "fields": fields}

    picklists = sorted({f.picklist for t in canon.values() for f in t.fields.values() if f.picklist})
    rows = []
    for pl in picklists:
        try:
            df = conn.read_entity_set("PickListValueV2", select=["PickListV2_id", "externalCode", "status"],
                                      filter_expr=f"PickListV2_id eq '{pl}'")
            rows += [{pl: r["externalCode"]} for r in df.to_dict(orient="records")
                     if str(r.get("status", "A")).upper() in ("A", "ACTIVE")]
            coverage.append({"table": f"PICKLIST.{pl}", "status": "live", "rows": len(df)})
        except Exception as e:
            coverage.append({"table": f"PICKLIST.{pl}", "status": "failed", "detail": str(e)[:200]})
    if rows:
        _store_config(session, tenant_id, system_id, "*", "PICKLIST", rows)
    counts = store_snapshot(session, tenant_id, system_id, snapshot_id, {"tables": tables, "domains": {}})
    failed = [c for c in coverage if c["status"] == "failed"]
    return {"status": "partial" if failed else "complete", "system_info": {"product": "successfactors"},
            "coverage": {"metadata": coverage}, "counts": counts}


def _store_config(session, tenant_id, system_id, module, table, records) -> None:
    session.execute(
        text("""
            INSERT INTO config_snapshots (id, tenant_id, system_id, module, config_table,
                                          config_data, record_count, source, synced_at)
            VALUES (gen_random_uuid(), :tid, :sid, :mod, :tbl, CAST(:data AS jsonb), :cnt, 'live', now())
            ON CONFLICT (tenant_id, system_id, module, config_table)
            DO UPDATE SET config_data = EXCLUDED.config_data, record_count = EXCLUDED.record_count,
                          source = 'live', synced_at = now()
        """),
        {"tid": tenant_id, "sid": system_id, "mod": module, "tbl": table,
         "data": json.dumps(records, default=str), "cnt": len(records)},
    )
    session.commit()


def _finish(session, snapshot_id, system_id, status, error=None, system_info=None, coverage=None,
            counts=None, note=None) -> dict:
    counts = counts or {}
    session.execute(
        text("""
            UPDATE ddic_snapshots SET status = :st, error_detail = :err, system_info = CAST(:si AS jsonb),
                   coverage = CAST(:cov AS jsonb), table_count = :tc, customer_table_count = :ct,
                   customer_field_count = :cf, completed_at = now()
            WHERE id = :id
        """),
        {"id": snapshot_id, "st": status, "err": error or note, "si": json.dumps(system_info or {}),
         "cov": json.dumps(coverage or {}), "tc": counts.get("tables", 0),
         "ct": counts.get("customer_tables", 0), "cf": counts.get("customer_fields", 0)},
    )
    session.execute(
        text("UPDATE sap_systems SET discovery_status = :st, discovered_at = now(), "
             "last_snapshot_id = CASE WHEN :st IN ('complete','partial') THEN CAST(:snap AS uuid) "
             "ELSE last_snapshot_id END WHERE id = :sid"),
        {"st": status, "snap": snapshot_id, "sid": system_id},
    )
    session.commit()
    logger.info(f"discovery {snapshot_id} for system {system_id}: {status} {error or ''}")
    return {"snapshot_id": snapshot_id, "status": status, "error": error, "counts": counts}

"""Celery task: run Config Intelligence and Z-Object Intelligence on an analysed version.

Both engines are pure functions over ``list[dict]`` records keyed by bare SAP
field names. Until now only ``POST /config/discover`` and ``POST /z-objects/detect``
called them, so every page built on their tables stayed empty. ``run_checks``
enqueues this task once a version's findings are written; it reloads the
version's dataset, flattens it to records and persists both results under
``run_id = version_id`` so a re-analysis replaces its own rows.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.config_intelligence")

# the engines count transactions per config value; beyond this the picture does not change
MAX_RECORDS = int(os.getenv("MERIDIAN_CONFIG_INTEL_MAX_RECORDS", "250000"))

CONFIG_TABLES = ("config_drift_log", "config_alignment_findings", "config_health_scores",
                 "config_inventory")  # steps go with their process rows
Z_RUN_TABLES = ("z_object_findings", "z_object_anomalies", "z_object_profiles")


def frames_to_records(frames: dict[str, pd.DataFrame], limit: int = MAX_RECORDS) -> list[dict]:
    """One record list over every table: ``TABLE.FIELD`` → ``FIELD``, every record
    carrying the union of keys (the engines read ``records[0].keys()``)."""
    parts: list[pd.DataFrame] = []
    budget = limit
    for table in sorted(frames, key=lambda t: -len(frames[t])):
        df = frames[table]
        if budget <= 0 or df.empty:
            continue
        part = df.head(budget).rename(columns=lambda c: c.split(".", 1)[-1])
        part = part.loc[:, ~part.columns.duplicated()]
        parts.append(part)
        budget -= len(part)
    if not parts:
        return []
    combined = pd.concat(parts, ignore_index=True, sort=False)
    combined = combined.astype(object).where(pd.notna(combined), None)
    return combined.to_dict("records")


def _async_url() -> str:
    url = os.getenv("DATABASE_URL") or os.getenv("DATABASE_URL_SYNC", "")
    if not url:
        raise RuntimeError("DATABASE_URL not configured")
    if "+asyncpg" not in url and url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def _persist(tenant_id: str, run_id: str, config_result, z_result) -> dict:
    from api.services.config_intelligence.engine import ConfigIntelligenceEngine
    from api.services.config_intelligence.persistence import ConfigIntelligencePersistence
    from api.services.z_object_intelligence.persistence import ZObjectPersistence

    engine = create_async_engine(_async_url(), pool_pre_ping=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    out = {"drift": 0}
    try:
        async with maker() as db:
            await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tenant_id})
            await db.commit()

            # idempotent: a re-analysis of the version replaces its own rows
            await db.execute(text("DELETE FROM config_process_steps WHERE process_id IN "
                                  "(SELECT id FROM config_processes WHERE tenant_id = :tid AND run_id = :rid)"),
                             {"tid": tenant_id, "rid": run_id})
            await db.execute(text("DELETE FROM config_processes WHERE tenant_id = :tid AND run_id = :rid"),
                             {"tid": tenant_id, "rid": run_id})
            for t in CONFIG_TABLES + Z_RUN_TABLES:
                await db.execute(text(f"DELETE FROM {t} WHERE tenant_id = :tid AND run_id = :rid"),
                                 {"tid": tenant_id, "rid": run_id})
            await db.commit()

            cfg = ConfigIntelligencePersistence()
            await cfg.save_run(db, tenant_id, run_id, config_result)
            previous = await cfg.get_previous_run_id(db, tenant_id, run_id)
            if previous:
                prev_inventory = await cfg.load_inventory(db, tenant_id, previous)
                drift = ConfigIntelligenceEngine().detect_drift(prev_inventory, config_result.config_inventory)
                if drift:
                    await cfg.save_drift(db, tenant_id, run_id, drift)
                    out["drift"] = len(drift)

            if z_result is not None:
                zp = ZObjectPersistence()
                ids: dict[str, str] = {}
                for obj in z_result.detection.detected_objects:
                    profile = next((p for p in z_result.profiles if p.object_name == obj.object_name), None)
                    ids[obj.object_name] = await zp.upsert_registry_entry(db, tenant_id, obj, profile)
                await zp.save_profiles(db, tenant_id, run_id, z_result.profiles, ids)
                await zp.save_baselines(db, tenant_id, z_result.baselines, ids)
                await zp.save_anomalies(db, tenant_id, run_id, z_result.anomalies, ids)
                await zp.save_rule_findings(db, tenant_id, run_id, z_result.rule_findings, ids)
    finally:
        await engine.dispose()
    return out


async def _persist_variants(tenant_id: str, version_id: str, variants) -> int:
    from api.services.config_intelligence.persistence import ConfigIntelligencePersistence

    engine = create_async_engine(_async_url(), pool_pre_ping=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as db:
            return await ConfigIntelligencePersistence().save_variants(db, tenant_id, version_id, variants)
    finally:
        await engine.dispose()


async def _persist_derivation(tenant_id: str, version_id: str, system_type: str, document: dict) -> None:
    from api.services.config_intelligence.persistence import ConfigIntelligencePersistence

    engine = create_async_engine(_async_url(), pool_pre_ping=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as db:
            await ConfigIntelligencePersistence().save_derivation(db, tenant_id, version_id, system_type, document)
    finally:
        await engine.dispose()


async def _z_context(tenant_id: str):
    from api.services.z_object_intelligence.persistence import ZObjectPersistence

    engine = create_async_engine(_async_url(), pool_pre_ping=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as db:
            await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tenant_id})
            await db.commit()
            zp = ZObjectPersistence()
            return await zp.load_baselines(db, tenant_id), await zp.get_registry_status_map(db, tenant_id)
    finally:
        await engine.dispose()


@celery_app.task(bind=True, name="workers.tasks.run_config_intelligence.run_config_intelligence",
                 soft_time_limit=900, time_limit=960, acks_late=True)
def run_config_intelligence(self, version_id: str, tenant_id: str, parquet_path: str) -> dict:
    """Discover live configuration, detect processes, validate alignment and
    profile Z objects from the version's data; stored under ``run_id = version_id``."""
    from api.services.config_intelligence.engine import ConfigIntelligenceEngine
    from api.services.source_design import dictionary_for
    from api.services.z_object_intelligence.engine import ZObjectIntelligenceEngine
    from workers.dataset import load_dataset

    tenant_id = str(tenant_id)
    sync_engine = get_sync_engine()
    with Session(sync_engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        row = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :vid"),
                              {"vid": version_id}).fetchone()
        metadata = (row[0] if row else None) or {}
        dictionary = dictionary_for(session, metadata.get("system_id"))
        try:
            from workers.tasks.run_checks import snapshot_as_of
            as_of = snapshot_as_of(session, metadata)
        except Exception:  # discovery falls back to the wall clock
            as_of = None

    frames, flat, row_count, _ = load_dataset(parquet_path, dictionary, None)
    tables = dict(frames.frames)
    if flat is not None:
        for t in frames.unsplittable:
            tables[t] = flat[[c for c in flat.columns if c.startswith(t + ".")]]
    records = frames_to_records(tables)
    if not records:
        logger.info("Config intelligence %s: no records", version_id)
        return {"version_id": version_id, "status": "empty"}

    now = datetime.now(timezone.utc)  # persistence binds these as timestamps
    config_result = ConfigIntelligenceEngine().analyze(records)
    for el in config_result.config_inventory:
        el.first_seen = el.first_seen or now
        el.last_seen = now

    z_result = None
    try:
        baselines, registry = asyncio.run(_z_context(tenant_id))
        z_result = ZObjectIntelligenceEngine().analyze(records, baselines, registry)
    except Exception as e:  # Z profiling must never cost the config run
        logger.warning("Z-object analysis skipped for %s: %s", version_id, e)

    variants_stored = 0
    try:
        from api.services.config_intelligence.variant_discovery import discover_variants
        variants_stored = asyncio.run(_persist_variants(tenant_id, version_id, discover_variants(tables, as_of)))
    except Exception as e:  # variant discovery must never cost the config run
        logger.warning("Process variant discovery skipped for %s: %s", version_id, e)

    flows_stored = False
    try:
        from api.services.config_intelligence.process_flow_derivation import derive_model, detect_system_type
        system_type = detect_system_type(tables)
        doc = derive_model(tables, system_type)
        if doc.source == "config":
            asyncio.run(_persist_derivation(tenant_id, version_id, system_type, doc.model_dump(mode="json")))
            flows_stored = True
    except Exception as e:  # flow derivation must never cost the config run
        logger.warning("Process flow derivation skipped for %s: %s", version_id, e)

    stored = asyncio.run(_persist(tenant_id, version_id, config_result, z_result))
    summary = {
        "version_id": version_id, "status": "complete", "records": len(records), "rows": row_count,
        "config_elements": len(config_result.config_inventory), "processes": len(config_result.processes),
        "alignment_findings": len(config_result.alignment_findings), "drift": stored["drift"],
        "process_variants": variants_stored, "process_flows": flows_stored,
        "z_objects": z_result.total_z_objects if z_result else 0,
        "z_anomalies": z_result.total_anomalies if z_result else 0,
    }
    logger.info("Config intelligence %s: %s", version_id, summary)
    return summary

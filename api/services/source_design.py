"""Persist and load a connected system's discovered design (live DDIC snapshot).

The discovery task (workers/tasks/run_discovery.py) stores what it reads here;
the check engine, extraction planner and migration analyser load it back as a
Dictionary overlay so every decision uses the source system's own definitions
(customer appends, Z tables, changed lengths) with provenance ``live``.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import text

from sap.ddic import Dictionary, dictionary_for_system, get_dictionary


def store_snapshot(session, tenant_id: str, system_id: str, snapshot_id: str, snap: dict) -> dict:
    """Write tables/domains of a ddic_reader.snapshot() result; return counts."""
    tables = snap.get("tables", {})
    for name, t in tables.items():
        session.execute(
            text("""
                INSERT INTO ddic_tables (tenant_id, snapshot_id, table_name, description, category,
                                         delivery_class, customer_table, field_count, definition)
                VALUES (:tid, :sid, :name, :desc, :cat, :dc, :cust, :n, CAST(:defn AS jsonb))
                ON CONFLICT (snapshot_id, table_name) DO UPDATE SET definition = EXCLUDED.definition,
                    field_count = EXCLUDED.field_count
            """),
            {"tid": tenant_id, "sid": snapshot_id, "name": name, "desc": t.get("description"),
             "cat": t.get("category"), "dc": t.get("delivery_class"), "cust": bool(t.get("customer_table")),
             "n": len(t.get("fields", [])),
             "defn": json.dumps({"fields": t.get("fields", []), "foreign_keys": t.get("foreign_keys", [])})},
        )
    for name, d in (snap.get("domains") or {}).items():
        session.execute(
            text("""
                INSERT INTO ddic_domains (tenant_id, snapshot_id, domain, fixed_values)
                VALUES (:tid, :sid, :dom, CAST(:fv AS jsonb))
                ON CONFLICT (snapshot_id, domain) DO UPDATE SET fixed_values = EXCLUDED.fixed_values
            """),
            {"tid": tenant_id, "sid": snapshot_id, "dom": name, "fv": json.dumps(d.get("fixed_values", []))},
        )
    customer_fields = sum(1 for t in tables.values() for f in t.get("fields", []) if f.get("customer_field"))
    return {"tables": len(tables), "customer_tables": len(snap.get("customer_tables") or []),
            "customer_fields": customer_fields}


def latest_snapshot_id(session, system_id: str) -> Optional[str]:
    row = session.execute(
        text("SELECT id FROM ddic_snapshots WHERE system_id = :sid AND status IN ('complete', 'partial') "
             "ORDER BY started_at DESC LIMIT 1"),
        {"sid": system_id},
    ).fetchone()
    return str(row[0]) if row else None


def load_overlay(session, snapshot_id: str) -> tuple[dict[str, dict], dict[str, dict]]:
    tables = {
        name: {"table": name, "description": desc, "category": cat, "delivery_class": dc,
               **(defn or {})}
        for name, desc, cat, dc, defn in session.execute(
            text("SELECT table_name, description, category, delivery_class, definition "
                 "FROM ddic_tables WHERE snapshot_id = :sid"),
            {"sid": snapshot_id},
        ).fetchall()
    }
    domains = {
        dom: {"domain": dom, "fixed_values": fv or []}
        for dom, fv in session.execute(
            text("SELECT domain, fixed_values FROM ddic_domains WHERE snapshot_id = :sid"),
            {"sid": snapshot_id},
        ).fetchall()
    }
    return tables, domains


def dictionary_for(session, system_id: Optional[str], system_type: Optional[str] = None) -> Dictionary:
    """SAP-standard dictionary for the system's release, overlaid with its live DDIC."""
    base = dictionary_for_system(system_type) if system_type else get_dictionary("s4hana")
    if not system_id:
        return base
    if system_type is None:
        row = session.execute(
            text("SELECT system_type, sap_product FROM sap_systems WHERE id = :sid"), {"sid": system_id}
        ).fetchone()
        if row:
            base = dictionary_for_system(row[1] if row[1] in ("ecc6", "s4hana") else row[0])
    snap = latest_snapshot_id(session, system_id)
    if not snap:
        return base
    tables, domains = load_overlay(session, snap)
    return base.overlay(tables, domains) if tables else base


async def live_config_for_version(db, version_id) -> tuple[str, dict[str, list]]:
    """(system_type, {config_table: rows}) of the system a version was extracted from.

    Uploads have no source system → ("ecc", {}) and callers fall back to the
    SAP-standard baseline, labelled as such.
    """
    row = (await db.execute(
        text("SELECT s.id, s.system_type FROM analysis_versions v "
             "JOIN sap_systems s ON s.id::text = v.metadata->>'system_id' WHERE v.id = :vid"),
        {"vid": str(version_id)},
    )).fetchone()
    if not row:
        return "ecc", {}
    rows = (await db.execute(
        text("SELECT config_table, config_data FROM config_snapshots WHERE system_id = :sid AND source = 'live'"),
        {"sid": row[0]},
    )).fetchall()
    return row[1], {t: d or [] for t, d in rows}

"""Source Design Explorer API — what Meridian learned about a connected system.

Everything here is read from the live discovery snapshot (ddic_* tables) and
the live configuration snapshots; each table/field is compared with the SAP
standard dictionary so customer extensions and deviations are explicit.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission
from sap.ddic import dictionary_for_system

router = APIRouter(prefix="/api/v1/systems", tags=["source-design"])


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))


async def _snapshot(db: AsyncSession, system_id: uuid.UUID, snapshot_id: Optional[uuid.UUID] = None):
    if snapshot_id:
        row = (await db.execute(text("SELECT * FROM ddic_snapshots WHERE id = :id AND system_id = :sid"),
                                {"id": snapshot_id, "sid": system_id})).fetchone()
    else:
        row = (await db.execute(text("SELECT * FROM ddic_snapshots WHERE system_id = :sid "
                                     "ORDER BY started_at DESC LIMIT 1"), {"sid": system_id})).fetchone()
    return row


@router.post("/{system_id}/discover", dependencies=[Depends(require_permission("trigger_sync"))])
async def discover(system_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """(Re)discover the system's design: DDIC, customer objects, configuration."""
    await _rls(db, tenant)
    exists = (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :sid"), {"sid": system_id})).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="System not found")
    from workers.tasks.run_discovery import discover_system
    job = discover_system.delay(str(tenant.id), str(system_id))
    return {"task_id": job.id, "status": "queued"}


@router.get("/{system_id}/design", dependencies=[Depends(require_permission("view"))])
async def design_summary(system_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    snap = await _snapshot(db, system_id)
    sys_row = (await db.execute(text("SELECT system_type, discovery_status, discovered_at, sap_release, sap_product, "
                                     "config_sync_status, config_last_synced_at FROM sap_systems WHERE id = :sid"),
                                {"sid": system_id})).fetchone()
    if not sys_row:
        raise HTTPException(status_code=404, detail="System not found")
    config = (await db.execute(text("SELECT config_table, module, record_count, source, synced_at FROM config_snapshots "
                                    "WHERE system_id = :sid ORDER BY config_table"), {"sid": system_id})).fetchall()
    coverage = (snap.coverage if snap else None) or {}
    flat = [c for part in coverage.values() for c in part] if isinstance(coverage, dict) else []
    return {
        "system_type": sys_row[0],
        "discovery_status": sys_row[1],
        "discovered_at": sys_row[2],
        "sap_release": sys_row[3],
        "sap_product": sys_row[4],
        "config_sync_status": sys_row[5],
        "config_synced_at": sys_row[6],
        "snapshot": None if not snap else {
            "id": str(snap.id), "status": snap.status, "source": snap.source,
            "started_at": snap.started_at, "completed_at": snap.completed_at,
            "system_info": snap.system_info, "error": snap.error_detail,
            "tables": snap.table_count, "customer_tables": snap.customer_table_count,
            "customer_fields": snap.customer_field_count,
            "coverage_summary": {s: sum(1 for c in flat if c.get("status") == s)
                                 for s in sorted({c.get("status") for c in flat})},
        },
        "configuration": [{"table": r[0], "scope": r[1], "rows": r[2], "source": r[3], "synced_at": r[4]}
                          for r in config],
    }


@router.get("/{system_id}/design/coverage", dependencies=[Depends(require_permission("view"))])
async def design_coverage(system_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    snap = await _snapshot(db, system_id)
    return {"snapshot_id": str(snap.id) if snap else None, "coverage": snap.coverage if snap else {}}


@router.get("/{system_id}/design/tables", dependencies=[Depends(require_permission("view"))])
async def design_tables(
    system_id: uuid.UUID,
    search: Optional[str] = None,
    customer_only: bool = False,
    limit: int = Query(200, le=2000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    snap = await _snapshot(db, system_id)
    if not snap:
        return {"total": 0, "items": []}
    where = "snapshot_id = :snap"
    params: dict = {"snap": snap.id, "limit": limit, "offset": offset}
    if search:
        where += " AND (table_name ILIKE :q OR description ILIKE :q)"
        params["q"] = f"%{search}%"
    if customer_only:
        where += " AND (customer_table OR definition::text LIKE '%\"customer_field\": true%')"
    total = (await db.execute(text(f"SELECT count(*) FROM ddic_tables WHERE {where}"), params)).scalar()
    rows = (await db.execute(text(
        f"SELECT table_name, description, category, delivery_class, customer_table, field_count, definition "
        f"FROM ddic_tables WHERE {where} ORDER BY customer_table DESC, table_name LIMIT :limit OFFSET :offset"
    ), params)).fetchall()
    return {"total": total, "items": [{
        "table": r[0], "description": r[1], "category": r[2], "delivery_class": r[3],
        "customer_table": r[4], "field_count": r[5],
        "customer_fields": sum(1 for f in (r[6] or {}).get("fields", []) if f.get("customer_field")),
    } for r in rows]}


@router.get("/{system_id}/design/tables/{table}", dependencies=[Depends(require_permission("view"))])
async def design_table(system_id: uuid.UUID, table: str, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    """Live definition of one table, field by field, compared with the SAP standard."""
    await _rls(db, tenant)
    snap = await _snapshot(db, system_id)
    sys_row = (await db.execute(text("SELECT system_type, sap_product FROM sap_systems WHERE id = :sid"),
                                {"sid": system_id})).fetchone()
    if not snap or not sys_row:
        raise HTTPException(status_code=404, detail="No discovery snapshot for this system")
    row = (await db.execute(text("SELECT description, category, delivery_class, customer_table, definition "
                                 "FROM ddic_tables WHERE snapshot_id = :snap AND table_name = :t"),
                            {"snap": snap.id, "t": table.upper()})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Table not in the discovery snapshot")
    std = dictionary_for_system(sys_row[1] if sys_row[1] in ("ecc6", "s4hana") else sys_row[0]).table(table.upper())
    fields = []
    for f in (row[4] or {}).get("fields", []):
        sf = std.fields.get(f["name"]) if std else None
        deviation = None
        if std and not sf:
            deviation = "customer_field" if f.get("customer_field") else "not_in_standard"
        elif sf and (sf.length != f.get("length") or (sf.type or "") != (f.get("type") or "")):
            deviation = f"differs_from_standard ({sf.type} {sf.length} → {f.get('type')} {f.get('length')})"
        fields.append({**f, "standard": None if not sf else {"type": sf.type, "length": sf.length,
                                                            "decimals": sf.decimals, "domain": sf.domain},
                       "deviation": deviation})
    missing = sorted(set(std.fields) - {f["name"] for f in fields}) if std else []
    return {"table": table.upper(), "description": row[0], "category": row[1], "delivery_class": row[2],
            "customer_table": row[3], "in_sap_standard": std is not None, "fields": fields,
            "standard_fields_missing": missing, "foreign_keys": (row[4] or {}).get("foreign_keys", [])}


@router.get("/{system_id}/design/config/{table}", dependencies=[Depends(require_permission("view"))])
async def design_config(system_id: uuid.UUID, table: str, limit: int = Query(500, le=5000),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Live configuration values read from the system (check tables, org structure)."""
    await _rls(db, tenant)
    rows = (await db.execute(text("SELECT module, config_data, record_count, source, synced_at FROM config_snapshots "
                                  "WHERE system_id = :sid AND config_table = :t"),
                             {"sid": system_id, "t": table.upper()})).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="No configuration snapshot for this table")
    r = rows[0]
    return {"table": table.upper(), "scope": r[0], "rows": (r[1] or [])[:limit], "total": r[2],
            "source": r[3], "synced_at": r[4]}


@router.get("/{system_id}/design/snapshots", dependencies=[Depends(require_permission("view"))])
async def design_snapshots(system_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    rows = (await db.execute(text("SELECT id, status, started_at, completed_at, table_count, customer_table_count, "
                                  "customer_field_count, error_detail FROM ddic_snapshots WHERE system_id = :sid "
                                  "ORDER BY started_at DESC LIMIT 50"), {"sid": system_id})).fetchall()
    return [{"id": str(r[0]), "status": r[1], "started_at": r[2], "completed_at": r[3], "tables": r[4],
             "customer_tables": r[5], "customer_fields": r[6], "error": r[7]} for r in rows]


@router.get("/{system_id}/design/diff", dependencies=[Depends(require_permission("view"))])
async def design_diff(system_id: uuid.UUID, from_snapshot: uuid.UUID, to_snapshot: uuid.UUID,
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Design drift between two discovery snapshots: tables/fields added, removed, changed."""
    await _rls(db, tenant)

    async def load(sid):
        return {r[0]: {f["name"]: f for f in (r[1] or {}).get("fields", [])}
                for r in (await db.execute(text("SELECT table_name, definition FROM ddic_tables WHERE snapshot_id = :s"),
                                           {"s": sid})).fetchall()}
    a, b = await load(from_snapshot), await load(to_snapshot)
    changes = []
    for t in sorted(set(a) | set(b)):
        if t not in a:
            changes.append({"table": t, "change": "table_added"})
            continue
        if t not in b:
            changes.append({"table": t, "change": "table_removed"})
            continue
        for f in sorted(set(a[t]) | set(b[t])):
            fa, fb = a[t].get(f), b[t].get(f)
            if fa is None:
                changes.append({"table": t, "field": f, "change": "field_added"})
            elif fb is None:
                changes.append({"table": t, "field": f, "change": "field_removed"})
            else:
                diff = {k: [fa.get(k), fb.get(k)] for k in ("type", "length", "decimals", "domain", "check_table", "key")
                        if fa.get(k) != fb.get(k)}
                if diff:
                    changes.append({"table": t, "field": f, "change": "field_changed", "diff": diff})
    return {"from": str(from_snapshot), "to": str(to_snapshot), "changes": changes}

"""Consolidate two master records into one (match & merge).

Deterministic survivorship: the survivor keeps every value it has; a field the
survivor lacks is taken from the merged record; steward overrides win last.
The merged record is marked ``superseded``. Both sides get a history entry
(previous/new fields) so the merge is auditable and reversible by hand.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def fuse(survivor: dict, merged: dict, contributions: dict, merged_key: str,
         overrides: Optional[dict] = None) -> tuple[dict, dict, list[str]]:
    fields, contrib, filled = dict(survivor), dict(contributions), []
    now = datetime.now(timezone.utc).isoformat()
    for f, v in merged.items():
        if fields.get(f) in (None, "") and v not in (None, ""):
            fields[f] = v
            contrib[f] = {"value": v, "source_system": f"merge:{merged_key}", "extracted_at": now, "confidence": None}
            filled.append(f)
    for f, v in (overrides or {}).items():
        fields[f] = v
        contrib[f] = {"value": v, "source_system": "steward_override", "extracted_at": now, "confidence": 1.0}
    return fields, contrib, filled


async def merge_master_records(db: AsyncSession, tenant_id: str, domain: str, survivor_key: str, merged_key: str,
                               user_id: Optional[str], overrides: Optional[dict] = None) -> Optional[dict]:
    """Returns None when either key has no live master record in ``domain``."""
    rows = (await db.execute(text("""
        SELECT id, sap_object_key, golden_fields, source_contributions FROM master_records
         WHERE tenant_id = :tid AND domain = :d AND sap_object_key IN (:a, :b) AND status <> 'superseded'
         FOR UPDATE
    """), {"tid": tenant_id, "d": domain, "a": survivor_key, "b": merged_key})).fetchall()
    by_key = {r.sap_object_key: r for r in rows}
    if survivor_key == merged_key or set(by_key) != {survivor_key, merged_key}:
        return None
    s, m = by_key[survivor_key], by_key[merged_key]
    fields, contrib, filled = fuse(s.golden_fields or {}, m.golden_fields or {}, s.source_contributions or {},
                                   merged_key, overrides)
    await db.execute(text("""
        UPDATE master_records SET golden_fields = CAST(:f AS jsonb), source_contributions = CAST(:c AS jsonb),
               updated_at = now() WHERE id = :id
    """), {"id": s.id, "f": json.dumps(fields), "c": json.dumps(contrib)})
    await db.execute(text("UPDATE master_records SET status = 'superseded', updated_at = now() WHERE id = :id"),
                     {"id": m.id})
    hist = text("""
        INSERT INTO master_record_history (id, tenant_id, master_record_id, changed_by, change_type,
                                           previous_fields, new_fields)
        VALUES (gen_random_uuid(), :tid, :mid, CAST(:uid AS uuid), :ct, CAST(:prev AS jsonb), CAST(:new AS jsonb))
    """)
    await db.execute(hist, {"tid": tenant_id, "mid": s.id, "uid": user_id, "ct": "merged",
                            "prev": json.dumps(s.golden_fields or {}), "new": json.dumps(fields)})
    await db.execute(hist, {"tid": tenant_id, "mid": m.id, "uid": user_id, "ct": "superseded",
                            "prev": json.dumps(m.golden_fields or {}),
                            "new": json.dumps({"merged_into": survivor_key})})
    return {"survivor_id": str(s.id), "superseded_id": str(m.id), "filled_fields": filled}

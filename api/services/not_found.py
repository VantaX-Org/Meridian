"""Not-found answers for object and record addresses (PO-5): a 404 with a sentence, never a synthesized page.

An object slug is known when it is a shipped module (MODULE_LABELS or a shipped rule file) or the tenant has
rules or findings for it (custom and Z objects). A record key is known when any run of the tenant has a result
for it, or the delta extraction has seen it (record_hashes). The 404 carries the header
``X-Not-Found: unknown_object`` or ``unknown_record`` so the client can tell an unknown address from an object or
record that is known but has nothing to show.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_RULES = Path(__file__).resolve().parent.parent.parent / "checks" / "rules"


@lru_cache(maxsize=1)
def _shipped_modules() -> frozenset[str]:
    from api.routes.sync_trigger import MODULE_LABELS

    names = set(MODULE_LABELS)
    if _RULES.is_dir():
        for p in _RULES.rglob("*.yaml"):
            names.add(p.name.split(".", 1)[0])
    return frozenset(names)


def unknown_object(module: str) -> HTTPException:
    return HTTPException(status_code=404, headers={"X-Not-Found": "unknown_object"},
                         detail=f"There is no object '{module}'. Check the address, or open the object from the "
                                "landscape.")


def unknown_record(module: str, record_key: str) -> HTTPException:
    from api.routes.sync_trigger import module_label

    return HTTPException(status_code=404, headers={"X-Not-Found": "unknown_record"},
                         detail=f"No record with the key {record_key} is known in {module_label(module)}. Check the "
                                "key, or open the record from the work list.")


async def object_known(db: AsyncSession, tenant_id: Any, module: str) -> bool:
    if module in _shipped_modules():
        return True
    p = {"t": str(tenant_id), "m": module}
    return bool((await db.execute(text(
        "SELECT EXISTS (SELECT 1 FROM rules WHERE tenant_id = CAST(:t AS uuid) AND module = :m) "
        "OR EXISTS (SELECT 1 FROM findings WHERE tenant_id = CAST(:t AS uuid) AND module = :m)"), p)).scalar())


async def require_object(db: AsyncSession, tenant_id: Any, module: str) -> None:
    """404 with a sentence when ``module`` names no object this tenant could have."""
    if not await object_known(db, tenant_id, module):
        raise unknown_object(module)


async def record_known(db: AsyncSession, tenant_id: Any, module: str, record_key: str) -> bool:
    p = {"t": str(tenant_id), "m": module, "k": record_key}
    return bool((await db.execute(text(
        "SELECT EXISTS (SELECT 1 FROM finding_records WHERE tenant_id = CAST(:t AS uuid) AND record_key = :k "
        "AND module = :m) OR EXISTS (SELECT 1 FROM record_hashes WHERE tenant_id = CAST(:t AS uuid) AND module = :m "
        "AND record_key = :k)"), p)).scalar())

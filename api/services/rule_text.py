"""The plain message of rules, for any list that shows a check id: one batched read of the latest work groups."""
from __future__ import annotations

from typing import Iterable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def rule_messages(db: AsyncSession, tenant_id, check_ids: Iterable[str]) -> dict[str, str]:
    """{check_id: message} from the newest run that has the rule; a rule never run is left out (the UI shows its id alone).
    The caller has set the tenant's row-level security."""
    ids = sorted(set(check_ids))
    if not ids:
        return {}
    rows = (await db.execute(text("""
        SELECT DISTINCT ON (g.check_id) g.check_id, g.message
          FROM work_groups g JOIN analysis_versions av ON av.id = g.version_id
         WHERE g.tenant_id = CAST(:t AS uuid) AND g.check_id = ANY(:c) AND g.message IS NOT NULL
         ORDER BY g.check_id, av.run_at DESC"""), {"t": str(tenant_id), "c": ids})).all()
    return {r.check_id: r.message for r in rows}

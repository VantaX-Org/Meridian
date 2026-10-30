"""get_db sets app.tenant_id in every transaction of the request's session, not only the first.

After a commit the session checks out a pooled connection again; with the setting made once, a read after the commit
ran with an empty app.tenant_id and failed every RLS cast (acceptance run, October 2026: POST /admin/sandbox/enter
answered 500 after committing).

PG tests are skipped without MERIDIAN_TEST_DB_URL.
"""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.mark.asyncio
async def test_tenant_context_survives_a_commit() -> None:
    from api.deps import engine, get_db
    from api.middleware.tenant import _tenant_id_var

    await engine.dispose()  # a fresh pool on this test's event loop
    tid = uuid.uuid4()
    token = _tenant_id_var.set(tid)
    try:
        gen = get_db()
        db = await gen.__anext__()
        q = text("SELECT current_setting('app.tenant_id', true)")
        assert (await db.execute(q)).scalar() == str(tid)
        await db.commit()
        assert (await db.execute(q)).scalar() == str(tid)
        await db.rollback()
        assert (await db.execute(q)).scalar() == str(tid)
        await gen.aclose()
    finally:
        _tenant_id_var.reset(token)
        await engine.dispose()

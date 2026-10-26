"""Inbox sweeps against a real Postgres (RLS enforced, non-superuser):

- an escalated task is closed when its source closes (the sweep and accepting a merge pair);
- a resolved contract-breach / write-back task does not stop a later re-breach / re-approval from
  getting a new inbox task.

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


def _tenant(owner) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'SWEEP')"), {"t": tid})
    return tid


def _sql(app_eng, tid, sql, **p):
    from sqlalchemy import text

    with app_eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        r = c.execute(text(sql), {"t": tid, **p})
        return r.fetchall() if r.returns_rows else None


def _session(app_eng, tid):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    s = Session(app_eng)
    s.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
    return s


def test_escalated_tasks_close_with_their_source(app_engine):  # noqa: F811
    from workers.tasks.populate_stewardship_queue import _mark_resolved_items

    owner, app_eng = app_engine
    tid = _tenant(owner)
    exc = _sql(app_eng, tid, "INSERT INTO exceptions (tenant_id, type, category, severity, status, title, description) "
                             "VALUES (:t, 'dq_rule', 'fi_gl', 'high', 'resolved', 'x', 'y') RETURNING id")[0][0]
    task = _sql(app_eng, tid, "INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority, status) "
                              "VALUES (:t, 'exception', :e, 'fi_gl', 1, 'escalated') RETURNING id", e=exc)[0][0]
    s = _session(app_eng, tid)
    try:
        assert _mark_resolved_items(s, tid) >= 1
        s.commit()
    finally:
        s.close()
    assert _sql(app_eng, tid, "SELECT status FROM stewardship_queue WHERE id = :i", i=task)[0][0] == "resolved"


def test_accepting_a_pair_closes_its_escalated_task(app_engine):  # noqa: F811
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.routes.merge_explain import _accept

    owner, app_eng = app_engine
    tid = _tenant(owner)
    score = str(_sql(app_eng, tid, "INSERT INTO match_scores (tenant_id, candidate_a_key, candidate_b_key, domain, "
                                   "total_score, auto_action) VALUES (:t, 'A', 'B', 'business_partner', 0.8, 'review') "
                                   "RETURNING id")[0][0])
    task = _sql(app_eng, tid, "INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority, status) "
                              "VALUES (:t, 'merge_decision', :s, 'business_partner', 1, 'escalated') RETURNING id",
                s=score)[0][0]
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))

    async def main():
        from sqlalchemy import text

        try:
            async with async_sessionmaker(aeng)() as db:
                await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
                await _accept(db, tid, score, "same partner")
                await db.commit()
        finally:
            await aeng.dispose()

    asyncio.run(main())
    assert _sql(app_eng, tid, "SELECT status FROM stewardship_queue WHERE id = :i", i=task)[0][0] == "resolved"


def test_rebreach_and_reapproval_get_a_new_task(app_engine):  # noqa: F811
    from workers.tasks.populate_stewardship_queue import _populate_contract_breaches, _populate_writeback_approvals

    owner, app_eng = app_engine
    tid = _tenant(owner)
    con = _sql(app_eng, tid, "INSERT INTO contracts (tenant_id, name, producer, consumer, status) "
                             "VALUES (:t, 'C', 'p', 'c', 'active') RETURNING id")[0][0]
    cq = _sql(app_eng, tid, "INSERT INTO cleaning_queue (tenant_id, object_type, status, record_key) "
                            "VALUES (:t, 'business_partner', 'approved', 'K1') RETURNING id")[0][0]
    # an earlier breach and an earlier approval, both handled and resolved
    _sql(app_eng, tid, "INSERT INTO contract_compliance_history (tenant_id, contract_id, overall_compliant, recorded_at) "
                       "VALUES (:t, :c, false, now() - interval '2 days')", c=con)
    for kind, src in (("contract_breach", con), ("writeback_approval", cq)):
        _sql(app_eng, tid, "INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority, status, "
                           "resolved_at) VALUES (:t, :k, :s, 'x', 2, 'resolved', now() - interval '1 day')",
             k=kind, s=src)

    def sweep():
        s = _session(app_eng, tid)
        try:
            n = (_populate_contract_breaches(s, tid), _populate_writeback_approvals(s, tid))
            s.commit()
            return n
        finally:
            s.close()

    # the contract breach was resolved after its failure: no new task; the item is approved again: new task
    assert sweep() == (0, 1)
    assert sweep() == (0, 0)  # an open task blocks a duplicate
    # a re-breach after the resolution gets a new task, once
    _sql(app_eng, tid, "INSERT INTO contract_compliance_history (tenant_id, contract_id, overall_compliant) "
                       "VALUES (:t, :c, false)", c=con)
    assert sweep() == (1, 0)
    assert sweep() == (0, 0)
    open_ = _sql(app_eng, tid, "SELECT item_type FROM stewardship_queue WHERE status <> 'resolved' ORDER BY item_type")
    assert [r[0] for r in open_] == ["contract_breach", "writeback_approval"]

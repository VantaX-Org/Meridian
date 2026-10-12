"""Process catalogue / flow-node dq_defects: module mapping and the one-query defect lookup."""
import asyncio
import json
import os
import uuid

import pytest
from sqlalchemy import text

from api.models.process_model import L1, L2, L3, L4, L5
from api.routes import process_discovery as route
from tests.test_process_designer_api import app_engine  # noqa: F401  (module fixture: app role + owner engine)

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


def _tree() -> L1:
    a = L5(id="A", name="a", rule_modules=["vendor"])
    b = L5(id="B", name="b", rule_modules=["material_master", "vendor"])
    c = L5(id="C", name="c")
    return L1(id="PTP", name="P", modules=["fi_gl"], l2=[
        L2(id="L2-A", name="x", l3=[L3(id="L3-A", name="y", l4=[L4(id="L4-A", name="z", activities=[a, b]),
                                                           L4(id="L4-B", name="w", activities=[c])])])])


def test_node_modules_union_and_none():
    root = _tree()
    assert route._node_modules(root) == {"fi_gl", "vendor", "material_master"}
    l4b = root.l2[0].l3[0].l4[1]
    assert route._node_modules(l4b) == set()
    assert route._defects({"vendor": 2, "material_master": 3}, route._node_modules(root.l2[0].l3[0].l4[0])) == 5
    assert route._defects({"vendor": 2}, route._node_modules(l4b)) is None  # no mapping: None, not 0
    assert route._defects(None, {"vendor"}) is None  # no DQ run: None
    assert route._defects({}, {"vendor"}) == 0  # mapped, clean: a real 0


@pg
def test_defects_by_module_is_tenant_scoped(app_engine):  # noqa: F811
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant

    owner, app_eng = app_engine
    t1, t2, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    v1, v_old, v2 = (str(uuid.uuid4()) for _ in range(3))
    with owner.begin() as c:
        for t in (t1, t2):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": t, "n": f"DQD-{t[:8]}"})
        for v, t, age in ((v_old, t1, 2), (v1, t1, 1), (v2, t2, 0)):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata, run_at) VALUES "
                           "(:v, :t, 'complete', CAST(:m AS jsonb), now() - :a * interval '1 hour')"),
                      {"v": v, "t": t, "m": json.dumps({"system_id": sid}), "a": age})
        rows = [(v_old, t1, "vendor", "OLD", 9), (v1, t1, "vendor", "V1", 4), (v1, t1, "vendor", "V2", 1),
                (v1, t1, "vendor", "V3", 0), (v1, t1, "fi_gl", "G1", 7), (v2, t2, "vendor", "X1", 99)]
        for v, t, m, cid, aff in rows:
            c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count) VALUES (gen_random_uuid(), :v, :t, :m, :c, 'low', 'validity', "
                           ":a, 10)"), {"v": v, "t": t, "m": m, "c": cid, "a": aff})

    async def run(tenant: str, system: str):
        eng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(eng, expire_on_commit=False)() as db:
                return await route._defects_by_module(db, Tenant(uuid.UUID(tenant), "T", []), system)
        finally:
            await eng.dispose()

    got = asyncio.run(run(t1, sid))
    assert got.by_module == {"vendor": 2, "fi_gl": 1}  # newest run only; 0-affected excluded
    assert got.version_id == v1  # the version the counts came from
    assert asyncio.run(run(t2, sid)).by_module == {"vendor": 1}
    assert asyncio.run(run(t1, str(uuid.uuid4()))) is None  # no run for that system

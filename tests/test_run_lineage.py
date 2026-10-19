"""Upload lineage: uploads are one lineage per set of objects, system runs one per system.

Unit tests with a fake session; tests/test_run_lineage_pg.py runs the same rules on Postgres.
"""

import uuid

import pytest
from fastapi import HTTPException

from api.routes import versions
from api.services import insights_aggregate as agg
from api.services.run_lineage import lineage_key, lineage_sql


def test_lineage_key_matches_the_frontend_rule():
    assert lineage_key({"system_id": "S1", "modules": ["fi_gl"]}) == "S1"  # system runs: unchanged
    assert lineage_key({"modules": ["controlling"]}) == "upload:controlling"
    # sorted by code point, as [...modules].sort() in frontend/lib/runs.ts
    assert lineage_key({"modules": ["sdb", "sd_x", "a"]}) == "upload:a+sd_x+sdb"
    assert lineage_key({}, {"fi_gl": {}, "accounts_payable": {}}) == "upload:accounts_payable+fi_gl"
    assert lineage_key(None, None, "business_partner_100k") == "upload:business_partner"
    assert lineage_key(None, None, "5 rows") == "upload"


def test_lineage_sql_has_no_stray_binds():
    from sqlalchemy import text
    assert set(text(f"SELECT {lineage_sql('av')}").compile().params) == set()


class _Res:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeDB:
    """_scope_of answers with the lineage key of each id; the default-pair query answers ``pick``."""

    def __init__(self, scopes: dict, pick=None):
        self.scopes, self.pick, self.calls = scopes, pick, []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "id <> :v2" not in sql:
            key = self.scopes.get(params["v"])
            return _Res((key,) if key else None)
        return _Res((self.pick,) if self.pick else None)


@pytest.mark.asyncio
async def test_default_pair_is_scoped_to_the_upload_objects():
    co2, co1 = uuid.uuid4(), uuid.uuid4()
    db = _FakeDB({co2: "upload:controlling"}, pick=co1)
    assert await versions._resolve_pair(db, None, str(co2)) == (co1, co2)
    sql, params = db.calls[-1]
    assert params["scope"] == "upload:controlling"
    assert "COALESCE(metadata->>'system_id', 'upload') =" not in sql  # the old all-uploads lineage
    assert "baseline" in sql  # the pinned baseline still wins, inside the scope


@pytest.mark.asyncio
async def test_single_run_upload_is_no_baseline():
    bp = uuid.uuid4()
    with pytest.raises(HTTPException) as e:
        await versions._resolve_pair(_FakeDB({bp: "upload:business_partner"}), None, str(bp))
    assert e.value.status_code == 404 and e.value.detail["reason"] == "no_baseline"


@pytest.mark.asyncio
async def test_explicit_pair_across_systems_is_refused_but_uploads_are_allowed():
    a, b, u = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db = _FakeDB({a: "S1", b: "S2", u: "upload:controlling"})
    with pytest.raises(HTTPException) as e:
        await versions._resolve_pair(db, str(a), str(b))
    assert e.value.status_code == 400
    assert await versions._resolve_pair(db, str(u), str(b)) == (u, b)


def test_trends_window_uses_the_run_lineage(monkeypatch):
    seen = {}
    ap = {"id": uuid.uuid4(), "label": "accounts_payable_p02", "metadata": {"modules": ["accounts_payable"]},
          "dqs_summary": {"accounts_payable": {}}, "run_at": None}
    monkeypatch.setattr(agg, "resolve_version", lambda s, t, v: ap)

    def fake_all(s, sql, **kw):
        seen.setdefault("calls", []).append((sql, kw))
        return []

    monkeypatch.setattr(agg, "_all", fake_all)
    monkeypatch.setattr(agg, "load_scoring", lambda s, t: {})
    out = agg.trends(None, "t", str(ap["id"]), None)
    sql, kw = seen["calls"][0]
    assert kw["l"] == "upload:accounts_payable" and out["lineage"] == "upload:accounts_payable"
    assert "COALESCE(metadata->>'system_id', 'upload') =" not in sql

"""Cross-system matching: only pairs across connected systems are scored, each side keeps its system,
and the Across systems view clusters them into cross-references."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pandas as pd

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle

_ECC = {"system_id": "sys-ecc", "system_name": "ECC TEST"}
_S4 = {"system_id": "sys-s4", "system_name": "S4 TEST"}


def _frame(rows: list[tuple[str, str]]) -> pd.DataFrame:
    return pd.DataFrame({"BUT000.PARTNER": [k for k, _ in rows], "BUT000.NAME_ORG1": [n for _, n in rows],
                         "ADRC.COUNTRY": ["DE"] * len(rows), "ADRC.POST_CODE1": ["10115"] * len(rows)})


def _scored(monkeypatch, df, systems=None) -> list[dict]:
    import api.services.match_engine as me
    from workers.tasks.run_match import match_frame

    calls = []

    def fake(tid, module, a, b, ida, idb, session, dry_run=False, sources=None):
        calls.append({"tid": tid, "keys": {ida, idb}, "sources": sources})
        return {"auto_action": "queued"}

    monkeypatch.setattr(me, "score_candidate_pair", fake)
    session = MagicMock()
    session.execute.return_value = []
    tid = str(uuid.uuid4())
    out = match_frame(df, "business_partner", tid, session, systems=systems)
    assert out["status"] == "complete"
    assert all(c["tid"] == tid for c in calls)
    assert session.execute.call_args_list[0].args[1] == {"tid": tid}  # SET app.tenant_id first
    return calls


def test_cross_run_scores_only_pairs_across_systems_with_their_sources(monkeypatch):
    from workers.tasks.run_match import stack_systems

    ecc = _frame([("100001", "ALPHA TRADING GMBH"), ("100002", "ALPHA TRADNG GMBH")])
    s4 = _frame([("900001", "ALPHA TRADING GMBH")])
    df, systems = stack_systems([(_ECC, ecc), (_S4, s4)])
    assert list(systems.map(lambda s: s["system_id"])) == ["sys-ecc", "sys-ecc", "sys-s4"]

    calls = _scored(monkeypatch, df, systems)
    assert sorted(sorted(c["keys"]) for c in calls) == [["100001", "900001"], ["100002", "900001"]]
    for c in calls:
        assert {s["system_id"] for s in c["sources"]} == {"sys-ecc", "sys-s4"}
        s4_side = next(s for s in c["sources"] if s["system_id"] == "sys-s4")
        assert s4_side == {"key": "900001", **_S4, "text": "ALPHA TRADING GMBH"}


def test_single_system_run_is_unchanged(monkeypatch):
    df = _frame([("100001", "ALPHA TRADING GMBH"), ("100002", "ALPHA TRADNG GMBH")])
    calls = _scored(monkeypatch, df)
    assert [c["keys"] for c in calls] == [{"100001", "100002"}]
    assert calls[0]["sources"] is None


def test_cross_run_is_registered_and_chained_from_run_match():
    from pathlib import Path

    assert "workers.tasks.run_match.run_cross_system_match" in workers.celery_app.celery_app.tasks
    src = Path(__file__).resolve().parents[1].joinpath("workers/tasks/run_match.py").read_text()
    assert "run_cross_system_match.delay(tenant_id, module)" in src
    assert "WHERE v.tenant_id = CAST(:tid AS uuid)" in src


def test_cross_run_skips_with_fewer_than_two_systems(monkeypatch):
    import workers.tasks.run_match as rm

    monkeypatch.setattr(rm, "get_sync_engine", lambda: None)
    monkeypatch.setattr(rm, "Session", MagicMock())
    monkeypatch.setattr(rm, "latest_runs", lambda s, t, m: [object()])
    out = rm.run_cross_system_match.run(str(uuid.uuid4()), "business_partner")
    assert out["status"] == "skipped"
    assert rm.run_cross_system_match.run(str(uuid.uuid4()), "fi_gl")["status"] == "skipped"


def _src(system: dict, key: str) -> dict:
    return {"key": key, **system, "text": f"NAME {key}"}


def test_clusters_join_pairs_through_shared_records_and_count_per_system_pair():
    from api.routes.merge_explain import cross_system_clusters

    pairs = [
        {"id": "p1", "total": 0.97, "sources": [_src(_ECC, "1"), _src(_S4, "9")], "open": False, "same_cluster": True},
        {"id": "p2", "total": 0.91, "sources": [_src(_ECC, "2"), _src(_S4, "9")], "open": True, "same_cluster": False},
        {"id": "p3", "total": 0.88, "sources": [_src(_ECC, "5"), _src(_S4, "7")], "open": True, "same_cluster": False},
    ]
    heads = {"1": "g1", "9": "g1", "2": "g2", "5": "g5", "7": "g5"}
    clusters, by = cross_system_clusters(pairs, heads)
    assert [len(c["members"]) for c in clusters] == [3, 2]
    big, small = clusters
    assert big["pairs"] == 2 and big["best"] == 0.97 and sorted(big["pair_ids"]) == ["p1", "p2"]
    assert [(m["system_name"], m["key"], m["golden_record_id"]) for m in big["members"]] == [
        ("ECC TEST", "1", "g1"), ("ECC TEST", "2", "g2"), ("S4 TEST", "9", "g1")]
    assert big["merged"] is False and small["merged"] is True
    assert by == [{"a": "ECC TEST", "b": "S4 TEST", "pairs": 3, "open": 2, "merged": 1}]


def test_across_systems_route_is_declared_before_the_pair_route():
    from api.routes.merge_explain import router

    paths = [r.path for r in router.routes]
    assert paths.index("/api/v1/match-scores/across-systems") < paths.index("/api/v1/match-scores/{score_id}")


def test_across_systems_route_is_tenant_scoped_and_reads_golden_heads():
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from api.routes.merge_explain import list_cross_system_clusters

    tid = uuid.uuid4()
    row = SimpleNamespace(id=uuid.uuid4(), total=0.93, steward_decision=None, pc_kind=None, same_cluster=False,
                          explanation={"sources": [_src(_ECC, "1"), _src(_S4, "9")]})
    sent = []

    async def execute(sql, params=None):
        q = str(sql)
        sent.append(params)
        rows = [row] if "match_scores" in q else [("1", "g1"), ("9", "g9")] if "master_records" in q else []
        return MagicMock(all=lambda: rows)

    db = AsyncMock()
    db.execute = execute
    out = asyncio.run(list_cross_system_clusters(domain="business_partner", limit=50, _="u", db=db,
                                                 tenant=SimpleNamespace(id=tid)))
    assert sent[0] == {"t": str(tid)}  # RLS set first
    assert all(p["tid"] == str(tid) for p in sent[1:])
    assert out.pairs == 1 and out.clusters_total == 1
    assert [(m.key, m.system_name, m.golden_record_id) for m in out.clusters[0].members] == [
        ("1", "ECC TEST", "g1"), ("9", "S4 TEST", "g9")]
    assert out.clusters[0].merged is False
    assert out.by_systems[0].open == 1

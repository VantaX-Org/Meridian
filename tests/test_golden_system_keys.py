"""System-qualified golden keys: the same SAP key in two connected systems stays two golden records
and becomes a cross-system candidate pair."""

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


def test_pick_key_plain_for_first_system_qualified_for_second():
    from api.services.golden_keys import pick_key, plain, qualify

    owned = {"1000": {"NAME": {"value": "A", "source_system_id": "sys-ecc"}}}
    assert pick_key("1000", "sys-ecc", owned) == "1000"
    assert pick_key("1000", "sys-s4", owned) == qualify("1000", "sys-s4") == "1000@@sys-s4"
    assert pick_key("1000", "sys-s4", {**owned, "1000@@sys-s4": {}}) == "1000@@sys-s4"
    assert pick_key("1000", "sys-s4", {}) == "1000"  # nothing built yet
    assert pick_key("1000", None, owned) == "1000"  # upload with no system keeps today's behaviour
    assert plain("1000@@sys-s4") == plain("1000") == "1000"


def test_same_plain_key_across_systems_becomes_a_candidate_pair(monkeypatch):
    import api.services.match_engine as me
    from workers.tasks.run_match import match_frame, stack_systems

    ecc = _frame([("1000", "ALPHA TRADING GMBH")])
    s4 = _frame([("1000", "ALPHA TRADING GMBH"), ("2000", "OTHER LTD")])
    df, systems = stack_systems([(_ECC, ecc), (_S4, s4)])
    tid = str(uuid.uuid4())
    calls = []
    monkeypatch.setattr(me, "score_candidate_pair", lambda t, m, a, b, ida, idb, s, dry_run=False, sources=None:
                        calls.append((ida, idb, sources)) or {"auto_action": "queued"})
    seen = []

    def execute(sql, params=None):
        seen.append(params)
        return [("1000@@sys-s4",)] if "master_records" in str(sql) else []

    session = MagicMock()
    session.execute = execute
    assert match_frame(df, "business_partner", tid, session, systems=systems)["status"] == "complete"
    assert len(calls) == 1
    ida, idb, sources = calls[0]
    assert {ida, idb} == {"1000", "1000@@sys-s4"}
    assert [s["key"] for s in sources] == ["1000", "1000"]  # display keys stay the SAP key
    assert {s.get("record_key") for s in sources} == {None, "1000@@sys-s4"}
    assert any(p and p.get("tid") == tid and "keys" in p for p in seen)  # master lookup is tenant scoped


def test_same_key_without_a_qualified_golden_record_is_skipped(monkeypatch):
    import api.services.match_engine as me
    from workers.tasks.run_match import match_frame, stack_systems

    df, systems = stack_systems([(_ECC, _frame([("1000", "ALPHA TRADING GMBH")])),
                                 (_S4, _frame([("1000", "ALPHA TRADING GMBH")]))])
    calls = []
    monkeypatch.setattr(me, "score_candidate_pair", lambda *a, **k: calls.append(a) or {"auto_action": "queued"})
    session = MagicMock()
    session.execute.return_value = []
    match_frame(df, "business_partner", str(uuid.uuid4()), session, systems=systems)
    assert calls == []


def test_clusters_resolve_golden_heads_by_record_key():
    from api.routes.merge_explain import cross_system_clusters

    a = {"key": "1000", **_ECC, "text": "X"}
    b = {"key": "1000", **_S4, "text": "X", "record_key": "1000@@sys-s4"}
    pairs = [{"id": "p", "total": 0.95, "sources": [a, b], "open": True, "same_cluster": False}]
    clusters, _ = cross_system_clusters(pairs, {"1000": "g1", "1000@@sys-s4": "g2"})
    assert sorted(m["golden_record_id"] for m in clusters[0]["members"]) == ["g1", "g2"]
    assert clusters[0]["merged"] is False


def test_build_uses_qualified_key_for_second_system():
    import asyncio

    from workers.tasks.build_golden_records import _master_key

    owner = {"sap_object_key": "1000", "source_contributions": {"N": {"source_system_id": "sys-ecc"}}}

    async def execute(sql, params=None):
        assert params["t"] == "tid"  # tenant scoped
        return MagicMock(all=lambda: [(owner["sap_object_key"], owner["source_contributions"])])

    db = MagicMock()
    db.execute = execute
    assert asyncio.run(_master_key(db, "tid", "business_partner", "1000", "sys-s4")) == "1000@@sys-s4"
    assert asyncio.run(_master_key(db, "tid", "business_partner", "1000", "sys-ecc")) == "1000"

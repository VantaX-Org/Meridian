"""Mining SQL against Postgres (spec §3.1-§3.3, §3.6). Skipped without MERIDIAN_TEST_DB_URL."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Iterator

import pytest
from sqlalchemy.orm import Session

from api.services.process_discovery.mining import CaseTypeResult

Log = tuple[Session, str, str, str]

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROLE = "meridian_pd_mining"
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HAPPY = ["CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE"]
T0 = datetime(2025, 1, 10, 8, 0, tzinfo=timezone.utc)
T1 = datetime(2025, 2, 10, 8, 0, tzinfo=timezone.utc)
DAY = 86400


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def log() -> Iterator[Log]:
    """One tenant, one system, one PTP run: three po_item cases and one vendor case."""
    from sqlalchemy import create_engine, text

    from workers.db import tenant_session

    _alembic("upgrade", "head")
    from urllib.parse import urlparse, urlunparse

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    u = urlparse(url)
    if (u.port or 5432) == 5432:
        pytest.skip("refusing to run migrations against port 5432")
    eng = create_engine(url)
    with eng.begin() as c:  # queries run as a non-superuser that cannot bypass RLS
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
            c.execute(text(f"DROP ROLE {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {_ROLE}"))
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port}", u.path, u.params, u.query,
                                    u.fragment)))
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDM-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": sid, "t": tid})
    events: list[dict[str, object]] = []

    def add(case: str, acts: list[str], start: datetime, org: str, doc: str | None, auto: tuple[int, ...] = (),
            same_second: tuple[int, ...] = ()) -> None:
        for i, a in enumerate(acts):
            ts = start + timedelta(days=0 if i in same_second else i)
            events.append({"ct": "vendor" if a == "CREATE_VENDOR" else "po_item", "case": case, "a": a,
                           "ts": ts, "seq": i, "auto": i in auto, "doc": doc, "org": json.dumps({"BUKRS": org}),
                           "l5": None if a == "ZZ_UNMAPPED" else f"PTP-X-{a}"})

    add("4500000001/00010", HAPPY, T0, "1000", "NB")
    add("4500000002/00010", HAPPY, T0, "2000", "FO")
    add("4500000003/00010", ["CREATE_PO_ITEM", "CHANGE_PO_QTY", "CHANGE_PO_QTY", "INVOICE_RECEIPT"], T1, "1000",
        "NB", auto=(2,), same_second=(1, 2))
    add("0000100001", ["CREATE_VENDOR"], T0, "1000", None)
    s = tenant_session(app, tid)
    assert s.execute(text("SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user")).scalar() is False
    rid = str(s.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                             "VALUES (:t, :s, 'PTP', 'full', 'mining') RETURNING id"), {"t": tid, "s": sid}).scalar())
    s.execute(text(
        "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, l5_id, ts, ts_precision,"
        " seq, automated, doc_type, org, source_table, run_id) VALUES (:t, :s, 'PTP', :ct, :case, :a, :l5, :ts, "
        "'second', :seq, :auto, :doc, CAST(:org AS jsonb), 'EKPO', :r)"),
        [{**e, "t": tid, "s": sid, "r": rid} for e in events])
    s.commit()
    yield s, tid, sid, rid
    s.close()
    app.dispose()
    with eng.begin() as c:  # rows stay, like tests/test_process_event_log_pg.py; every test uses a fresh tenant
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    eng.dispose()


def _mine(log: Log, **flt: object) -> CaseTypeResult:
    from api.services.process_discovery.builders import builder
    from api.services.process_discovery.filters import ProcessFilter
    from api.services.process_discovery.mining import Scope, mine_case_type

    s, tid, sid, _ = log
    return mine_case_type(s, Scope(tid, sid, "PTP"), "po_item", ProcessFilter(**flt), builder("PTP").MAPPING)


@pg
def test_variants_and_throughput(log: Log) -> None:
    r = _mine(log)
    assert (r.cases, r.events) == (3, 12)
    top = r.variants[0]
    assert top.activities == tuple(HAPPY) and top.case_count == 2 and top.share == pytest.approx(0.666667)
    assert top.hash == hashlib.md5(">".join(HAPPY).encode()).hexdigest()
    assert top.median_seconds == 3 * DAY and top.sample_case_ids == ("4500000001/00010", "4500000002/00010")
    assert r.variants[1].activities == ("CREATE_PO_ITEM", "CHANGE_PO_QTY", "CHANGE_PO_QTY", "INVOICE_RECEIPT")
    assert r.median_seconds == 3 * DAY


@pg
def test_dfg_edges_start_end_and_waiting_time(log: Log) -> None:
    e = {(x.source, x.target): x for x in _mine(log).edges}
    assert e[("__START__", "CREATE_PO_ITEM")].count == 3
    assert e[("CREATE_PO_ITEM", "GOODS_RECEIPT")].median_seconds == DAY
    assert e[("CHANGE_PO_QTY", "CHANGE_PO_QTY")].median_seconds == 0
    assert e[("CLEAR_INVOICE", "__END__")].count == 2 and e[("INVOICE_RECEIPT", "__END__")].count == 1
    assert e[("CLEAR_INVOICE", "__END__")].median_seconds is None


@pg
def test_node_stats_rework_automation_conformance(log: Log) -> None:
    r = _mine(log)
    q = r.activities["CHANGE_PO_QTY"]
    assert (q.events, q.cases, q.rework_rate, q.automation_rate) == (2, 1, 1.0, 0.5)
    assert r.activities["CREATE_PO_ITEM"].share == 1.0 and r.activities["CREATE_PO_ITEM"].l5_id == "PTP-X-CREATE_PO_ITEM"
    assert r.conformance.missing == {"GOODS_RECEIPT": pytest.approx(0.3333), "CLEAR_INVOICE": pytest.approx(0.3333)}
    assert r.variants[0].fitness == 1.0 and r.variants[1].fitness == pytest.approx(round(1 - 2 / 8, 4))


@pg
def test_filters_use_the_first_event(log: Log) -> None:
    assert _mine(log, org={"BUKRS": ["2000"]}).cases == 1
    assert _mine(log, doc_type=["NB"]).cases == 2
    assert _mine(log, automated=True).cases == 1
    assert _mine(log, automated=False).cases == 2
    assert _mine(log, period_from=date(2025, 2, 1)).cases == 1
    assert _mine(log, period_to=date(2025, 1, 31)).cases == 2
    assert _mine(log, org={"BUKRS": ["9999"]}).cases == 0


@pg
def test_mine_all_case_types_and_store_variants(log: Log) -> None:
    from sqlalchemy import text

    from api.services.process_discovery.builders import builder
    from api.services.process_discovery.mining import Scope, mine, store_variants

    s, tid, sid, rid = log
    m = mine(s, Scope(tid, sid, "PTP"), builder("PTP").MAPPING, "po_item")
    assert set(m.by_type) == {"po_item", "vendor"}
    stats = m.stats()
    assert stats["cases"] == 4 and stats["case_types"] == {"po_item": 3, "vendor": 1}
    assert stats["automation_rate"] == pytest.approx(round(1 / 13, 4))
    assert stats["rework"] == {"CHANGE_PO_QTY": 1.0}
    assert store_variants(s, rid, tid, m.by_type["po_item"]) == 2
    s.commit()
    row = s.execute(text("SELECT case_count, share, fitness, activities, median_seconds FROM "
                         "process_discovery_variants WHERE run_id = :r ORDER BY case_count DESC LIMIT 1"),
                    {"r": rid}).one()
    assert (row.case_count, float(row.share), float(row.fitness), row.activities, row.median_seconds) == (
        2, 0.666667, 1.0, HAPPY, 3 * DAY)

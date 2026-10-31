"""Row-level security on every workflow and change request table (migrations 119, 120): enabled and forced, and a
non-superuser application role sees, changes and writes only the rows of the tenant it is set to."""
from __future__ import annotations

import json
import os
import uuid
from urllib.parse import urlparse, urlunparse

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from tests import workflow_seed as seed

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

TABLES = ("workflow_definitions", "workflow_instances", "workflow_tasks", "workflow_events", "change_requests",
          "change_request_attachments", "change_request_comments")
ROLE, PW = "meridian_wf_rls_app", "wf_rls_app_pw"


@pytest.fixture(scope="module")
def engines():
    owner = seed.engine()
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}).first():
            c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{PW}' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
    u = urlparse(os.environ["MERIDIAN_TEST_DB_URL"])
    app = create_engine(urlunparse((u.scheme, f"{ROLE}:{PW}@{u.hostname or ''}" + (f":{u.port}" if u.port else ""),
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
    owner.dispose()


def _rows(owner, tid: str) -> None:
    """One row in every table for the tenant."""
    with seed.tenant_conn(owner, tid) as c:
        d = c.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, definition) "
                           "VALUES (:t, 'k', 'k', 'change_request', 1, CAST(:d AS jsonb)) RETURNING id"),
                      {"t": tid, "d": json.dumps({"steps": []})}).scalar()
        cr = c.execute(text("INSERT INTO change_requests (tenant_id, kind, object, payload) VALUES (:t, 'create', "
                            "'material', '{}') RETURNING id::text"), {"t": tid}).scalar()
        i = c.execute(text("INSERT INTO workflow_instances (tenant_id, definition_id, definition_key, "
                           "definition_version, object_kind, object_id) VALUES (:t, :d, 'k', 1, 'change_request', :o) "
                           "RETURNING id"), {"t": tid, "d": d, "o": cr}).scalar()
        k = c.execute(text("INSERT INTO workflow_tasks (tenant_id, instance_id, step_index, step_name, assignee_rule) "
                           "VALUES (:t, :i, 0, 's', '{}') RETURNING id"), {"t": tid, "i": i}).scalar()
        c.execute(text("INSERT INTO workflow_events (tenant_id, object_kind, object_id, instance_id, task_id, action) "
                       "VALUES (:t, 'change_request', :o, :i, :k, 'started')"), {"t": tid, "o": cr, "i": i, "k": k})
        c.execute(text("INSERT INTO change_request_attachments (tenant_id, request_id, filename) VALUES (:t, :r, 'f')"),
                  {"t": tid, "r": cr})
        c.execute(text("INSERT INTO change_request_comments (tenant_id, request_id, body) VALUES (:t, :r, 'b')"),
                  {"t": tid, "r": cr})


@pytest.fixture
def two(engines):
    owner, _ = engines
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, :a), (:b, :b)"), {"a": a, "b": b})
    _rows(owner, a)
    _rows(owner, b)
    yield a, b
    for t in (a, b):
        seed.drop_tenant(owner, t)


def test_every_table_has_forced_row_level_security(engines):
    owner, _ = engines
    with owner.connect() as c:
        rows = dict(c.execute(text("SELECT relname, relrowsecurity AND relforcerowsecurity FROM pg_class "
                                   "WHERE relname = ANY(:n)"), {"n": list(TABLES)}).fetchall())
    assert rows == {t: True for t in TABLES}


def test_the_application_role_sees_and_changes_only_its_tenants_rows(engines, two):
    _, app = engines
    a, b = two
    for table in TABLES:
        with app.begin() as c:
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": a})
            seen = c.execute(text(f"SELECT DISTINCT tenant_id::text FROM {table}")).scalars().all()
            assert seen == [a], table
            assert c.execute(text(f"SELECT count(*) FROM {table} WHERE tenant_id = :b"), {"b": b}).scalar() == 0, table
            hit = c.execute(text(f"DELETE FROM {table} WHERE tenant_id = :b"), {"b": b}).rowcount
            assert hit == 0, table


def test_the_application_role_cannot_write_into_another_tenant(engines, two):
    _, app = engines
    a, b = two
    with pytest.raises(DBAPIError):
        with app.begin() as c:
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": a})
            c.execute(text("INSERT INTO change_requests (tenant_id, kind, object, payload) VALUES (:b, 'create', "
                           "'material', '{}')"), {"b": b})
    with pytest.raises(DBAPIError):
        with app.begin() as c:
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": a})
            c.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, definition) "
                           "VALUES (:b, 'x', 'x', 'fix_batch', 1, '{}')"), {"b": b})

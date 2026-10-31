"""Shared seed for the workflow and change request tests: one tenant with named users, cleaned up afterwards."""
from __future__ import annotations

import os
import uuid
from contextlib import contextmanager

from sqlalchemy import create_engine, text

# Users of the seeded tenant: (key, role)
PEOPLE = (("requester", "data_steward"), ("alice", "data_owner"), ("bob", "data_owner"), ("carol", "data_steward"),
          ("dave", "viewer"), ("boss", "programme_lead"), ("admin", "platform_admin"))

_CLEAN = ("notifications", "audit_log", "webhook_deliveries", "webhooks", "skipped_deliveries", "delegations",
          "escalation_steps", "data_owners", "glossary_terms", "policy_field_classes", "change_request_comments",
          "change_request_attachments", "change_requests", "workflow_events", "workflow_tasks", "workflow_instances",
          "workflow_definitions", "match_rules", "master_records", "remediation_events", "remediation_items",
          "remediation_batches", "system_credentials", "sap_systems", "user_role_scopes", "users")


def engine():
    return create_engine(os.environ["MERIDIAN_TEST_DB_URL"])


@contextmanager
def tenant_conn(eng, tid: str):
    with eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        yield c


def seed_tenant(eng) -> dict:
    tid = str(uuid.uuid4())
    users = {k: str(uuid.uuid4()) for k, _ in PEOPLE}
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
    with tenant_conn(eng, tid) as c:
        for k, role in PEOPLE:
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, :r)"),
                      {"u": users[k], "t": tid, "e": f"{k}@example.com", "n": k.title(), "r": role})
    return {"tid": tid, **users}


def drop_tenant(eng, tid: str) -> None:
    for table in _CLEAN:
        with eng.begin() as c:
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
            if table == "system_credentials":
                c.execute(text("DELETE FROM system_credentials WHERE system_id IN (SELECT id FROM sap_systems "
                               "WHERE tenant_id = :t)"), {"t": tid})
                continue
            if c.execute(text("SELECT to_regclass(:n)"), {"n": table}).scalar() is None:
                continue
            c.execute(text(f"DELETE FROM {table} WHERE tenant_id = :t"), {"t": tid})
    with eng.begin() as c:
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})

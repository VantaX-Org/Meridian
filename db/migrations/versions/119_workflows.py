"""configurable approval workflows: definitions, instances, tasks and their audit trail

Revision ID: 119
Revises: 118
Create Date: 2026-10-30

* workflow_definitions: a tenant's versioned definitions (``key`` groups the versions of one workflow), each for one
  object kind (fix_batch or change_request) with its steps as JSON (api/services/workflow.py). One active definition
  per (tenant, object kind). A new version is a new row; an instance keeps the version it started on.
* workflow_instances: one run of a definition over one object (a fix batch, a change request), with the facts it was
  evaluated against. At most one instance in progress per object.
* workflow_tasks: one row per step of an instance: who may decide (assignee rule, the users it resolved to), quorum,
  status, due time, votes, the decision, who took it, the comment and the escalation level reached.
* workflow_events: every transition (started, step activated, skipped, vote, approved, rejected, escalated, cancelled)
  and every change request transition, with the actor. Append only.
* users.manager_id: the person a user reports to, for the assignee rule "requester's manager" (optional).

Every table is tenant-scoped with ENABLE + FORCE row-level security and the tenant policy. Each existing tenant gets
the default four-eyes workflow for fix batches and for change requests (one step: anyone holding approve except the
requester), so approvals behave as before.
"""
import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "119"
down_revision: str | None = "118"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("workflow_definitions", "workflow_instances", "workflow_tasks", "workflow_events")

# The same documents as api/services/workflow.py DEFAULTS (kept literal: a migration never imports app code).
_FOUR_EYES_STEP = {"name": "Four-eyes approval", "assignee": {"rule": "role", "action": "approve"},
                   "quorum": "any", "requester_may_approve": False, "escalate": True}
_DEFAULTS = (
    ("default-fix-batch", "Four-eyes approval of fix batches", "fix_batch",
     {"steps": [_FOUR_EYES_STEP], "notify_requester": False, "distinct_approvers": True}),
    ("default-change-request", "Four-eyes approval of change requests", "change_request",
     {"steps": [_FOUR_EYES_STEP], "notify_requester": True, "distinct_approvers": True}),
)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def _tenant() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _id() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _now(name: str = "created_at") -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"))


def upgrade() -> None:
    op.add_column("users", sa.Column("manager_id", UUID(as_uuid=True),
                                     sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))

    op.create_table(
        "workflow_definitions", _id(), _tenant(),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("object_kind", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("definition", JSONB(), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_label", sa.Text(), nullable=True),
        _now(),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_by_label", sa.Text(), nullable=True),
        sa.CheckConstraint("object_kind IN ('fix_batch', 'change_request')", name="ck_workflow_definitions_kind"),
        sa.UniqueConstraint("tenant_id", "key", "version", name="uq_workflow_definitions_version"),
    )
    op.create_index("uq_workflow_definitions_active", "workflow_definitions", ["tenant_id", "object_kind"],
                    unique=True, postgresql_where=sa.text("active"))

    op.create_table(
        "workflow_instances", _id(), _tenant(),
        sa.Column("definition_id", UUID(as_uuid=True), sa.ForeignKey("workflow_definitions.id"), nullable=False),
        sa.Column("definition_key", sa.Text(), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("object_kind", sa.Text(), nullable=False),
        sa.Column("object_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_progress"),
        sa.Column("requester_id", UUID(as_uuid=True), nullable=True),
        sa.Column("requester_label", sa.Text(), nullable=True),
        sa.Column("facts", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('in_progress', 'approved', 'rejected', 'cancelled', 'withdrawn')",
                           name="ck_workflow_instances_status"),
    )
    op.create_index("ix_workflow_instances_object", "workflow_instances", ["tenant_id", "object_kind", "object_id"])
    op.create_index("uq_workflow_instances_open", "workflow_instances", ["tenant_id", "object_kind", "object_id"],
                    unique=True, postgresql_where=sa.text("status = 'in_progress'"))

    op.create_table(
        "workflow_tasks", _id(), _tenant(),
        sa.Column("instance_id", UUID(as_uuid=True), sa.ForeignKey("workflow_instances.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("step_index", sa.SmallInteger(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("assignee_rule", JSONB(), nullable=False),
        sa.Column("assigned_users", ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"),
        sa.Column("assignee_note", sa.Text(), nullable=True),
        sa.Column("quorum", sa.Text(), nullable=False, server_default="any"),
        sa.Column("requester_may_approve", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False, server_default="waiting"),
        sa.Column("skip_reason", sa.Text(), nullable=True),
        sa.Column("sla_hours", sa.Float(), nullable=True),
        sa.Column("escalate", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("escalation_level", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("escalated_to", ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"),
        sa.Column("overdue_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("votes", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("decided_by", UUID(as_uuid=True), nullable=True),
        sa.Column("decided_by_label", sa.Text(), nullable=True),
        sa.Column("on_behalf_of", UUID(as_uuid=True), nullable=True),
        sa.Column("decision", sa.Text(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        _now(),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'cancelled')",
                           name="ck_workflow_tasks_status"),
        sa.CheckConstraint("quorum IN ('any', 'all')", name="ck_workflow_tasks_quorum"),
        sa.UniqueConstraint("instance_id", "step_index", name="uq_workflow_tasks_step"),
    )
    op.create_index("ix_workflow_tasks_pending", "workflow_tasks", ["tenant_id", "status", "due_at"])

    op.create_table(
        "workflow_events", _id(), _tenant(),
        sa.Column("object_kind", sa.Text(), nullable=False),
        sa.Column("object_id", sa.Text(), nullable=False),
        sa.Column("instance_id", UUID(as_uuid=True), sa.ForeignKey("workflow_instances.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("workflow_tasks.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("from_status", sa.Text(), nullable=True),
        sa.Column("to_status", sa.Text(), nullable=True),
        sa.Column("actor_id", UUID(as_uuid=True), nullable=True),
        sa.Column("actor_label", sa.Text(), nullable=True),
        sa.Column("detail", JSONB(), nullable=True),
        _now(),
    )
    op.create_index("ix_workflow_events_object", "workflow_events", ["tenant_id", "object_kind", "object_id",
                                                                     "created_at"])
    for table in _TABLES:
        _rls(table)

    conn = op.get_bind()
    for (tid,) in conn.execute(sa.text("SELECT id::text FROM tenants")).fetchall():
        conn.execute(sa.text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        for key, name, kind, doc in _DEFAULTS:
            conn.execute(sa.text(
                "INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, definition, "
                "created_by_label, activated_at, activated_by_label) VALUES (CAST(:t AS uuid), :k, :n, :o, 1, true, "
                "CAST(:d AS jsonb), 'system', now(), 'system') ON CONFLICT DO NOTHING"),
                {"t": tid, "k": key, "n": name, "o": kind, "d": json.dumps(doc)})


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_table(table)
    op.drop_column("users", "manager_id")

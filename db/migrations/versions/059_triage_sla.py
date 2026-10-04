"""Triage: assignment rules, teams, SLA policies + business-hours calendar, SLA timers.

  triage_teams          steward teams (lead, round_robin | least_loaded strategy)
  triage_team_members   team membership
  assignment_rules      ordered rules: match (module, check_id, severity, dimension,
                        company_code, plant, sales_org) -> user or team
  sla_policies          per severity (optionally per module): time-to-acknowledge and
                        time-to-resolve, at-risk threshold, business-hours flag
  triage_settings       one row per tenant: timezone, working days/hours, holidays,
                        fallback owner

record_issues and stewardship_queue both gain the same triage columns (assignment
provenance, acknowledge time, SLA deadlines, state, pause, snooze). record_issues
gains a manual priority and two waiting statuses that pause the SLA clock.

Revision ID: 059
Revises: 058
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "059"
down_revision: Union[str, None] = "058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("triage_teams", "triage_team_members", "assignment_rules", "sla_policies", "triage_settings")
_ITEMS = ("record_issues", "stewardship_queue")


def _tid():
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False)


def _now(name):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"))


def upgrade() -> None:
    op.create_table(
        "triage_teams",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tid(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("lead_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("strategy", sa.Text(), nullable=False, server_default="round_robin"),
        sa.Column("rr_cursor", sa.Integer(), nullable=False, server_default="0"),
        _now("created_at"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_triage_teams_name"),
        sa.CheckConstraint("strategy IN ('round_robin', 'least_loaded')", name="ck_triage_teams_strategy"),
    )
    op.create_table(
        "triage_team_members",
        _tid(),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("triage_teams.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("team_id", "user_id", name="pk_triage_team_members"),
    )
    op.create_table(
        "assignment_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tid(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("match", JSONB(), nullable=False, server_default="{}"),
        sa.Column("assign_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("assign_team_id", UUID(as_uuid=True), sa.ForeignKey("triage_teams.id", ondelete="CASCADE")),
        sa.Column("created_by", UUID(as_uuid=True)),
        _now("created_at"),
        _now("updated_at"),
        # a deleted target user leaves both NULL: the rule then routes to the fallback owner
        sa.CheckConstraint("NOT (assign_user_id IS NOT NULL AND assign_team_id IS NOT NULL)",
                           name="ck_assignment_rules_target"),
    )
    op.create_index("ix_assignment_rules_order", "assignment_rules", ["tenant_id", "position"])
    op.create_table(
        "sla_policies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tid(),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("module", sa.Text()),
        sa.Column("ack_minutes", sa.Integer()),
        sa.Column("resolve_minutes", sa.Integer(), nullable=False),
        sa.Column("at_risk_pct", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("business_hours", sa.Boolean(), nullable=False, server_default="false"),
        _now("created_at"),
        sa.CheckConstraint("severity IN ('critical', 'high', 'medium', 'low')", name="ck_sla_policies_severity"),
        sa.CheckConstraint("resolve_minutes > 0 AND (ack_minutes IS NULL OR ack_minutes > 0)",
                           name="ck_sla_policies_minutes"),
        sa.CheckConstraint("at_risk_pct BETWEEN 1 AND 99", name="ck_sla_policies_risk"),
    )
    # one policy per (severity, module); module NULL = the severity default
    op.execute("CREATE UNIQUE INDEX uq_sla_policies ON sla_policies (tenant_id, severity, COALESCE(module, ''))")
    op.create_table(
        "triage_settings",
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("timezone", sa.Text(), nullable=False, server_default="UTC"),
        sa.Column("work_days", ARRAY(sa.SmallInteger()), nullable=False, server_default="{1,2,3,4,5}"),
        sa.Column("work_start", sa.Time(), nullable=False, server_default="08:00"),
        sa.Column("work_end", sa.Time(), nullable=False, server_default="17:00"),
        sa.Column("holidays", ARRAY(sa.Date()), nullable=False, server_default="{}"),
        sa.Column("fallback_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        _now("updated_at"),
    )

    op.add_column("record_issues", sa.Column("due_at", sa.DateTime(timezone=True)))
    for t in _ITEMS:
        op.add_column(t, sa.Column("assigned_team_id", UUID(as_uuid=True),
                                   sa.ForeignKey("triage_teams.id", ondelete="SET NULL")))
        op.add_column(t, sa.Column("assigned_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("assigned_by_rule", UUID(as_uuid=True),
                                   sa.ForeignKey("assignment_rules.id", ondelete="SET NULL")))
        op.add_column(t, sa.Column("acknowledged_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("sla_started_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("sla_policy_id", UUID(as_uuid=True),
                                   sa.ForeignKey("sla_policies.id", ondelete="SET NULL")))
        op.add_column(t, sa.Column("sla_business_hours", sa.Boolean(), nullable=False, server_default="false"))
        op.add_column(t, sa.Column("ack_due_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("ack_risk_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("risk_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("sla_state", sa.Text()))
        op.add_column(t, sa.Column("sla_paused_at", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("sla_notified", ARRAY(sa.Text()), nullable=False, server_default="{}"))
        op.add_column(t, sa.Column("snoozed_until", sa.DateTime(timezone=True)))
        op.add_column(t, sa.Column("snooze_reason", sa.Text()))
        op.create_index(f"ix_{t}_sla", t, ["tenant_id", "sla_state", "due_at"])
    op.add_column("record_issues", sa.Column("priority", sa.SmallInteger()))
    op.add_column("stewardship_queue", sa.Column("resolved_at", sa.DateTime(timezone=True)))
    op.drop_constraint("ck_record_issues_status", "record_issues", type_="check")
    op.create_check_constraint(
        "ck_record_issues_status", "record_issues",
        "status IN ('open', 'in_progress', 'waiting_sap', 'waiting_requester', 'accepted', 'resolved')")

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("UPDATE record_issues SET status = 'in_progress' "
               "WHERE status IN ('waiting_sap', 'waiting_requester')")
    op.drop_constraint("ck_record_issues_status", "record_issues", type_="check")
    op.create_check_constraint("ck_record_issues_status", "record_issues",
                               "status IN ('open', 'in_progress', 'accepted', 'resolved')")
    op.drop_column("stewardship_queue", "resolved_at")
    op.drop_column("record_issues", "priority")
    for t in _ITEMS:
        op.drop_index(f"ix_{t}_sla", table_name=t)
        for c in ("snooze_reason", "snoozed_until", "sla_notified", "sla_paused_at", "sla_state", "risk_at",
                  "ack_risk_at", "ack_due_at", "sla_business_hours", "sla_policy_id", "sla_started_at",
                  "acknowledged_at", "assigned_by_rule", "assigned_at", "assigned_team_id"):
            op.drop_column(t, c)
    op.drop_column("record_issues", "due_at")
    for t in reversed(_TABLES):
        op.drop_table(t)

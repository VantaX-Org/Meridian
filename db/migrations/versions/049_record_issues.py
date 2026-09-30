"""Record-level findings, cross-run issue lifecycle, baseline versions.

  finding_records      every failing record key per (version, check) — the
                       record-level truth behind findings.affected_count;
                       drives run-to-run diffs (new / resolved / persisting)
  record_issues        one row per (scope, check, record) across runs:
                       open → in_progress → resolved / accepted; auto-resolved
                       when a later run evaluates the record and it passes,
                       re-opened when it fails again
  record_issue_events  lifecycle audit + comments

scope = the source system id (or 'upload' for file uploads) so issues are
tracked per data lineage.

Revision ID: 049
Revises: 048
Create Date: 2026-09-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "049"
down_revision: Union[str, None] = "048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("finding_records", "record_issues", "record_issue_events")


def upgrade() -> None:
    op.create_table(
        "finding_records",
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("grain", sa.Text(), nullable=True),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("version_id", "check_id", "record_key", name="pk_finding_records"),
    )
    op.create_index("ix_finding_records_tenant_record", "finding_records", ["tenant_id", "record_key"])

    op.create_table(
        "record_issues",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("grain", sa.Text(), nullable=True),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("assigned_to", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("first_seen_version", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("last_seen_version", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("resolved_version", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reopened_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "scope", "check_id", "record_key", name="uq_record_issues"),
        sa.CheckConstraint("status IN ('open', 'in_progress', 'accepted', 'resolved')", name="ck_record_issues_status"),
    )
    op.create_index("ix_record_issues_queue", "record_issues", ["tenant_id", "status", "module", "severity"])
    op.create_index("ix_record_issues_assignee", "record_issues", ["tenant_id", "assigned_to", "status"])

    op.create_table(
        "record_issue_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("issue_id", UUID(as_uuid=True), sa.ForeignKey("record_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("user_label", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),  # status|assign|comment|auto_resolved|reopened
        sa.Column("from_value", sa.Text(), nullable=True),
        sa.Column("to_value", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("version_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_record_issue_events_issue", "record_issue_events", ["issue_id", "created_at"])

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)

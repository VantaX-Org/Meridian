"""worklist read model: work_records, work_groups; cleaning_queue.check_id / field

Revision ID: 086
Revises: 085
Create Date: 2026-10-25

The steward work list at scale. Built after each run from finding_records, findings and
record_issues (api/services/worklist.py), so no screen counts millions of rows at request time:

  work_groups    one row per (run, check): what fails, on which field, how many records,
                 how many have a proposed value, and how many are in each work status
  work_records   one row per (run, object, record): its readable name, how many checks it
                 fails, its worst severity, the checks, its work status and assignee

cleaning_queue gains check_id and field so a cleaning proposal can be tied to the issue it fixes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "086"
down_revision: Union[str, None] = "085"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("work_groups", "work_records")


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "work_groups",
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("sev_rank", sa.SmallInteger(), nullable=False),
        sa.Column("dimension", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("records", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("population", sa.Integer(), nullable=True),
        sa.Column("proposed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("truncated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("statuses", JSONB(), nullable=False, server_default="{}"),
        sa.Column("built_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("version_id", "check_id", name="pk_work_groups"),
    )
    op.create_index("ix_work_groups_rank", "work_groups", ["tenant_id", "version_id", "sev_rank", "records"])

    op.create_table(
        "work_records",
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("issues", sa.Integer(), nullable=False),
        sa.Column("sev_rank", sa.SmallInteger(), nullable=False),
        sa.Column("checks", ARRAY(sa.Text()), nullable=False),
        sa.Column("proposed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.Text(), nullable=False, server_default="to_fix"),
        sa.Column("assigned_to", UUID(as_uuid=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("version_id", "module", "record_key", name="pk_work_records"),
    )
    # Ranked list: worst first, then by key (keyset paging), within a run and object.
    op.create_index("ix_work_records_rank", "work_records",
                    ["tenant_id", "version_id", "module", "sev_rank", "record_key"])
    op.create_index("ix_work_records_all", "work_records", ["tenant_id", "version_id", "sev_rank", "module", "record_key"])
    op.create_index("ix_work_records_checks", "work_records", ["checks"], postgresql_using="gin")
    op.create_index("ix_work_records_assignee", "work_records", ["tenant_id", "version_id", "assigned_to", "status"])
    # Prefix search by key and by name.
    op.execute("CREATE INDEX ix_work_records_key ON work_records (tenant_id, version_id, record_key text_pattern_ops)")
    op.execute("CREATE INDEX ix_work_records_name ON work_records (tenant_id, version_id, lower(name) text_pattern_ops)")

    for t in _TABLES:
        _rls(t)

    op.add_column("cleaning_queue", sa.Column("check_id", sa.Text(), nullable=True))
    op.add_column("cleaning_queue", sa.Column("field", sa.Text(), nullable=True))
    op.create_index("ix_cleaning_queue_record", "cleaning_queue", ["tenant_id", "object_type", "record_key"])
    # The open issues of a run, by check (the worklist build and the record panel).
    op.execute("CREATE INDEX IF NOT EXISTS ix_record_issues_open_seen ON record_issues "
               "(tenant_id, last_seen_version, check_id, record_key) WHERE status <> 'resolved'")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_record_issues_open_seen")
    op.drop_index("ix_cleaning_queue_record", table_name="cleaning_queue")
    op.drop_column("cleaning_queue", "field")
    op.drop_column("cleaning_queue", "check_id")
    for t in reversed(_TABLES):
        op.drop_table(t)

"""fix batch hand-offs: the SAP load, the verification of the next run, event notices and access requests by permission

Revision ID: 121
Revises: 120
Create Date: 2026-10-31

* remediation_batches: a batch exported as a load file waits for the SAP load (status ``awaiting_load``, a value of the
  free-text status column) until someone confirms the load (``exported``, read as "Sent to SAP" as before, so old
  batches keep their meaning). ``exported_by`` / ``exported_by_label`` say who downloaded the load file,
  ``loaded_at`` / ``loaded_by`` / ``loaded_by_label`` / ``load_note`` who confirmed the load in SAP.
* remediation_batch_verifications: per batch and run, what the first run after the export found for the batch's
  records (fixed, still failing). One row per (batch, run), written once by the worker that follows the run.
* notification_deliveries: kind ``event`` for the notices of a hand-off (a batch waiting, approved, sent back, loaded,
  verified, an access request), claimed per user, channel and event key so a notice is never sent twice.
* access_requests: ``permission``, the action asked for by name (manage_digests, manage_settings), when the request
  names one rather than a resource and action pair.

The new table is tenant-scoped with ENABLE + FORCE row-level security and the tenant policy.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "121"
down_revision: str | None = "120"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BATCH_COLUMNS = (
    ("exported_by", UUID(as_uuid=True)),
    ("exported_by_label", sa.Text()),
    ("loaded_at", sa.DateTime(timezone=True)),
    ("loaded_by", UUID(as_uuid=True)),
    ("loaded_by_label", sa.Text()),
    ("load_note", sa.Text()),
)


def upgrade() -> None:
    for name, type_ in _BATCH_COLUMNS:
        op.add_column("remediation_batches", sa.Column(name, type_, nullable=True))

    op.create_table(
        "remediation_batch_verifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("batch_id", UUID(as_uuid=True), sa.ForeignKey("remediation_batches.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("records", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fixed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("still_failing", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("batch_id", "version_id", name="uq_remediation_batch_verifications"),
    )
    op.create_index("ix_remediation_batch_verifications_batch", "remediation_batch_verifications",
                    ["tenant_id", "batch_id", "created_at"])
    table = "remediation_batch_verifications"
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")

    op.drop_constraint("ck_notification_deliveries_kind", "notification_deliveries", type_="check")
    op.create_check_constraint("ck_notification_deliveries_kind", "notification_deliveries",
                               "kind IN ('critical', 'digest', 'test', 'event')")

    op.add_column("access_requests", sa.Column("permission", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("access_requests", "permission")
    # the notices already sent stay in the history: the narrower check holds for new rows only
    op.drop_constraint("ck_notification_deliveries_kind", "notification_deliveries", type_="check")
    op.execute("ALTER TABLE notification_deliveries ADD CONSTRAINT ck_notification_deliveries_kind "
               "CHECK (kind IN ('critical', 'digest', 'test')) NOT VALID")
    op.drop_index("ix_remediation_batch_verifications_batch", table_name="remediation_batch_verifications")
    op.drop_table("remediation_batch_verifications")
    # a batch waiting for the SAP load reads as exported (sent) again, as before this migration
    forced = op.get_bind().execute(sa.text(
        "SELECT relforcerowsecurity FROM pg_class WHERE oid = 'remediation_batches'::regclass")).scalar()
    if forced:
        op.execute("ALTER TABLE remediation_batches NO FORCE ROW LEVEL SECURITY")
    op.execute("UPDATE remediation_batches SET status = 'exported' WHERE status = 'awaiting_load'")
    if forced:
        op.execute("ALTER TABLE remediation_batches FORCE ROW LEVEL SECURITY")
    for name, _ in reversed(_BATCH_COLUMNS):
        op.drop_column("remediation_batches", name)

"""master data change requests: the request, its attachments and comments

Revision ID: 120
Revises: 119
Create Date: 2026-10-30

* change_requests: a proposed create or change of a material, customer, vendor or business partner on a target SAP
  system, as SAP fields with values (``payload``, TABLE.FIELD: value; for a change, ``object_key`` names the record).
  Status: draft, submitted, in_approval, approved, rejected, creating, created, failed, cancelled. ``precheck`` keeps
  the rules the proposal fails and the likely duplicates found at the last validation; ``workflow_instance_id`` the
  approval (migration 119); ``sap_key``, ``sap_result`` and ``sap_phase`` what SAP answered (RETURN messages, the
  created key) and how far the create got, so a retry never creates twice; ``export`` the load file and its reason
  when the record goes to SAP by file.
* change_request_attachments: metadata of the files attached to a request (name, type, size, sha256, storage key).
* change_request_comments: the discussion on a request.

Each table is tenant-scoped with ENABLE + FORCE row-level security and the tenant policy.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "120"
down_revision: str | None = "119"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("change_requests", "change_request_attachments", "change_request_comments")
_STATUSES = ("draft", "submitted", "in_approval", "approved", "rejected", "creating", "created", "failed", "cancelled")


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def _base() -> list[sa.Column]:
    return [sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)]


def upgrade() -> None:
    statuses = ", ".join(f"'{s}'" for s in _STATUSES)
    op.create_table(
        "change_requests", *_base(),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("object", sa.Text(), nullable=False),
        sa.Column("target_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("object_key", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("payload", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("requester_id", UUID(as_uuid=True), nullable=True),
        sa.Column("requester_label", sa.Text(), nullable=True),
        sa.Column("workflow_instance_id", UUID(as_uuid=True),
                  sa.ForeignKey("workflow_instances.id", ondelete="SET NULL"), nullable=True),
        sa.Column("precheck", JSONB(), nullable=True),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sap_key", sa.Text(), nullable=True),
        sa.Column("sap_result", JSONB(), nullable=True),
        sa.Column("sap_phase", sa.Text(), nullable=True),
        sa.Column("sap_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivery", sa.Text(), nullable=True),
        sa.Column("export", JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('create', 'change')", name="ck_change_requests_kind"),
        sa.CheckConstraint("object IN ('material', 'customer', 'vendor', 'business_partner')",
                           name="ck_change_requests_object"),
        sa.CheckConstraint(f"status IN ({statuses})", name="ck_change_requests_status"),
        sa.CheckConstraint("kind = 'create' OR object_key IS NOT NULL", name="ck_change_requests_change_key"),
    )
    op.create_index("ix_change_requests_status", "change_requests", ["tenant_id", "status", "created_at"])
    op.create_index("ix_change_requests_requester", "change_requests", ["tenant_id", "requester_id", "created_at"])
    op.create_table(
        "change_request_attachments", *_base(),
        sa.Column("request_id", UUID(as_uuid=True), sa.ForeignKey("change_requests.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("uploaded_by", UUID(as_uuid=True), nullable=True),
        sa.Column("uploaded_by_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_change_request_attachments_request", "change_request_attachments", ["tenant_id", "request_id"])
    op.create_table(
        "change_request_comments", *_base(),
        sa.Column("request_id", UUID(as_uuid=True), sa.ForeignKey("change_requests.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("author_id", UUID(as_uuid=True), nullable=True),
        sa.Column("author_label", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_change_request_comments_request", "change_request_comments", ["tenant_id", "request_id",
                                                                                      "created_at"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_table(table)

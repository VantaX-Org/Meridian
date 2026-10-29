"""readiness certificates: versioned per migration wave, signed by each owner

Revision ID: 106
Revises: 103
Create Date: 2026-10-29

Independent of 104 and 105 (it touches none of their tables); when they are on one branch, point ``down_revision``
at 105 so the chain stays linear. Both tables are tenant-scoped with ENABLE + FORCE row-level security and the
tenant policy, like migration 103.

* wave_certificates: one issued readiness certificate of a wave (api/services/readiness_certificate.py), numbered
  per wave. ``content`` is the certified content, ``content_sha256`` its SHA-256 over canonical JSON; the PDF is a
  report_files row of kind ``readiness_certificate``.
* wave_certificate_signatures: one owner's signature (user, time, statement) of a certificate.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "106"
down_revision: str | None = "105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("wave_certificates", "wave_certificate_signatures")


def _tenant_fk() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "wave_certificates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("migration_waves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="issued"),
        sa.Column("content", JSONB(), nullable=False),
        sa.Column("content_sha256", sa.Text(), nullable=False),
        sa.Column("report_file_id", UUID(as_uuid=True), sa.ForeignKey("report_files.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('issued', 'signed')", name="ck_wave_certificates_status"),
        sa.UniqueConstraint("wave_id", "version", name="uq_wave_certificates_version"),
    )
    op.create_index("ix_wave_certificates_wave", "wave_certificates", ["tenant_id", "wave_id", "version"])
    op.create_table(
        "wave_certificate_signatures",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("certificate_id", UUID(as_uuid=True), sa.ForeignKey("wave_certificates.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_label", sa.Text(), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("certificate_id", "user_id", name="uq_wave_certificate_signatures_user"),
    )
    op.create_index("ix_wave_certificate_signatures_cert", "wave_certificate_signatures", ["tenant_id", "certificate_id"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_table(table)

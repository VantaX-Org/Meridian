"""Rule lifecycle (tenant rule versions, suppressions) and outbound alert channels.

rule_versions      — draft → in_review → active → retired, with approver; one active per rule
rule_suppressions  — a rule or one record kept out of the score until expires_at (reason required)
alert_channels     — webhook / Slack / Teams / email targets; digest by default

Revision ID: 054
Revises: 053
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "054"
down_revision: Union[str, None] = "053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("rule_versions", "rule_suppressions", "alert_channels")


def _id() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _tenant() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "rule_versions",
        _id(), _tenant(),
        sa.Column("rule_id", sa.Text(), nullable=False),        # check id, shipped or tenant-authored
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("body", JSONB(), nullable=False),              # partial override, or a whole new rule
        sa.Column("state", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("approved_by", sa.Text(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "rule_id", "version", name="uq_rule_versions"),
        sa.CheckConstraint("state IN ('draft', 'in_review', 'active', 'retired')", name="ck_rule_versions_state"),
    )
    op.create_index("uq_rule_versions_active", "rule_versions", ["tenant_id", "rule_id"], unique=True,
                    postgresql_where=sa.text("state = 'active'"))

    op.create_table(
        "rule_suppressions",
        _id(), _tenant(),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=True),       # NULL = the whole rule
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("length(btrim(reason)) > 0", name="ck_rule_suppressions_reason"),
    )
    op.create_index("ix_rule_suppressions_tenant_expiry", "rule_suppressions", ["tenant_id", "expires_at"])

    op.create_table(
        "alert_channels",
        _id(), _tenant(),
        sa.Column("kind", sa.Text(), nullable=False),            # webhook | slack | teams | email
        sa.Column("target", sa.Text(), nullable=False),          # URL, or email address
        sa.Column("secret", sa.Text(), nullable=True),           # HMAC key (webhook)
        sa.Column("digest", sa.Text(), nullable=False, server_default="daily"),
        sa.Column("immediate_critical", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('webhook', 'slack', 'teams', 'email')", name="ck_alert_channels_kind"),
        sa.CheckConstraint("digest IN ('daily', 'weekly', 'off')", name="ck_alert_channels_digest"),
    )

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)

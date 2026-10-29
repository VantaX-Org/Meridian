"""role capabilities: comments, watches, subscriptions, delegations, escalation chain, contract versions,
wave gates, share links and shared saved views

Revision ID: 104
Revises: 103
Create Date: 2026-10-29

The tables behind the role capability audit (docs/roles-and-features.md):

  comments                   one comment on a record, rule, batch, contract or wave; ``mentions`` are the user ids
                             named in it (each gets a ``mention`` notification). Soft-deleted (``deleted_at``).
  watches                    a user watching one object, rule, batch or system for the listed ``events``.
  notification_subscriptions per-user opt-out of one event kind (absent row = the event's default).
  delegations                out of office: ``from_user_id`` hands approvals and assigned work to ``to_user_id``
                             between two dates (inclusive). ``revoked_at`` ends it early.
  escalation_steps           the escalation chain after an SLA breach: level n notifies ``target`` once the item is
                             ``after_minutes`` past due (team_lead, fallback or one user).
  contract_versions          a snapshot of a contract each time it is revised; ``contracts.version`` is the live one.
  wave_gates                 the gate a migration wave passes before it moves: min score, zero criticals,
                             contracts met.
  share_links                a read-only link to one canvas state, opened under the viewer role until it expires or
                             is revoked. Only the sha256 of the token is stored.
  saved_views.shared         a view every user of the tenant sees on that route (read-only to them).

Every new table is tenant-scoped: ENABLE + FORCE row-level security with the tenant policy, like migration 100.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "104"
down_revision: str | None = "103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("comments", "watches", "notification_subscriptions", "delegations", "escalation_steps",
           "contract_versions", "wave_gates", "share_links")


def _tenant() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _id() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _now(name: str = "created_at") -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"))


def upgrade() -> None:
    op.create_table(
        "comments", _id(), _tenant(),
        sa.Column("target_kind", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_id", sa.Text(), nullable=False),
        sa.Column("author_label", sa.Text(), nullable=False),
        sa.Column("mentions", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        _now(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("target_kind IN ('record','rule','batch','contract','wave','object')",
                           name="ck_comments_target_kind"),
        sa.CheckConstraint("length(body) BETWEEN 1 AND 4000", name="ck_comments_body_len"),
    )
    op.create_index("ix_comments_target", "comments", ["tenant_id", "target_kind", "target_id", "created_at"])

    op.create_table(
        "watches", _id(), _tenant(),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("target_kind", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("events", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        _now(),
        sa.UniqueConstraint("tenant_id", "user_id", "target_kind", "target_id", name="uq_watches_user_target"),
        sa.CheckConstraint("target_kind IN ('record','rule','batch','object','system','contract','wave')",
                           name="ck_watches_target_kind"),
    )
    op.create_index("ix_watches_target", "watches", ["tenant_id", "target_kind", "target_id"])

    op.create_table(
        "notification_subscriptions",
        _tenant(),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        _now("updated_at"),
        sa.PrimaryKeyConstraint("tenant_id", "user_id", "event", name="pk_notification_subscriptions"),
    )

    op.create_table(
        "delegations", _id(), _tenant(),
        sa.Column("from_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        _now(),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("ends_on >= starts_on", name="ck_delegations_dates"),
        sa.CheckConstraint("from_user_id <> to_user_id", name="ck_delegations_not_self"),
    )
    op.create_index("ix_delegations_from", "delegations", ["tenant_id", "from_user_id", "starts_on"])
    op.create_index("ix_delegations_to", "delegations", ["tenant_id", "to_user_id", "starts_on"])

    op.create_table(
        "escalation_steps", _id(), _tenant(),
        sa.Column("level", sa.SmallInteger(), nullable=False),
        sa.Column("after_minutes", sa.Integer(), nullable=False),
        sa.Column("target", sa.Text(), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        _now("updated_at"),
        sa.UniqueConstraint("tenant_id", "level", name="uq_escalation_steps_level"),
        sa.CheckConstraint("level BETWEEN 1 AND 5", name="ck_escalation_steps_level"),
        sa.CheckConstraint("after_minutes >= 0", name="ck_escalation_steps_after"),
        sa.CheckConstraint("target IN ('team_lead','fallback','user')", name="ck_escalation_steps_target"),
    )

    op.add_column("contracts", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_table(
        "contract_versions", _id(), _tenant(),
        sa.Column("contract_id", UUID(as_uuid=True), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        _now(),
        sa.UniqueConstraint("contract_id", "version", name="uq_contract_versions"),
    )

    op.create_table(
        "wave_gates",
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("migration_waves.id", ondelete="CASCADE"),
                  primary_key=True),
        _tenant(),
        sa.Column("min_score", sa.Float(), nullable=True),
        sa.Column("zero_criticals", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("contracts_met", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_by", sa.Text(), nullable=True),
        _now("updated_at"),
        sa.CheckConstraint("min_score IS NULL OR (min_score >= 0 AND min_score <= 100)", name="ck_wave_gates_score"),
    )

    op.create_table(
        "share_links", _id(), _tenant(),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("route", sa.Text(), nullable=False),
        sa.Column("state", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("role", sa.Text(), nullable=False, server_default="viewer"),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_by_label", sa.Text(), nullable=True),
        _now(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("open_count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("role = 'viewer'", name="ck_share_links_role"),
        sa.CheckConstraint("route LIKE '/v2%'", name="ck_share_links_route"),
    )
    op.create_index("ix_share_links_tenant", "share_links", ["tenant_id", "created_at"])

    op.add_column("saved_views", sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.text("false")))

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_column("saved_views", "shared")
    for t in reversed(_TABLES):
        op.drop_table(t)
    op.drop_column("contracts", "version")

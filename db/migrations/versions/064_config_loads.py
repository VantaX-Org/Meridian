"""Config loads: system-neutral configuration snapshots, one row set per load, kept per system.

  config_loads  one snapshot (role source|target, origin connection|best_practice|upload), object states,
                change history (dates and counts only) and the flow derivation made from it
  config_items  one row per config object + key (TVAK / AUART=ZOR), so two loads can be compared key by key

Revision ID: 064
Revises: 063
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "064"
down_revision: Union[str, None] = "063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "config_loads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), nullable=True),  # null for a best-practice baseline
        sa.Column("system_type", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default="source"),
        sa.Column("origin", sa.Text(), nullable=False, server_default="connection"),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("objects", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("history", JSONB(), nullable=True),
        sa.Column("derivation", JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('source','target')", name="ck_config_loads_role"),
        sa.CheckConstraint("origin IN ('connection','best_practice','upload')", name="ck_config_loads_origin"),
    )
    op.create_index("ix_config_loads_system", "config_loads",
                    ["tenant_id", "system_id", "role", sa.text("created_at DESC")])
    op.create_table(
        "config_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("load_id", UUID(as_uuid=True), sa.ForeignKey("config_loads.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("object", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("values", JSONB(), nullable=False),
    )
    op.create_index("ix_config_items_load", "config_items", ["load_id", "object", "key"])
    _rls("config_loads")
    _rls("config_items")


def downgrade() -> None:
    op.drop_table("config_items")
    op.drop_table("config_loads")

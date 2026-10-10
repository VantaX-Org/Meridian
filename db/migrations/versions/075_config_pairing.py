"""Config pairing: sap_systems role and target; transfer_value_mappings pair scope and status.

Revision ID: 075
Revises: 074
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "075"
down_revision: Union[str, None] = "074"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sap_systems", sa.Column("role", sa.Text(), nullable=False, server_default="source"))
    op.create_check_constraint("ck_sap_systems_role", "sap_systems", "role IN ('source','target')")
    op.add_column("sap_systems", sa.Column("target_system_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_sap_systems_target", "sap_systems", "sap_systems", ["target_system_id"], ["id"],
                          ondelete="SET NULL")
    op.create_check_constraint("ck_sap_systems_target_not_self", "sap_systems",
                               "target_system_id IS NULL OR target_system_id <> id")

    op.add_column("transfer_value_mappings", sa.Column("source_system_id", UUID(as_uuid=True), nullable=True))
    op.add_column("transfer_value_mappings", sa.Column("target_system_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_transfer_value_mappings_source", "transfer_value_mappings", "sap_systems",
                          ["source_system_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_transfer_value_mappings_target", "transfer_value_mappings", "sap_systems",
                          ["target_system_id"], ["id"], ondelete="CASCADE")
    op.add_column("transfer_value_mappings",
                  sa.Column("status", sa.Text(), nullable=False, server_default="confirmed"))
    op.create_check_constraint("ck_transfer_value_mappings_status", "transfer_value_mappings",
                               "status IN ('proposed','confirmed','rejected')")
    op.drop_constraint("uq_transfer_value_mappings", "transfer_value_mappings", type_="unique")
    op.execute("ALTER TABLE transfer_value_mappings ADD CONSTRAINT uq_transfer_value_mappings_scope "
               "UNIQUE NULLS NOT DISTINCT (tenant_id, module, target_field, source_value, "
               "source_system_id, target_system_id)")


def downgrade() -> None:
    # scoped and unconfirmed rows cannot live under the old one-row-per-value key
    op.execute("DELETE FROM transfer_value_mappings "
               "WHERE source_system_id IS NOT NULL OR target_system_id IS NOT NULL OR status <> 'confirmed'")
    op.drop_constraint("uq_transfer_value_mappings_scope", "transfer_value_mappings", type_="unique")
    op.create_unique_constraint("uq_transfer_value_mappings", "transfer_value_mappings",
                                ["tenant_id", "module", "target_field", "source_value"])
    op.drop_constraint("ck_transfer_value_mappings_status", "transfer_value_mappings", type_="check")
    op.drop_column("transfer_value_mappings", "status")
    op.drop_constraint("fk_transfer_value_mappings_target", "transfer_value_mappings", type_="foreignkey")
    op.drop_constraint("fk_transfer_value_mappings_source", "transfer_value_mappings", type_="foreignkey")
    op.drop_column("transfer_value_mappings", "target_system_id")
    op.drop_column("transfer_value_mappings", "source_system_id")

    op.drop_constraint("ck_sap_systems_target_not_self", "sap_systems", type_="check")
    op.drop_constraint("fk_sap_systems_target", "sap_systems", type_="foreignkey")
    op.drop_column("sap_systems", "target_system_id")
    op.drop_constraint("ck_sap_systems_role", "sap_systems", type_="check")
    op.drop_column("sap_systems", "role")

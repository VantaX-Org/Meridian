"""Add multi-system type support to sap_systems: cloud connector fields,
health tracking, config sync tracking. Make RFC fields nullable for
cloud-only systems.

Revision ID: 030
Revises: 029
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # System type (ecc, s4hana_onprem, s4hana_cloud, successfactors, concur, ariba, ewm, etc.)
    op.add_column("sap_systems", sa.Column("system_type", sa.Text(), server_default="ecc", nullable=False))

    # Cloud-specific connection fields (null for RFC-based systems)
    op.add_column("sap_systems", sa.Column("base_url", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("company_id", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("auth_type", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("client_id_encrypted", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("client_secret_encrypted", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("token_url", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("api_key_encrypted", sa.Text(), nullable=True))

    # Make RFC fields nullable (cloud systems don't have them)
    op.alter_column("sap_systems", "host", existing_type=sa.Text(), nullable=True)
    op.alter_column("sap_systems", "client", existing_type=sa.Text(), nullable=True)
    op.alter_column("sap_systems", "sysnr", existing_type=sa.Text(), nullable=True)

    # Health tracking
    op.add_column("sap_systems", sa.Column("last_health_check", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sap_systems", sa.Column("health_status", sa.Text(), server_default="unknown", nullable=True))
    op.add_column("sap_systems", sa.Column("health_message", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("consecutive_failures", sa.Integer(), server_default="0", nullable=True))

    # Config sync tracking
    op.add_column("sap_systems", sa.Column("config_last_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sap_systems", sa.Column("config_sync_status", sa.Text(), server_default="never", nullable=True))


def downgrade() -> None:
    op.drop_column("sap_systems", "config_sync_status")
    op.drop_column("sap_systems", "config_last_synced_at")
    op.drop_column("sap_systems", "consecutive_failures")
    op.drop_column("sap_systems", "health_message")
    op.drop_column("sap_systems", "health_status")
    op.drop_column("sap_systems", "last_health_check")
    op.alter_column("sap_systems", "sysnr", existing_type=sa.Text(), nullable=False)
    op.alter_column("sap_systems", "client", existing_type=sa.Text(), nullable=False)
    op.alter_column("sap_systems", "host", existing_type=sa.Text(), nullable=False)
    op.drop_column("sap_systems", "api_key_encrypted")
    op.drop_column("sap_systems", "token_url")
    op.drop_column("sap_systems", "client_secret_encrypted")
    op.drop_column("sap_systems", "client_id_encrypted")
    op.drop_column("sap_systems", "auth_type")
    op.drop_column("sap_systems", "company_id")
    op.drop_column("sap_systems", "base_url")
    op.drop_column("sap_systems", "system_type")

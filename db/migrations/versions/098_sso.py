"""OIDC single sign-on

Revision ID: 098
Revises: 097
Create Date: 2026-10-28

tenants.sso_config (jsonb, null until configured): issuer, client_id, client_secret_encrypted (Fernet under the
tenant jwt_secret, api/services/crypto.py; never returned by the API), display_name, allowed_domains[],
default_role ('viewer'), enforce. users.external_subject: the IdP's `sub`; unique per tenant where set, so one
identity maps to one user. Additive: with sso_config NULL nothing changes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "098"
down_revision: Union[str, None] = "097"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("sso_config", JSONB(), nullable=True))
    op.add_column("users", sa.Column("external_subject", sa.Text(), nullable=True))
    op.create_index("uq_users_tenant_external_subject", "users", ["tenant_id", "external_subject"], unique=True,
                    postgresql_where=sa.text("external_subject IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("uq_users_tenant_external_subject", table_name="users")
    op.drop_column("users", "external_subject")
    op.drop_column("tenants", "sso_config")

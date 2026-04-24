"""Create audit_log table for general-purpose mutation auditing.

Separate from llm_audit_log (which records LLM calls). This table captures
every state-changing API request — who, what, when, from where, with a
before/after JSON payload when the handler supplies it.

Revision ID: 038
Revises: 037
Create Date: 2026-04-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision: str = "038"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("actor_email", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=True),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("ip", sa.Text(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("before_json", JSONB, nullable=True),
        sa.Column("after_json", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_audit_log_tenant_created",
        "audit_log",
        ["tenant_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_audit_log_entity",
        "audit_log",
        ["tenant_id", "entity_type", "entity_id"],
    )
    op.create_index(
        "ix_audit_log_actor",
        "audit_log",
        ["tenant_id", "actor_user_id"],
    )

    op.execute("ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY audit_log_rls ON audit_log "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS audit_log_rls ON audit_log")
    op.drop_index("ix_audit_log_actor", table_name="audit_log")
    op.drop_index("ix_audit_log_entity", table_name="audit_log")
    op.drop_index("ix_audit_log_tenant_created", table_name="audit_log")
    op.drop_table("audit_log")

"""Add config_matches table and config_match_summary column to analysis_versions.

Stores per-finding classification of whether a data quality issue is a
genuine data error, a configuration deviation, or ambiguous — enabling
targeted remediation recommendations and SAP tcode guidance.

Revision ID: 025
Revises: 024
Create Date: 2026-03-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "config_matches",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("analysis_versions.id"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("actual_value", sa.Text(), nullable=True),
        sa.Column("std_rule_expectation", sa.Text(), nullable=True),
        # data_error | config_deviation | ambiguous
        sa.Column("classification", sa.Text(), nullable=False),
        sa.Column("config_evidence", sa.Text(), nullable=True),
        sa.Column("recommended_action", sa.Text(), nullable=True),
        sa.Column("sap_tcode", sa.Text(), nullable=True),
        sa.Column("fix_priority", sa.Integer(), nullable=True, server_default="2"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "ix_config_matches_version",
        "config_matches",
        ["version_id", "tenant_id"],
    )
    op.create_index(
        "ix_config_matches_classification",
        "config_matches",
        ["tenant_id", "classification"],
    )
    op.create_index(
        "ix_config_matches_module",
        "config_matches",
        ["tenant_id", "module"],
    )

    # Row Level Security — same pattern as findings in 001_initial_schema.py
    op.execute("ALTER TABLE config_matches ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON config_matches
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
    """)
    op.execute("ALTER TABLE config_matches FORCE ROW LEVEL SECURITY")

    op.add_column(
        "analysis_versions",
        sa.Column("config_match_summary", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_versions", "config_match_summary")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON config_matches")
    op.execute("ALTER TABLE config_matches DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_config_matches_module", table_name="config_matches")
    op.drop_index("ix_config_matches_classification", table_name="config_matches")
    op.drop_index("ix_config_matches_version", table_name="config_matches")
    op.drop_table("config_matches")

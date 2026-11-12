"""semantic_type_overrides: the type a user confirmed or chose for a column of an uploaded run

Revision ID: 160
Revises: 154
Create Date: 2026-11-11

Uploads and external database runs carry a semantic profile in analysis_versions.metadata (detected type,
confidence and shares per column, no values). A user confirms a detected type or overrides it here; suggested
rules come from confirmed types only. "none" records that a column has no semantic type.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "160"
down_revision: Union[str, None] = "154"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE semantic_type_overrides (
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            version_id uuid NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,
            column_name text NOT NULL,
            semantic_type text NOT NULL,
            confirmed_by text,
            confirmed_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, version_id, column_name)
        )""")
    op.execute("ALTER TABLE semantic_type_overrides ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE semantic_type_overrides FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS semantic_type_overrides_rls ON semantic_type_overrides")
    op.execute("CREATE POLICY semantic_type_overrides_rls ON semantic_type_overrides "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
               "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS semantic_type_overrides")

"""target_templates: uploaded target load templates per module, with their column mapping

Revision ID: 150
Revises: 149
Create Date: 2026-11-11

A tenant uploads the new system's load template (a Migration Cockpit workbook, a SuccessFactors import file, any
xlsx or csv) once per module and fills it from each run. Every upload under the same name is a new version. The
column map holds the corrections a person made to unresolved columns, keyed "sheet::header", and is carried to the
next version. Coverage is the last check's summary.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "150"
down_revision: Union[str, None] = "149"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE target_templates (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            module text NOT NULL,
            name text NOT NULL,
            version integer NOT NULL,
            filename text NOT NULL,
            sha256 text NOT NULL,
            size_bytes integer NOT NULL,
            content bytea NOT NULL,
            column_map jsonb NOT NULL DEFAULT '{}',
            coverage jsonb,
            last_fill_at timestamptz,
            last_fill_version_id text,
            created_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (tenant_id, module, name, version)
        )""")
    op.execute("ALTER TABLE target_templates ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE target_templates FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS target_templates_rls ON target_templates")
    op.execute("CREATE POLICY target_templates_rls ON target_templates "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
               "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS target_templates")

"""org_unit_names: plant and company code names from the newest run

Revision ID: 149
Revises: 148
Create Date: 2026-11-07

Records are named by their first key field, so a MATNR=..|WERKS=.. row carries the material's name and the plant's
name is lost. Screens that show a plant or company code alone read its name here. Filled by worklist.name_records.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "149"
down_revision: Union[str, None] = "148"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE org_unit_names (
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            field text NOT NULL,
            value text NOT NULL,
            name text NOT NULL,
            PRIMARY KEY (tenant_id, field, value)
        )""")
    op.execute("ALTER TABLE org_unit_names ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE org_unit_names FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS org_unit_names_rls ON org_unit_names")
    op.execute("CREATE POLICY org_unit_names_rls ON org_unit_names "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
               "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS org_unit_names")

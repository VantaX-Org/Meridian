"""roundtrip_edits: every cell a cleaned copy has changed, one row per cell

Revision ID: 169
Revises: 166
Create Date: 2026-11-13

A cleaned copy (an uploaded cleaning workbook or filled template) used to list its edited cells in
metadata.cleaned_overlay.edits, cut at 5,000. The cells now live here, written in the same transaction as the copy,
so nothing is cut: the monitor reads them to tell a fix not yet made in SAP from a regression, and the upload
route reads them to find cells another person changed after a file was exported.

167 and 168 are claimed by branches in flight; whichever merges last re-points its down_revision.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "169"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS roundtrip_edits (
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            version_id uuid NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,
            grain text NOT NULL,
            record_key text NOT NULL,
            field text NOT NULL,
            PRIMARY KEY (version_id, grain, record_key, field)
        )""")
    op.execute("ALTER TABLE roundtrip_edits ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE roundtrip_edits FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS roundtrip_edits_rls ON roundtrip_edits")
    op.execute("CREATE POLICY roundtrip_edits_rls ON roundtrip_edits "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
               "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS roundtrip_edits")

"""force RLS on system_update_log; share links keep the app's root routes

Revision ID: 117
Revises: 116
Create Date: 2026-10-30

system_update_log (migration 045) enabled row level security but never forced it, so its owner role read every
tenant's update history. Every other tenant table forces it (039).

Share links (migration 104) were created while the interface lived under /v2, with ``CHECK (route LIKE '/v2%')``.
After the cut-over to the root the API kept that prefix in storage and converted at the edge. The constraint now
allows any app route (``route LIKE '/%'``), stored rows lose the prefix (``/v2`` -> ``/``, ``/v2/o/x`` -> ``/o/x``)
and api/routes/share_links.py stores the route as given. The rewrite runs with RLS lifted for the owner (share_links
forces it) and forced again before the migration ends.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "117"
down_revision: str | None = "116"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE system_update_log FORCE ROW LEVEL SECURITY")

    op.execute("ALTER TABLE share_links DROP CONSTRAINT IF EXISTS ck_share_links_route")
    op.execute("ALTER TABLE share_links NO FORCE ROW LEVEL SECURITY")
    op.execute("""
        UPDATE share_links
           SET route = CASE WHEN route = '/v2' THEN '/' ELSE substr(route, 4) END
         WHERE route = '/v2' OR route LIKE '/v2/%'
    """)
    op.execute("ALTER TABLE share_links FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE share_links ADD CONSTRAINT ck_share_links_route CHECK (route LIKE '/%')")


def downgrade() -> None:
    op.execute("ALTER TABLE share_links DROP CONSTRAINT IF EXISTS ck_share_links_route")
    op.execute("ALTER TABLE share_links NO FORCE ROW LEVEL SECURITY")
    op.execute("""
        UPDATE share_links
           SET route = CASE WHEN route = '/' THEN '/v2' ELSE '/v2' || route END
         WHERE route NOT LIKE '/v2%'
    """)
    op.execute("ALTER TABLE share_links FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE share_links ADD CONSTRAINT ck_share_links_route CHECK (route LIKE '/v2%')")

    op.execute("ALTER TABLE system_update_log NO FORCE ROW LEVEL SECURITY")

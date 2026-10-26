"""run identity: number each run within its lineage and link a re-run to the run it repeats

Revision ID: 093
Revises: 092
Create Date: 2026-10-26

A re-run already created a new analysis_versions row, but nothing distinguished it from an earlier
attempt at the same thing except its timestamp: two runs of the same objects on one day read the
same in the run picker, and "which of these is the newer attempt?" was answerable only by clock.
Every run also had a NULL label, so the picker fell back to the object list.

analysis_versions.run_number  INTEGER, 1-based within the run's lineage (the system, or "upload"),
                              ordered by run_at. Backfilled here.
analysis_versions.parent_version_id UUID -> analysis_versions.id ON DELETE SET NULL. For a run whose
                              lineage and object set match an earlier run, the earlier one.

Both are nullable so the upgrade is metadata-only; the backfill fills existing rows. Downgrade drops
both columns (the lineage is still derivable from run_at and metadata, so nothing is lost).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "093"
down_revision: str | None = "092"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("analysis_versions", sa.Column("run_number", sa.Integer(), nullable=True))
    op.add_column("analysis_versions", sa.Column("parent_version_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_analysis_versions_parent", "analysis_versions", "analysis_versions",
                          ["parent_version_id"], ["id"], ondelete="SET NULL")

    # Number per lineage, oldest first.
    op.execute("""
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (
                       PARTITION BY tenant_id, COALESCE(metadata->>'system_id', 'upload')
                       ORDER BY run_at, id) AS n
              FROM analysis_versions)
        UPDATE analysis_versions v SET run_number = n.n
          FROM numbered n WHERE n.id = v.id
    """)

    # Link a run to the immediately preceding run of the same lineage and object set: that is what
    # makes "re-run of #N" meaningful rather than merely "an earlier run".
    op.execute("""
        WITH ordered AS (
            SELECT id, tenant_id, COALESCE(metadata->>'system_id', 'upload') AS lineage,
                   COALESCE(metadata->'modules', '[]'::jsonb) AS modules, run_at,
                   LAG(id) OVER (
                       PARTITION BY tenant_id, COALESCE(metadata->>'system_id', 'upload'),
                                    COALESCE(metadata->'modules', '[]'::jsonb)
                       ORDER BY run_at, id) AS prev_id
              FROM analysis_versions)
        UPDATE analysis_versions v SET parent_version_id = o.prev_id
          FROM ordered o WHERE o.id = v.id AND o.prev_id IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_constraint("fk_analysis_versions_parent", "analysis_versions", type_="foreignkey")
    op.drop_column("analysis_versions", "parent_version_id")
    op.drop_column("analysis_versions", "run_number")

"""entry_duplicate_block_indexes: indexes for the duplicate search at entry

Revision ID: 133
Revises: 132
Create Date: 2026-11-05

The data quality firewall's duplicate search (api/services/entry_duplicates.py) finds candidates by equality on a
normalised key inside one tenant and domain. One partial expression index per block field keeps that lookup an index
probe at any population size. The expression text must equal entry_duplicates.block_expr. Plain CREATE INDEX blocks
writes to master_records while it builds; run the upgrade outside an extraction.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "133"
down_revision: Union[str, None] = "132"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FIELDS = ["BUT000.NAME_ORG1", "KNA1.NAME1", "KNA1.STCD1", "KNA1.STCD2", "KNA1.STCEG",
          "MAKT.MAKTX", "MARA.BISMT", "MARA.MFRPN"]


def _name(f: str) -> str:
    return "ix_master_records_dup_" + f.lower().replace(".", "_")


def upgrade() -> None:
    for f in FIELDS:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {_name(f)} ON master_records (tenant_id, domain, "
            f"(upper(regexp_replace(COALESCE(own_fields, golden_fields)->>'{f}', '[^0-9A-Za-z]', '', 'g')))) "
            f"WHERE merged_into IS NULL")


def downgrade() -> None:
    for f in FIELDS:
        op.execute(f"DROP INDEX IF EXISTS {_name(f)}")

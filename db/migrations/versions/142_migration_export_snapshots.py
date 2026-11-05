"""migration_export_files: pointer and digest of the snapshot of what was handed over

Revision ID: 142
Revises: 141
Create Date: 2026-11-05

At export, the load tables and the held-back tables are stored as parquet in object storage, and the export row keeps
where they are and a content digest. Post-load reconciliation then compares the target against what was handed over,
not against a rebuild from the current mappings.

* ``snapshot_prefix``: object prefix under the uploads bucket, keyed by tenant, run and export id. Null when no snapshot.
* ``snapshot_sha256``: digest over the sorted (object name, sha256 of bytes) pairs; checked on every read.
* ``snapshot_at``: when the snapshot was written.
* ``snapshot_error``: why the snapshot could not be written (the export itself still succeeded).

Renumber at merge: another unmerged branch also holds revision 142.

Downgrade drops the four columns; snapshot objects already in storage are not removed by it.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "142"
down_revision: Union[str, None] = "141"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = {"snapshot_prefix": "text", "snapshot_sha256": "text", "snapshot_at": "timestamptz", "snapshot_error": "text"}


def upgrade() -> None:
    for c, t in COLS.items():
        op.execute(f"ALTER TABLE migration_export_files ADD COLUMN IF NOT EXISTS {c} {t}")


def downgrade() -> None:
    for c in COLS:
        op.execute(f"ALTER TABLE migration_export_files DROP COLUMN IF EXISTS {c}")

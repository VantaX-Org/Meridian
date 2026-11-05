"""entry_hold: stage a flagged candidate as a change request and release the approved one to the SAP save

Revision ID: 141
Revises: 140
Create Date: 2026-11-05

The entry gate can hold a flagged candidate (POST /api/v1/dq-firewall/validate with ``hold``): the SAP save stops, the
candidate waits as a change request, and once the workflow approves it the exact content may be saved. Two stamps make
that safe against a second record in SAP:

* ``entry_released_at``: set once, when an approved request is released to the SAP save. A released request is valid
  for a limited time and must not also leave through the export load file.
* ``export_downloaded_at``: set when the export load file is downloaded. A request whose file was taken is never
  released to the save.

Requests approved for export before this migration have no record of a download. To stay on the safe side, the
migration stamps ``export_downloaded_at`` on every approved gate request that has an export file, so none is released.

The open-request unique index now also requires ``entry_released_at IS NULL``: a released request whose time ran out
must not block a new request for the same content. A second index serves the lookup of the latest request of a
fingerprint at any status.

Downgrade: the old unique index allows one open request per fingerprint, so a released request that a newer open
request outlived loses its fingerprint first (the request itself stays).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "141"
down_revision: Union[str, None] = "140"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPEN = "('draft', 'submitted', 'in_approval', 'approved', 'creating', 'failed')"


def upgrade() -> None:
    op.execute("ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS entry_released_at timestamptz")
    op.execute("ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS export_downloaded_at timestamptz")
    op.execute("UPDATE change_requests SET export_downloaded_at = now() WHERE entry_fingerprint IS NOT NULL "
               "AND status = 'approved' AND export IS NOT NULL")
    op.execute("DROP INDEX IF EXISTS uq_change_requests_entry_open")
    op.execute("CREATE UNIQUE INDEX uq_change_requests_entry_open ON change_requests (tenant_id, entry_fingerprint) "
               f"WHERE entry_fingerprint IS NOT NULL AND entry_released_at IS NULL AND status IN {OPEN}")
    op.execute("CREATE INDEX IF NOT EXISTS ix_change_requests_entry_latest ON change_requests "
               "(tenant_id, entry_fingerprint, created_at DESC) WHERE entry_fingerprint IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_change_requests_entry_latest")
    op.execute("DROP INDEX IF EXISTS uq_change_requests_entry_open")
    op.execute("UPDATE change_requests r SET entry_fingerprint = NULL WHERE r.entry_released_at IS NOT NULL "
               f"AND r.status IN {OPEN} AND EXISTS (SELECT 1 FROM change_requests o WHERE o.tenant_id = r.tenant_id "
               f"AND o.entry_fingerprint = r.entry_fingerprint AND o.id <> r.id AND o.status IN {OPEN})")
    op.execute("CREATE UNIQUE INDEX uq_change_requests_entry_open ON change_requests (tenant_id, entry_fingerprint) "
               f"WHERE entry_fingerprint IS NOT NULL AND status IN {OPEN}")
    op.execute("ALTER TABLE change_requests DROP COLUMN IF EXISTS export_downloaded_at")
    op.execute("ALTER TABLE change_requests DROP COLUMN IF EXISTS entry_released_at")

"""change_request_entry_fingerprint: one open change request per candidate record opened from the entry gate

Revision ID: 137
Revises: 136
Create Date: 2026-11-05

The entry gate (POST /api/v1/dq-firewall/validate with route_to_steward) opens a change request for a blocked or
warned candidate. A hook retries and a person saves again, so the same candidate must find the request that is
already open instead of opening a second. ``entry_fingerprint`` is an HMAC (keyed by the tenant secret) of the module
and the candidate's content; the candidate is customer master data and may be personal, so the content itself is never
stored in the column. A partial unique index allows one open request per fingerprint, whatever the timing of two
calls. Once the request is rejected, cancelled, created or failed it leaves the index and the same candidate may open
a new one. Requests not opened from the gate have no fingerprint and are not touched.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "137"
down_revision: Union[str, None] = "136"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS entry_fingerprint text")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_change_requests_entry_open ON change_requests "
               "(tenant_id, entry_fingerprint) WHERE entry_fingerprint IS NOT NULL "
               "AND status IN ('draft', 'submitted', 'in_approval', 'approved', 'creating', 'failed')")
    op.execute("CREATE INDEX IF NOT EXISTS ix_change_requests_entry ON change_requests (tenant_id, created_at DESC) "
               "WHERE entry_fingerprint IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_change_requests_entry")
    op.execute("DROP INDEX IF EXISTS uq_change_requests_entry_open")
    op.execute("ALTER TABLE change_requests DROP COLUMN IF EXISTS entry_fingerprint")

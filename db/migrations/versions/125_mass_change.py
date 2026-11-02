"""mass change requests: one request, the same fields on many records

Revision ID: 125
Revises: 124
Create Date: 2026-11-02

change_requests.record_keys: the records of a mass change (a JSON list of SAP keys, at most 10,000 by the API).
change_request_field_changes.record_key: the record a field change belongs to (null for the request's own fields).
Both tables keep the row level security of migrations 120 and 124.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "125"
down_revision: Union[str, None] = "124"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS record_keys jsonb")
    op.execute("ALTER TABLE change_request_field_changes ADD COLUMN IF NOT EXISTS record_key text")
    op.execute("ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS ck_change_requests_kind")
    op.execute("ALTER TABLE change_requests ADD CONSTRAINT ck_change_requests_kind "
               "CHECK (kind IN ('create', 'change', 'mass_change'))")
    op.execute("ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS ck_change_requests_change_key")
    op.execute("ALTER TABLE change_requests ADD CONSTRAINT ck_change_requests_change_key "
               "CHECK (kind IN ('create', 'mass_change') OR object_key IS NOT NULL)")


def downgrade() -> None:
    op.execute("DELETE FROM change_requests WHERE kind = 'mass_change'")
    op.execute("ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS ck_change_requests_change_key")
    op.execute("ALTER TABLE change_requests ADD CONSTRAINT ck_change_requests_change_key "
               "CHECK (kind = 'create' OR object_key IS NOT NULL)")
    op.execute("ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS ck_change_requests_kind")
    op.execute("ALTER TABLE change_requests ADD CONSTRAINT ck_change_requests_kind CHECK (kind IN ('create', 'change'))")
    op.execute("ALTER TABLE change_request_field_changes DROP COLUMN IF EXISTS record_key")
    op.execute("ALTER TABLE change_requests DROP COLUMN IF EXISTS record_keys")

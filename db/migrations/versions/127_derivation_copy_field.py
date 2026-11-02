"""derivation rules can copy from another field

Revision ID: 127
Revises: 126
Create Date: 2026-11-03

request_derivations.source_field: copy this field of the request into target_field (SAP MDG derivation, copy from field).
Exactly one of value and source_field is set. RLS from 126 is untouched.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "127"
down_revision: Union[str, None] = "126"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE request_derivations ADD COLUMN IF NOT EXISTS source_field text")
    op.execute("ALTER TABLE request_derivations ALTER COLUMN value DROP NOT NULL")
    op.execute("ALTER TABLE request_derivations DROP CONSTRAINT IF EXISTS ck_request_derivations_one_action")
    op.execute("ALTER TABLE request_derivations ADD CONSTRAINT ck_request_derivations_one_action "
               "CHECK ((value IS NULL) <> (source_field IS NULL))")


def downgrade() -> None:
    op.execute("DELETE FROM request_derivations WHERE source_field IS NOT NULL")
    op.execute("ALTER TABLE request_derivations DROP CONSTRAINT IF EXISTS ck_request_derivations_one_action")
    op.execute("ALTER TABLE request_derivations ALTER COLUMN value SET NOT NULL")
    op.execute("ALTER TABLE request_derivations DROP COLUMN IF EXISTS source_field")

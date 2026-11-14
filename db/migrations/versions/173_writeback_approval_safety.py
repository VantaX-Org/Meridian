"""Write-back approval safety: frozen snapshot, system id, lifecycle and expiry

Revision ID: 173
Revises: 167
Create Date: 2026-11-13

write_back_log (single finding write-back): the submit stores the exact fix rows it asks approval for
(record_fixes) with their sha256 and the SAP system id. Approval claims the row with a conditional UPDATE on
status 'pending' and runs only that snapshot against the system it names. A request expires at expires_at, can be
rejected with a reason, and is 'blocked' when the finding's live fixes no longer match the snapshot.

remediation_batches.approved_sha256: hash of the batch items at approval; a send whose items differ is refused.

writeback_run_records.based_on: per changed field, the value the fix was based on. The worker reads the current SAP
value first and skips the record as stale (state 'stale') when it differs.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "173"
down_revision: Union[str, None] = "167"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # rejected_by / rejected_at / reject_reason belong to 167
    for col in ("system_id uuid", "record_fixes jsonb", "fixes_sha256 text",
                "status text NOT NULL DEFAULT 'pending'", "expires_at timestamptz"):
        op.execute(f"ALTER TABLE write_back_log ADD COLUMN IF NOT EXISTS {col}")
    # rows already decided keep their meaning
    op.execute("UPDATE write_back_log SET status = 'approved' WHERE approved_by IS NOT NULL")
    op.execute("UPDATE write_back_log SET status = 'dry_run' WHERE dry_run AND approved_by IS NULL")
    op.execute("UPDATE write_back_log SET status = 'rejected' WHERE rejected_at IS NOT NULL AND NOT dry_run "
               "AND approved_by IS NULL")
    op.execute("ALTER TABLE write_back_log ADD CONSTRAINT ck_write_back_log_status CHECK "
               "(status IN ('pending', 'approved', 'rejected', 'blocked', 'expired', 'dry_run'))")
    op.execute("ALTER TABLE remediation_batches ADD COLUMN IF NOT EXISTS approved_sha256 text")
    op.execute("ALTER TABLE writeback_run_records ADD COLUMN IF NOT EXISTS based_on jsonb")
    op.execute("ALTER TABLE writeback_run_records DROP CONSTRAINT IF EXISTS writeback_run_records_state_check")
    op.execute("ALTER TABLE writeback_run_records ADD CONSTRAINT writeback_run_records_state_check CHECK "
               "(state IN ('pending', 'sending', 'committed', 'failed', 'needs_check', 'export_only', 'stale'))")


def downgrade() -> None:
    op.execute("UPDATE writeback_run_records SET state = 'failed' WHERE state = 'stale'")
    op.execute("ALTER TABLE writeback_run_records DROP CONSTRAINT IF EXISTS writeback_run_records_state_check")
    op.execute("ALTER TABLE writeback_run_records ADD CONSTRAINT writeback_run_records_state_check CHECK "
               "(state IN ('pending', 'sending', 'committed', 'failed', 'needs_check', 'export_only'))")
    op.execute("ALTER TABLE writeback_run_records DROP COLUMN IF EXISTS based_on")
    op.execute("ALTER TABLE remediation_batches DROP COLUMN IF EXISTS approved_sha256")
    op.execute("ALTER TABLE write_back_log DROP CONSTRAINT IF EXISTS ck_write_back_log_status")
    for col in ("expires_at", "status", "fixes_sha256",
                "record_fixes", "system_id"):
        op.execute(f"ALTER TABLE write_back_log DROP COLUMN IF EXISTS {col}")

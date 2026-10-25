"""indexes for the lead's work analytics (api/services/work_analytics.py)

Revision ID: 087
Revises: 086
Create Date: 2026-10-25

The analytics read windows of events and fixes, never a whole history row by row:

  * ``record_issue_events (tenant_id, action, created_at)``: the decisions of the last 30 days and the
    'reopened' events of the burn-down. The only index was ``(issue_id, created_at)``, so a window by
    tenant walked every event.
  * ``record_issues (tenant_id, resolved_at) WHERE resolved_at IS NOT NULL``: time to fix over the issues
    fixed in a window, and "fixed this week".
  * ``remediation_events (tenant_id, action, created_at)``: approvals per day.

Additive and read-only, ``IF NOT EXISTS`` guarded, no new tables (so no new RLS policy).
"""
from collections.abc import Sequence

from alembic import op

revision: str = "087"
down_revision: str | None = "086"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_record_issue_events_tenant_action "
               "ON record_issue_events (tenant_id, action, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_record_issues_resolved "
               "ON record_issues (tenant_id, resolved_at) WHERE resolved_at IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_remediation_events_tenant_action "
               "ON remediation_events (tenant_id, action, created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_remediation_events_tenant_action")
    op.execute("DROP INDEX IF EXISTS ix_record_issues_resolved")
    op.execute("DROP INDEX IF EXISTS ix_record_issue_events_tenant_action")

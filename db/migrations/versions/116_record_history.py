"""record history: index one record's rows across runs

Revision ID: 116
Revises: 115
Create Date: 2026-10-29

GET /work/records/{module}/{key}/history reads one record across every run. Every existing index of the tables it
reads leads with the run (work_records: (version_id, module, record_key), (tenant_id, version_id, ...)) or with the
system scope (record_issues: (tenant_id, scope, check_id, record_key); remediation_items: (tenant_id, scope, check_id)),
so without these the history of one record is a scan of the tenant's rows of every run. finding_records already has
(tenant_id, record_key).
"""
from collections.abc import Sequence

from alembic import op

revision: str = "116"
down_revision: str | None = "115"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_work_records_history", "work_records", ["tenant_id", "module", "record_key"])
    op.create_index("ix_record_issues_record", "record_issues", ["tenant_id", "module", "record_key"])
    op.create_index("ix_remediation_items_record", "remediation_items", ["tenant_id", "module", "record_key"])


def downgrade() -> None:
    op.drop_index("ix_remediation_items_record", table_name="remediation_items")
    op.drop_index("ix_record_issues_record", table_name="record_issues")
    op.drop_index("ix_work_records_history", table_name="work_records")

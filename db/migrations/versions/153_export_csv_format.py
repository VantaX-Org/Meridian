"""export_csv_format: report files and schedules may be csv

Revision ID: 153
Revises: 152
Create Date: 2026-11-11

The export centre (api/services/export_centre.py) writes findings, failing records, cleansing proposals,
changes, score history, the rule catalogue and the audit log as csv as well as xlsx, json and pdf, and a
schedule may deliver any of them. Widens the two format checks from migration 089.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "153"
down_revision: Union[str, None] = "152"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = (("report_files", "ck_report_files_format"), ("report_schedules", "ck_report_schedules_format"))


def _formats(table: str, name: str, formats: str) -> None:
    op.drop_constraint(name, table, type_="check")
    op.create_check_constraint(name, table, f"format IN ({formats})")


def upgrade() -> None:
    for table, name in _TABLES:
        _formats(table, name, "'pdf', 'xlsx', 'json', 'csv'")


def downgrade() -> None:
    op.execute("DELETE FROM report_files WHERE format = 'csv'")
    op.execute("DELETE FROM report_schedules WHERE format = 'csv'")
    for table, name in _TABLES:
        _formats(table, name, "'pdf', 'xlsx', 'json'")

"""scheduled board pack: report_pack cadence on alert channels

Revision ID: 085
Revises: 084
Create Date: 2026-10-22

``report_pack`` is how often an email alert channel receives the board pack (and the analyst
workbook) for the tenant's latest finished run: off (default), weekly or monthly. It is only
read for kind = 'email'; the API rejects any other value for the other kinds.

``report_pack_key`` is the idempotency key of the last pack sent to the channel
(``<cadence>:<period>:<run id>``). The sender claims the key with a single UPDATE before it
sends, so a beat task fired twice in one period delivers once. Additive, no data changes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "085"
down_revision: Union[str, None] = "084"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("alert_channels", sa.Column("report_pack", sa.Text(), nullable=False, server_default="off"))
    op.add_column("alert_channels", sa.Column("report_pack_key", sa.Text(), nullable=True))
    op.create_check_constraint("ck_alert_channels_report_pack", "alert_channels",
                               "report_pack IN ('off', 'weekly', 'monthly')")


def downgrade() -> None:
    op.drop_constraint("ck_alert_channels_report_pack", "alert_channels", type_="check")
    op.drop_column("alert_channels", "report_pack_key")
    op.drop_column("alert_channels", "report_pack")

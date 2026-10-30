"""sap_systems: extraction_path and read_function, per system

Revision ID: 118
Revises: 117
Create Date: 2026-10-30

How an ABAP system's tables are read (sap/extraction_plan.py EXTRACTION_PATHS):
``extraction_path`` is table_reader (the default, as before), odp (ODP providers through RODPS_REPL_ODP_*, the table
reader for unmapped tables), odata (S/4HANA on premise through its Gateway's released OData APIs) or auto (ODP where
the functions exist and a provider covers the rules' fields). ``read_function`` names the table reader
(RFC_READ_TABLE, /BODS/RFC_READ_TABLE2, BBP_RFC_READ_TABLE or auto); NULL keeps MERIDIAN_RFC_READ_FUNCTION.
Both were deployment-wide environment settings until now; Basis teams decide them per system.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "118"
down_revision: str | None = "117"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sap_systems", sa.Column("extraction_path", sa.Text(), nullable=False,
                                           server_default="table_reader"))
    op.add_column("sap_systems", sa.Column("read_function", sa.Text(), nullable=True))
    op.create_check_constraint("ck_sap_systems_extraction_path", "sap_systems",
                               "extraction_path IN ('table_reader', 'odp', 'odata', 'auto')")
    op.create_check_constraint(
        "ck_sap_systems_read_function", "sap_systems",
        "read_function IS NULL OR read_function IN ('RFC_READ_TABLE', '/BODS/RFC_READ_TABLE2', "
        "'BBP_RFC_READ_TABLE', 'auto')")


def downgrade() -> None:
    op.drop_constraint("ck_sap_systems_read_function", "sap_systems", type_="check")
    op.drop_constraint("ck_sap_systems_extraction_path", "sap_systems", type_="check")
    op.drop_column("sap_systems", "read_function")
    op.drop_column("sap_systems", "extraction_path")

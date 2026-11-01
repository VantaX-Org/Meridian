"""Migration 122: finding_records and record_issues carry a jsonb context; RLS stays forced.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database migrated to head); skipped otherwise.
"""

from __future__ import annotations

from sqlalchemy import Engine, text

from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (owner is a module-scoped fixture)


def test_context_columns_are_jsonb_and_rls_still_forced(owner: Engine) -> None:
    with owner.connect() as c:
        cols = dict(c.execute(text(
            "SELECT table_name, data_type FROM information_schema.columns "
            "WHERE column_name = 'context' AND table_name IN ('finding_records', 'record_issues')")).fetchall())
        forced = dict(c.execute(text(
            "SELECT relname, relforcerowsecurity FROM pg_class "
            "WHERE relname IN ('finding_records', 'record_issues') AND relkind = 'r'")).fetchall())
    assert cols == {"finding_records": "jsonb", "record_issues": "jsonb"}
    assert forced == {"finding_records": True, "record_issues": True}

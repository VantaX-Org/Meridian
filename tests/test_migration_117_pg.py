"""Migration 117: system_update_log forces RLS (D-07); share links store root routes (D-02).

Runs with MERIDIAN_TEST_DB_URL (a throwaway database migrated to head); skipped otherwise.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (owner is a module-scoped fixture)

TENANT = "00000000-0000-0000-0000-0000000001a7"


def test_system_update_log_and_share_links_force_rls(owner: Engine) -> None:
    with owner.connect() as c:
        forced = dict(c.execute(text(
            "SELECT relname, relforcerowsecurity FROM pg_class "
            "WHERE relname IN ('system_update_log', 'share_links') AND relkind = 'r'")).fetchall())
    assert forced == {"system_update_log": True, "share_links": True}


@pytest.mark.parametrize("route,ok", [("/", True), ("/o/ecc/material-master", True), ("/v2/o/x", True),
                                      ("o/x", False), ("https://example.test/", False)])
def test_share_link_route_constraint_takes_root_routes(owner: Engine, route: str, ok: bool) -> None:
    with owner.connect() as c:
        tx = c.begin()
        try:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'mig117') ON CONFLICT (id) DO NOTHING"),
                      {"t": TENANT})
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": TENANT})
            stmt = text("INSERT INTO share_links (tenant_id, token_hash, route, created_by, expires_at) "
                        "VALUES (:t, md5(random()::text), :r, 'x', now() + interval '1 day')")
            if ok:
                c.execute(stmt, {"t": TENANT, "r": route})
            else:
                with pytest.raises(IntegrityError):
                    c.execute(stmt, {"t": TENANT, "r": route})
        finally:
            tx.rollback()

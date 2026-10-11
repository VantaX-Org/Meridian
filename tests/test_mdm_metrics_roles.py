"""viewer and process_analyst get the restricted (empty) MDM views; others do not."""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request

from api.routes import mdm_metrics


def _call(fn, role: str, **kw: object) -> object:
    async def run() -> object:
        mdm_metrics._get_user_role = AsyncMock(return_value=role)  # type: ignore[assignment]
        db = MagicMock()
        db.execute = AsyncMock(side_effect=RuntimeError("queried"))
        tenant = SimpleNamespace(id=uuid.uuid4())
        return await fn(request=MagicMock(spec=Request), tenant=tenant, db=db, role=role, **kw)
    orig = mdm_metrics._get_user_role
    try:
        return asyncio.run(run())
    finally:
        mdm_metrics._get_user_role = orig  # type: ignore[assignment]


@pytest.mark.parametrize("role", ["viewer", "process_analyst"])
def test_restricted_roles_get_empty_views(role: str) -> None:
    assert role in mdm_metrics.RESTRICTED_ROLES
    assert _call(mdm_metrics.get_mdm_dashboard, role) == mdm_metrics.MdmDashboardResponse()
    assert _call(mdm_metrics.get_mdm_history, role, days=90, domain=None) == mdm_metrics.MdmHistoryResponse()


def test_other_roles_reach_the_queries() -> None:
    with pytest.raises(RuntimeError, match="queried"):
        _call(mdm_metrics.get_mdm_dashboard, "analyst")

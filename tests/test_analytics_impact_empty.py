"""GET /analytics/impact with no finished run: the ROI has nulls where nothing can be computed, never zeros."""

import uuid

import pytest

import api.routes.analytics as analytics
from api.deps import Tenant


class _Res:
    def first(self):
        return None


class _DB:
    async def execute(self, stmt, params=None):
        return _Res()


@pytest.mark.asyncio
async def test_empty_impact_roi_matches_calculate_roi():
    out = await analytics.get_impact_analytics(version_id=None, db=_DB(), tenant=Tenant(uuid.uuid4(), "T", []))
    assert out["impacts"] == []
    assert out["roi"] == analytics.impact_analytics.calculate_roi([], None)
    assert out["roi"]["roi_multiple"] is None and out["roi"]["payback_months"] is None
    assert out["roi"]["subscription_annual"] is None

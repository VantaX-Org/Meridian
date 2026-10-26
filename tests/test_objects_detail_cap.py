"""GET /objects/{module} carries the score cap (no database needed)."""
import uuid

import pytest


@pytest.mark.anyio
async def test_object_detail_carries_the_score_cap(monkeypatch):
    """GET /objects/{module} returns the cap dqs_summary records, so the score explainer can name it."""
    from types import SimpleNamespace

    from api.routes import objects as objects_routes

    summary = {"material_master": {"composite_score": 70.0, "raw_score": 82.4, "capped": True,
                                   "cap_reason": "MM001: material type missing — score capped at 70",
                                   "dimension_scores": {"completeness": 80.0}}}

    async def _no_rls(db, tenant):  # noqa: ANN001, ANN202
        return None

    async def _summary(db, tenant, run_id):  # noqa: ANN001, ANN202
        return summary, {}

    class _Rows:
        def fetchall(self) -> list:
            return [("MM001", "critical", "completeness", 4, 100, 96.0)]

    class _Db:
        async def execute(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN202
            return _Rows()

    monkeypatch.setattr(objects_routes, "_rls", _no_rls)
    monkeypatch.setattr(objects_routes, "_version_summary", _summary)
    monkeypatch.setattr(objects_routes, "tier", lambda score, thresholds: "no_go")
    body = await objects_routes.get_object("material_master", run=uuid.uuid4(), db=_Db(),
                                           tenant=SimpleNamespace(id=uuid.uuid4()))
    assert body["capped"] is True
    assert body["cap_reason"].startswith("MM001")
    assert body["raw_score"] == 82.4
    assert objects_routes.ObjectDetailOut(**body).capped is True
    summary["material_master"].pop("capped")
    summary["material_master"].pop("cap_reason")
    body = await objects_routes.get_object("material_master", run=uuid.uuid4(), db=_Db(),
                                           tenant=SimpleNamespace(id=uuid.uuid4()))
    assert body["capped"] is False and body["cap_reason"] is None

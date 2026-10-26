"""Conformance "extra" activities (process-discovery spec §3.5): computed in mining, returned by the API.

An extra activity is one the cases perform that the case type's mapping does not name. Mapped optional steps
(a PO change) are not extra, and the "other" variant bucket names no activity, so it adds nothing.
"""

from __future__ import annotations

import hashlib
import uuid
from types import SimpleNamespace

import pytest

from api.services.process_discovery.builders import builder
from api.services.process_discovery.mining import (
    OTHER, OTHER_HASH, CaseTypeResult, Conformance, Variant, conformance,
)

PTP = [m for m in builder("PTP").MAPPING if m.case_type == "po_item"]
HAPPY = ("CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE")


def _v(acts: tuple[str, ...], n: int, h: str = "") -> Variant:
    return Variant(h or hashlib.md5(">".join(acts).encode()).hexdigest(), acts, n, 0.0, None, None, ("c",))


def test_extra_counts_cases_per_unmapped_activity() -> None:
    vs = [
        _v(HAPPY, 5),
        _v((*HAPPY[:2], "ZZ_MANUAL_FIX", *HAPPY[2:]), 3),
        _v((*HAPPY, "ZZ_MANUAL_FIX", "ZZ_MANUAL_FIX", "YY_REVERSAL"), 2),  # a repeat counts the case once
        _v(("CREATE_PR", "CREATE_PO_ITEM", "CHANGE_PO_QTY", *HAPPY[1:]), 4),  # mapped optional steps: not extra
        _v((OTHER,), 7, OTHER_HASH),
    ]
    c = conformance(vs, PTP)
    assert c.extra == {"ZZ_MANUAL_FIX": 5, "YY_REVERSAL": 2}
    assert list(c.extra) == ["ZZ_MANUAL_FIX", "YY_REVERSAL"]  # most cases first


def test_no_reference_means_no_extra() -> None:
    assert conformance([_v(("ZZ",), 2)], []) == Conformance(None, {}, {}, {})
    assert conformance([_v(("ZZ",), 2)], []).extra == {}


def test_conformance_route_returns_extra_with_share(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_discovery as route

    tenant_id = uuid.uuid4()
    seen: list[str] = []

    async def _run(db, tenant, run_id):  # noqa: ANN001, ANN202
        assert tenant.id == tenant_id  # the run is read under the caller's tenant
        seen.append(run_id)
        return SimpleNamespace(id=run_id, l1="PTP", system_type="ecc", system_id=str(uuid.uuid4()), tz="UTC")

    result = CaseTypeResult("po_item", cases=10, events=40, median_seconds=None, p90_seconds=None, edges=[],
                            activities={}, variants=[_v(HAPPY, 8), _v((*HAPPY, "ZZ_MANUAL_FIX"), 2)])
    result.conformance = conformance(result.variants, PTP)

    async def _mine(db, tenant, run, flt, case_type):  # noqa: ANN001, ANN202
        return result

    monkeypatch.setattr(route, "_run", _run)
    monkeypatch.setattr(route, "_mine", _mine)
    app = FastAPI()
    app.include_router(route.router)

    async def _db():  # noqa: ANN202
        yield None

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(tenant_id, "T", [])
    c = TestClient(app, headers={"X-User-Role": "viewer"})
    rid = str(uuid.uuid4())
    r = c.get(f"/api/v1/process-discovery/runs/{rid}/conformance")
    assert r.status_code == 200, r.text
    assert r.json()["extra"] == [{"activity": "ZZ_MANUAL_FIX", "cases": 2, "share": 0.2}]
    assert seen == [rid]


def test_extra_helper_handles_an_empty_view() -> None:
    from api.routes.process_discovery import _extra

    assert _extra({"A": 3}, 0)[0].share == 0.0
    assert [e.activity for e in _extra({"B": 1, "A": 1, "C": 4}, 6)] == ["C", "A", "B"]

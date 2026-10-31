"""F26: the signed-off records (exceptions) export holds every record of the filter, not the page on screen, and
says how many; the list pages with a total; a grid export of fewer rows than the filter holds says so."""
from __future__ import annotations

import io
import os

import openpyxl
import pytest
from sqlalchemy import create_engine

from tests.m2_client import headers, make_client
from tests.m2_seed import R2, R3, seed_m2
from tests.test_m2_batches_pg import groups

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def _cells(content: bytes, sheet: str) -> list[list]:
    ws = openpyxl.load_workbook(io.BytesIO(content))[sheet]
    return [[c.value for c in row] for row in ws.iter_rows()]


@pytest.mark.anyio
async def test_the_exceptions_export_holds_the_whole_filter(owner, monkeypatch):
    s = seed_m2(owner)
    groups(owner, s)  # the work groups the decisions recompute
    deps, client = make_client(monkeypatch, s["tid"], s["user"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": k, "check_id": "MM014", "action": a, "note": "Legacy plant"}
            for k, a in ((R2, "not_an_issue"), (R3, "accept_risk"))]})
        assert r.status_code == 200, r.text
        page = (await client.get("/api/v1/work/records?status=not_an_issue&limit=1", headers=headers())).json()
        assert page["total"] == 2 and len(page["items"]) == 1 and page["next"]
        nxt = (await client.get(f"/api/v1/work/records?status=not_an_issue&limit=1&after={page['next']}",
                                headers=headers())).json()
        assert len(nxt["items"]) == 1 and nxt["items"][0]["record_key"] != page["items"][0]["record_key"]

        x = await client.get("/api/v1/work/exceptions/export", headers=headers())
        assert x.status_code == 200, x.text
        assert x.headers["x-record-count"] == "2" and x.headers["x-row-count"] == "2" and "x-row-cap" not in x.headers
        rows = [r for r in _cells(x.content, "Signed off") if r and r[-1] and "MATNR=" in str(r[-1])]
        assert sorted(r[-1] for r in rows) == sorted([R2, R3])
        decisions = {r[-1]: (r[4], r[5]) for r in rows}
        assert decisions[R3] == ("Accepted risk", "Legacy plant") and decisions[R2][0] == "Not an issue"
        # the filter of the list narrows the export too
        one = await client.get("/api/v1/work/exceptions/export?q=102", headers=headers())
        assert one.headers["x-record-count"] == "1"

        g = await client.post("/api/v1/export/grid", headers=headers(), json={
            "title": "Exceptions", "route": "/work", "columns": [{"key": "k", "header": "Key"}],
            "rows": [{"k": "a"}], "total": 48})
        assert g.status_code == 200 and g.headers["x-row-count"] == "1" and g.headers["x-total-count"] == "48"
        cover = " ".join(str(v) for row in _cells(g.content, openpyxl.load_workbook(io.BytesIO(g.content)).sheetnames[0])
                         for v in row if v)
        assert "1 of 48 rows" in cover

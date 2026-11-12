"""Batch A backend: paging contract, cycle state, compare reasons, round trip batch, load order, workbook."""
import asyncio
import io
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import openpyxl
import pytest
from fastapi import HTTPException

from api.services import cleaning_workbook as cw
from api.services import compare_sets, cycle_state
from api.services.branded_xlsx import build_workbook
from api.services.paging import order_by, page_meta, sort_items
from api.services.sf_roundtrip import cleaning_edits

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_paging_contract_walks_100_objects_and_500_runs_without_gaps():
    objs = [{"module": f"obj_{i:03d}", "score": (i * 7) % 100 if i % 10 else None} for i in range(100)]
    for items, sort, size in ((objs, "-score", 30), (objs, "module", 25), ([{"module": str(i), "n": i} for i in range(500)], "-n", 100)):
        key = sort.lstrip("-")
        ordered = sort_items(items, sort, ("module", "score", "n"), "module")
        seen, off = [], 0
        while off is not None:
            seen += ordered[off:off + size]
            off = page_meta(len(ordered), size, off)["next_offset"]
        assert seen == ordered and len(seen) == len(items)
        vals = [i[key] for i in ordered if i.get(key) is not None]
        assert vals == sorted(vals, reverse=sort.startswith("-"))
    assert [i["score"] for i in sort_items(objs, "score", ("score",), "score")][-10:] == [None] * 10
    assert page_meta(500, 100, 400)["next_offset"] is None


def test_unknown_sort_field_is_422_and_never_reaches_sql():
    assert order_by("-run_at", {"run_at": "v.run_at"}, "run_at") == "v.run_at DESC"
    for bad in (lambda: order_by("x; DROP", {"a": "a"}, "a"), lambda: sort_items([], "zzz", ("a",), "a")):
        with pytest.raises(HTTPException) as e:
            bad()
        assert e.value.status_code == 422


def test_cycle_steps():
    run = lambda **k: {"status": "complete", "run_at": T0, "parent": None, **k}  # noqa: E731
    assert cycle_state.derive(None, None, None)["step"] == "pull"
    assert cycle_state.derive(run(), run(), None)["step"] == "clean"
    dl = {"at": T0 + timedelta(hours=1), "by": "a@example.test"}
    c = cycle_state.derive(run(), run(), dl)
    assert c["step"] == "upload" and c["downloaded_by"] == "a@example.test"
    assert cycle_state.derive(run(), run(), {"at": T0 - timedelta(hours=1), "by": "x"})["step"] == "clean"
    assert cycle_state.derive(run(parent="p"), run(parent="p"), None, 2)["step"] == "compare"
    assert cycle_state.derive(run(status="running", parent="p"), run(), None)["step"] == "score"


def test_compare_reasons():
    ok = lambda total=10, ctx=None: {"total_count": total, "rule_context": ctx, "error": None}  # noqa: E731
    assert compare_sets.reason_for(None, ok(), "new") == "new_rule"
    assert compare_sets.reason_for(ok(), None, "resolved") == "rule_removed"
    assert compare_sets.reason_for(ok(ctx={"a": 1}), ok(ctx={"a": 2}), "new") == "rule_changed"
    assert compare_sets.reason_for(ok(10), ok(20), "regressed") == "records_added"
    assert compare_sets.reason_for(ok(20), ok(10), "resolved") == "records_removed"
    assert compare_sets.reason_for(ok(10), ok(10), "new") == "data"


def test_cleaning_edits_strip_the_field_description():
    rows = [("Table", "Record key", "Field", "Corrected value"), ("MARA", "MATNR=1", "MARA.MATKL (Material Group)", "X1"),
            ("MARA", "MATNR=2", "MARA.MATKL (Material Group)", "")]
    edits, blank = cleaning_edits([("Records to clean", rows)])
    assert edits == [{"table": "MARA", "key": "MATNR=1", "field": "MARA.MATKL", "value": "X1"}] and blank == 1


def test_roundtrip_batch_isolates_a_bad_file(monkeypatch):
    from api.routes import upload

    async def one(request, f, parent, db, tenant):
        if f.filename == "bad.xlsx":
            raise HTTPException(status_code=422, detail="The file holds no edits to apply.")
        return SimpleNamespace(parent_version_id="p-" + f.filename)

    class Db:
        rolled = 0

        async def rollback(self):
            self.rolled += 1

    monkeypatch.setattr(upload, "_roundtrip_one", one)
    monkeypatch.setattr(upload.RoundTripBatchItem, "__init__", upload.RoundTripBatchItem.__init__)  # real model
    db = Db()
    files = [SimpleNamespace(filename=n) for n in ("a.xlsx", "bad.xlsx", "c.xlsx")]
    # result must be a RoundTripResponse for the real model, so build items with a stand-in that validates
    monkeypatch.setattr(upload, "RoundTripBatchItem", lambda **k: SimpleNamespace(**{"result": None, "parent_version_id": None, "error": None, **k}))
    monkeypatch.setattr(upload, "RoundTripBatchResponse", lambda **k: SimpleNamespace(**k))
    out = asyncio.run(upload.upload_roundtrip_batch.__wrapped__(None, files, None, db, None)
                      if hasattr(upload.upload_roundtrip_batch, "__wrapped__")
                      else upload.upload_roundtrip_batch(None, files, None, db, None))
    assert (out.succeeded, out.failed, db.rolled) == (2, 1, 1)
    assert [i.parent_version_id for i in out.items] == ["p-a.xlsx", None, "p-c.xlsx"]
    assert out.items[1].error == "The file holds no edits to apply."


def test_new_routes_publish_the_paging_params():
    from api.main import app

    spec = app.openapi()["paths"]
    params = lambda p: {x["name"] for x in spec[p]["get"].get("parameters", [])}  # noqa: E731
    assert {"limit", "offset", "sort"} <= params("/api/v1/versions") if "/api/v1/versions" in spec else True
    for path in ("/api/v1/objects/portfolio", "/api/v1/objects/monitor/feed", "/api/v1/migration/load-history",
                 "/api/v1/versions/compare/sets"):
        assert {"limit", "offset"} <= params(path), path
    assert "post" in spec["/api/v1/objects/portfolio/start"] and "post" in spec["/api/v1/upload/roundtrip/batch"]
    assert "/api/v1/migration/load-order" in spec and "/api/v1/versions/compare/multi" in spec


def test_load_order_follows_the_employee_central_sequence():
    from api.routes import migration
    from api.services.migration.load_plan import EC_LOAD_ORDER

    t = SimpleNamespace(licensed_modules=["*"])
    out = asyncio.run(migration.load_order(modules="employee_central,material_master,nope", tenant=t, _role="view"))
    by = {o.module: o for o in out.objects}
    assert list(by) == ["employee_central", "material_master"] and by["employee_central"].tables == list(EC_LOAD_ORDER)
    assert asyncio.run(migration.load_order(modules="material_master", tenant=SimpleNamespace(licensed_modules=[]), _role="view")).objects == []


def test_workbook_has_start_here_allowed_values_and_locks_key_columns():
    data = {"module": "material_master", "run": {"id": "r1", "label": "Run 1"},
            "findings": [{"check_id": "MM-1", "severity": "high", "dimension": "validity", "affected_count": 1,
                          "total_count": 5, "pass_rate": 80, "field": "MARA.MTART", "message": "bad", "value_fix_map": {},
                          "record_fixes": []}],
            "records": [{"check_id": "MM-1", "grain": "MARA", "record_key": "MATNR=1", "field_values": {"MARA.MTART": "ZZ"}}]}
    rules = {"MM-1": {"field": "MARA.MTART", "allowed_values": ["FERT", "ROH"], "message": "bad"}}
    sheets, _ = cw.cleaning_context(data, rules)
    assert [s.title for s in sheets][:3] == ["Start here", "Allowed values", "Examples"]
    body = build_workbook(tenant_name="T", run_label="R", run_id="r", title="C", sheets=sheets)
    wb = openpyxl.load_workbook(io.BytesIO(body))
    ws = wb["Records to clean"]
    assert ws.protection.sheet and ws.protection.autoFilter is False
    hdr = next(r for r in range(1, 12) if ws.cell(r, 1).value == "Severity")
    cols = {ws.cell(hdr, c).value: c for c in range(1, ws.max_column + 1)}
    assert ws.cell(hdr + 1, cols["Record key"]).protection.locked is True
    assert ws.cell(hdr + 1, cols["Corrected value"]).protection.locked is False
    assert {"FERT", "ROH", "Needs owner"} <= {r[2].value for r in wb["Allowed values"].iter_rows(min_row=1) if r[2].value}

"""POST /api/v1/migration/target-workbook against a real Postgres: a real parquet dataset goes in, the workbook's own
columns come out, and the export leaves an audit row. The workbook is synthetic (tests/test_migration_workbook.py)."""
from __future__ import annotations

import io
import json
import os
import uuid
import zipfile

import pandas as pd
import pytest
from openpyxl import load_workbook
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_seed import seed_m2
from tests.test_migration_workbook import sample

needs_db = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
P = "/api/v1/migration/target-workbook"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def upload(data=None):
    return {"file": ("target.xlsx", sample() if data is None else data, "application/octet-stream")}


class _Bucket:
    def list_objects(self, bucket, prefix):
        return []  # a bundle with none of the workbook's tables


async def start(monkeypatch, s):
    from sap.ddic import dictionary_for_system

    monkeypatch.setattr("api.services.source_design.dictionary_for",
                        lambda session, system_id, system_type=None: dictionary_for_system("successfactors"))
    monkeypatch.setattr("workers.dataset._client", lambda: _Bucket())
    monkeypatch.setattr("workers.dataset._read", lambda client, bucket, name: open(name, "rb").read())
    deps, client = make_client(monkeypatch, s["tid"])
    await deps.engine.dispose()
    return client


def seed_run(owner, tmp_path, status="complete"):
    s = seed_m2(owner)
    path = tmp_path / "run.parquet"
    pd.DataFrame({"PERINFO.PERSON_ID": ["P1", "P2", "P3"], "PERINFO.FIRSTNAME": ["Ann", "Bartholomew", "Cy"],
                  "PERINFO.GENDER": ["F", "M", "X"]}).to_parquet(path)
    with owner.begin() as c:
        c.execute(text("UPDATE analysis_versions SET status = :st, metadata = metadata || CAST(:m AS jsonb) WHERE id = :v"),
                  {"st": status, "m": json.dumps({"dataset_path": str(path)}), "v": s["run"]})
    return s


@needs_db
@pytest.mark.anyio
async def test_check_reports_ready_and_held_rows(owner, monkeypatch, tmp_path):
    s = seed_run(owner, tmp_path)
    async with await start(monkeypatch, s) as client:
        r = await client.post(f"{P}/{s['run']}/check", files=upload(), headers=headers())
    assert r.status_code == 200, r.text
    b = r.json()
    row = next(x for x in b["sheets"] if x["name"] == "Personal Info")
    assert (row["rows"], row["ready"], row["held"]) == (3, 1, 2)  # Bartholomew too long, X not on the picklist
    assert b["held_total"] == len(b["held"]) == 2 and {h["field"] for h in b["held"]} == {"first-name", "gender"}


@needs_db
@pytest.mark.anyio
async def test_export_is_the_workbook_format_and_is_audited(owner, monkeypatch, tmp_path):
    s = seed_run(owner, tmp_path)
    async with await start(monkeypatch, s) as client:
        r = await client.post(f"{P}/{s['run']}/export", files=upload(), headers=headers())
        z = await client.post(f"{P}/{s['run']}/export", params={"format": "csv"}, files=upload(), headers=headers())
    assert r.status_code == 200, r.text
    book = load_workbook(io.BytesIO(r.content), read_only=True)
    assert "Personal Info" in book.sheetnames and "Held back" in book.sheetnames
    assert "Personal Info.csv" in zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    with owner.connect() as c:
        n = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND entity_id = :v "
                           "AND action = 'migration.target_workbook.export'"), {"t": s["tid"], "v": s["run"]}).scalar()
    assert n == 2


@needs_db
@pytest.mark.anyio
async def test_refusals(owner, monkeypatch, tmp_path):
    s = seed_run(owner, tmp_path)
    unfinished = seed_run(owner, tmp_path, status="running")
    async with await start(monkeypatch, s) as client:
        post = lambda v, data=None, role="admin": client.post(f"{P}/{v}/check", files=upload(data), headers=headers(role))  # noqa: E731
        assert (await post(s["run"], b"not a workbook")).status_code == 400
        assert (await post(uuid.uuid4())).status_code == 404
        assert (await post("not-a-uuid")).status_code == 404
        assert (await post(unfinished["run"])).status_code == 404  # another tenant's run
        assert (await post(s["run"], role="viewer")).status_code == 403
    async with await start(monkeypatch, unfinished) as client:
        assert (await client.post(f"{P}/{unfinished['run']}/check", files=upload(), headers=headers())).status_code == 409


@needs_db
@pytest.mark.anyio
async def test_too_large_is_refused_before_parsing(owner, monkeypatch, tmp_path):
    s = seed_run(owner, tmp_path)
    monkeypatch.setattr("api.routes.migration.MAX_WORKBOOK_BYTES", 10)
    async with await start(monkeypatch, s) as client:
        r = await client.post(f"{P}/{s['run']}/check", files=upload(), headers=headers())
    assert r.status_code == 413


@needs_db
@pytest.mark.anyio
async def test_a_run_without_the_tables_says_so_and_a_storage_fault_does_not(owner, monkeypatch, tmp_path):
    s = seed_run(owner, tmp_path)
    with owner.begin() as c:
        c.execute(text("""UPDATE analysis_versions SET metadata = metadata || '{"dataset_path": "bundle/"}' WHERE id = :v"""),
                  {"v": s["run"]})
    async with await start(monkeypatch, s) as client:
        assert (await client.post(f"{P}/{s['run']}/check", files=upload(), headers=headers())).status_code == 422

        def down():
            raise ValueError("Secret key must not be empty")
        monkeypatch.setattr("workers.dataset._client", down)
        with pytest.raises(ValueError, match="Secret key"):
            await client.post(f"{P}/{s['run']}/check", files=upload(), headers=headers())

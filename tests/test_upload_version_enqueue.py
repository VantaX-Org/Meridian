"""Upload: the version row is created under the tenant's RLS context after its commit,
and a failed enqueue of the checks task never leaves the version ``pending``.

``create_version`` commits (which hands the session's connection back to the pool) and then
refreshes: the refresh may land on a connection where ``app.tenant_id`` is '' and the RLS
policy's ``::uuid`` cast raises. The tenant must be set again on the session right before
the refresh. Fake async session in the style of tests/test_preferences.py."""

import uuid

import pytest
from fastapi import HTTPException

from db.queries.versions import create_version, mark_version_failed

TID = uuid.uuid4()


class _DB:
    """Records the order of execute / commit / refresh calls."""

    def __init__(self, fail_refresh_without_tenant: bool = True):
        self.calls: list[tuple] = []
        self.tenant_set: str | None = None  # the session-level app.tenant_id as Postgres would hold it
        self.fail_refresh_without_tenant = fail_refresh_without_tenant

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append(("execute", sql, params))
        if sql.startswith("SELECT set_config('app.tenant_id'"):
            self.tenant_set = params["tid"]
        return None

    def add(self, obj):
        self.calls.append(("add", obj))

    async def commit(self):
        self.calls.append(("commit",))
        # The pool may hand the next statement another connection without the setting.
        self.tenant_set = None

    async def refresh(self, obj):
        self.calls.append(("refresh", obj))
        if self.fail_refresh_without_tenant and self.tenant_set is None:
            raise RuntimeError('invalid input syntax for type uuid: ""')


@pytest.mark.asyncio
async def test_create_version_sets_tenant_on_the_session_before_the_post_commit_refresh():
    db = _DB()
    version = await create_version(db, TID, {"modules": ["fi_gl"], "parquet_path": "staging/x.parquet"}, label="x")
    assert version.tenant_id == TID and version.metadata_["parquet_path"] == "staging/x.parquet"
    kinds = [c[0] for c in db.calls]
    commit_at, refresh_at = kinds.index("commit"), kinds.index("refresh")
    assert commit_at < refresh_at
    between = [c for c in db.calls[commit_at + 1:refresh_at] if c[0] == "execute"]
    assert between and between[-1][1].startswith("SELECT set_config('app.tenant_id'")
    assert between[-1][2] == {"tid": str(TID)}
    # never the f-string SET that cannot be parametrised
    assert not any("SET app.tenant_id" in c[1] for c in db.calls if c[0] == "execute")


@pytest.mark.asyncio
async def test_mark_version_failed_records_the_reason_under_the_tenant():
    db = _DB()
    vid = uuid.uuid4()
    await mark_version_failed(db, TID, vid, "Could not queue the analysis: ConnectionError")
    executes = [c for c in db.calls if c[0] == "execute"]
    assert executes[0][1].startswith("SELECT set_config('app.tenant_id'")
    update = executes[1]
    assert "SET status = 'failed'" in update[1] and "'error'" in update[1]
    assert update[2]["vid"] == vid and update[2]["tid"] == TID
    assert update[2]["reason"].startswith("Could not queue")
    assert db.calls[-1] == ("commit",)


@pytest.mark.asyncio
async def test_enqueue_failure_marks_the_version_failed_and_returns_503(monkeypatch):
    from api.routes import upload
    from workers.tasks import run_checks as rc

    def _boom(*a, **k):
        raise ConnectionError("broker down")

    monkeypatch.setattr(rc.run_checks, "delay", _boom)
    progress, finished = [], []
    monkeypatch.setattr(upload, "update_task_progress", lambda vid, **kw: progress.append((vid, kw)))
    monkeypatch.setattr(upload.jobs, "finish_job", lambda tid, jid, status, **kw: finished.append((jid, status, kw)))

    db = _DB(fail_refresh_without_tenant=False)
    vid = uuid.uuid4()
    with pytest.raises(HTTPException) as exc:
        await upload._enqueue_checks(db, TID, vid, "staging/x.parquet", total_rows=3)
    assert exc.value.status_code == 503 and exc.value.detail["error"] == "queue_unavailable"

    updates = [c for c in db.calls if c[0] == "execute" and "SET status = 'failed'" in c[1]]
    assert len(updates) == 1 and updates[0][2]["vid"] == vid
    assert "ConnectionError" in updates[0][2]["reason"]
    assert ("commit",) in db.calls
    assert progress and progress[0][0] == str(vid) and progress[0][1]["status"] == "failed"
    assert finished == [(str(vid), "failed", {"error": updates[0][2]["reason"]})]


@pytest.mark.asyncio
async def test_enqueue_success_returns_the_task_id(monkeypatch):
    from api.routes import upload
    from workers.tasks import run_checks as rc

    class _Job:
        id = "task-1"

    seen = []
    monkeypatch.setattr(rc.run_checks, "delay", lambda *a: seen.append(a) or _Job())
    db = _DB()
    vid = uuid.uuid4()
    assert await upload._enqueue_checks(db, TID, vid, "staging/x.parquet") == "task-1"
    assert seen == [(str(vid), str(TID), "staging/x.parquet")]
    assert db.calls == []  # nothing to repair

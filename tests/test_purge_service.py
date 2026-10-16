"""purge_version on a fake session: the statements it issues, the open-work rules,
the storage targets it derives and how storage failures are recorded."""

from __future__ import annotations

import uuid

import pytest

from api.services import purge
from api.services.purge import (
    CLOSED_ISSUE_STATUSES, DELETE_ORDER, OPEN_CLEANING_SQL, OPEN_ISSUE_STATUSES, UNLINK, _storage_targets,
    open_work, purge_version,
)

TENANT = str(uuid.uuid4())
VID = str(uuid.uuid4())
OTHER = str(uuid.uuid4())


class _Result:
    def __init__(self, rows, rowcount=0):
        self._rows = rows
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows

    def scalar(self):
        return self._rows[0][0] if self._rows else None


class _Session:
    """Answers the statements purge_version makes; records every write in order."""

    def __init__(self, metadata=None, stranded=0, pdf_paths=(), counts=None):
        self.metadata = metadata or {}
        self.stranded = stranded
        self.pdf_paths = list(pdf_paths)
        self.counts = counts or {}
        self.writes: list[tuple[str, dict]] = []
        self.logs: list[dict] = []
        self.commits = 0

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if sql.startswith("SELECT label, metadata FROM analysis_versions"):
            return _Result([("Q1", self.metadata)])
        if sql.startswith("SELECT count(*) FROM record_issues"):
            return _Result([(self.stranded,)])
        if sql.startswith("SELECT count(*) FROM"):
            table = sql.split("FROM ")[1].split()[0]
            return _Result([(self.counts.get(table, 0),)])
        if sql.startswith("SELECT pdf_path FROM reports"):
            return _Result([(p,) for p in self.pdf_paths])
        if sql.startswith("INSERT INTO purge_log"):
            self.logs.append(params)
            return _Result([])
        if sql.startswith(("DELETE FROM", "UPDATE ", "INSERT INTO audit_log")):
            self.writes.append((sql, params))
            return _Result([], rowcount=self.counts.get(sql.split()[2], 0))
        raise AssertionError(sql)

    def commit(self):
        self.commits += 1


def _quiet_storage(monkeypatch):
    monkeypatch.setattr("api.services.storage.list_prefix", lambda b, p: [])
    monkeypatch.setattr("api.services.storage.delete_prefix", lambda b, p: (0, 0))
    monkeypatch.setattr("api.services.storage.object_size", lambda b, n: None)
    monkeypatch.setattr("api.services.storage.delete_file", lambda b, n: None)


# ── finding 6: tenant predicate on every statement ───────────────────────────

def _tenant_scoped_tables() -> set[str]:
    """Tables with a tenant_id column: the SQLAlchemy models plus the migration-only tables
    (write_back_log and others are created by Alembic without a model)."""
    import glob
    import os
    import re

    from db.schema import Base

    scoped = {name for name, t in Base.metadata.tables.items() if "tenant_id" in t.columns}
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for path in glob.glob(os.path.join(root, "db", "migrations", "versions", "*.py")):
        with open(path, encoding="utf-8") as f:
            src = f.read()
        for m in re.finditer(r'create_table\(\s*"(\w+)"(.*?)\n    \)', src, re.S):
            if '"tenant_id"' in m.group(2):
                scoped.add(m.group(1))
    return scoped


def test_every_delete_and_unlink_names_the_tenant():
    scoped = _tenant_scoped_tables()
    for table, where in DELETE_ORDER:
        assert table in scoped, f"{table} has no tenant_id column; check db/schema.py"
        assert where.startswith("tenant_id = :t AND"), f"DELETE FROM {table} lacks the tenant predicate: {where}"
        assert ":v" in where
    for table, _set, where in UNLINK:
        assert table in scoped
        assert where.startswith("tenant_id = :t AND"), f"UPDATE {table} lacks the tenant predicate: {where}"
    # subqueries over findings carry it too
    for _table, where in DELETE_ORDER:
        if "FROM findings" in where:
            assert "FROM findings WHERE tenant_id = :t" in where


def test_purge_statements_bind_tenant_and_version(monkeypatch):
    _quiet_storage(monkeypatch)
    s = _Session()
    purge_version(s, TENANT, VID, dry_run=False, actor=None, source="manual")
    data_writes = [(sql, p) for sql, p in s.writes if not sql.startswith("INSERT INTO audit_log")
                   and not sql.startswith("UPDATE purge_log")]
    assert len(data_writes) == len(DELETE_ORDER) + len(UNLINK) + 1
    for sql, p in data_writes:
        assert "tenant_id = :t" in sql, sql
        assert p == {"t": TENANT, "v": VID}


# ── finding 9: verified cleaning items are finished ──────────────────────────

def test_verified_cleaning_items_do_not_block():
    finished = OPEN_CLEANING_SQL.split("NOT IN")[1]
    for st in ("applied", "verified", "rejected", "rolled_back", "merged"):
        assert f"'{st}'" in finished


# ── finding 1: open record issues ────────────────────────────────────────────

def test_issue_status_vocabulary_matches_record_issues():
    # migration 048: open | in_progress | accepted | resolved
    assert set(OPEN_ISSUE_STATUSES) | set(CLOSED_ISSUE_STATUSES) == {"open", "in_progress", "accepted", "resolved"}
    assert not set(OPEN_ISSUE_STATUSES) & set(CLOSED_ISSUE_STATUSES)


def test_open_issues_with_nowhere_to_go_block_the_purge():
    s = _Session(stranded=2)
    assert open_work(s, TENANT, VID) == \
        "2 open record issues were only observed in this run; resolve or dismiss them first"
    assert open_work(_Session(stranded=1), TENANT, VID) == \
        "1 open record issue was only observed in this run; resolve or dismiss them first"
    assert open_work(_Session(stranded=0), TENANT, VID) is None


def test_blocked_purge_writes_only_the_log_row(monkeypatch):
    _quiet_storage(monkeypatch)
    s = _Session(stranded=3)
    r = purge_version(s, TENANT, VID, dry_run=False, actor=None, source="nightly")
    assert r["blocked_reason"].startswith("3 open record issues were only observed in this run")
    assert s.writes == [] and len(s.logs) == 1 and s.logs[0]["src"] == "nightly"
    assert s.logs[0]["why"] == r["blocked_reason"]


def test_open_issues_are_repointed_before_closed_ones_are_deleted(monkeypatch):
    _quiet_storage(monkeypatch)
    s = _Session()
    purge_version(s, TENANT, VID, dry_run=False, actor=None)
    sqls = [sql for sql, _ in s.writes]
    repoint = next(i for i, q in enumerate(sqls)
                   if q.startswith("UPDATE record_issues SET last_seen_version = (SELECT av.id"))
    first_seen = next(i for i, q in enumerate(sqls)
                      if q.startswith("UPDATE record_issues SET first_seen_version = last_seen_version"))
    delete = next(i for i, q in enumerate(sqls) if q.startswith("DELETE FROM record_issues"))
    assert repoint < first_seen < delete
    # the re-point targets open issues of the same system and only when one remains
    assert "status IN ('open', 'in_progress')" in sqls[repoint]
    assert "COALESCE(av.metadata->>'system_id', 'upload') = record_issues.scope" in sqls[repoint]
    assert "ORDER BY av.run_at DESC NULLS LAST" in sqls[repoint]
    assert "EXISTS (SELECT av.id" in sqls[repoint]
    # the delete leaves open issues alone unless no other version of their system exists
    assert "NOT (status IN ('open', 'in_progress')) OR NOT EXISTS" in sqls[delete]


# ── findings 5 and 7: storage targets ────────────────────────────────────────

def test_storage_targets_include_the_raw_upload(monkeypatch):
    from api.config import settings

    s = _Session()
    fid = str(uuid.uuid4())
    meta = {"dataset_path": f"staging/{TENANT}/{fid}.parquet", "upload_path": f"uploads/{TENANT}/{fid}.csv"}
    t = _storage_targets(s, TENANT, VID, meta)
    assert t["prefixes"] == [(settings.minio_bucket_uploads, f"staging/{TENANT}/{VID}/"),
                             (settings.minio_bucket_uploads, f"uploads/{TENANT}/{fid}.")]
    # the parquet is a named object; the raw file is covered by the derived prefix
    assert t["objects"] == [(settings.minio_bucket_uploads, f"staging/{TENANT}/{fid}.parquet")]
    assert t["skipped"] == []


def test_storage_targets_derive_the_upload_prefix_for_versions_without_upload_path():
    s = _Session()
    fid = str(uuid.uuid4())
    t = _storage_targets(s, TENANT, VID, {"dataset_path": f"staging/{TENANT}/{fid}.parquet"})
    assert any(p == f"uploads/{TENANT}/{fid}." for _, p in t["prefixes"])
    # an extraction's dataset is the version prefix itself: no upload to derive
    t = _storage_targets(s, TENANT, VID, {"dataset_path": f"staging/{TENANT}/{VID}/"})
    assert len(t["prefixes"]) == 1 and t["objects"] == []


def test_storage_targets_skip_keys_outside_the_tenant(monkeypatch):
    from api.config import settings

    other = str(uuid.uuid4())
    hostile = {
        "dataset_path": f"staging/{other}/x.parquet",
        "upload_path": f"uploads/{TENANT}/../{other}/x.csv",
        "findings_archive": f"archive/{other}/findings/{VID}.json.gz",
    }
    s = _Session(pdf_paths=[f"reports/{other}/{VID}.pdf", "/etc/passwd", f"reports/{TENANT}/{VID}.pdf",
                            "s3://bucket/reports/x.pdf"])
    t = _storage_targets(s, TENANT, VID, hostile)
    assert t["objects"] == [(settings.minio_bucket_reports, f"reports/{TENANT}/{VID}.pdf")]
    assert set(t["skipped"]) == {f"reports/{other}/{VID}.pdf", "/etc/passwd", "s3://bucket/reports/x.pdf",
                                 hostile["dataset_path"], hostile["upload_path"], hostile["findings_archive"]}
    assert t["prefixes"] == [(settings.minio_bucket_uploads, f"staging/{TENANT}/{VID}/")]


def test_untrusted_keys_are_recorded_on_the_purge_log_row(monkeypatch):
    _quiet_storage(monkeypatch)
    other = str(uuid.uuid4())
    s = _Session(metadata={"dataset_path": f"staging/{other}/x.parquet"})
    purge_version(s, TENANT, VID, dry_run=True, actor=None, source="preview")
    assert s.logs[0]["src"] == "preview"
    assert f'"skipped_untrusted_key": ["staging/{other}/x.parquet"]' in s.logs[0]["r"]
    s = _Session(metadata={"dataset_path": f"staging/{other}/x.parquet"})
    purge_version(s, TENANT, VID, dry_run=False, actor=None)
    assert f'"skipped_untrusted_key": ["staging/{other}/x.parquet"]' in s.logs[0]["r"]


# ── finding 4: storage errors are recorded, never swallowed ──────────────────

def test_storage_failure_lands_in_storage_errors(monkeypatch):
    monkeypatch.setattr("api.services.storage.list_prefix", lambda b, p: [])
    monkeypatch.setattr("api.services.storage.delete_prefix", lambda b, p: (0, 0))
    monkeypatch.setattr("api.services.storage.delete_file", lambda b, n: None)

    def boom(bucket, name):
        raise RuntimeError("storage unreachable")

    monkeypatch.setattr("api.services.storage.object_size", boom)
    s = _Session(pdf_paths=[f"reports/{TENANT}/{VID}.pdf"])
    r = purge_version(s, TENANT, VID, dry_run=False, actor=None)
    assert r["storage_errors"] == [f"delete reports/{TENANT}/{VID}.pdf: storage unreachable"]
    outcome = [p for sql, p in s.writes if sql.startswith("UPDATE purge_log")]
    assert outcome and "storage unreachable" in outcome[0]["err"]
    # a dry run reports the same failure
    s = _Session(pdf_paths=[f"reports/{TENANT}/{VID}.pdf"])
    r = purge_version(s, TENANT, VID, dry_run=True, actor=None)
    assert r["storage_errors"] == [f"stat reports/{TENANT}/{VID}.pdf: storage unreachable"]


def test_unknown_source_is_refused():
    with pytest.raises(ValueError):
        purge.write_purge_log(_Session(), TENANT, "version", VID, True, {}, 0, None, None, source="cron")

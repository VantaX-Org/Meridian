"""Copy-then-verify logic of the MinIO → Garage migration, against in-memory S3 fakes."""

from __future__ import annotations

import io
from types import SimpleNamespace

from minio.error import S3Error

from api.services.storage_migration import DIGEST_META, export_tar, import_tar, migrate


class _Resp(io.BytesIO):
    def __init__(self, data: bytes, ctype: str):
        super().__init__(data)
        self.headers = {"Content-Type": ctype, "Content-Length": str(len(data))}

    def stream(self, n):
        yield from iter(lambda: self.read(n), b"")

    def release_conn(self):
        pass


class FakeS3:
    def __init__(self, buckets=None, corrupt=False):
        self.b = {k: dict(v) for k, v in (buckets or {}).items()}  # name -> {key: (bytes, ctype, meta)}
        self.corrupt = corrupt
        self.puts = 0

    def list_buckets(self):
        return [SimpleNamespace(name=n) for n in self.b]

    def bucket_exists(self, b):
        return b in self.b

    def make_bucket(self, b):
        self.b[b] = {}

    def list_objects(self, b, recursive=True):
        return [SimpleNamespace(object_name=k, is_dir=False, last_modified=None) for k in sorted(self.b[b])]

    def get_object(self, b, k):
        data, ctype, _ = self.b[b][k]
        return _Resp(data[:-1] if self.corrupt else data, ctype)

    def stat_object(self, b, k):
        if k not in self.b.get(b, {}):
            raise S3Error(None, "NoSuchKey", "missing", k, "r", "h")
        meta = {f"X-Amz-Meta-{m}": v for m, v in self.b[b][k][2].items()}
        return SimpleNamespace(metadata=meta)

    def put_object(self, b, k, data, length, content_type, metadata=None):
        self.puts += 1
        self.b[b][k] = (data.read(length), content_type, metadata or {})


def _src():
    return FakeS3({
        "meridian-uploads": {"a.csv": (b"x" * 3_000_000, "text/csv", {}), "dir/b.xlsx": (b"bb", "application/x", {})},
        "meridian-reports": {"r.pdf": (b"%PDF", "application/pdf", {})},
    })


def test_copies_every_object_with_digest_and_content_type():
    src, dst = _src(), FakeS3()
    out = migrate(src, dst, log=lambda *_: None)
    assert out["meridian-uploads"].copied == 2 and out["meridian-reports"].copied == 1
    assert not any(r.failed for r in out.values())
    data, ctype, meta = dst.b["meridian-uploads"]["a.csv"]
    assert data == b"x" * 3_000_000 and ctype == "text/csv" and len(meta[DIGEST_META]) == 64


def test_rerun_skips_verified_copies():
    src, dst = _src(), FakeS3()
    migrate(src, dst, log=lambda *_: None)
    puts = dst.puts
    out = migrate(src, dst, log=lambda *_: None)
    assert dst.puts == puts
    assert out["meridian-uploads"].verified_existing == 2


def test_object_written_by_application_is_kept():
    src = _src()
    dst = FakeS3({"meridian-uploads": {"a.csv": (b"newer", "text/csv", {})}})
    out = migrate(src, dst, log=lambda *_: None)
    assert dst.b["meridian-uploads"]["a.csv"][0] == b"newer"
    assert out["meridian-uploads"].kept_newer == 1


def test_changed_source_overwrites_stale_copy():
    src, dst = _src(), FakeS3()
    migrate(src, dst, log=lambda *_: None)
    src.b["meridian-reports"]["r.pdf"] = (b"%PDF-2", "application/pdf", {})
    out = migrate(src, dst, log=lambda *_: None)
    assert out["meridian-reports"].copied == 1 and dst.b["meridian-reports"]["r.pdf"][0] == b"%PDF-2"


def test_read_back_mismatch_is_reported():
    class Lossy(FakeS3):
        def put_object(self, b, k, data, length, content_type, metadata):
            super().put_object(b, k, data, length, content_type, metadata)
            d, c, m = self.b[b][k]
            self.b[b][k] = (d[:-1], c, m)

    out = migrate(_src(), Lossy(), log=lambda *_: None)
    assert len(out["meridian-uploads"].failed) == 2 and out["meridian-uploads"].copied == 0


def test_one_unreadable_object_does_not_stop_the_rest():
    src = _src()
    real = src.get_object

    def flaky(b, k):
        if k == "a.csv":
            raise OSError("disk")
        return real(b, k)

    src.get_object = flaky
    out = migrate(src, FakeS3(), log=lambda *_: None)
    assert out["meridian-uploads"].copied == 1 and "a.csv" in out["meridian-uploads"].failed[0]


def test_export_import_round_trip_keeps_bytes_and_content_type():
    src, dst, buf = _src(), FakeS3(), io.BytesIO()
    assert export_tar(src, buf) == 3
    buf.seek(0)
    assert import_tar(dst, buf) == 3
    assert {b: {k: v[:2] for k, v in objs.items()} for b, objs in dst.b.items()} == \
        {b: {k: v[:2] for k, v in objs.items()} for b, objs in src.b.items()}

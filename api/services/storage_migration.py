"""Copy every object from the old MinIO into Garage, verifying each copy.

Run by scripts/update.sh (once, when an install still has a MinIO volume) inside
the api image:  python -m api.services.storage_migration --source-endpoint HOST:PORT

Also the object half of scripts/backup.sh / restore.sh: --export writes every
bucket as a tar stream to stdout, --import loads one from stdin.

Copy-then-verify, never move: each object is streamed from the source with its
SHA-256 computed on the way, written to the destination with that digest as
metadata, then read back and compared. Re-running is safe — verified copies are
skipped, and an object the application already wrote to the destination is kept
(it is newer). Exit status 1 if anything failed to copy or verify.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass, field

from minio import Minio
from minio.error import S3Error

DIGEST_META = "meridian-sha256"
_CHUNK = 1024 * 1024


@dataclass
class Report:
    copied: int = 0
    verified_existing: int = 0
    kept_newer: int = 0
    bytes: int = 0
    failed: list[str] = field(default_factory=list)


def _digest(stream) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    for chunk in iter(lambda: stream.read(_CHUNK), b""):
        h.update(chunk)
        n += len(chunk)
    return h.hexdigest(), n


def _dest_digest(dst: Minio, bucket: str, name: str) -> str | None:
    """'' when the object exists without our digest, None when it does not exist."""
    try:
        st = dst.stat_object(bucket, name)
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchObject", "NotFound"):
            return None
        raise
    meta = {k.lower(): v for k, v in (st.metadata or {}).items()}
    return meta.get(f"x-amz-meta-{DIGEST_META}", "")


def copy_object(src: Minio, dst: Minio, bucket: str, name: str, report: Report) -> None:
    existing = _dest_digest(dst, bucket, name)
    if existing == "":
        report.kept_newer += 1  # written by the application, not by us
        return
    resp = src.get_object(bucket, name)
    try:
        content_type = resp.headers.get("Content-Type") or "application/octet-stream"
        with tempfile.SpooledTemporaryFile(max_size=64 * _CHUNK) as buf:
            h, size = hashlib.sha256(), 0
            for chunk in resp.stream(_CHUNK):
                h.update(chunk)
                size += len(chunk)
                buf.write(chunk)
            digest = h.hexdigest()
            if existing == digest:
                report.verified_existing += 1
                return
            buf.seek(0)
            dst.put_object(bucket, name, buf, size, content_type=content_type, metadata={DIGEST_META: digest})
    finally:
        resp.close()
        resp.release_conn()
    back = dst.get_object(bucket, name)
    try:
        got, got_size = _digest(back)
    finally:
        back.close()
        back.release_conn()
    if got != digest or got_size != size:
        report.failed.append(f"{bucket}/{name}: read-back does not match")
        return
    report.copied += 1
    report.bytes += size


def migrate(src: Minio, dst: Minio, buckets: list[str] | None = None, log=print) -> dict[str, Report]:
    out: dict[str, Report] = {}
    for bucket in buckets or sorted(b.name for b in src.list_buckets()):
        rep = out.setdefault(bucket, Report())
        if not dst.bucket_exists(bucket):
            dst.make_bucket(bucket)
        for obj in src.list_objects(bucket, recursive=True):
            if obj.is_dir:
                continue
            try:
                copy_object(src, dst, bucket, obj.object_name, rep)
            except Exception as e:  # one bad object must not hide the others
                rep.failed.append(f"{bucket}/{obj.object_name}: {e}")
        log(f"{bucket}: {rep.copied} copied ({rep.bytes:,} bytes), {rep.verified_existing} already copied, "
            f"{rep.kept_newer} newer in destination, {len(rep.failed)} failed")
    return out


_CTYPE = "MERIDIAN.content_type"


def export_tar(client: Minio, out) -> int:
    """Every object of every bucket as bucket/key members of a tar stream."""
    n = 0
    with tarfile.open(fileobj=out, mode="w|") as tar:
        for b in sorted(x.name for x in client.list_buckets()):
            for obj in client.list_objects(b, recursive=True):
                if obj.is_dir:
                    continue
                resp = client.get_object(b, obj.object_name)
                try:
                    info = tarfile.TarInfo(f"{b}/{obj.object_name}")
                    info.size = int(resp.headers["Content-Length"])
                    info.mtime = obj.last_modified.timestamp() if obj.last_modified else time.time()
                    info.pax_headers = {_CTYPE: resp.headers.get("Content-Type") or "application/octet-stream"}
                    tar.addfile(info, resp)
                finally:
                    resp.close()
                    resp.release_conn()
                n += 1
    return n


def import_tar(client: Minio, src) -> int:
    n = 0
    with tarfile.open(fileobj=src, mode="r|") as tar:
        for m in tar:
            if not m.isfile():
                continue
            bucket, _, key = m.name.partition("/")
            if not client.bucket_exists(bucket):
                client.make_bucket(bucket)
            client.put_object(bucket, key, tar.extractfile(m), m.size,
                              content_type=m.pax_headers.get(_CTYPE, "application/octet-stream"))
            n += 1
    return n


def _wait(client: Minio, what: str, seconds: int = 90) -> None:
    last: Exception | None = None
    for _ in range(seconds):
        try:
            client.list_buckets()
            return
        except S3Error as e:  # reachable, but refused: waiting will not help
            raise SystemExit(f"{what} refused the credentials: {e.code}") from e
        except Exception as e:
            last = e
            time.sleep(1)
    raise SystemExit(f"{what} not reachable after {seconds}s: {last}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--source-endpoint")
    mode.add_argument("--export", action="store_true", help="tar of all buckets to stdout")
    mode.add_argument("--import", dest="import_", action="store_true", help="tar from stdin")
    p.add_argument("--source-access-key",
                   default=os.getenv("STORAGE_SOURCE_ACCESS_KEY") or os.getenv("MINIO_ACCESS_KEY", "meridian"))
    p.add_argument("--source-secret-key", default=os.getenv("STORAGE_SOURCE_SECRET_KEY")
                   or os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_PASSWORD", ""))
    p.add_argument("--dest-endpoint", default=os.getenv("MINIO_ENDPOINT", "minio:9000"))
    p.add_argument("--dest-access-key", default=os.getenv("MINIO_ACCESS_KEY", "meridian"))
    p.add_argument("--dest-secret-key", default=os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_PASSWORD", ""))
    a = p.parse_args(argv)
    dst = Minio(a.dest_endpoint, access_key=a.dest_access_key, secret_key=a.dest_secret_key, secure=False)
    if a.export or a.import_:
        _wait(dst, "object storage")
        n = export_tar(dst, sys.stdout.buffer) if a.export else import_tar(dst, sys.stdin.buffer)
        print(f"storage {'export' if a.export else 'import'}: {n} objects", file=sys.stderr)
        return 0
    src = Minio(a.source_endpoint, access_key=a.source_access_key, secret_key=a.source_secret_key, secure=False)
    _wait(src, "source (MinIO)")
    _wait(dst, "destination (Garage)")
    reports = migrate(src, dst)
    failed = [f for r in reports.values() for f in r.failed]
    for f in failed[:50]:
        print(f"FAILED {f}", file=sys.stderr)
    total = sum(r.copied + r.verified_existing + r.kept_newer for r in reports.values())
    print(f"storage migration: {total} objects in {len(reports)} buckets, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

import io
import logging
from typing import Optional

import urllib3
from minio import Minio

from api.config import settings

logger = logging.getLogger("meridian.storage")


def get_minio_client() -> Minio:
    return Minio(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,  # Internal Docker network — no TLS
        # fail fast instead of hanging a request when storage stalls
        http_client=urllib3.PoolManager(
            timeout=urllib3.Timeout(connect=5, read=60),
            retries=urllib3.Retry(total=2, backoff_factor=0.5),
        ),
    )


def ensure_buckets() -> None:
    client = get_minio_client()
    for bucket in [settings.minio_bucket_uploads, settings.minio_bucket_reports]:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            logger.info(f"Created MinIO bucket: {bucket}")
        else:
            logger.info(f"MinIO bucket exists: {bucket}")


def upload_file(
    bucket: str, object_name: str, data: bytes, content_type: str = "application/octet-stream"
) -> str:
    client = get_minio_client()
    client.put_object(
        bucket,
        object_name,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    return f"{settings.minio_endpoint}/{bucket}/{object_name}"


def download_file(bucket: str, object_name: str) -> bytes:
    client = get_minio_client()
    response = client.get_object(bucket, object_name)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def delete_file(bucket: str, object_name: str) -> None:
    client = get_minio_client()
    client.remove_object(bucket, object_name)


def list_prefix(bucket: str, prefix: str) -> list[tuple[str, int]]:
    """Every object under ``prefix`` as ``(object_name, size)``. The MinIO client
    pages through the listing itself; this materialises it so callers can count."""
    client = get_minio_client()
    out: list[tuple[str, int]] = []
    for obj in client.list_objects(bucket, prefix=prefix, recursive=True):
        if getattr(obj, "is_dir", False):
            continue
        out.append((obj.object_name, int(obj.size or 0)))
    return out


def delete_prefix(bucket: str, prefix: str) -> tuple[int, int]:
    """Remove every object under ``prefix``. Returns ``(objects_removed, bytes_freed)``.
    A prefix that matches nothing is not an error."""
    if not prefix:
        raise ValueError("delete_prefix needs a non-empty prefix")
    client = get_minio_client()
    count = total = 0
    for name, size in list_prefix(bucket, prefix):
        client.remove_object(bucket, name)
        count += 1
        total += size
    return count, total


def object_size(bucket: str, object_name: str) -> Optional[int]:
    """Size of one object, or None when it does not exist."""
    client = get_minio_client()
    try:
        return int(client.stat_object(bucket, object_name).size or 0)
    except Exception:
        return None

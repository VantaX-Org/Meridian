import io
import logging
from typing import Optional

from minio import Minio

from api.config import settings

logger = logging.getLogger("meridian.storage")


def get_minio_client() -> Minio:
    return Minio(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,  # Internal Docker network — no TLS
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

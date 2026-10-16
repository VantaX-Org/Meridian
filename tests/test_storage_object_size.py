"""storage.object_size: a missing object is None, any other storage error propagates."""

from __future__ import annotations

import pytest
from minio.error import S3Error

from api.services import storage


class _Client:
    def __init__(self, error=None, size=42):
        self.error = error
        self.size = size

    def stat_object(self, bucket, name):
        if self.error is not None:
            raise self.error
        return type("Stat", (), {"size": self.size})()


def _s3(code: str) -> S3Error:
    return S3Error(None, code, code, "r", "rid", "hid")


def test_missing_object_is_none(monkeypatch):
    monkeypatch.setattr(storage, "get_minio_client", lambda: _Client(error=_s3("NoSuchKey")))
    assert storage.object_size("b", "k") is None


def test_size_of_an_existing_object(monkeypatch):
    monkeypatch.setattr(storage, "get_minio_client", lambda: _Client(size=1234))
    assert storage.object_size("b", "k") == 1234


@pytest.mark.parametrize("error", [_s3("AccessDenied"), _s3("NoSuchBucket"), ConnectionError("down")])
def test_other_errors_propagate(monkeypatch, error):
    monkeypatch.setattr(storage, "get_minio_client", lambda: _Client(error=error))
    with pytest.raises(type(error)):
        storage.object_size("b", "k")

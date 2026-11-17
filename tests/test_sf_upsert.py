"""SuccessFactors upsert: chunking, purgeType, per-record status, retries and secret masking. Mocked HTTP only.
Entity and property names are synthetic."""

import json

import httpx

import sap.successfactors as sf
from sap.base import CloudConnectionParams
from sap.successfactors import SuccessFactorsConnector, parse_upsert

BASE = "https://sf.example.test"


def _connector(handler, password="s3cret-pw") -> SuccessFactorsConnector:
    c = SuccessFactorsConnector()
    c._params = CloudConnectionParams(base_url=BASE, company_id="co", auth_type="basic", password=password)
    c._client = httpx.Client(base_url=BASE, transport=httpx.MockTransport(handler))
    return c


def _ok(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    return httpx.Response(200, json={"d": [
        {"key": f"TestEntity(k='{r['k']}')", "status": "OK" if r["k"] != "bad" else "ERROR",
         "editStatus": "UPSERTED", "message": None if r["k"] != "bad" else "Field xField is required",
         "httpCode": 200 if r["k"] != "bad" else 400} for r in body]})


def test_chunks_and_status_per_record():
    calls = []

    def handler(request):
        calls.append(request)
        return _ok(request)

    recs = [{"k": str(i)} for i in range(5)] + [{"k": "bad"}]
    out = _connector(handler).upsert("TestEntity", recs, chunk_size=4)
    assert len(calls) == 2
    assert [r["index"] for r in out] == list(range(6))
    assert [r["status"] for r in out] == ["ok"] * 5 + ["failed"]
    assert out[5]["message"] == "Field xField is required" and out[5]["http_code"] == 400
    sent = json.loads(calls[0].content)
    assert sent[0]["__metadata"] == {"uri": "TestEntity"} and sent[0]["k"] == "0"
    assert calls[0].url.path == "/odata/v2/upsert" and "purgeType" not in calls[0].url.params


def test_purge_type_full_is_sent():
    seen = []

    def handler(request):
        seen.append(request.url.params.get("purgeType"))
        return _ok(request)

    _connector(handler).upsert("TestEntity", [{"k": "1"}], purge_type="full")
    assert seen == ["full"]


def test_transient_error_is_retried(monkeypatch):
    monkeypatch.setattr(sf.time, "sleep", lambda s: None)
    n = {"i": 0}

    def handler(request):
        n["i"] += 1
        return httpx.Response(503) if n["i"] == 1 else _ok(request)

    out = _connector(handler).upsert("TestEntity", [{"k": "1"}])
    assert n["i"] == 2 and out[0]["status"] == "ok"


def test_hard_error_fails_chunk_and_masks_secret(monkeypatch):
    monkeypatch.setattr(sf.time, "sleep", lambda s: None)

    def handler(request):
        return httpx.Response(400, json={"error": {"message": {"value": "bad password s3cret-pw"}}})

    out = _connector(handler).upsert("TestEntity", [{"k": "1"}, {"k": "2"}])
    assert [r["status"] for r in out] == ["failed", "failed"]
    assert all("s3cret-pw" not in r["message"] for r in out)


def test_short_response_marks_rest_failed():
    def handler(request):
        return httpx.Response(200, json={"d": [{"key": "x", "status": "OK", "httpCode": 200}]})

    out = _connector(handler).upsert("TestEntity", [{"k": "1"}, {"k": "2"}])
    assert [r["status"] for r in out] == ["ok", "failed"]


def test_parse_upsert_accepts_results_wrapper():
    rows = parse_upsert({"d": {"results": [{"key": "a", "status": "OK"}, {"key": "b", "status": "ERROR"}]}})
    assert [r["status"] for r in rows] == ["ok", "failed"]

import logging
import re

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.server_error import unhandled_exception_handler


def _client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(Exception, unhandled_exception_handler)

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internals /srv/app.py")

    @app.get("/teapot")
    def teapot():
        raise HTTPException(status_code=418, detail="short and stout")

    return TestClient(app, raise_server_exceptions=False)


def test_unhandled_error_returns_reference_json_and_logs_code(caplog):
    with caplog.at_level(logging.ERROR, logger="meridian.server_error"):
        r = _client().get("/boom")
    assert r.status_code == 500
    body = r.json()
    code = body["reference"]
    assert re.fullmatch(r"[0-9a-f]{8}", code)
    assert body["detail"] == f"Something went wrong on the server. Reference {code}."
    assert "Traceback" not in r.text and "RuntimeError" not in r.text and "secret internals" not in r.text
    line = next(rec for rec in caplog.records if code in rec.getMessage())
    assert "/boom" in line.getMessage() and line.exc_info is not None


def test_http_exception_is_unchanged():
    r = _client().get("/teapot")
    assert r.status_code == 418 and r.json() == {"detail": "short and stout"}

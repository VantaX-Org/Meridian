"""Download filenames cannot inject headers, and imported free text cannot carry a spreadsheet formula."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from urllib.parse import unquote

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.services.branded_xlsx import content_disposition


def test_content_disposition_strips_quotes_and_line_breaks_and_keeps_the_unicode_name():
    name = 'Plant "1000"\r\nSet-Cookie: x=1 Übersicht.xlsx'
    header = content_disposition(name)
    ascii_part = header.split("; filename*=")[0]
    assert "\r" not in header and "\n" not in header
    assert ascii_part.count('"') == 2  # only the quotes around the value
    assert header.isascii()
    assert unquote(header.split("filename*=UTF-8''")[1]) == name
    assert content_disposition("") .startswith('attachment; filename="report"')


class _Rows:
    def fetchall(self) -> list[Any]:
        return []


class _DB:
    async def execute(self, *_a: Any, **_k: Any) -> _Rows:
        return _Rows()


def test_user_import_preview_refuses_a_formula_in_the_name(monkeypatch):
    from api.routes import users

    async def _caller(*_a: Any, **_k: Any) -> Any:
        return None

    async def _seats(*_a: Any) -> tuple[int, None]:
        return 0, None

    monkeypatch.setattr(users, "resolve_caller", _caller)
    monkeypatch.setattr(users, "enforce_ceiling", _caller)
    monkeypatch.setattr(users, "seats_for", _seats)
    raw = "email,name,role\na@example.com,=HYPERLINK(\"x\"),viewer\nb@example.com,Bea Smith,viewer\n"
    out = asyncio.run(users._preview_rows(_DB(), Tenant(uuid.uuid4(), "T", []), None, raw))  # type: ignore[arg-type]
    rows = {r["email"]: r for r in out["rows"]}
    assert rows["a@example.com"]["error"] == "Name must not start with =, +, - or @"
    assert rows["b@example.com"]["error"] is None


def test_postal_code_upload_drops_rows_whose_city_or_region_is_a_formula(monkeypatch):
    from api.routes import system_objects

    stored: list[dict[str, str]] = []

    async def _store(_db: Any, _tenant: Any, _sid: Any, _kind: str, records: list[dict[str, str]]) -> None:
        stored.extend(records)

    monkeypatch.setattr(system_objects, "_store_reference", _store)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(system_objects.router)
    app.dependency_overrides[get_db] = lambda: _DB()
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    body = "country,postcode,city,region\nZA,2196,Sandton,GP\nZA,2191,Rivonia,GP\nZA,2194,Randburg,GP\nZA,2000,=cmd|' /C calc'!A0,GP\nZA,8001,Cape Town,@WC\n"
    r = TestClient(app).post(f"/api/v1/systems/{uuid.uuid4()}/reference/postal-codes", content=body,
                             headers={"X-User-Role": "admin"})
    assert r.status_code == 200, r.text
    assert sorted(s["CITY"] for s in stored) == ["Randburg", "Rivonia", "Sandton"]

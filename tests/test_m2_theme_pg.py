"""Tenant theming against a real Postgres (MERIDIAN_TEST_DB_URL): validation, the contrast check, logo upload
(object storage replaced by a dict) and the public theme the sign-in page reads before anyone signs in."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from api.services import theme as th
from tests.m2_client import headers, make_client

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

PNG = th.PNG_MAGIC + b"\x00\x00\x00\rIHDR" + b"\x00" * 64
SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' \
      b'<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/></svg>'


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


def test_contrast_check_is_wcag():
    assert th.contrast("#000000", "#FFFFFF") == pytest.approx(21.0)
    assert th.contrast("#FFFFFF", "#FFFFFF") == pytest.approx(1.0)
    assert round(th.contrast("#2563EB", "#FFFFFF"), 2) == 5.17  # the product accent
    assert th.contrast("#7FA8FF", th.DARK_GROUND) >= 4.5  # and its dark-mode value
    assert th.normalise_hex("2563eb") == "#2563EB" and th.normalise_hex("#26e") == "#2266EE"
    with pytest.raises(th.ThemeError):
        th.normalise_hex("blue")
    ok = th.check_accent("#2563EB")
    assert ok["accent"] == "#2563EB" and th.contrast(ok["accent_dark"], th.DARK_GROUND) >= 4.5
    assert ok["contrast"]["on_white"] >= 4.5 and ok["contrast"]["on_dark"] >= 4.5
    with pytest.raises(th.ThemeError, match="against white"):
        th.check_accent("#7FA8FF")  # too light for white
    with pytest.raises(th.ThemeError, match="dark ground"):
        th.check_accent("#2563EB", "#1E3A8A")  # too dark for the dark ground
    # no colour reaches 4.5:1 on both: the reason the theme carries two accents
    assert not any(th.contrast(f"#{v:02X}{v:02X}{v:02X}", "#FFFFFF") >= 4.5 and
                   th.contrast(f"#{v:02X}{v:02X}{v:02X}", th.DARK_GROUND) >= 4.5 for v in range(256))


def test_logo_sniffing():
    assert th.sniff_logo(PNG) == "png" and th.sniff_logo(SVG) == "svg"
    for bad in (b"", b"GIF89a....", b"%PDF-1.7", b"\xff\xd8\xff\xe0JFIF", b"<html><svg></svg></html>",
                b"<svg><script>alert(1)</script></svg>", b'<svg onload="x()"></svg>',
                b'<svg><image href="https://evil.example/x.png"/></svg>', b"<svg><foreignObject/></svg>",
                b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
                th.PNG_MAGIC + b"\x00" * th.LOGO_MAX_BYTES):
        with pytest.raises(th.ThemeError):
            th.sniff_logo(bad)


@pytest.mark.anyio
async def test_theme_settings_and_public_theme(owner, monkeypatch):
    from api.services import storage
    from tests.landscape_seed import seed

    store: dict[tuple[str, str], bytes] = {}
    monkeypatch.setattr(storage, "upload_file", lambda b, o, d, ct="": store.__setitem__((b, o), d) or f"{b}/{o}")
    monkeypatch.setattr(storage, "download_file", lambda b, o: store[(b, o)])
    s, other = seed(owner, with_run=False), seed(owner, with_run=False)
    client = await start(monkeypatch, s["tid"], s["user"])
    async with client:
        # before anything is set: the product defaults, publicly
        r = await client.get("/api/v1/theme", params={"tenant": s["tid"]})
        assert r.status_code == 200 and r.json() == {"product_name": "Meridian", "accent": "#2563EB",
                                                     "accent_dark": "#7FA8FF", "logo_url": None, "customised": False}
        assert (await client.get("/api/v1/settings/theme", headers=headers("viewer"))).status_code == 403

        for body, msg in (({"accent": "#7FA8FF"}, "against white"), ({"accent": "#FFEE00"}, "against white"),
                          ({"accent": "#2563EB", "accent_dark": "#1E3A8A"}, "dark ground"),
                          ({"accent": "teal"}, "hex"), ({"product_name_override": "x" * 41}, "40"),
                          ({"product_name_override": "<b>Acme</b>"}, "<"), ({"accent_dark": "#7FA8FF"}, "accent"),
                          ({"logo_url": "https://cdn.example/logo.png"}, "Upload")):
            r = await client.put("/api/v1/settings/theme", headers=headers(), json=body)
            assert r.status_code == 422 and msg in r.json()["detail"], (body, r.text)
        assert (await client.put("/api/v1/settings/theme", headers=headers(), json={"colour": "#000"})).status_code == 422

        r = await client.put("/api/v1/settings/theme", headers=headers(),
                             json={"product_name_override": "  Acme   Data  Quality ", "accent": "#0f766e"})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["product_name_override"] == "Acme Data Quality" and out["accent"] == "#0F766E"
        assert out["contrast"]["on_white"] >= 4.5 and out["contrast"]["on_dark"] >= 4.5 and out["accent_dark"]

        # logo: type from the bytes, size capped, unsafe SVG refused
        r = await client.post("/api/v1/settings/theme/logo", headers=headers(),
                              files={"file": ("logo.svg", b"GIF89a fake", "image/svg+xml")})
        assert r.status_code == 422
        r = await client.post("/api/v1/settings/theme/logo", headers=headers(),
                              files={"file": ("logo.svg", b"<svg><script>1</script></svg>", "image/svg+xml")})
        assert r.status_code == 422 and "scripts" in r.json()["detail"]
        r = await client.post("/api/v1/settings/theme/logo", headers=headers(),
                              files={"file": ("innocent.svg", PNG, "image/svg+xml")})
        assert r.status_code == 200 and r.json()["logo_content_type"] == "image/png"
        assert store and next(iter(store))[1] == f"branding/{s['tid']}/logo.png"
        logo_url = r.json()["logo_url"]
        assert logo_url.startswith("/api/v1/theme/logo?v=")
        assert (await client.post("/api/v1/settings/theme/logo", headers=headers("viewer"),
                                  files={"file": ("l.png", PNG, "image/png")})).status_code == 403

        pub = (await client.get("/api/v1/theme", params={"tenant": s["tid"]})).json()
        assert pub["product_name"] == "Acme Data Quality" and pub["accent"] == "#0F766E" and pub["customised"]
        assert pub["logo_url"].startswith(logo_url)
        r = await client.get("/api/v1/theme/logo", params={"tenant": s["tid"]})
        assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"
        assert "sandbox" in r.headers["content-security-policy"] and r.headers["x-content-type-options"] == "nosniff"

        # another tenant keeps the defaults; an unknown tenant is a 404
        assert (await client.get("/api/v1/theme", params={"tenant": other["tid"]})).json()["customised"] is False
        assert (await client.get("/api/v1/theme/logo", params={"tenant": other["tid"]})).status_code == 404
        assert (await client.get("/api/v1/theme", params={"tenant": str(uuid.uuid4())})).status_code == 404

        # keeping the logo by echoing its URL, then removing it with null
        r = await client.put("/api/v1/settings/theme", headers=headers(),
                             json={"product_name_override": "Acme", "accent": "#0F766E", "logo_url": logo_url})
        assert r.json()["logo_url"] == logo_url
        r = await client.put("/api/v1/settings/theme", headers=headers(), json={"product_name_override": "Acme"})
        assert r.json()["logo_url"] is None and r.json()["accent"] is None
        assert (await client.get("/api/v1/theme", params={"tenant": s["tid"]})).json()["accent"] == "#2563EB"
    with owner.connect() as c:
        actions = [r[0] for r in c.execute(text("SELECT action FROM audit_log WHERE tenant_id = :t AND action LIKE "
                                                "'theme.%' ORDER BY created_at"), {"t": s["tid"]})]
    assert actions == ["theme.update", "theme.logo", "theme.update", "theme.update"]

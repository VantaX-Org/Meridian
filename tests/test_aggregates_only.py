"""D-19: redaction keys on the mapped field, header words and value shape (not on a SAP-named header), and the
tenant switch "aggregates only to the model" sends no row-level sample on any path.

The Postgres part (tenant scope, route, audit) runs with MERIDIAN_TEST_DB_URL (see tests/test_alert_digest_pg.py).
"""
from __future__ import annotations

import json
import os
import uuid

import pandas as pd
import pytest

EMAIL, IBAN, TAXNO, PHONE = "anna.muller@zebratron.example", "DE89370400440532013000", "123456789012", "+27 82 555 0147"
PERSONAL = {"Tax Number": [TAXNO, "987654321098"], "Emp Mail": [EMAIL, "bob.k@zebratron.example"],
            "Col7": [IBAN, "GB29NWBK60161331926819"]}
LEAKS = (TAXNO, "987654321098", EMAIL, "bob.k@zebratron.example", IBAN, "GB29NWBK60161331926819", "Zebratron")


@pytest.fixture(autouse=True)
def _no_tenant(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MERIDIAN_TENANT_ID", raising=False)


@pytest.fixture
def switch(monkeypatch: pytest.MonkeyPatch):
    def _set(on: bool) -> None:
        monkeypatch.setattr("api.services.prompt_shapes.aggregates_only", lambda tenant_id=None: on)
    return _set


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Fake provider: records every prompt that would reach the model, answers with nothing usable."""
    seen: list[str] = []

    class _Llm:
        model = "fake"

        def bind(self, **_k):
            return self

    def _invoke(_llm, prompt, *a, **k):
        seen.append(prompt if isinstance(prompt, str) else " ".join(str(getattr(m, "content", m)) for m in prompt))
        return None

    monkeypatch.setattr("llm.provider.get_llm", lambda *a, **k: _Llm())
    monkeypatch.setattr("llm.provider.safe_invoke", _invoke)
    monkeypatch.setattr("llm.provider.llm_is_noop", lambda: False)
    monkeypatch.setattr("api.utils.llm_logger.log_llm_call", lambda *a, **k: None)
    return seen


# ── non-SAP headers: personal values never reach the prompt ──


def _cols(headers: list[str]) -> tuple[list[str], list[list[str]]]:
    n = len(PERSONAL["Tax Number"])
    return headers, [[PERSONAL.get(h, ["x"] * n)[i] for h in headers] for i in range(n)]


def test_non_sap_headers_personal_values_never_reach_the_prompt(captured, monkeypatch, switch) -> None:
    from api.services import ai_column_matcher as m

    switch(False)
    monkeypatch.setattr(m, "get_llm", lambda: object())
    headers, rows = _cols(["Tax Number", "Emp Mail", "Col7"])
    m._llm_match_columns(headers, rows, headers, {"LFA1.NAME1", "LFA1.STCD1"}, "business_partner")
    assert len(captured) == 1
    prompt = captured[0]
    assert not any(v in prompt for v in LEAKS)
    # a personal column keeps counts, length and kind, and no pattern
    assert "Tax Number: rows=2 blank=0 distinct=2 length=12-12 kind=numeric (shape withheld)" in prompt
    assert "Emp Mail" in prompt and "Emp Mail: rows=2 blank=0 distinct=2 length=23-29 kind=text (shape withheld)" in prompt
    assert "masks=" not in prompt


def test_col7_is_caught_by_value_shape_alone() -> None:
    from api.services.prompt_shapes import column_profile

    assert column_profile(PERSONAL["Col7"], header="Col7")["masked"] is True
    assert column_profile(["Anna Muller", "Jean-Luc Picard"], header="Col7")["masked"] is True
    assert column_profile([PHONE], header="Col7")["masked"] is True


def test_matcher_still_works_on_non_personal_columns_and_masked_ones() -> None:
    from api.services import ai_column_matcher as m
    from api.services.prompt_shapes import column_profile

    plant = column_profile(["1000", "1010", "10A0"], header="Col3")
    assert plant["masks"] == ["9999", "99A9"] and "masked" not in plant and plant["max_length"] == 4
    masked = column_profile(PERSONAL["Emp Mail"], header="Col7")
    assert masked["masks"] == [] and masked["min_length"] == 23 and masked["distinct"] == 2 and masked["kind"] == "text"
    # the model answer is still proved by the deterministic verify
    ok = {"source": "Emp Mail", "target": "LFA1.NAME1", "confidence": 0.9}
    assert m.verify(ok, ["Emp Mail"], {"LFA1.NAME1"})["verified"]
    assert not m.verify({**ok, "target": "INVENTED"}, ["Emp Mail"], {"LFA1.NAME1"})["verified"]
    # headerless detection still reads the shapes locally
    assert m.probably_headerless(["1000123", "2024-01-31", "4500.00"], [["1000124", "2024-02-01", "12.50"]])


def test_saved_mapping_only_tightens() -> None:
    from api.services.prompt_shapes import column_profile
    from api.utils.pii_fields import column_is_personal

    vals = ["1000", "2000"]
    assert column_profile(vals, header="Plant", mapped_field="STCD1")["masked"] is True  # mapped to a personal field
    assert column_profile(vals, header="Tax Number", mapped_field="WERKS")["masked"] is True  # a mapping never loosens
    assert column_is_personal("Tax Number", [], mapped_field="WERKS") is True
    assert column_is_personal("Plant", ["a.person@zebratron.example"], mapped_field="WERKS") is True
    assert column_is_personal("Plant", ["1000"], mapped_field="WERKS") is False
    assert column_is_personal("Plant", ["1000"], mapped_field=None) is False
    assert column_is_personal("Tax Number", [], None) is True


def test_saved_mapping_reaches_the_prompt(captured, monkeypatch, switch) -> None:
    from api.services import ai_column_matcher as m

    switch(False)
    monkeypatch.setattr(m, "get_llm", lambda: object())
    headers, rows = ["Plant"], [["1000"], ["1010"]]
    m._llm_match_columns(headers, rows, headers, {"T001W.WERKS"}, "business_partner", saved_mapping={"Plant": "STCD1"})
    assert "masks=" not in captured[0] and "shape withheld" in captured[0]


def test_other_paths_withhold_masks_of_a_personal_field(captured, switch) -> None:
    from api.services import ai_semantic_matcher as sm
    from api.services import ai_survivorship as sv
    from api.services import fix_drafter as fd

    switch(False)
    assert sm.facts("Emp Mail", "Zebratron A", "Zebratron B", 0.5, "text")["a"]["mask"] == ""
    assert sm.facts("KTOKK", "ZEBR", "ZEBR", 0.5, "text")["a"]["mask"] != ""
    contribs = [{"source_system": "A", "value": EMAIL, "confidence": 0.9, "extracted_at": "2026-01-01"},
                {"source_system": "B", "value": "bob.k@zebratron.example", "confidence": 0.9, "extracted_at": "2026-01-02"}]
    assert all(f["mask"] == "" for f in sv.facts(contribs, "Tax Number"))
    shape = fd.build_shape(pd.Series([EMAIL, "bob.k@zebratron.example"]))
    fd.ask_llm("t", {"id": "R1", "field": "Emp Mail", "table": "T"}, shape)
    assert captured and not any(v in captured[-1] for v in LEAKS)
    assert "'masks': []" in captured[-1] or '"masks": []' in captured[-1] or "aaaa" not in captured[-1]


# ── the switch: no row-level sample on any path ──


def test_switch_column_matcher_sends_counts_only(captured, monkeypatch, switch) -> None:
    from api.services import ai_column_matcher as m

    switch(True)
    monkeypatch.setattr(m, "get_llm", lambda: object())
    headers, rows = ["Plant", "Col2"], [["1000", "AB-1"], ["1010", "AB-2"]]
    m._llm_match_columns(headers, rows, headers, {"T001W.WERKS"}, "business_partner")
    p = captured[0]
    assert "Plant: rows=2 blank=0 distinct=2 length=4-4 kind=numeric (shape withheld)" in p
    assert "masks=" not in p and "1000" not in p and "AB-1" not in p
    # fallback with no samples at all still works
    assert m._llm_match_columns(["Plant"], [], ["Plant"], {"T001W.WERKS"}, "business_partner")[0]["source"] == "Plant"


def test_switch_semantic_matcher_makes_no_model_call(captured, monkeypatch, switch) -> None:
    from api.services import ai_semantic_matcher as sm

    monkeypatch.setenv("MERIDIAN_SEMANTIC_MATCHER_LLM", "on")
    pair = ("NAME1", "Zebratron Industrial Supplies", "Zebratron Industrial Supply Co")
    switch(True)
    score = sm.compute_semantic_score("t", "business_partner", *pair)
    assert score is None or isinstance(score, float)
    assert captured == []


def test_switch_survivorship_makes_no_model_call(captured, switch) -> None:
    from api.services import ai_survivorship as sv

    contribs = [{"source_system": "A", "value": "Zebratron", "confidence": 0.9, "extracted_at": "2026-01-01"},
                {"source_system": "B", "value": "Zebratron Ltd", "confidence": 0.8, "extracted_at": "2026-01-02"}]
    switch(True)
    assert sv.propose_field_winner("t", "KTOKK", "business_partner", contribs) is None
    assert captured == []


def test_switch_impact_inference_withholds_key_shape(captured, switch) -> None:
    from api.services import ai_impact_scorer as m

    key = "QX-0042-ABC"
    switch(False)
    m.infer_relationships("t", "business_partner", key, [], ["fi_gl"])
    switch(True)
    m.infer_relationships("t", "business_partner", key, [], ["fi_gl"])
    off, on = captured[-2:] if len(captured) >= 2 else ("", "")
    assert f"length {len(key)}" in off
    assert "withheld" in on and "mask" not in on.lower() and f"length {len(key)}" not in on


def test_switch_fix_drafter_sends_no_patterns(captured, switch) -> None:
    from api.services import fix_drafter as fd

    shape = fd.build_shape(pd.Series(["AB-1234", "AB-5678", "ab-9"]))
    rule = {"id": "R1", "field": "KTOKK", "table": "LFA1"}
    switch(False)
    fd.ask_llm("t", rule, shape)
    switch(True)
    fd.ask_llm("t", rule, shape)
    off, on = captured
    assert "AA-9999" in off and "AA-9999" not in on and "aa-9" not in on


def test_switch_rule_authoring_drops_shapes(captured, switch) -> None:
    from api.services import rule_authoring as ra

    ctx = {"module": "business_partner", "check_classes": [], "examples": [],
           "fields": [{"field": "LFA1.KTOKK", "profile": {"rows": 5, "blank": 0, "shapes": ["AA-9999"],
                                                          "shape_count": 1, "masked": False}}]}
    out = ra.redact_ctx(ctx, True)
    assert out["fields"][0]["profile"] == {"rows": 5, "blank": 0}
    assert ra.redact_ctx(ctx, False)["fields"][0]["profile"]["shapes"] == ["AA-9999"]
    assert "shapes" not in ra.redact_ctx({**ctx, "fields": [{"field": "LFA1.NAME1", "profile": {
        "rows": 1, "shapes": ["Aaaa"]}}]}, False)["fields"][0]["profile"]
    switch(True)
    ra.generate("t", "flag bad groups", ctx)
    assert captured and "AA-9999" not in captured[-1]


def test_config_matching_sends_shapes_never_values(switch) -> None:
    from agents import config_matching as cm

    finding = {"check_id": "BP_001", "field": "KTOKK", "module": "business_partner", "count": 3,
               "value_fix_map": {"ZEBR": "Z001", "__blank__": "Z001"}}
    off = cm._render_user_prompt("business_partner", [finding], {})
    on = cm._render_user_prompt("business_partner", [finding], {}, True)
    personal = cm._render_user_prompt("business_partner", [{**finding, "field": "NAME1"}], {})
    assert not any("ZEBR" in p for p in (off, on, personal))  # the switch is not what keeps values out
    assert '"AAAA"' in off and '"AAAA"' not in on and '"AAAA"' not in personal
    assert '"distinct": 1' in on and '"masked": true' in on


def test_unreadable_setting_of_a_known_tenant_fails_closed(monkeypatch) -> None:
    import workers.db as wdb
    from api.services.prompt_shapes import aggregates_only

    def down() -> None:
        raise RuntimeError("database down")

    monkeypatch.setattr(wdb, "get_sync_engine", down)
    monkeypatch.delenv("MERIDIAN_TENANT_ID", raising=False)
    assert aggregates_only("00000000-0000-0000-0000-000000000001") is True
    assert aggregates_only() is False  # no tenant at all


def test_triage_still_filters_through_sanitise_for_prompt() -> None:
    import inspect

    from workers.tasks import ai_triage

    assert "sanitise_for_prompt" in inspect.getsource(ai_triage)


# ── Postgres: the setting is tenant scoped, the route is audited ──

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROLE = "meridian_agg_app"


@pytest.fixture(scope="module")
def app_engine():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant(owner, cfg: dict | None) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, llm_config) VALUES "
                       "(:i, :n, CAST(:c AS jsonb))"),
                  {"i": tid, "n": f"agg-{tid[:8]}", "c": json.dumps(cfg) if cfg else None})
    return tid


@pg
def test_setting_is_tenant_scoped(app_engine, monkeypatch) -> None:
    from api.services.prompt_shapes import aggregates_only

    owner, app = app_engine
    on, off, unset = _tenant(owner, {"aggregates_only": True}), _tenant(owner, {"aggregates_only": False}), _tenant(owner, None)
    monkeypatch.setattr("workers.db.get_sync_engine", lambda: app)
    assert aggregates_only(on) is True
    assert aggregates_only(off) is False
    assert aggregates_only(unset) is False  # default off
    assert aggregates_only(str(uuid.uuid4())) is False  # unknown tenant
    # the request tenant is used when no argument is given, never another tenant's value
    monkeypatch.setattr("api.middleware.tenant.get_current_tenant_id", lambda: on)
    assert aggregates_only() is True
    monkeypatch.setattr("api.middleware.tenant.get_current_tenant_id", lambda: off)
    assert aggregates_only() is False
    # a config holding only the flag is not a provider config
    from sqlalchemy import text
    with owner.connect() as c:
        assert c.execute(text("SELECT llm_config->>'provider' FROM tenants WHERE id = :i"), {"i": on}).scalar() is None


@pg
def test_route_sets_flag_for_own_tenant_only_and_audits(app_engine) -> None:
    import asyncio
    from types import SimpleNamespace

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    from api.routes.llm_settings import AggregatesOnlyUpdate, set_aggregates_only

    owner, _app = app_engine
    a, b = _tenant(owner, None), _tenant(owner, None)
    url = os.environ["MERIDIAN_TEST_DB_URL"].replace("postgresql://", "postgresql+asyncpg://", 1)

    async def run() -> None:
        eng = create_async_engine(url)
        async with AsyncSession(eng) as db:
            req = SimpleNamespace(method="PUT", url=SimpleNamespace(path="/api/v1/settings/llm/aggregates-only"), headers={}, state=SimpleNamespace())
            out = await set_aggregates_only(AggregatesOnlyUpdate(aggregates_only=True), req, db,
                                            SimpleNamespace(id=uuid.UUID(a)), "admin")
            assert out == {"status": "ok", "aggregates_only": True}
        await eng.dispose()

    asyncio.run(run())
    with owner.connect() as c:
        got = {r[0]: r[1] for r in c.execute(text("SELECT id::text, llm_config->'aggregates_only' FROM tenants "
                                                  "WHERE id IN (:a, :b)"), {"a": a, "b": b})}
        audit = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :a AND action = 'llm.aggregates_only'"),
                          {"a": a}).scalar()
    assert got[a] is True and got[b] is None
    assert audit == 1

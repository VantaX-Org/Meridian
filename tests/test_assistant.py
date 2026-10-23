"""Ask Meridian (api/services/assistant.py, POST /api/v1/assistant/ask): intent matching, answer shape, the
LLM fallback and what the model is allowed to see. The Insights services are faked; no database is used."""
import asyncio
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import assistant as a

RUN = "11111111-1111-1111-1111-111111111111"
PREV = "22222222-2222-2222-2222-222222222222"

#: a record key and a field value that must never reach the model
SECRET_KEY = "MATNR-000000004711"
SECRET_VALUE = "Kettle steel 2L"


class FakeSources:
    """The Insights payload shapes, as insights_aggregate and the readiness and owner routes return them."""

    def __init__(self, empty: bool = False) -> None:
        self.empty = empty
        self.calls: list[tuple] = []

    async def overview(self, vid, module):
        self.calls.append(("overview", vid, module))
        if self.empty:
            return None
        return {
            "version_id": RUN, "previous_version_id": PREV,
            "dqs": {"composite": 72.4, "previous": 70.0, "delta": 2.4, "capped": False, "cap_reason": None},
            "blockers": {"count": 3, "previous": 4, "waves": 1},
            "narrative": [
                {"text": "The data quality score rose 2.4 points to 72.4, led by Material master completeness (+3.0).",
                 "href": f"/insights/trends?run={RUN}"},
                {"text": "3 blocking rules fail, holding up Wave 1.", "href": f"/insights/readiness?run={RUN}"},
            ],
        }

    async def rules(self, vid, module, severity, limit):
        self.calls.append(("rules", vid, module, severity, limit))
        if self.empty:
            return None
        rows = [
            {"check_id": "MM003", "name": "Material type is mandatory - drives procurement", "module": "material_master",
             "severity": "critical", "affected": 1200, "delta_affected": 40, "impact": 12000,
             "sample_values": [SECRET_VALUE], "record_key": SECRET_KEY},
            {"check_id": "BP010", "name": "Tax number format", "module": "business_partner", "severity": "high",
             "affected": 300, "delta_affected": -5, "impact": 1500},
            {"check_id": "GL002", "name": "Account group set", "module": "fi_gl", "severity": "medium",
             "affected": 90, "delta_affected": None, "impact": 180},
        ]
        rows = [r for r in rows if (not module or r["module"] == module) and (not severity or r["severity"] == severity)]
        return {"version_id": RUN, "rows": rows[:limit]}

    async def heatmap(self, vid):
        self.calls.append(("heatmap", vid))
        return None if self.empty else {"version_id": RUN, "rows": [
            {"module": "material_master", "scores": {"composite": 61.0}, "tier": {"composite": "fail"}, "critical": 1},
            {"module": "business_partner", "scores": {"composite": 80.5}, "tier": {"composite": "warn"}, "critical": 0},
            {"module": "fi_gl", "scores": {"composite": 93.0}, "tier": {"composite": "pass"}, "critical": 0},
        ]}

    async def trends(self, vid):
        self.calls.append(("trends", vid))
        return {"lineage": "sys", "runs": [
            {"version_id": PREV, "run_at": "2026-09-01T10:00:00", "composite": 70.0, "rules_fixed": None, "rules_new": None},
            {"version_id": RUN, "run_at": "2026-10-01T10:00:00", "composite": 72.4, "rules_fixed": 4, "rules_new": 2},
        ]}

    async def root_causes(self, vid, module):
        return {"version_id": RUN, "clusters": [
            {"module": "material_master", "field": "MARA.MTART", "rules": ["MM003", "MM004"], "impact": 900,
             "records": 1300, "auto_fix_pct": 40.0},
            {"module": "fi_gl", "field": None, "rules": ["GL002"], "impact": 100, "records": 90},
        ]}

    async def cleansing(self, vid, module):
        return {"version_id": RUN, "steps": [
            {"key": "failing", "label": "Failing records", "records": 1000},
            {"key": "proposed", "label": "With a proposed value", "records": 600},
            {"key": "high", "label": "High confidence", "records": 300},
            {"key": "approved", "label": "Approved", "records": 200},
            {"key": "applied", "label": "Applied", "records": 50},
        ]}

    async def readiness(self, vid):
        return {"version_id": RUN, "configured": True, "cells": [
            {"module": "material_master", "wave": "Wave 1", "verdict": "no_go", "blocker_count": 3, "dqs": 61.0,
             "score": 40.0, "records_blocked": 900},
            {"module": "fi_gl", "wave": "Wave 2", "verdict": "go", "blocker_count": 0, "dqs": 93.0, "score": 95.0,
             "records_blocked": 0},
        ]}

    async def owners(self):
        return {"owners": [
            {"owner": "Ana Steward", "score": 60.0, "delta": -2.0, "open_by_severity": {"critical": 2, "high": 5},
             "fixed_since_baseline": 3, "oldest_item_age_days": 12},
            {"owner": "Ben Lead", "score": 90.0, "delta": 1.0, "open_by_severity": {"low": 2},
             "fixed_since_baseline": 1, "oldest_item_age_days": 3},
        ]}


def run(coro):
    return asyncio.run(coro)


def ask(q, src=None, module=None, vid=None):
    return run(a.ask(q, vid, module, src or FakeSources(), str(uuid.uuid4())))


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    """No test reaches a real model: off unless a test turns it on."""
    from llm import provider

    monkeypatch.setattr(provider, "llm_is_noop", lambda: True)


# ── intent matching ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("question, intent", [
    ("How has the score moved?", "score"),
    ("What is our DQS?", "score"),
    ("Which objects are weakest?", "weakest_objects"),
    ("What are the lowest scoring modules", "weakest_objects"),
    ("What are the top failing rules?", "top_rules"),
    ("What should I fix first?", "top_rules"),
    ("Show me the critical rules", "top_rules"),
    ("How many critical findings are there?", "critical"),
    ("What is blocking wave 1?", "readiness"),
    ("Are we ready for migration?", "readiness"),
    ("What are the root causes?", "root_causes"),
    ("How many fixes are proposed, approved and applied?", "fixes"),
    ("Who has the most open work?", "owners"),
    ("Which owners have critical items?", "owners"),
    ("What changed since the last run?", "changes"),
    ("Which rules are newly failing?", "changes"),
    ("What can you answer?", "help"),
    ("Tell me a joke about penguins", None),
])
def test_intent_matching(question, intent):
    assert a.match(question).intent == intent


def test_matching_reads_object_and_severity():
    m = a.match("What are the worst high rules in material master?")
    assert (m.intent, m.module, m.severity) == ("top_rules", "material_master", "high")
    assert a.match("top failing rules in FI general ledger").module == "fi_gl"
    assert a.match("top rules for sd_customer_master").module == "sd_customer_master"
    assert a.match("top rules for customer master").module == "sd_customer_master"
    # a bare object name asks for that object's score
    assert (a.match("Material master").intent, a.match("Material master").module) == ("score", "material_master")


def test_context_module_used_when_question_names_none():
    assert a.match("What are the top rules?", module="fi_gl").module == "fi_gl"
    assert a.match("Top rules in material master", module="fi_gl").module == "material_master"
    assert a.match("What are the top rules?", module="not_a_module").module is None


# ── answers ──────────────────────────────────────────────────────────────────

def _shape(out: dict) -> None:
    assert set(out) == {"answer", "intent", "data", "chart", "links", "ai", "version_id"}
    assert isinstance(out["answer"], str) and out["answer"]
    assert out["ai"] is False
    assert out["chart"] in (None, "bar", "line")
    assert out["data"] is None or all(set(d) == {"label", "value"} for d in out["data"])
    for link in out["links"]:
        assert link["href"].startswith("/") and not link["href"].startswith("//")


@pytest.mark.parametrize("question, intent", [
    ("How has the score moved?", "score"),
    ("Which objects are weakest?", "weakest_objects"),
    ("What are the top failing rules?", "top_rules"),
    ("How many critical findings are there?", "critical"),
    ("What is blocking the waves?", "readiness"),
    ("What are the root causes?", "root_causes"),
    ("How many fixes are approved?", "fixes"),
    ("Who has the most open work?", "owners"),
    ("What changed since the last run?", "changes"),
])
def test_every_intent_answers_in_shape(question, intent):
    out = ask(question)
    _shape(out)
    assert out["intent"] == intent
    assert out["links"]
    # plain speech, at most three sentences
    assert out["answer"].count(". ") <= 2


def test_score_answer():
    out = ask("How has the score moved?")
    assert "72.4" in out["answer"] and "rose 2.4" in out["answer"]
    assert out["chart"] == "line" and [d["value"] for d in out["data"]] == [70.0, 72.4]
    assert out["version_id"] == RUN
    assert {"label": "Open trends", "href": f"/insights/trends?run={RUN}"} in out["links"]


def test_object_score_links_to_the_object():
    out = ask("How is material master doing?")
    assert out["intent"] == "score"
    assert out["answer"].startswith("Material master scores 72.4")
    assert out["links"][0]["href"] == f"/objects/material_master?run={RUN}"


def test_weakest_objects_ranked_with_names():
    out = ask("Which objects are weakest?")
    assert out["answer"].startswith("The weakest objects are Material master at 61.0, Business partner at 80.5")
    assert "FI general ledger" in out["answer"]
    assert "1 of 3 scored objects meets the target" in out["answer"]
    assert out["data"][0] == {"label": "Material master", "value": 61.0}


def test_top_rules_for_one_object_and_severity_pass_filters():
    src = FakeSources()
    out = ask("What are the worst critical rules in material master?", src)
    assert ("rules", None, "material_master", "critical", a.TOP_N) in src.calls
    assert "MM003 in Material master on 1,200 records" in out["answer"]
    assert out["links"][0]["href"] == f"/insights/rules?run={RUN}&module=material_master&severity=critical"
    assert out["links"][1]["href"] == f"/objects/material_master?run={RUN}&rule=MM003"


def test_critical_uses_the_commentary_builder():
    out = ask("How many critical findings are there?")
    assert out["answer"].startswith("1 critical check fails across 1 module, on 1,200 records in total.")
    assert out["links"][0]["href"].endswith("severity=critical")


def test_readiness_by_wave():
    out = ask("What is blocking the waves?")
    assert "3 blocking rules fail" in out["answer"]
    assert "Wave 1 is no-go and Wave 2 is go" in out["answer"]
    assert out["data"] == [{"label": "Wave 1", "value": 3}, {"label": "Wave 2", "value": 0}]


def test_fixes_funnel():
    out = ask("How many fixes are proposed?")
    assert out["answer"].startswith("Of 1,000 failing records, 600 have a proposed fix, 200 are approved and 50 are applied.")
    assert {"label": "Open Fix", "href": "/fix"} in out["links"]


def test_owners_most_open_first():
    out = ask("Who has the most open work?")
    assert "Ana Steward holds 7 open items" in out["answer"]
    assert out["data"][0] == {"label": "Ana Steward", "value": 7}


def test_changes_since_previous_run():
    out = ask("What changed since the last run?")
    assert "rose 2.4 points" in out["answer"]
    assert "4 rules that failed before pass now and 2 rules started failing" in out["answer"]
    assert out["links"][0]["href"] == f"/runs/{RUN}/vs/{PREV}"


def test_no_run_answers_politely():
    out = ask("Which objects are weakest?", FakeSources(empty=True))
    _shape(out)
    assert "no finished run" in out["answer"]


def test_a_failing_service_never_raises(caplog):
    class Broken(FakeSources):
        async def heatmap(self, vid):
            raise RuntimeError("db down")

    out = ask("Which objects are weakest?", Broken())
    _shape(out)
    assert out["answer"].startswith("I could not work that out")
    assert "db down" not in out["answer"]


# ── the LLM fallback ─────────────────────────────────────────────────────────

def test_fallback_when_llm_off_lists_examples():
    out = ask("Tell me a joke about penguins")
    _shape(out)
    assert out["intent"] == "unknown"
    for q in a.EXAMPLES:
        assert q in out["answer"]


def test_llm_context_holds_aggregates_only():
    src = FakeSources()
    ctx = a.llm_context(run(src.overview(None, None)), run(src.heatmap(None)), run(src.rules(None, None, None, 10)))
    assert "MM003, Material master, critical, 1200" in ctx
    assert "Material master: 61.0" in ctx
    assert "rose 2.4 points" in ctx
    assert SECRET_KEY not in ctx and SECRET_VALUE not in ctx
    assert "Material type is mandatory" not in ctx  # rule ids only, not their wording


def test_llm_fallback_marks_ai_and_audits(monkeypatch):
    from llm import provider

    sent, logged = [], []

    async def fake_ainvoke(llm, messages, *, timeout_seconds=60):
        sent.append((messages, timeout_seconds))
        return "Material master is the object to watch."

    class FakeLLM:
        model = "test-model"

    monkeypatch.setattr(provider, "llm_is_noop", lambda: False)
    monkeypatch.setattr(provider, "get_llm_safe", lambda: FakeLLM())
    monkeypatch.setattr(provider, "safe_ainvoke", fake_ainvoke)
    monkeypatch.setattr("api.utils.llm_logger.log_llm_call", lambda *args, **kw: logged.append(args))

    out = ask("Tell me a joke about penguins")
    _shape({**out, "ai": False})
    assert out["ai"] is True and out["intent"] == "ai"
    assert out["answer"] == "Material master is the object to watch."
    (messages, timeout), = sent
    assert timeout == a.LLM_TIMEOUT_S
    prompt = " ".join(m["content"] for m in messages)
    assert "Tell me a joke about penguins" in prompt and "MM003" in prompt
    assert SECRET_KEY not in prompt and SECRET_VALUE not in prompt
    assert len(logged) == 1 and logged[0][1] == "assistant" and logged[0][3] == "test-model"


def test_llm_failure_falls_back_to_examples(monkeypatch):
    from llm import provider

    async def none(*args, **kw):
        return None

    monkeypatch.setattr(provider, "llm_is_noop", lambda: False)
    monkeypatch.setattr(provider, "get_llm_safe", lambda: object())
    monkeypatch.setattr(provider, "safe_ainvoke", none)
    monkeypatch.setattr("api.utils.llm_logger.log_llm_call", lambda *args, **kw: None)
    out = ask("Tell me a joke about penguins")
    assert out["ai"] is False and out["intent"] == "unknown"
    assert a.EXAMPLES[0] in out["answer"]


# ── the route ────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    from api.deps import Tenant, get_db, get_tenant
    from api.routes.assistant import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(a, "DbSources", lambda db, tenant: FakeSources())
    app = FastAPI()
    app.include_router(router)

    async def _db():
        yield object()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


def _post(client, body):
    return client.post("/api/v1/assistant/ask", json=body, headers={"X-User-Role": "viewer"})


def test_route_answers(client):
    r = _post(client, {"question": "Which objects are weakest?", "version_id": RUN})
    assert r.status_code == 200
    body = r.json()
    assert body["intent"] == "weakest_objects" and body["ai"] is False and body["chart"] == "bar"
    assert body["version_id"] == RUN


@pytest.mark.parametrize("question", ["", "   ", "x" * 501])
def test_route_rejects_empty_or_oversized_question(client, question):
    assert _post(client, {"question": question}).status_code == 422


def test_route_rejects_bad_version_id(client):
    assert _post(client, {"question": "score", "version_id": "not-a-uuid"}).status_code == 422

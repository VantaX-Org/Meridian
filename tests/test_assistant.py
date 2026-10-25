"""Ask Meridian (api/services/assistant.py, POST /api/v1/assistant/ask): intent matching, grounded answers (every
number backed by a fact), retrieval and refusal, the model's reword-only role and what it may see. The Insights,
impact, forecast and burn-down services are faked; no database is used."""
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

    async def impact(self, vid):
        return None if self.empty else {"version_id": RUN, "currency": "ZAR", "rows": [
            {"feature": "MRP_RUN", "l1": "plan_to_produce", "status": "blocked", "record_count": 900,
             "value_per_record": 150.0, "value_at_risk": 135000.0, "causing_rules": ["MM003"]},
            {"feature": "AUTOMATIC_PAYMENT", "l1": "procure_to_pay", "status": "degraded", "record_count": 300,
             "value_per_record": 50.0, "value_at_risk": 15000.0, "causing_rules": ["BP010"]},
        ]}

    async def forecast(self, module):
        return {"runs_seen": 6, "days_seen": 4, "early_warnings": [], "forecasts": [
            {"module_id": "material_master", "current_score": 61.0, "forecast_7d": 62.3, "forecast_30d": 65.8,
             "forecast_90d": 70.0, "trend": "improving", "confidence": 72.0, "points": 4, "span_days": 30.0,
             "forecast_30d_low": 61.2, "forecast_30d_high": 70.4},
            {"module_id": "fi_gl", "current_score": 93.0, "forecast_7d": 92.0, "forecast_30d": 88.5,
             "forecast_90d": 85.0, "trend": "declining", "confidence": 60.0, "points": 4, "span_days": 30.0},
        ]}

    async def burndown(self, vid, module):
        return None if self.empty else {
            "version_id": RUN, "today": "2026-10-25", "open_now": 840, "open_records": 840, "fixed_7d": 210,
            "pace_per_day": 30.0, "pace_window_days": 14, "projected_finish": "2026-11-23", "runs": [],
            "days": [{"day": "2026-10-24", "open": 870, "opened": 0, "closed": 30},
                     {"day": "2026-10-25", "open": 840, "opened": 0, "closed": 30}],
        }

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
    ("How many records fail MM045?", "rule"),
    ("What does mm_bad_uom check?", "rule"),
    ("What is the value at risk?", "value_at_risk"),
    ("How much money is at stake?", "value_at_risk"),
    ("What will the score be in 30 days?", "forecast"),
    ("Forecast material master", "forecast"),
    ("When will the open records be fixed?", "progress"),
    ("Are we on track with the backlog?", "progress"),
    ("How is project system doing?", "score"),
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

KEYS = {"answer", "intent", "data", "chart", "links", "ai", "phrased", "version_id", "facts", "coverage", "grounded"}


def _shape(out: dict) -> None:
    assert set(out) == KEYS
    assert isinstance(out["answer"], str) and out["answer"]
    assert out["ai"] is False and out["phrased"] is False
    # grounded: every number the answer states is one of its facts
    assert out["grounded"] is True, out["answer"]
    assert 0 <= out["coverage"] <= 1
    for f in out["facts"]:
        assert set(f) == {"statement", "value", "source", "href"} and f["statement"] and f["source"]
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
    ("How many records fail MM003?", "rule"),
    ("What is the value at risk?", "value_at_risk"),
    ("What will the score be in 30 days?", "forecast"),
    ("When will the open records be fixed?", "progress"),
])
def test_every_intent_answers_in_shape(question, intent):
    out = ask(question)
    _shape(out)
    assert out["intent"] == intent
    assert out["links"]
    assert out["facts"], "a grounded answer lists the figures it used"
    assert out["coverage"] == 1
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


# ── the new intents ──────────────────────────────────────────────────────────

def test_one_rule_by_id():
    out = ask("How many records fail mm003?")
    assert out["answer"].startswith("MM003 fails on 1,200 records in Material master.")
    assert "It checks that material type is mandatory" in out["answer"]
    assert "40 more than in the previous run" in out["answer"]
    assert out["links"][0]["href"] == f"/objects/material_master?run={RUN}&rule=MM003"
    assert out["facts"][0]["value"] == 1200


def test_a_rule_that_does_not_fail_says_so():
    out = ask("How many records fail XX999?")
    assert out["intent"] == "rule" and out["answer"] == "XX999 does not fail in this run." and out["grounded"]


def test_value_at_risk_in_the_tenant_currency():
    out = ask("What is the value at risk?")
    assert out["answer"].startswith("150,000 ZAR is at risk across 2 priced features.")
    assert "mRP RUN" not in out["answer"] and "135,000 ZAR" in out["answer"]
    assert out["data"][0] == {"label": "MRP RUN", "value": 135000}


def test_forecast_names_the_lowest_object_and_its_range():
    out = ask("What will the score be in 30 days?")
    assert out["answer"].startswith("Material master is forecast at 65.8 in 30 days (likely between 61.2 and 70.4), "
                                    "from 61.0 now, projected from 4 runs.")
    assert "%" not in out["answer"] and out["grounded"]
    assert out["chart"] == "line"


def test_forecast_speaks_to_the_7_day_point_when_the_api_leaves_30_days_out():
    class ShortHistory(FakeSources):
        async def forecast(self, module):
            return {"runs_seen": 3, "days_seen": 3, "early_warnings": [], "forecasts": [
                {"module_id": "fi_gl", "current_score": 90.0, "forecast_7d": 88.0, "forecast_30d": None,
                 "forecast_90d": None, "trend": "declining", "confidence": 64, "points": 3, "span_days": 2.0},
            ]}

    out = ask("What will the score be in 30 days?", src=ShortHistory())
    assert "is forecast at 88.0 in 7 days, from 90.0 now" in out["answer"]
    assert [d["label"] for d in out["data"]] == ["Now", "7 days"]


def test_progress_projects_the_finish_from_the_pace():
    out = ask("When will the open records be fixed?")
    assert out["answer"] == ("840 records are open to fix, and 210 were fixed in the last 7 days. "
                             "At 30.0 records a day, the list is clear by 2026-11-23.")


# ── grounding, retrieval and refusal ─────────────────────────────────────────

def test_numbers_grounded_checks_every_number_against_the_facts():
    facts = [a.fact("MM003 fails on 1,200 records", "Rule ranking", value=1200),
             a.fact("Score now 72.4, change +2.4 points", "Run comparison")]
    assert a.numbers_grounded("1,200 records fail and the score rose 2.4 to 72.4.", facts)
    assert not a.numbers_grounded("1,300 records fail.", facts)
    # ids and words with digits are not numbers
    assert a.numbers_grounded("MM003 and BP010 in S4 fail.", facts)


def test_retrieval_answers_from_matching_figures_with_coverage(monkeypatch):
    out = ask("Is automatic payment affected?")
    _shape(out)
    assert out["intent"] == "retrieval" and a.MIN_COVERAGE <= out["coverage"] < 1
    assert "AUTOMATIC PAYMENT: 15,000 ZAR on 300 records (degraded)." in out["answer"]
    assert any(f["source"] == "Value at risk" for f in out["facts"])


def test_refuses_when_the_figures_do_not_cover_the_question():
    out = ask("Tell me a joke about penguins")
    assert out["intent"] == "refused" and out["coverage"] == 0 and out["facts"] == []
    assert out["answer"].startswith("Your figures do not answer that.")
    assert a.EXAMPLES[0] in out["answer"]


def test_retrieve_ranks_by_shared_words():
    facts = [a.fact("Wave 1 is no-go", "Wave readiness"), a.fact("Material master: 61.0", "Object scores")]
    picked, coverage = a.retrieve("is wave 1 no-go", facts)
    assert picked[0]["statement"] == "Wave 1 is no-go" and coverage == 1.0
    assert a.retrieve("penguins", facts) == ([], 0.0)


def _model(monkeypatch, reply):
    from llm import provider

    sent, logged = [], []

    async def fake_ainvoke(llm, messages, *, timeout_seconds=60):
        sent.append((messages, timeout_seconds))
        return reply

    class FakeLLM:
        model = "test-model"

    monkeypatch.setattr(provider, "llm_is_noop", lambda: False)
    monkeypatch.setattr(provider, "get_llm_safe", lambda: FakeLLM())
    monkeypatch.setattr(provider, "safe_ainvoke", fake_ainvoke)
    monkeypatch.setattr("api.utils.llm_logger.log_llm_call", lambda *args, **kw: logged.append(args))
    return sent, logged


def test_the_model_only_rewords_and_is_audited(monkeypatch):
    sent, logged = _model(monkeypatch, "Automatic payment is degraded, with 15,000 ZAR at stake.")
    out = ask("Is automatic payment affected?")
    assert out["intent"] == "retrieval" and out["phrased"] is True and out["ai"] is True and out["grounded"]
    assert out["answer"] == "Automatic payment is degraded, with 15,000 ZAR at stake."
    (messages, timeout), = sent
    assert timeout == a.LLM_TIMEOUT_S
    prompt = " ".join(m["content"] for m in messages)
    assert "AUTOMATIC PAYMENT: 15,000 ZAR" in prompt
    assert SECRET_KEY not in prompt and SECRET_VALUE not in prompt
    assert len(logged) == 1 and logged[0][1] == "assistant" and logged[0][3] == "test-model"


def test_a_reword_that_adds_a_number_is_dropped(monkeypatch):
    _model(monkeypatch, "Automatic payment is degraded on 17 records.")
    out = ask("Is automatic payment affected?")
    assert out["phrased"] is False and "17" not in out["answer"] and out["grounded"]


def test_the_model_is_never_asked_for_a_recognised_question(monkeypatch):
    sent, _ = _model(monkeypatch, "anything")
    assert ask("Which objects are weakest?")["phrased"] is False
    assert sent == []


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
    assert body["grounded"] is True and body["coverage"] == 1 and body["facts"][0]["source"] == "Object scores"


@pytest.mark.parametrize("question", ["", "   ", "x" * 501])
def test_route_rejects_empty_or_oversized_question(client, question):
    assert _post(client, {"question": question}).status_code == 422


def test_route_rejects_bad_version_id(client):
    assert _post(client, {"question": "score", "version_id": "not-a-uuid"}).status_code == 422

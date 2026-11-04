"""Aletheia rule for every LLM call site: the prompt carries shapes and counts, never a SAP value, and a model
answer is proved server-side. One test per service; fixtures are synthetic and non-personal."""
import json

import pytest

from api.services.prompt_shapes import column_profile, shape

# Synthetic strings standing in for SAP values. None may appear in any built prompt.
VALUE_A = "Zebratron Qwerty 77"
VALUE_B = "Zebratron Qwerti 77"
KEY = "QX7741ZZ"


def _codes(proof: dict) -> dict:
    return {c["code"]: c["passed"] for c in proof["checks"]}


def test_shapes_hold_no_value_characters() -> None:
    s = shape(VALUE_A)
    assert s["length"] == len(VALUE_A) and s["mask"] == "Aaaaaaaaa~Aaaaaa~99"
    p = column_profile([VALUE_A, VALUE_A, "", KEY])
    assert (p["rows"], p["blank"], p["distinct"]) == (4, 1, 2)
    assert VALUE_A not in json.dumps(p) and KEY not in json.dumps(p)


def test_semantic_matcher_prompt_and_verify() -> None:
    from sap.deterministic import FieldType

    from api.services import ai_semantic_matcher as m

    f = m.facts("NAME1", VALUE_A, VALUE_B, 0.7, FieldType.NAME)
    prompt = m._build_prompt("business_partner", f)
    assert VALUE_A not in prompt and VALUE_B not in prompt and "Zebratron" not in prompt
    assert str(shape(VALUE_A)["mask"]) in prompt

    assert m.verify({"similarity": 0.8, "reasoning": "free text"}, 0.7) == {
        "verified": True, "checks": [{"code": "SIMILARITY_IS_NUMBER", "passed": True},
                                     {"code": "SIMILARITY_IN_RANGE", "passed": True}], "similarity": 0.8}
    for bad in ({"similarity": 1.7}, {"similarity": "high"}, {"similarity": True}, {}, [0.9], None):
        proof = m.verify(bad, 0.7)
        assert not proof["verified"] and proof["similarity"] == 0.7  # falls back to the deterministic score


def test_column_matcher_prompt_and_verify() -> None:
    from api.services import ai_column_matcher as m

    headers = ["Col A", "Col B"]
    rows = [[VALUE_A, KEY], [VALUE_B, KEY]]
    f = m.facts(headers, rows, headers, {"LFA1.KTOKK", "MARA.MTART"}, "accounts_payable")
    prompt = m._build_prompt(f)
    for v in (VALUE_A, VALUE_B, KEY, "Zebratron"):
        assert v not in prompt
    assert "Col A: rows=2 blank=0 distinct=2" in prompt

    fields = {"LFA1.KTOKK", "MARA.MTART"}
    good = {"source": "Col A", "target": "LFA1.KTOKK", "confidence": 0.9}
    assert m.verify(good, headers, fields)["verified"]
    assert m.verify({"source": "Col A", "target": None, "confidence": 0.0}, headers, fields)["verified"]
    assert not _codes(m.verify({**good, "source": "Other"}, headers, fields))["SOURCE_OFFERED"]
    assert not _codes(m.verify({**good, "target": "FAKE.FIELD"}, headers, fields))["TARGET_IN_SCHEMA"]
    assert not _codes(m.verify({**good, "confidence": 9}, headers, fields))["CONFIDENCE_IN_RANGE"]
    assert not m.verify("not a dict", headers, fields)["verified"]


def test_column_matcher_drops_a_bad_mapping_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import ai_column_matcher as m

    class _Resp:
        content = json.dumps([{"source": "Col A", "target": "FAKE.FIELD", "confidence": 0.99},
                              {"source": "Col B", "target": "MARA.MTART", "confidence": 0.8}])

    monkeypatch.setattr(m, "get_llm", lambda: object())
    monkeypatch.setattr("llm.provider.safe_invoke", lambda *a, **k: _Resp())
    out = m._llm_match_columns(["Col A", "Col B"], [[VALUE_A, "FERT"]], ["Col A", "Col B"], {"MARA.MTART"}, "x")
    assert out == [{"source": "Col A", "target": None, "confidence": 0.0},
                   {"source": "Col B", "target": "MARA.MTART", "confidence": 0.8}]


def test_impact_scorer_prompt_and_verify(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import ai_impact_scorer as m

    related = [{"to_domain": "material_master", "relationship_type": "uses", "sap_link_table": "MARC"}]
    inference = m._build_inference_prompt("business_partner", KEY, related, ["fi_gl", "hcm"])
    assert KEY not in inference and "QX" not in inference and "reasoning" not in inference
    assert f"length {len(KEY)}" in inference
    assert KEY not in m._build_impact_prompt("NAME1", "business_partner", related)

    assert m.verify_impact({"impact_score": 0.4, "affected_domains": ["material_master"]}, related)["verified"]
    assert not _codes(m.verify_impact({"impact_score": 3, "affected_domains": []}, related))["IMPACT_SCORE_IN_RANGE"]
    assert not _codes(m.verify_impact({"impact_score": 0.4, "affected_domains": ["invented"]}, related))[
        "AFFECTED_DOMAINS_OFFERED"]

    ok = {"to_domain": "fi_gl", "relationship_type": "posts_to", "confidence": 0.8}
    assert m.verify_inference(ok, ["fi_gl", "hcm"], related)["verified"]
    assert not _codes(m.verify_inference({**ok, "to_domain": "zzz"}, ["fi_gl"], related))["TO_DOMAIN_CANDIDATE"]
    assert not _codes(m.verify_inference({**ok, "to_domain": "material_master"}, ["material_master"], related))[
        "NOT_ALREADY_KNOWN"]
    assert not _codes(m.verify_inference({**ok, "confidence": 2}, ["fi_gl"], related))["CONFIDENCE_IN_RANGE"]

    # end to end: model free text is not stored, a bad answer claims no impact
    answers = iter([json.dumps({"impact_score": 0.5, "affected_domains": ["material_master"], "rationale": "LEAK"}),
                    json.dumps({"impact_score": 7, "affected_domains": []})])

    class _Llm:
        def bind(self, **_k):
            return self

    monkeypatch.setattr("llm.provider.get_llm", lambda: _Llm())
    monkeypatch.setattr("llm.provider.safe_invoke", lambda *a, **k: next(answers))
    monkeypatch.setattr(m, "log_llm_call", lambda **k: None)
    good = m.score_impact("t", "NAME1", "no_such_domain_zz", related)
    assert good["impact_score"] == 0.5 and "LEAK" not in good["rationale"]
    bad = m.score_impact("t", "NAME1", "no_such_domain_zz", related)
    assert bad["impact_score"] == 0.0 and bad["affected_domains"] == []


def test_triage_prompt_and_verify() -> None:
    from workers.tasks import ai_triage as m

    item = {"item_type": "contract_breach", "domain": "business_partner", "priority": 1, "status": "open",
            "source_metadata": {"contract_name": VALUE_A, "producer": VALUE_B, "technical_name": KEY,
                                "severity": "high", "total_score": 0.5, "exception_type": VALUE_A}}
    prompt = m._build_triage_prompt(item)
    for v in (VALUE_A, VALUE_B, KEY, "Zebratron"):
        assert v not in prompt
    assert "severity: high" in prompt and "total_score: 0.5" in prompt

    assert m._parse_llm_response('{"recommendation": "approve", "justification": "LEAK", "confidence": 0.9}') == (
        "approve: AI-assisted triage suggestion, verified", 0.9)
    for bad in ('{"recommendation": "delete", "confidence": 0.9}', '{"recommendation": "approve", "confidence": 1.5}',
                '{"recommendation": "approve"}', "free text answer " + VALUE_A, "{not json}"):
        assert m._parse_llm_response(bad) == ("review_manually", 0.0)
    assert not _codes(m.verify({"recommendation": "x", "confidence": 0.5}))["ACTION_ALLOWED"]


def test_rule_proposal_prompt_and_verify() -> None:
    from workers.tasks import rule_proposal_task as m

    rows = [(1, "approve", "reject", f"vendor {VALUE_A} iban {KEY}", None),
            (2, "approve", "reject", None, None),
            (3, "approve", f"decision {VALUE_B}", "x", None)]
    summary = m._summarise_corrections(rows)
    dumped = json.dumps(summary)
    for v in (VALUE_A, VALUE_B, KEY, "Zebratron"):
        assert v not in dumped
    assert summary["total_corrections"] == 3 and summary["patterns"]["corrections_with_reason"] == 2
    assert summary["patterns"]["decision_distribution"] == {"reject": 2, "other": 1}

    known = {"LFA1.NAME1", "NAME1"}
    good = {"proposed_rule": {"field": "NAME1", "match_type": "fuzzy", "weight": 40, "threshold": 0.8},
            "rationale": "LEAK"}
    assert m.verify(good, known)["verified"]

    def with_rule(**kw):
        return {"proposed_rule": {**good["proposed_rule"], **kw}}

    assert not _codes(m.verify(with_rule(field="INVENTED"), known))["FIELD_KNOWN"]
    assert not _codes(m.verify(with_rule(match_type="magic"), known))["MATCH_TYPE_ALLOWED"]
    assert not _codes(m.verify(with_rule(weight=500), known))["WEIGHT_IN_RANGE"]
    assert not _codes(m.verify(with_rule(threshold=1.5), known))["THRESHOLD_IN_RANGE"]
    assert not m.verify("nope", known)["verified"]

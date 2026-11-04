"""Aletheia verified survivorship: the prompt carries shapes only, and a model pick wins only when proved."""
from datetime import datetime, timezone

from api.routes.aletheia_survivorship import summarise
from api.services import ai_survivorship as ai

T = datetime(2026, 1, 2, tzinfo=timezone.utc)


def _c(src, val):
    return {"source_system": src, "extracted_at": T, "confidence": 0.9, "value": val}


CS = [_c("SYS_A", "ACME-1234"), _c("SYS_B", "ACME-1234"), _c("SYS_C", "")]


def test_prompt_has_no_value_preview_or_hash():
    p = ai._build_prompt("MATNR", "material_master", CS)
    assert "ACME" not in p and "1234" not in p and "preview" not in p.lower() and "hash" not in p.lower()
    assert "AAAA-9999" in p and "same value: 1" in p


def test_verify_accepts_a_real_non_blank_source():
    v = ai.verify(CS, {"recommended_value_source": "SYS_A", "confidence": 0.8})
    assert v["verified"] and "1 of the other 2" in v["reasoning"]


def test_verify_rejects_invented_blank_and_bad_confidence():
    assert not ai.verify(CS, {"recommended_value_source": "SYS_Z", "confidence": 0.8})["verified"]
    assert not ai.verify(CS, {"recommended_value_source": "SYS_C", "confidence": 0.8})["verified"]
    bad = ai.verify(CS, {"recommended_value_source": "SYS_A", "confidence": 7})
    assert [c["code"] for c in bad["checks"] if not c["passed"]] == ["CONFIDENCE_VALID"]


def test_summary_counts_unproved_legacy_entries_as_rejected():
    rows = [("material_master", "K1", "MAKTX", {"ai_recommendation": "SYS_A", "ai_verification": {"verified": True, "checks": []}}),
            ("material_master", "K2", "MAKTX", {"ai_recommendation": "SYS_A"})]
    out = summarise(rows, 10)
    assert out["domains"] == [{"domain": "material_master", "verified": 1, "rejected": 1}]
    assert len(out["picks"]) == 2 and "value" not in out["picks"][0]

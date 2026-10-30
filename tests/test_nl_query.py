"""The rule-based natural language parser (api/services/nl_query.py): sentences to the /work/records filter, the
explanation, the unmatched words, the href; and the optional LLM fallback taking only closed-vocabulary answers."""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from api.services import nl_query as nl

SYSTEMS = [{"id": "sys-ecc", "name": "ECC production", "system_type": "ecc"},
           {"id": "sys-s4a", "name": "S4 quality", "system_type": "s4hana"},
           {"id": "sys-s4b", "name": "S4 sandbox", "system_type": "s4hana"}]
PEOPLE = [{"id": "u-bob", "name": "Bob Steward", "email": "bob@example.com"},
          {"id": "u-cara", "name": "Cara Owner", "email": "cara@example.com"},
          {"id": "u-cal", "name": "Cara Lead", "email": "cl@example.com"}]


@pytest.fixture(scope="module")
def vocab():
    return nl.tenant_vocab(SYSTEMS, PEOPLE)


@pytest.mark.parametrize("q, expected", [
    ("critical material master records assigned to me due this week",
     {"severity": "critical", "module": "material_master", "assigned": "me", "due": "week"}),
    ("rules failing on vendor bank data in ECC production", {"policy": "sox:vendor_bank", "system": "sys-ecc"}),
    ("unassigned blockers from uploads that are overdue",
     {"assigned": "unassigned", "severity": "blocking", "system": "upload", "due": "overdue"}),
    ("open MM001 failures for Bob", {"status": "open", "check_id": "MM001", "assigned": "u-bob"}),
    ("assigned to bob steward", {"assigned": "u-bob"}),
    ("false positives in the general ledger", {"status": "not_an_issue", "module": "fi_gl"}),
    ("vendors with proposals", {"module": "accounts_payable", "proposed": True}),
    ("GDPR personal data in hr", {"policy": "gdpr", "module": "hcm"}),
    ("expiry dates of batches due today", {"policy": "gxp:shelf_life", "module": "batch_management", "due": "today"}),
    ("ecc", {"system": "sys-ecc"}),
])
def test_sentences(vocab, q, expected):
    out = nl.parse(q, vocab)
    assert out["filter"] == expected, out
    assert out["unmatched_words"] == []


def test_longest_phrase_wins(vocab):
    # "vendor bank data" is the SOX class, not the vendor object followed by unknown words
    assert nl.parse("vendor bank data", vocab)["filter"] == {"policy": "sox:vendor_bank"}
    assert nl.parse("vendor", vocab)["filter"] == {"module": "accounts_payable"}


def test_ambiguous_names_are_not_guessed(vocab):
    # two people are called Cara and two systems are S/4: neither alone resolves
    out = nl.parse("cara s4hana", vocab)
    assert out["filter"] == {} and out["unmatched_words"] == ["cara", "s4hana"]
    assert "Not understood: cara, s4hana" in out["explanation"]
    assert nl.parse("cara owner", vocab)["filter"] == {"assigned": "u-cara"}


def test_one_value_per_slot(vocab):
    out = nl.parse("critical high material master", vocab)
    assert out["filter"] == {"severity": "critical", "module": "material_master"}
    assert "Ignored" in out["explanation"] and "only one severity" in out["explanation"]


def test_unknown_words_and_explanation(vocab):
    out = nl.parse("show me the wibbly records", vocab)
    assert out["filter"] == {} and out["unmatched_words"] == ["wibbly"]
    assert out["explanation"].startswith("No filter recognised")
    assert "·" not in out["explanation"]


def test_href_carries_the_filter(vocab):
    out = nl.parse("critical material master records assigned to me", vocab)
    h = nl.href(out["filter"])
    u = urlparse(h)
    assert u.path == "/work"
    assert parse_qs(u.query) == {"severity": ["critical"], "module": ["material_master"], "assigned": ["me"]}
    assert nl.href({"proposed": True}) == "/work?proposed=true" and nl.href({}) == "/work"


def test_filter_values_are_what_work_records_accepts(vocab):
    import re
    from api.routes.work import OPEN, SEVERITIES

    statuses = {"open", "all", *OPEN, "not_an_issue", "fixed"}
    for phrase, options in vocab.phrases.items():
        for slot, value, _label in options:
            assert slot in {"severity", "status", "due", "assigned", "proposed", "system", "module", "policy"}
            if slot == "severity":
                assert value in (*SEVERITIES, "blocking")
            elif slot == "status":
                assert value in statuses
            elif slot == "due":
                assert re.match("^(overdue|today|week)$", value)


def test_llm_fallback_takes_only_closed_vocabulary(vocab, monkeypatch):
    sent = []

    def fake(messages):
        sent.append(messages)
        return '{"grumpy": "critical", "wibble": "drop table users", "other": "high"}'

    mapped = nl.classify_unmatched(["grumpy", "wibble"], vocab, invoke=fake)
    assert mapped == {"grumpy": "critical"}
    body = sent[0][1]["content"]
    assert '"grumpy"' in body and "u-bob" not in body  # words and phrases only, never ids or record data
    assert nl.classify_unmatched([], vocab, invoke=fake) == {}
    assert nl.classify_unmatched(["x"], vocab, invoke=lambda m: "not json") == {}
    monkeypatch.delenv("MERIDIAN_NL_LLM", raising=False)
    assert nl.llm_enabled() is False

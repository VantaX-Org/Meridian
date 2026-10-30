"""The AI column matcher redacts sample values by header name and by mapped SAP field (D-19).

Uploads often carry business headers ("Vendor name", "Bank account") rather than SAP field names, so redaction
that keyed on SAP names alone sent those values to the model before the column was mapped.
"""

from __future__ import annotations

import pytest

from api.utils.pii_fields import is_pii_field, is_pii_header, sanitise_for_prompt


@pytest.mark.parametrize("header", ["NAME1", "lfa1.name1", "Vendor Name", "vendorName", "Bank account", "IBAN",
                                    "E-mail", "Street", "Postal code", "Date of birth", "Tax number"])
def test_personal_headers_are_redacted(header: str) -> None:
    assert is_pii_header(header)
    assert sanitise_for_prompt(header, "Jane Doe") == "[REDACTED]"


@pytest.mark.parametrize("header", ["Material", "MATNR", "Plant", "Company code", "Unit of measure", "sap_object_key"])
def test_other_headers_pass_through(header: str) -> None:
    assert not is_pii_header(header)
    assert sanitise_for_prompt(header, "1000") == "1000"


def test_a_neutral_header_mapped_to_a_pii_field_is_redacted() -> None:
    assert is_pii_field("LFA1.STRAS") and is_pii_field("BUT000.NAME_ORG1") and not is_pii_field("MARA.MATNR")
    assert sanitise_for_prompt("Col 7", "Main Road 1", "LFA1.STRAS") == "[REDACTED]"
    assert sanitise_for_prompt("Col 7", "FERT", "MARA.MTART") == "FERT"


def test_the_matcher_prompt_carries_no_personal_values(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import ai_column_matcher as m

    prompts: list[str] = []

    class _Resp:
        content = "[]"

    monkeypatch.setattr(m, "get_llm", lambda: object())
    monkeypatch.setattr("llm.provider.safe_invoke", lambda _llm, msgs, timeout_seconds=30: prompts.append(msgs[1].content) or _Resp())
    monkeypatch.setattr(m, "_log_llm_call", lambda *a: None)
    # "Supplier label" is no PII word; the catalogue says it is LFA1.NAME1
    monkeypatch.setattr(m, "_candidate_index", lambda: {"supplier label": "LFA1.NAME1"})
    headers = ["Supplier label", "Vendor name", "Payment ref", "Kind"]
    rows = [["Acme Holdings", "Jane Doe", "DE89370400440532013000", "ZLIF"]]
    m._llm_match_columns(["Supplier label", "Vendor name", "Kind"], rows, headers, {"LFA1.KTOKK"}, "accounts_payable")
    (prompt,) = prompts
    assert "Acme Holdings" not in prompt and "Jane Doe" not in prompt
    assert "Supplier label=[REDACTED]" in prompt and "Vendor name=[REDACTED]" in prompt
    assert "Kind=ZLIF" in prompt
    assert "DE89370400440532013000" not in prompt  # a matched column never reaches the model at all

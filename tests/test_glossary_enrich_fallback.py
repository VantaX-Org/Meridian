"""With no LLM (Tier-2 Ollama dropped), the glossary draft must not go empty.

The bundled Ollama can be removed from a customer stack. When it is, `get_llm()`
resolves to the no-op provider and `safe_invoke` returns None. The enricher must
then build real business prose deterministically from the structured inputs it
already holds — never the empty strings it used to return (feature loss).
"""

from __future__ import annotations

from llm.provider import clear_llm_cache
from api.services.ai_glossary_enricher import enrich_term, normalise


def test_enrich_term_falls_back_to_deterministic_prose_without_llm(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "none")
    clear_llm_cache()

    out = enrich_term(
        tenant_id="t1",
        technical_name="Reconciliation Account in General Ledger",
        sap_table="LFB1",
        sap_field="AKONT",
        why_it_matters="The G/L account that vendor postings reconcile to.",
        sap_impact="Wrong value misstates payables in the balance sheet.",
        skip_rate_limit=True,
    )

    assert out["business_definition"], "business_definition must not be empty without an LLM"
    assert out["why_it_matters_business"], "why_it_matters_business must not be empty without an LLM"
    # Deterministic prose must survive the same schema gate the LLM answer does.
    source = "LFB1 AKONT Reconciliation Account in General Ledger The G/L account that vendor postings reconcile to. Wrong value misstates payables in the balance sheet."
    checked = normalise(out, source)
    assert not checked["rejections"], checked["rejections"]

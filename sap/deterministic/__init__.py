"""SAP-aware deterministic rule package.

Pure-Python, zero-I/O helpers used by match / survivorship / triage / impact to
resolve the overwhelming majority of records without an LLM call.

The public surface is intentionally small — services should import from here
instead of rolling their own normalisation / similarity logic.

Modules:
    normalize       — canonicalisers (country, currency, phone, email, uom, ...)
    synonyms        — SAP-specific abbreviation / synonym tables
    field_classifier — classify SAP fields by semantic type
    similarity      — deterministic similarity tiers (match/uncertain/no_match)
"""

from __future__ import annotations

from sap.deterministic.field_classifier import FieldType, classify_field
from sap.deterministic.normalize import (
    canonical_country,
    canonical_currency,
    canonical_email,
    canonical_phone,
    canonical_uom,
    collapse_whitespace,
    strip_diacritics,
    strip_legal_suffix,
    uppercase_sap_code,
)
from sap.deterministic.similarity import (
    SimilarityBand,
    classify_band,
    deterministic_similarity,
)

__all__ = [
    "FieldType",
    "classify_field",
    "canonical_country",
    "canonical_currency",
    "canonical_email",
    "canonical_phone",
    "canonical_uom",
    "collapse_whitespace",
    "strip_diacritics",
    "strip_legal_suffix",
    "uppercase_sap_code",
    "SimilarityBand",
    "classify_band",
    "deterministic_similarity",
]

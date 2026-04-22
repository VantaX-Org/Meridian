"""Canonicalisers for SAP field values.

Every function is:
    - Pure (no I/O, no globals mutated)
    - Deterministic (same input → same output)
    - Null-tolerant (returns empty string / None on invalid input, never raises)
    - Fast (no allocations in the hot path beyond what Python forces)

These are the building blocks the semantic matcher / survivorship chain use
to avoid LLM calls for the overwhelming majority of records.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

from sap.deterministic.synonyms import (
    BUSINESS_ABBR,
    COUNTRY_ALIASES,
    CURRENCY_ALIASES,
    LEGAL_SUFFIXES,
    UOM_ALIASES,
)

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^\w\s]")
_EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$")
_DIGITS_RE = re.compile(r"\D+")
_NON_ALPHANUM_RE = re.compile(r"[^a-z0-9]+")


def _as_str(value: object) -> str:
    """Safe-coerce any value to a stripped string (empty on None)."""
    if value is None:
        return ""
    s = str(value).strip()
    return s


def collapse_whitespace(value: object) -> str:
    """Collapse any run of whitespace to a single space and strip."""
    return _WS_RE.sub(" ", _as_str(value)).strip()


def strip_diacritics(value: object) -> str:
    """NFKD-decompose and drop combining marks — Å→A, ü→u, é→e, ß stays."""
    s = _as_str(value)
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def uppercase_sap_code(value: object) -> str:
    """Normalise a short SAP-like code: strip, uppercase, drop punctuation."""
    s = collapse_whitespace(value).upper()
    return _PUNCT_RE.sub("", s)


def strip_legal_suffix(value: object) -> str:
    """Remove trailing company-form suffixes (Inc, Ltd, GmbH, ...).

    The comparison is case-insensitive and whitespace-tolerant. Longest
    suffix wins so "Pvt Ltd" isn't truncated to just "Ltd" + "Pvt".
    """
    s = collapse_whitespace(value)
    if not s:
        return ""

    lowered = s.lower()
    for suffix in LEGAL_SUFFIXES:
        suf = suffix.lower()
        # Match " <suffix>" or ", <suffix>" or "-<suffix>" at the end.
        for sep in (" ", ", ", ",", " - ", "-"):
            needle = f"{sep}{suf}"
            if lowered.endswith(needle):
                return s[: len(s) - len(needle)].rstrip(" ,-")
        if lowered == suf:
            return ""

    return s


def _expand_business_abbr(tokens: list[str]) -> list[str]:
    """Expand known business-name abbreviations to full forms, token-wise."""
    out: list[str] = []
    for tok in tokens:
        key = tok.lower().rstrip(".")
        expanded = BUSINESS_ABBR.get(key)
        out.append(expanded if expanded else tok)
    return out


def normalize_business_name(value: object) -> str:
    """Canonical form used for company-name similarity.

    Steps:
        1. strip diacritics
        2. lowercase, collapse whitespace
        3. strip legal suffix
        4. expand known abbreviations (co → company, intl → international)
        5. drop punctuation
    """
    s = strip_diacritics(value).lower()
    s = collapse_whitespace(s)
    s = strip_legal_suffix(s).lower()
    tokens = s.split()
    tokens = _expand_business_abbr(tokens)
    joined = " ".join(tokens)
    return _PUNCT_RE.sub("", joined).strip()


def canonical_country(value: object) -> Optional[str]:
    """Return ISO 3166-1 alpha-2 code for a country value, or None.

    Accepts alpha-2, alpha-3, common English names, and SAP shorthands.
    """
    s = collapse_whitespace(value).lower()
    if not s:
        return None

    if len(s) == 2 and s.isalpha():
        return s.upper()

    alias = COUNTRY_ALIASES.get(s)
    if alias:
        return alias

    stripped = _NON_ALPHANUM_RE.sub(" ", s).strip()
    if stripped != s:
        alias = COUNTRY_ALIASES.get(stripped)
        if alias:
            return alias

    return None


def canonical_currency(value: object) -> Optional[str]:
    """Return ISO 4217 code for a currency value, or None."""
    s = collapse_whitespace(value).lower()
    if not s:
        return None

    if len(s) == 3 and s.isalpha():
        return s.upper()

    alias = CURRENCY_ALIASES.get(s)
    if alias:
        return alias

    no_punct = _NON_ALPHANUM_RE.sub(" ", s).strip()
    alias = CURRENCY_ALIASES.get(no_punct)
    if alias:
        return alias

    return None


def canonical_uom(value: object) -> Optional[str]:
    """Return SAP UoM code (T006) for a free-text unit value, or None."""
    s = collapse_whitespace(value).lower()
    if not s:
        return None

    alias = UOM_ALIASES.get(s)
    if alias:
        return alias

    no_punct = _NON_ALPHANUM_RE.sub("", s)
    alias = UOM_ALIASES.get(no_punct)
    if alias:
        return alias

    if 1 <= len(s) <= 3 and s.isalnum():
        return s.upper()

    return None


def canonical_phone(value: object) -> Optional[str]:
    """Return a best-effort E.164-like form: leading '+' plus digits only.

    Keeps a leading '+' if present, otherwise returns just the digits.
    Numbers shorter than 6 digits are rejected as unusable.
    """
    s = _as_str(value)
    if not s:
        return None

    plus = s.lstrip().startswith("+")
    digits = _DIGITS_RE.sub("", s)
    if not digits or len(digits) < 6:
        return None

    if digits.startswith("00"):
        digits = digits[2:]
        plus = True

    return ("+" + digits) if plus else digits


def canonical_email(value: object) -> Optional[str]:
    """Return a lowercase, trimmed, syntactically-valid email, or None."""
    s = _as_str(value).lower()
    if not s:
        return None
    # Strip surrounding angle brackets ("<user@foo.com>")
    s = s.strip("<>")
    if _EMAIL_RE.match(s):
        return s
    return None


def canonical_date_iso(value: object) -> Optional[str]:
    """Coerce a date/datetime-ish value to ISO-8601 date (YYYY-MM-DD).

    Handles Python datetime/date, common SAP formats (YYYYMMDD, DD.MM.YYYY),
    and ISO strings. Returns None if unparseable.
    """
    if value is None or value == "":
        return None

    # datetime / date
    if hasattr(value, "isoformat"):
        try:
            iso = value.isoformat()
            return iso[:10] if len(iso) >= 10 else None
        except Exception:  # noqa: BLE001
            return None

    s = _as_str(value)
    if not s:
        return None

    # YYYYMMDD (SAP)
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"

    # DD.MM.YYYY (SAP / European)
    if len(s) == 10 and s[2] == "." and s[5] == ".":
        return f"{s[6:10]}-{s[3:5]}-{s[0:2]}"

    # YYYY-MM-DD (ISO, possibly with time)
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]

    # MM/DD/YYYY (US)
    if len(s) == 10 and s[2] == "/" and s[5] == "/":
        return f"{s[6:10]}-{s[0:2]}-{s[3:5]}"

    return None


def canonical_amount(value: object) -> Optional[float]:
    """Coerce a numeric-ish value (possibly with thousand separators) to float.

    Handles "1,234.56", "1.234,56", "1 234.56". Returns None on failure.
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)

    s = _as_str(value)
    if not s:
        return None

    # Remove spaces (thousand sep in some locales)
    s = s.replace(" ", "")
    # If both "," and "." appear, the last one seen is the decimal separator
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # Ambiguous: "12,34" could be European decimal; treat as decimal only
        # if exactly one comma and 1-2 digits after it
        parts = s.split(",")
        if len(parts) == 2 and 1 <= len(parts[1]) <= 2:
            s = parts[0] + "." + parts[1]
        else:
            s = s.replace(",", "")

    try:
        return float(s)
    except ValueError:
        return None

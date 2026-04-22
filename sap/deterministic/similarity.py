"""Deterministic similarity scoring — the LLM-avoidance workhorse.

Decision chain:
    1. Empty / null on either side → 0.0
    2. After canonicalisation: byte-equal → 1.0
    3. Field-type-specific deterministic scorer (codes are exact-or-zero)
    4. For free-text fields: token-set + Jaro-Winkler + phonetic hybrid
    5. Band classification (match / uncertain / no_match) → caller decides
       whether to invoke LLM for the uncertain band.

No external dependencies — we implement token-set ratio and Jaro-Winkler
inline so this works with or without `rapidfuzz`/`jellyfish` installed.
"""

from __future__ import annotations

from enum import Enum

from sap.deterministic.field_classifier import FieldType, classify_field
from sap.deterministic.normalize import (
    canonical_country,
    canonical_currency,
    canonical_email,
    canonical_phone,
    canonical_uom,
    collapse_whitespace,
    normalize_business_name,
    strip_diacritics,
)


class SimilarityBand(str, Enum):
    """Three bands used by the match / survivorship code to decide next action."""

    MATCH = "match"           # score >= MATCH_THRESHOLD → accept, no LLM
    UNCERTAIN = "uncertain"   # NO_MATCH_THRESHOLD < score < MATCH_THRESHOLD → LLM or steward
    NO_MATCH = "no_match"     # score <= NO_MATCH_THRESHOLD → reject, no LLM


# Tunable thresholds. Values chosen empirically for SAP-like data:
#   * 0.92 match threshold avoids the LLM when canonical forms agree or
#     near-canonical + fuzz sets the score very high.
#   * 0.35 no-match rules out wildly-different values up-front.
MATCH_THRESHOLD = 0.92
NO_MATCH_THRESHOLD = 0.35


def classify_band(score: float) -> SimilarityBand:
    """Map a 0-1 similarity score to MATCH / UNCERTAIN / NO_MATCH."""
    if score >= MATCH_THRESHOLD:
        return SimilarityBand.MATCH
    if score <= NO_MATCH_THRESHOLD:
        return SimilarityBand.NO_MATCH
    return SimilarityBand.UNCERTAIN


# ─── Low-level string similarity primitives ──────────────────────────────────


def _jaro(a: str, b: str) -> float:
    """Jaro similarity (0..1). Pure Python, O(m + n)."""
    if a == b:
        return 1.0
    len_a, len_b = len(a), len(b)
    if len_a == 0 or len_b == 0:
        return 0.0

    match_distance = max(len_a, len_b) // 2 - 1
    if match_distance < 0:
        match_distance = 0

    a_matches = [False] * len_a
    b_matches = [False] * len_b
    matches = 0
    transpositions = 0

    for i in range(len_a):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len_b)
        for j in range(start, end):
            if b_matches[j] or a[i] != b[j]:
                continue
            a_matches[i] = True
            b_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    k = 0
    for i in range(len_a):
        if not a_matches[i]:
            continue
        while not b_matches[k]:
            k += 1
        if a[i] != b[k]:
            transpositions += 1
        k += 1

    transpositions //= 2
    return (
        matches / len_a
        + matches / len_b
        + (matches - transpositions) / matches
    ) / 3.0


def _jaro_winkler(a: str, b: str, prefix_scale: float = 0.1) -> float:
    """Jaro-Winkler with standard prefix weighting (max prefix = 4 chars)."""
    jaro = _jaro(a, b)
    if jaro < 0.7:
        return jaro

    prefix = 0
    for ca, cb in zip(a[:4], b[:4]):
        if ca != cb:
            break
        prefix += 1

    return jaro + prefix * prefix_scale * (1 - jaro)


def _token_set_ratio(a: str, b: str) -> float:
    """Rapidfuzz-style token-set ratio: Jaccard on tokens plus common-string
    weighting. Returns 0..1."""
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return 0.0

    common = tokens_a & tokens_b
    diff_a = tokens_a - tokens_b
    diff_b = tokens_b - tokens_a

    t0 = " ".join(sorted(common))
    t1 = " ".join(sorted(common | diff_a)).strip()
    t2 = " ".join(sorted(common | diff_b)).strip()

    if not t1 or not t2:
        return 0.0

    pairs = [(t0, t1), (t0, t2), (t1, t2)]
    best = 0.0
    for x, y in pairs:
        if not x or not y:
            continue
        # Ratio = 2*M / (len(x)+len(y)), where M = length of longest common token prefix sequence.
        # For our purposes, Jaro-Winkler is a good proxy.
        r = _jaro_winkler(x, y)
        if r > best:
            best = r
    return best


def _soundex(s: str) -> str:
    """Classic 4-char English Soundex code. Useful for name matching."""
    if not s:
        return ""
    s = strip_diacritics(s).upper()
    if not s[0].isalpha():
        # Skip leading non-alpha
        s = "".join(c for c in s if c.isalpha())
        if not s:
            return ""

    first = s[0]
    mapping = {
        "B": "1", "F": "1", "P": "1", "V": "1",
        "C": "2", "G": "2", "J": "2", "K": "2",
        "Q": "2", "S": "2", "X": "2", "Z": "2",
        "D": "3", "T": "3",
        "L": "4",
        "M": "5", "N": "5",
        "R": "6",
    }

    digits: list[str] = []
    prev = mapping.get(first, "")
    for ch in s[1:]:
        d = mapping.get(ch, "")
        if d and d != prev:
            digits.append(d)
        prev = d if d else ""
        if len(digits) == 3:
            break

    code = (first + "".join(digits)).ljust(4, "0")
    return code[:4]


# ─── Field-type-specific scorers ─────────────────────────────────────────────


def _score_code_equality(value_a: object, value_b: object, canonicaliser) -> float:
    """For closed-domain codes (country, currency, UoM): exact-canonical-or-zero.

    There is no 'fuzzy' USD — either both normalise to USD or they don't match.
    """
    ca = canonicaliser(value_a)
    cb = canonicaliser(value_b)
    if ca is None or cb is None:
        return 0.0
    return 1.0 if ca == cb else 0.0


def _score_email(a: object, b: object) -> float:
    ea = canonical_email(a)
    eb = canonical_email(b)
    if not ea or not eb:
        return 0.0
    if ea == eb:
        return 1.0
    local_a, _, domain_a = ea.partition("@")
    local_b, _, domain_b = eb.partition("@")
    if local_a == local_b and domain_a != domain_b:
        return 0.6
    if domain_a == domain_b and local_a != local_b:
        return 0.2
    return 0.0


def _score_phone(a: object, b: object) -> float:
    pa = canonical_phone(a)
    pb = canonical_phone(b)
    if not pa or not pb:
        return 0.0
    if pa == pb:
        return 1.0
    # Compare digit-only forms — collapse leading '+' difference
    da = pa.lstrip("+")
    db = pb.lstrip("+")
    if da == db:
        return 1.0
    # One is a strict suffix of the other (typically missing country code)
    if len(da) >= 7 and len(db) >= 7 and (da.endswith(db) or db.endswith(da)):
        return 0.95
    # Last-7-digit match → likely same number, different country code convention
    if da[-7:] == db[-7:] and len(da) >= 7 and len(db) >= 7:
        return 0.85
    return 0.0


def _score_name(a: object, b: object) -> float:
    """Business / person name similarity — the main path for name matches."""
    na = normalize_business_name(a)
    nb = normalize_business_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0

    token_score = _token_set_ratio(na, nb)
    jw_score = _jaro_winkler(na, nb)

    # Phonetic tie-breaker for first tokens (helps "Muller" ≈ "Mueller")
    first_a = na.split()[0] if na.split() else ""
    first_b = nb.split()[0] if nb.split() else ""
    phonetic = 1.0 if first_a and _soundex(first_a) == _soundex(first_b) else 0.0

    # Weighted blend. Token-set dominates for multi-word names.
    return 0.55 * token_score + 0.35 * jw_score + 0.10 * phonetic


def _score_text(a: object, b: object) -> float:
    """Generic text similarity for descriptions / free-text fields."""
    sa = collapse_whitespace(strip_diacritics(a)).lower()
    sb = collapse_whitespace(strip_diacritics(b)).lower()
    if not sa or not sb:
        return 0.0
    if sa == sb:
        return 1.0
    return 0.6 * _token_set_ratio(sa, sb) + 0.4 * _jaro_winkler(sa, sb)


def _score_code(a: object, b: object) -> float:
    """Short opaque codes — exact uppercase match or zero."""
    sa = collapse_whitespace(a).upper()
    sb = collapse_whitespace(b).upper()
    if not sa or not sb:
        return 0.0
    return 1.0 if sa == sb else 0.0


def _score_postal(a: object, b: object) -> float:
    """Postal codes — prefix-5 exact match scores highest, else 0."""
    sa = collapse_whitespace(a).upper().replace(" ", "")
    sb = collapse_whitespace(b).upper().replace(" ", "")
    if not sa or not sb:
        return 0.0
    if sa == sb:
        return 1.0
    if len(sa) >= 5 and len(sb) >= 5 and sa[:5] == sb[:5]:
        return 0.8
    if len(sa) >= 3 and len(sb) >= 3 and sa[:3] == sb[:3]:
        return 0.4
    return 0.0


# ─── Public entry point ──────────────────────────────────────────────────────


def deterministic_similarity(
    field: str,
    value_a: object,
    value_b: object,
    *,
    field_type: FieldType | None = None,
) -> float:
    """Return a deterministic similarity score in [0, 1] for two values.

    The caller (ai_semantic_matcher) runs this before any LLM invocation:
        score = deterministic_similarity(field, a, b)
        band = classify_band(score)
        if band in (MATCH, NO_MATCH):  → use `score`, skip LLM
        else:                           → optionally ask LLM

    Args:
        field: SAP field name (for classification)
        value_a: first value
        value_b: second value
        field_type: optional pre-computed classification; if omitted we classify
    """
    if value_a is None or value_b is None:
        return 0.0

    ft = field_type or classify_field(field, sample_value=value_a)

    if ft == FieldType.COUNTRY:
        return _score_code_equality(value_a, value_b, canonical_country)
    if ft == FieldType.CURRENCY:
        return _score_code_equality(value_a, value_b, canonical_currency)
    if ft == FieldType.UOM:
        return _score_code_equality(value_a, value_b, canonical_uom)
    if ft == FieldType.EMAIL:
        return _score_email(value_a, value_b)
    if ft == FieldType.PHONE:
        return _score_phone(value_a, value_b)
    if ft == FieldType.POSTAL_CODE:
        return _score_postal(value_a, value_b)
    if ft in (FieldType.NAME, FieldType.CITY, FieldType.STREET):
        return _score_name(value_a, value_b)
    if ft == FieldType.DESCRIPTION:
        return _score_text(value_a, value_b)
    if ft in (FieldType.PRIMARY_KEY, FieldType.FOREIGN_KEY, FieldType.CODE, FieldType.FLAG, FieldType.LANGUAGE):
        return _score_code(value_a, value_b)

    # Fallback: free text
    return _score_text(value_a, value_b)

"""Country-aware phone, postcode and tax-number normalisers.

Keyed by the SAP country key (LAND1 on KNA1/LFA1, COUNTRY on ADRC/BUT020).
Pure Python, stdlib only, no LLM calls.

Contract for every normaliser:
  * unknown country (or unsupported kind) -> value returned unchanged
  * value that cannot be made to satisfy the country's own pattern ->
    value returned unchanged, status "invalid"
  * idempotent: normalise(normalise(x)) == normalise(x)
Only rules we are certain of are included; anything else is left out.
"""

import re
from dataclasses import dataclass
from typing import Callable

from api.services.standardisers import country_code


@dataclass(frozen=True)
class NormResult:
    value: str
    status: str  # "normalised" | "unchanged" | "invalid" | "unknown_country"


def resolve_land1(land1: str | None) -> str | None:
    """Return an upper-case ISO alpha-2 key, or None when blank.

    A two-letter value is taken as-is (SAP "SA" is Saudi Arabia, whereas the
    legacy country_code() maps "sa" to ZA); longer values go through country_code().
    """
    if not land1 or not str(land1).strip():
        return None
    s = str(land1).strip()
    if len(s) == 2 and s.isalpha():
        return s.upper()
    return country_code(s).upper()


def _result(original: str, out: str | None, pattern: re.Pattern | None) -> NormResult:
    if out is None or (pattern is not None and not pattern.fullmatch(out)):
        return NormResult(original, "invalid")
    return NormResult(out, "unchanged" if out == original else "normalised")


# --------------------------------------------------------------------- phone
# land1 -> (calling code, allowed national-number lengths, has trunk "0")
_PHONE: dict[str, tuple[str, range, bool]] = {
    "ZA": ("27", range(9, 10), True),
    "DE": ("49", range(7, 13), True),
    "GB": ("44", range(9, 11), True),
    "US": ("1", range(10, 11), False),
    "CA": ("1", range(10, 11), False),
    "AU": ("61", range(9, 10), True),
    "FR": ("33", range(9, 10), True),
    "NL": ("31", range(9, 10), True),
    "IN": ("91", range(10, 11), True),
    "BR": ("55", range(10, 12), True),
    "CL": ("56", range(9, 10), False),
    "PE": ("51", range(8, 10), True),
    "SA": ("966", range(9, 10), True),
    "AE": ("971", range(8, 10), True),
}
_PHONE_JUNK = re.compile(r"[\s().\-/]")


def normalise_phone(value: str, land1: str | None) -> NormResult:
    """Format to compact E.164 (+<cc><national>)."""
    c = resolve_land1(land1)
    if c not in _PHONE:
        return NormResult(value, "unknown_country")
    cc, lengths, trunk = _PHONE[c]
    s = _PHONE_JUNK.sub("", value.strip())
    if not re.fullmatch(r"\+?\d+", s):
        return NormResult(value, "invalid")
    intl = s.startswith("+") or s.startswith("00")
    digits = s.lstrip("+")
    if s.startswith("00"):
        digits = digits[2:]
    if intl:
        if not digits.startswith(cc):
            return NormResult(value, "invalid")
        national = digits[len(cc):]
    elif trunk and digits.startswith("0"):
        national = digits[1:]
    elif digits.startswith(cc) and len(digits) - len(cc) in lengths:
        national = digits[len(cc):]
    else:
        national = digits
    if trunk and national.startswith("0"):  # "+44 (0)20 ..." style
        national = national[1:]
    if len(national) not in lengths or national.startswith("0"):
        return NormResult(value, "invalid")
    return _result(value, f"+{cc}{national}", re.compile(r"\+\d{8,15}"))


# ------------------------------------------------------------------ postcode
def _strip(s: str) -> str:
    return s.replace(" ", "")


def _pc_gb(s: str) -> str | None:
    s = _strip(s)
    return f"{s[:-3]} {s[-3:]}" if len(s) > 3 else None


def _pc_nl(s: str) -> str | None:
    s = _strip(s)
    return f"{s[:4]} {s[4:]}"


def _pc_ca(s: str) -> str | None:
    s = _strip(s)
    return f"{s[:3]} {s[3:]}"


def _pc_br(s: str) -> str | None:
    d = s.replace("-", "").replace(" ", "")
    return f"{d[:5]}-{d[5:]}" if d.isdigit() and len(d) == 8 else None


def _pc_us(s: str) -> str | None:
    d = s.replace(" ", "").replace("-", "")
    if d.isdigit() and len(d) == 9:
        return f"{d[:5]}-{d[5:]}"
    return d if d.isdigit() and len(d) == 5 else None


# land1 -> (canonicaliser, pattern the output must satisfy)
_POSTCODE: dict[str, tuple[Callable[[str], str | None], re.Pattern]] = {
    "ZA": (_strip, re.compile(r"\d{4}")),
    "DE": (_strip, re.compile(r"\d{5}")),
    "GB": (_pc_gb, re.compile(r"[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}")),
    "US": (_pc_us, re.compile(r"\d{5}(-\d{4})?")),
    "AU": (_strip, re.compile(r"\d{4}")),
    "FR": (_strip, re.compile(r"\d{5}")),
    "NL": (_pc_nl, re.compile(r"[1-9]\d{3} [A-Z]{2}")),
    "IN": (_strip, re.compile(r"[1-9]\d{5}")),
    "BR": (_pc_br, re.compile(r"\d{5}-\d{3}")),
    "CL": (_strip, re.compile(r"\d{7}")),
    "PE": (_strip, re.compile(r"\d{5}")),
    "SA": (_strip, re.compile(r"\d{5}")),
    "CA": (_pc_ca, re.compile(r"[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d")),
    # AE: no postcode system -> deliberately absent
}


def normalise_postcode(value: str, land1: str | None) -> NormResult:
    c = resolve_land1(land1)
    if c not in _POSTCODE:
        return NormResult(value, "unknown_country")
    fn, pattern = _POSTCODE[c]
    s = value.strip().upper()
    return _result(value, fn(s) if s else None, pattern)


# ----------------------------------------------------------------- tax number
def _weighted(d: str, weights: list[int]) -> int:
    return sum(int(x) * w for x, w in zip(d, weights))


def _abn_ok(d: str) -> bool:
    w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    return (_weighted(d, w) - 10) % 89 == 0  # ABN: first digit minus 1, i.e. minus its weight of 10


def _cnpj_ok(d: str) -> bool:
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    r1 = _weighted(d[:12], w1) % 11
    c1 = 0 if r1 < 2 else 11 - r1
    r2 = _weighted(d[:13], [6] + w1) % 11
    c2 = 0 if r2 < 2 else 11 - r2
    return d[12:] == f"{c1}{c2}"


def _rut_check(body: str) -> str:
    total = sum(int(x) * (2 + i % 6) for i, x in enumerate(reversed(body)))
    r = 11 - total % 11
    return "0" if r == 11 else "K" if r == 10 else str(r)


def _t_plain(s: str) -> str | None:
    return s


def _t_eu(prefix: str) -> Callable[[str], str | None]:
    return lambda s: prefix + (s[len(prefix):] if s.startswith(prefix) else s)


def _t_au(s: str) -> str | None:
    return s if s.isdigit() and len(s) == 11 and _abn_ok(s) else None


def _t_br(s: str) -> str | None:
    return s if s.isdigit() and len(s) == 14 and _cnpj_ok(s) else None


def _t_cl(s: str) -> str | None:
    s = s.replace("-", "")
    if len(s) < 2 or not s[:-1].isdigit():
        return None
    return f"{s[:-1]}-{s[-1]}" if _rut_check(s[:-1]) == s[-1] else None


def _t_us_ein(s: str) -> str | None:
    d = s.replace("-", "")
    return f"{d[:2]}-{d[2:]}" if d.isdigit() and len(d) == 9 else None


# land1 -> kind -> (canonicaliser, final pattern). The default kind is "vat"
# (SAP KNA1/LFA1-STCEG); US has no VAT so only "ein" is offered.
# Checksums are enforced only where the algorithm is certain (AU, BR, CL).
_TAX: dict[str, dict[str, tuple[Callable[[str], str | None], re.Pattern]]] = {
    "ZA": {"vat": (_t_plain, re.compile(r"4\d{9}"))},
    "DE": {"vat": (_t_eu("DE"), re.compile(r"DE\d{9}"))},
    "GB": {"vat": (_t_eu("GB"), re.compile(r"GB(\d{9}|\d{12})"))},
    "FR": {"vat": (_t_eu("FR"), re.compile(r"FR[0-9A-HJ-NP-Z]{2}\d{9}"))},
    "NL": {"vat": (_t_eu("NL"), re.compile(r"NL\d{9}B\d{2}"))},
    "AU": {"vat": (_t_au, re.compile(r"\d{11}"))},
    "IN": {"vat": (_t_plain, re.compile(r"\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]"))},
    "BR": {"vat": (_t_br, re.compile(r"\d{14}"))},
    "CL": {"vat": (_t_cl, re.compile(r"\d{1,8}-[0-9K]"))},
    "PE": {"vat": (_t_plain, re.compile(r"(10|15|17|20)\d{9}"))},
    "SA": {"vat": (_t_plain, re.compile(r"3\d{13}3"))},
    "AE": {"vat": (_t_plain, re.compile(r"\d{15}"))},
    "CA": {"vat": (_t_plain, re.compile(r"\d{9}RT\d{4}"))},
    "US": {"ein": (_t_us_ein, re.compile(r"\d{2}-\d{7}"))},
}
_TAX_JUNK = re.compile(r"[\s.\-/]")
_TAX_JUNK_KEEP_HYPHEN = re.compile(r"[\s.]")  # CL and US canonical forms contain "-"


def normalise_tax_number(value: str, land1: str | None, kind: str = "vat") -> NormResult:
    c = resolve_land1(land1)
    entry = _TAX.get(c or "", {}).get(kind)
    if entry is None:
        return NormResult(value, "unknown_country")
    fn, pattern = entry
    junk = _TAX_JUNK_KEEP_HYPHEN if c in ("CL", "US") else _TAX_JUNK
    s = junk.sub("", value.strip().upper())
    return _result(value, fn(s) if s else None, pattern)


# ------------------------------------------------- str-returning conveniences
def phone_e164(value: str, land1: str | None) -> str:
    return normalise_phone(value, land1).value if value else value


def postcode(value: str, land1: str | None) -> str:
    return normalise_postcode(value, land1).value if value else value


def tax_number(value: str, land1: str | None, kind: str = "vat") -> str:
    return normalise_tax_number(value, land1, kind).value if value else value

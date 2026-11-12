"""Semantic types and a trust score for uploaded files and non-SAP sources.

Every detector is a deterministic Python function: email, phone, IBAN (ISO 13616 mod-97), EU VAT number,
postal code, date, currency amount, ISO 3166 country, URL and a person-name heuristic. ``profile`` runs them over
a sample of each column and keeps only shares (how many values have the type's shape, how many are valid),
never a value, so the profile can be stored with the run and shown on any screen. ``trust_score`` combines
the run's DQS with semantic conformance, freshness and completeness. ``suggested_rules`` turns the types a
user confirmed into rules of existing check types.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Callable

import pandas as pd

from api.services import contact_verify as cv
from checks.types.format_check import valid_de_ustid, valid_iban

TYPES = ("iban", "eu_vat", "email", "url", "date", "phone", "postcode", "country", "currency_amount",
         "person_name")  # priority order when two types fit a column equally well

ISO_3166 = frozenset("""
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA
CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA
GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS
MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS
RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW
TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
""".split())

# EU member-state VAT layouts (VIES), Greece as EL, Northern Ireland as XI; separators removed first
_VAT = {
    "AT": r"U\d{8}", "BE": r"[01]\d{9}", "BG": r"\d{9,10}", "CY": r"\d{8}[A-Z]", "CZ": r"\d{8,10}",
    "DE": r"\d{9}", "DK": r"\d{8}", "EE": r"\d{9}", "EL": r"\d{9}", "ES": r"[A-Z0-9]\d{7}[A-Z0-9]",
    "FI": r"\d{8}", "FR": r"[A-HJ-NP-Z0-9]{2}\d{9}", "HR": r"\d{11}", "HU": r"\d{8}",
    "IE": r"\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W]", "IT": r"\d{11}", "LT": r"\d{9}|\d{12}", "LU": r"\d{8}",
    "LV": r"\d{11}", "MT": r"\d{8}", "NL": r"\d{9}B\d{2}", "PL": r"\d{10}", "PT": r"\d{9}", "RO": r"\d{2,10}",
    "SE": r"\d{10}01", "SI": r"\d{8}", "SK": r"\d{10}", "XI": r"\d{9}|\d{12}|GD\d{3}|HA\d{3}",
}
_VAT_RE = {k: re.compile(f"(?:{p})") for k, p in _VAT.items()}
_SEP = re.compile(r"[\s.\-]")
_IBAN_SHAPE = re.compile(r"[A-Z]{2}\d{2}[A-Z0-9]{10,30}")
_URL = re.compile(r"(?:https?://|www\.)[^\s/$.?#][^\s]*\.[^\s]+|https?://[^\s/$.?#][^\s]*", re.I)
_PHONE_SHAPE = re.compile(r"(?:\+|00)?[\d\s()\-/.]{6,}")
_DECIMAL = re.compile(r"[-+]?\d+[.,]\d{1,2}")
_AMOUNT = re.compile(
    r"(?P<pre>[A-Z]{3}\s?|[$€£¥]\s?|R\s?)?[-+]?(?P<int>\d{1,3}(?:[ ,.'’]\d{3})+|\d+)(?P<dec>[.,]\d{1,4})?-?"
    r"(?P<post>\s?[A-Z]{3}|\s?[€$£])?")
_POSTCODE_SHAPE = re.compile(r"[A-Z0-9][A-Z0-9 \-]{1,9}", re.I)
_NAME_TOKEN = re.compile(r"[A-ZÀ-ÖØ-Þ][a-zß-öø-ÿ]+(?:[-'’][A-ZÀ-ÖØ-Þ]?[a-zß-öø-ÿ]+)*\.?|[A-Z]\.")
_LEGAL = {"ltd", "gmbh", "ag", "inc", "pty", "bv", "llc", "plc", "co", "corp", "sa", "srl", "spa", "kg", "nv",
          "limited", "company", "group", "holdings", "mining", "services", "trading"}
_DATE_FORMATS = ("%Y%m%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%m-%Y")

_HINTS = {
    "email": r"mail", "phone": r"phone|tel|mobile|cell|fax", "iban": r"iban",
    "eu_vat": r"vat|stceg|ust|tax", "postcode": r"post|zip|pstlz|plz|postal", "date": r"date|datum|dat$|_dt$|day",
    "currency_amount": r"amount|amt|price|value|cost|total|wrbtr|dmbtr|netwr|salary|pay",
    "country": r"country|land|ctry|nation", "url": r"url|web|site|link|homepage",
    "person_name": r"name|vorname|nachname|first|last|surname|given",
}
_HINT_RE = {k: re.compile(v, re.I) for k, v in _HINTS.items()}
NEEDS_HINT = {"postcode"}  # a short code alone is not a postcode; only a header says so
SAMPLE_ROWS = 20_000
MAX_DISTINCT = 1_000  # ponytail: top values only; bounded cost at upload, raise if wide rare-value columns mislabel


def _vat_parts(v: str) -> tuple[str, str] | None:
    s = _SEP.sub("", v).upper()
    return (s[:2], s[2:]) if len(s) > 4 and s[:2] in _VAT else None


def _vat_valid(v: str) -> bool:
    p = _vat_parts(v)
    if not p or not _VAT_RE[p[0]].fullmatch(p[1]):
        return False
    return valid_de_ustid(p[0] + p[1]) if p[0] == "DE" else True


def _date_valid(v: str) -> bool:
    s = v.strip()
    if s in ("00000000", "0000-00-00"):
        return False
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if "-" in s[:5] else None
    except ValueError:
        d = None
    for f in () if d else _DATE_FORMATS:
        try:
            d = dt.datetime.strptime(s, f)
            break
        except ValueError:
            continue
    return d is not None and 1900 <= d.year <= 2199


def _amount(v: str) -> bool:
    m = _AMOUNT.fullmatch(v.strip())
    # a bare integer is a count or a key, not money: an amount has decimals, a currency or thousands groups
    return bool(m and (m["pre"] or m["post"] or m["dec"] or not m["int"].isdigit()))


def _phone_shape(v: str) -> bool:
    s = v.strip()
    digits = sum(c.isdigit() for c in s)
    if not _PHONE_SHAPE.fullmatch(s) or not 7 <= digits <= 15 or _DECIMAL.fullmatch(s) or _date_valid(s):
        return False
    return s.startswith(("+", "00", "(")) or any(c in s for c in " -/") or (s.startswith("0") and digits >= 9)


def _name(v: str) -> bool:
    tokens = v.strip().split()
    return (1 <= len(tokens) <= 4 and len(v) <= 60 and all(_NAME_TOKEN.fullmatch(t) for t in tokens)
            and not any(t.lower().strip(".") in _LEGAL for t in tokens))


def _country(v: str) -> bool:
    s = v.strip().upper()
    return s in ISO_3166 or (len(s) == 3 and s in cv.ISO3)


# type -> (has the shape of the type, is a valid value of the type)
DETECTORS: dict[str, tuple[Callable[[str], bool], Callable[[str], bool]]] = {
    "email": (lambda v: v.count("@") == 1 and "." in v.rpartition("@")[2], lambda v: cv.email_reason(v) is None),
    "phone": (_phone_shape, lambda v: _phone_shape(v) and cv.phone(v)[0] is None),
    "iban": (lambda v: bool(_IBAN_SHAPE.fullmatch(v.replace(" ", "").upper())), valid_iban),
    "eu_vat": (lambda v: _vat_parts(v) is not None and any(c.isdigit() for c in v[2:]), _vat_valid),
    "postcode": (lambda v: bool(_POSTCODE_SHAPE.fullmatch(v.strip())) and any(c.isdigit() for c in v),
                 lambda v: bool(_POSTCODE_SHAPE.fullmatch(v.strip())) and any(c.isdigit() for c in v)),
    "date": (_date_valid, _date_valid),
    "currency_amount": (_amount, _amount),
    "country": (_country, _country),
    "url": (lambda v: bool(_URL.fullmatch(v.strip())), lambda v: bool(_URL.fullmatch(v.strip())) and " " not in v),
    "person_name": (_name, _name),
}


def _column(name: str, s: pd.Series) -> dict:
    s = s.head(SAMPLE_ROWS).astype("string").str.strip()
    rows = len(s)
    vc = s[s.notna() & (s != "")].value_counts()
    filled = int(vc.sum())
    vc = vc.head(MAX_DISTINCT)  # the most frequent values stand for the rest
    weight = int(vc.sum()) or 1
    shares: dict[str, list[float]] = {}
    for t, (shape, valid) in DETECTORS.items():
        hit = [(n, valid(v)) for v, n in vc.items() if shape(v)]
        if hit:
            shares[t] = [round(sum(n for n, _ in hit) / weight, 4), round(sum(n for n, ok in hit if ok) / weight, 4)]
    best, conf = None, 0.0
    for t in TYPES:
        if t not in shares:
            continue
        hint = bool(_HINT_RE[t].search(name))
        share = shares[t][0]
        if (t in NEEDS_HINT and not hint) or share < (0.6 if hint else 0.8):
            continue
        if t == "person_name" and not hint:
            continue  # ponytail: name heuristic only on a named column; a word list would widen it
        c = min(1.0, share + (0.1 if hint else 0.0)) * min(1.0, filled / 20)
        if c > conf + 1e-9:
            best, conf = t, c
    return {"column": name, "type": best, "confidence": round(conf, 2),
            "conformance": shares[best][1] if best else None,
            "filled": round(filled / rows, 4) if rows else 0.0, "shares": shares}


def safe_profile(df: pd.DataFrame) -> dict | None:
    """``profile`` for the upload paths: a failure is logged and never stops the upload."""
    try:
        return profile(df)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning("semantic profile failed", exc_info=True)
        return None


def profile(df: pd.DataFrame) -> dict:
    """Per column the detected type, its confidence and conformance, the filled share, and every type's
    shares. No values are kept."""
    cols = [_column(str(c), df[c]) for c in df.columns]
    return {"version": 1, "rows_sampled": min(len(df), SAMPLE_ROWS), "columns": cols,
            "completeness": round(sum(c["filled"] for c in cols) / len(cols), 4) if cols else None}


def dqs_of(dqs_summary: dict | None) -> float | None:
    raw = [m.get("composite_score") for m in (dqs_summary or {}).values() if isinstance(m, dict)]
    scores = [float(s) for s in raw if isinstance(s, (int, float))]
    return round(sum(scores) / len(scores), 1) if scores else None


def freshness(run_at: dt.datetime | None, now: dt.datetime | None = None) -> float | None:
    """100 for data loaded in the last day, falling in a straight line to 0 at 90 days."""
    if run_at is None:
        return None
    now = now or dt.datetime.now(dt.timezone.utc)
    if run_at.tzinfo is None:
        run_at = run_at.replace(tzinfo=dt.timezone.utc)
    days = (now - run_at).total_seconds() / 86400
    return round(max(0.0, min(100.0, 100 * (90 - days) / 89)), 1)


WEIGHTS = {"dqs": 0.40, "conformance": 0.25, "freshness": 0.15, "completeness": 0.20}


def trust_score(parts: dict[str, float | None]) -> float | None:
    """Weighted mean of the parts on 0-100; a missing part gives its weight to the others."""
    have = {k: v for k, v in parts.items() if v is not None and k in WEIGHTS}
    total = sum(WEIGHTS[k] for k in have)
    return round(sum(WEIGHTS[k] * v for k, v in have.items()) / total, 1) if total else None


def resolve(columns: list[dict], overrides: dict[str, str]) -> list[dict]:
    """Columns with the user's type in force: ``type`` is the override when there is one, else the detected
    type; ``confirmed`` says a user set it; conformance follows the type in force."""
    out = []
    for c in columns:
        o = overrides.get(c["column"])
        t = (None if o == "none" else o) if o else c["type"]
        share = (c.get("shares") or {}).get(t) if t else None
        out.append({"column": c["column"], "detected": c["type"], "confidence": c["confidence"], "type": t,
                    "confirmed": o is not None, "filled": c["filled"],
                    "conformance": share[1] if share else (0.0 if t else None)})
    return out


def conformance_of(columns: list[dict]) -> float | None:
    typed = [c["conformance"] for c in columns if c["type"] and c["conformance"] is not None]
    return round(100 * sum(typed) / len(typed), 1) if typed else None


_RULES: dict[str, list[tuple[str, dict, str]]] = {
    "email": [("contact_check", {"kind": "email"}, "Email address follows RFC 5321 and 5322"),
              ("contact_check", {"kind": "disposable"}, "Email domain is not a disposable mailbox service")],
    "phone": [("contact_check", {"kind": "phone"}, "Phone number is plausible for E.164")],
    "iban": [("format_check", {"format": "iban"}, "IBAN passes the ISO 13616 mod-97 check")],
    "eu_vat": [("regex_check", {"pattern": "^(" + "|".join(f"{k}(?:{p})" for k, p in _VAT.items()) + ")$"},
                "VAT number follows its EU member state's layout")],
    "postcode": [("contact_check", {"kind": "postcode"}, "Postal code matches its country's format")],
    "date": [("domain_value_check", {"format": "date"}, "Date is a real calendar date")],
    "currency_amount": [("regex_check", {"pattern": r"^[-+]?\d+(\.\d{1,4})?$"},
                         "Amount is a plain number with at most four decimals")],
    "country": [("domain_value_check", {"allowed_values": sorted(ISO_3166)}, "Country is an ISO 3166 code")],
    "url": [("regex_check", {"pattern": r"^https?://[^\s/$.?#][^\s]*$"}, "Web address starts with http or https")],
    "person_name": [("regex_check", {"pattern": r"^[^\d@]+$"}, "Name has no digits or @")],
}


def suggested_rules(columns: list[dict]) -> list[dict]:
    """A rule of an existing check type for every column whose type a user confirmed. A postcode rule reads
    the country from a confirmed country column when there is one."""
    country = next((c["column"] for c in columns if c["confirmed"] and c["type"] == "country"), None)
    out = []
    for c in columns:
        if not (c["confirmed"] and c["type"]):
            continue
        for check_class, params, message in _RULES[c["type"]]:
            p = {**params}
            if c["type"] in ("postcode", "phone") and country:
                p["country_field"] = country
            if c["type"] == "postcode" and not country:
                continue  # a postcode is only judged against its country
            if check_class == "domain_value_check" and "allowed_values" in p:
                p = {"allowed_values": f"ISO 3166 ({len(ISO_3166)} codes)"}
            out.append({"column": c["column"], "type": c["type"], "check_class": check_class, "params": p,
                        "message": message})
    return out


if __name__ == "__main__":
    assert len(ISO_3166) == 249
    assert valid_iban("DE89 3704 0044 0532 0130 00") and not valid_iban("DE89 3704 0044 0532 0130 01")
    assert _vat_valid("ATU12345678") and _vat_valid("NL123456789B01") and not _vat_valid("NL123456789")
    assert _vat_valid("FR40 303 265 045") and not _vat_valid("XX123456789")
    assert _date_valid("2026-11-01") and _date_valid("20261101") and not _date_valid("20261341")
    assert _amount("1,234.50") and _amount("EUR 99") and not _amount("12345")
    assert _phone_shape("+49 30 1234567") and not _phone_shape("1234.50") and not _phone_shape("20261101")
    assert _name("Anna Example") and not _name("Example Mining Ltd")
    df = pd.DataFrame({"contact_email": ["a.b@example.com"] * 30 + ["bad@"] * 2,
                       "IBAN": ["DE89370400440532013000"] * 31 + ["DE89370400440532013001"],
                       "row_id": [str(i) for i in range(32)]})
    p = profile(df)
    cols = {c["column"]: c for c in p["columns"]}
    assert cols["contact_email"]["type"] == "email" and cols["IBAN"]["type"] == "iban", cols
    assert cols["row_id"]["type"] is None and cols["IBAN"]["conformance"] < 1
    r = resolve(p["columns"], {"contact_email": "email", "row_id": "none"})
    assert r[0]["confirmed"] and r[2]["type"] is None and suggested_rules(r)[0]["check_class"] == "contact_check"
    assert trust_score({"dqs": 80, "conformance": None, "freshness": 100, "completeness": 100}) == 89.3
    assert freshness(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc), dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)) == 100
    print("semantic_types ok")

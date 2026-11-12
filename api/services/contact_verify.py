"""Email, phone and postcode verification: why one value is wrong, in words a steward can act on.

Pure stdlib, nothing leaves the site except the optional MX lookup, which asks the site's own
resolver (``/etc/resolv.conf``) and is off unless the tenant turns it on. Every function returns
``None`` for a good value and a short reason code otherwise; ``REASONS`` holds the words.
"""
from __future__ import annotations

import random
import re
import socket
import struct
from functools import lru_cache
from pathlib import Path

from api.services.country_normalisers import _PHONE, normalise_phone, normalise_postcode, resolve_land1

REASONS = {
    "too_long": "Address is longer than 254 characters (RFC 5321)",
    "no_at": "Address has no single @ between a local part and a domain",
    "local_too_long": "Part before @ is longer than 64 characters (RFC 5321)",
    "bad_local": "Part before @ has a character, leading, trailing or double dot RFC 5322 does not allow",
    "domain_too_long": "Domain is longer than 253 characters (RFC 1035)",
    "bad_domain": "Domain is not a valid host name (letters, digits, hyphens, at least one dot)",
    "label_too_long": "A part of the domain is longer than 63 characters (RFC 1035)",
    "disposable": "Domain belongs to a disposable (throw-away) mailbox service",
    "no_mx": "Domain has no mail server (no MX or address record)",
    "phone_invalid": "Number cannot be dialled: characters other than digits, or a wrong country code",
    "phone_length": "Number has the wrong length for its country",
    "phone_e164": "Number is not a plausible international number (E.164: 8 to 15 digits)",
    "postcode_format": "Postal code does not match the format of its country",
    "postcode_layout": "Postal code is valid but not in its country's standard layout (spacing or case)",
}

_ATEXT = re.compile(r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$")
_LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$")
_DIGITS = re.compile(r"\D")
_DISPOSABLE_FILE = Path(__file__).resolve().parent.parent / "data" / "disposable_email_domains.txt"
# EC PERADDRESS.COUNTRY carries ISO 3166 alpha-3; the normalisers key on alpha-2
ISO3 = {"ZAF": "ZA", "DEU": "DE", "GBR": "GB", "USA": "US", "CAN": "CA", "AUS": "AU", "FRA": "FR", "NLD": "NL",
        "IND": "IN", "BRA": "BR", "CHL": "CL", "PER": "PE", "SAU": "SA", "ARE": "AE"}


@lru_cache(maxsize=1)
def disposable_domains() -> frozenset[str]:
    lines = _DISPOSABLE_FILE.read_text(encoding="utf-8").splitlines()
    return frozenset(s.strip().lower() for s in lines if s.strip() and not s.startswith("#"))


def email_reason(value: str) -> str | None:
    """RFC 5321/5322 limits (dot-atom form; quoted local parts are not accepted by SAP output either)."""
    v = (value or "").strip()
    if len(v) > 254:
        return "too_long"
    local, at, domain = v.rpartition("@")
    if not at or not local or not domain or "@" in local:
        return "no_at"
    if len(local) > 64:
        return "local_too_long"
    if not _ATEXT.match(local) or local.startswith(".") or local.endswith(".") or ".." in local:
        return "bad_local"
    if len(domain) > 253:
        return "domain_too_long"
    labels = domain.rstrip(".").split(".")
    if any(len(lb) > 63 for lb in labels):
        return "label_too_long"
    if len(labels) < 2 or not all(_LABEL.match(lb) for lb in labels) or labels[-1].isdigit():
        return "bad_domain"
    return None


def disposable_reason(value: str) -> str | None:
    domain = (value or "").strip().rpartition("@")[2].lower().rstrip(".")
    parts = domain.split(".")
    # a sub-domain of a listed domain is the same service
    return "disposable" if any(".".join(parts[i:]) in disposable_domains() for i in range(len(parts) - 1)) else None


def country2(value: str | None) -> str | None:
    c = (value or "").strip().upper()
    return ISO3.get(c, resolve_land1(c))


def phone(value: str, country: str | None = None, dial_code: str | None = None) -> tuple[str | None, str | None]:
    """(reason, E.164 value). ``dial_code`` is a separate calling code field (SuccessFactors PERPHONE)."""
    v = (value or "").strip()
    cc = _DIGITS.sub("", dial_code or "")
    if cc and not v.startswith(("+", "00")):
        v = f"+{cc}{v}"  # the national part keeps its trunk 0; normalise_phone drops it
    land = country2(country)
    if land is None and v.startswith(("+", "00")):  # find the country from the calling code
        digits = _DIGITS.sub("", v).removeprefix("00") if v.startswith("00") else _DIGITS.sub("", v)
        land = next((c for c, (code, *_) in sorted(_PHONE.items(), key=lambda kv: -len(kv[1][0]))
                     if digits.startswith(code)), None)
    if land in _PHONE:
        r = normalise_phone(v, land)
        if r.status != "invalid":
            return None, r.value
        bad_chars = not re.fullmatch(r"\+?[\d\s().\-/]+", v)
        return ("phone_invalid" if bad_chars else "phone_length"), None
    digits = _DIGITS.sub("", v)
    if not re.fullmatch(r"\+?[\d\s().\-/]+", v) or not 8 <= len(digits.removeprefix("00")) <= 15:
        return "phone_e164", None
    return None, ("+" + digits.removeprefix("00")) if v.startswith(("+", "00")) else None


def postcode(value: str, country: str | None) -> tuple[str | None, str | None]:
    """(reason, normalised value); countries without a known format are not judged. A code that is right
    but spaced or cased differently from the standard layout fails with the fix as its normalised value."""
    v = (value or "").strip()
    r = normalise_postcode(v, country2(country))
    if r.status == "invalid":
        return "postcode_format", None
    if r.status == "normalised" and r.value != v:
        return "postcode_layout", r.value
    return None, r.value if r.status == "unchanged" else None


# ── optional MX lookup (stdlib DNS over UDP to the site's own resolver) ───────────────────────


def _resolver() -> str:
    try:
        for line in Path("/etc/resolv.conf").read_text().splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0] == "nameserver":
                return parts[1]
    except OSError:
        pass
    return "127.0.0.1"


def _query(domain: str, qtype: int, server: str, timeout: float) -> int | None:
    """Answer count for ``domain``/``qtype``; None on no reply. NXDOMAIN answers 0."""
    qid = random.randint(0, 0xFFFF)
    qname = b"".join(bytes([len(p)]) + p.encode("idna") for p in domain.rstrip(".").split(".")) + b"\0"
    packet = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + qname + struct.pack(">HH", qtype, 1)
    family = socket.AF_INET6 if ":" in server else socket.AF_INET
    with socket.socket(family, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        try:
            s.sendto(packet, (server, 53))
            data = s.recv(4096)
        except OSError:
            return None
    rid, flags, _qd, an = struct.unpack(">HHHH", data[:8])
    if rid != qid:
        return None
    return 0 if flags & 0x000F == 3 else an


@lru_cache(maxsize=4096)
def mx_reason(domain: str, timeout: float = 2.0) -> str | None:
    """'no_mx' when the domain has neither MX nor A record (RFC 5321 implicit MX); None when it has one
    or the resolver does not answer (an unreachable resolver never condemns an address)."""
    d = (domain or "").strip().lower()
    if not d:
        return None
    server = _resolver()
    mx = _query(d, 15, server, timeout)
    if mx is None or mx > 0:
        return None
    a = _query(d, 1, server, timeout)
    return "no_mx" if a == 0 else None


if __name__ == "__main__":
    assert email_reason("a.b@example.com") is None
    assert email_reason("a..b@example.com") == "bad_local"
    assert email_reason("x" * 65 + "@example.com") == "local_too_long"
    assert email_reason("ab@localhost") == "bad_domain"
    assert phone("082 555 0100", "ZA") == (None, "+27825550100")
    assert phone("5550100", "", "27")[0] == "phone_length"
    assert postcode("12", "DEU")[0] == "postcode_format"
    assert postcode("sw1a1aa", "GB") == ("postcode_layout", "SW1A 1AA")
    print("ok")

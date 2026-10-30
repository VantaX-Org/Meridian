"""PII field exclusion module.

SAP fields whose VALUES must never appear in LLM prompts.
All AI services import PII_EXCLUDED_FIELDS and strip these before prompt construction.

Redaction keys on both the column header and, when known, the SAP field the column maps to: an upload's
header is often a business word ("Vendor name", "Bank account") rather than the SAP field name (NAME1, BANKN),
so matching on SAP names alone let a non-SAP header through.
"""

import re

PII_EXCLUDED_FIELDS: set[str] = {
    # Business Partner personal data
    "BNAME", "NAME1", "NAME2", "NAME3", "NAME4",
    "STRAS", "ORT01", "ORT02", "TELF1", "TELFX",
    "SMTP_ADDR", "STCD1", "STCD2",
    # Financial / banking
    "BANKN", "BKONT", "IBAN",
    # HR / employee
    "NACHN", "VORNA", "GBDAT", "NATIO",
}

# Words in a free-text header that mark personal data (matched as whole words of the header).
PII_HEADER_WORDS: frozenset[str] = frozenset({
    "NAME", "NAMES", "FIRSTNAME", "LASTNAME", "SURNAME", "FORENAME", "STREET", "ADDRESS", "CITY", "TOWN",
    "POSTCODE", "POSTAL", "ZIP", "PHONE", "TELEPHONE", "TEL", "MOBILE", "FAX", "EMAIL", "MAIL", "IBAN", "BANK",
    "ACCOUNT", "SWIFT", "BIC", "TAX", "VAT", "BIRTH", "BIRTHDAY", "DOB", "NATIONALITY", "PASSPORT", "SSN",
    "SALARY", "PAY", "WAGE",
})

_WORD_SPLIT = re.compile(r"[^A-Z0-9]+")
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def _parts(name: str) -> tuple[str, str]:
    """('LFA1', 'NAME1') from 'LFA1.NAME1'; ('', 'NAME1') from 'name1'."""
    n = (name or "").strip().upper()
    table, _, field = n.rpartition(".")
    return table, field


def is_pii_field(field: str | None) -> bool:
    """True for an SAP field (``FIELD`` or ``TABLE.FIELD``) whose values are personal data."""
    if not field:
        return False
    table, name = _parts(field)
    if name in PII_EXCLUDED_FIELDS:
        return True
    from checks.profiling import is_sensitive

    return is_sensitive(table, name)


def is_pii_header(header: str | None) -> bool:
    """True when a column header names personal data: an SAP PII field, or a business word such as "Vendor name"
    or "bankAccount"."""
    if not header:
        return False
    if is_pii_field(header):
        return True
    words = {w for w in _WORD_SPLIT.split(_CAMEL.sub(" ", header.strip()).upper()) if w}
    return bool(words & PII_HEADER_WORDS)


def sanitise_for_prompt(field_name: str, value: object, mapped_field: str | None = None) -> str:
    """Return '[REDACTED]' if the field (by its header name or the SAP field it maps to) is PII, else str(value)
    truncated to 200 chars."""
    if is_pii_header(field_name) or is_pii_field(mapped_field):
        return "[REDACTED]"
    return str(value)[:200] if value is not None else "null"

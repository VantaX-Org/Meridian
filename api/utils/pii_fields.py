"""PII field exclusion module.

SAP fields whose VALUES must never appear in LLM prompts.
All AI services import PII_EXCLUDED_FIELDS and strip these before prompt construction.
"""

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


def sanitise_for_prompt(field_name: str, value: object) -> str:
    """Return '[REDACTED]' if field is PII, else return str(value) truncated to 200 chars."""
    if field_name.upper() in PII_EXCLUDED_FIELDS:
        return "[REDACTED]"
    return str(value)[:200] if value is not None else "null"

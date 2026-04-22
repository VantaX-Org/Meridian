"""Classify an SAP field by semantic type.

Given a (module, field_name) or just a raw field_name, return a FieldType
that the similarity / survivorship engines use to pick the right canonicaliser.

Classification is rule-based — no LLM. We look at:
    1. Explicit SAP tables/fields we know (data_dictionary)
    2. Well-known SAP primary keys
    3. Semantic name suffix / token heuristics

This module is hot — it gets called once per field per record.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Optional


class FieldType(str, Enum):
    """Semantic classification of an SAP field."""

    PRIMARY_KEY = "primary_key"         # BUT000.PARTNER, MARA.MATNR, ...
    FOREIGN_KEY = "foreign_key"         # *_ID, KUNNR on sales order, ...
    COUNTRY = "country"
    CURRENCY = "currency"
    LANGUAGE = "language"
    UOM = "uom"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    POSTAL_CODE = "postal_code"
    STREET = "street"
    CITY = "city"
    NAME = "name"                       # company / person name
    DESCRIPTION = "description"         # longer free-text
    DATE = "date"
    DATETIME = "datetime"
    TIMESTAMP = "timestamp"
    AMOUNT = "amount"
    QUANTITY = "quantity"
    PERCENTAGE = "percentage"
    CODE = "code"                        # short opaque code (status, category)
    FLAG = "flag"                        # X/Y/N/blank boolean
    NUMBER = "number"                    # generic numeric
    TEXT = "text"                        # fallback for free text
    UNKNOWN = "unknown"


# Known SAP primary keys (extended from checks/base.py)
_PRIMARY_KEYS = {
    "PARTNER", "BU_PARTNER", "MATNR", "SAKNR", "KUNNR", "LIFNR",
    "EQUNR", "ANLN1", "ANLN2", "EBELN", "EBELP", "VBELN", "POSNR",
    "USERID", "USER_ID", "PERNR", "EMP_ID", "EMPLOYEE_ID",
    "PLNNR", "STLNR", "ARBPL", "WERKS", "LGORT", "BUKRS",
    "KOSTL", "HKONT", "ZUONR",
}

# Field-name token → FieldType. Checked against last underscore-token first,
# then the full uppercased name.
_SUFFIX_MAP: dict[str, FieldType] = {
    "EMAIL": FieldType.EMAIL,
    "MAIL": FieldType.EMAIL,
    "E_MAIL": FieldType.EMAIL,
    "EMAILADDRESS": FieldType.EMAIL,
    "PHONE": FieldType.PHONE,
    "TEL": FieldType.PHONE,
    "TELEFON": FieldType.PHONE,
    "TEL_NUMBER": FieldType.PHONE,
    "TEL_NO": FieldType.PHONE,
    "TELNR": FieldType.PHONE,
    "MOBILE": FieldType.PHONE,
    "MOBILE_NUMBER": FieldType.PHONE,
    "FAX": FieldType.PHONE,
    "FAX_NUMBER": FieldType.PHONE,
    "SMTP_ADDR": FieldType.EMAIL,
    "SMTP_ADDRESS": FieldType.EMAIL,
    "E_MAIL_ADDR": FieldType.EMAIL,
    "EMAIL_ADDR": FieldType.EMAIL,
    "EMAIL_ADDRESS": FieldType.EMAIL,
    "URL": FieldType.URL,
    "WEBSITE": FieldType.URL,
    "WEB": FieldType.URL,
    "COUNTRY": FieldType.COUNTRY,
    "LAND1": FieldType.COUNTRY,
    "LAND": FieldType.COUNTRY,
    "COUNTRYCODE": FieldType.COUNTRY,
    "COUNTRY_CODE": FieldType.COUNTRY,
    "NATION": FieldType.COUNTRY,
    "CURRENCY": FieldType.CURRENCY,
    "WAERS": FieldType.CURRENCY,
    "HWAER": FieldType.CURRENCY,
    "WAERS1": FieldType.CURRENCY,
    "CURRCODE": FieldType.CURRENCY,
    "CUR": FieldType.CURRENCY,
    "LANGUAGE": FieldType.LANGUAGE,
    "LANGU": FieldType.LANGUAGE,
    "SPRAS": FieldType.LANGUAGE,
    "UOM": FieldType.UOM,
    "MEINS": FieldType.UOM,
    "MSEHI": FieldType.UOM,
    "UNIT": FieldType.UOM,
    "POSTAL_CODE": FieldType.POSTAL_CODE,
    "POSTALCODE": FieldType.POSTAL_CODE,
    "ZIPCODE": FieldType.POSTAL_CODE,
    "ZIP": FieldType.POSTAL_CODE,
    "PSTLZ": FieldType.POSTAL_CODE,
    "PLZ": FieldType.POSTAL_CODE,
    "POSTCODE": FieldType.POSTAL_CODE,
    "STREET": FieldType.STREET,
    "STRAS": FieldType.STREET,
    "ADDRESS": FieldType.STREET,
    "ADDRESS1": FieldType.STREET,
    "ADDR": FieldType.STREET,
    "CITY": FieldType.CITY,
    "ORT01": FieldType.CITY,
    "ORT02": FieldType.CITY,
    "NAME": FieldType.NAME,
    "NAME1": FieldType.NAME,
    "NAME2": FieldType.NAME,
    "NAME3": FieldType.NAME,
    "MCOD1": FieldType.NAME,
    "FULLNAME": FieldType.NAME,
    "FIRSTNAME": FieldType.NAME,
    "LASTNAME": FieldType.NAME,
    "COMPANYNAME": FieldType.NAME,
    "COMPANY_NAME": FieldType.NAME,
    "DESCR": FieldType.DESCRIPTION,
    "DESC": FieldType.DESCRIPTION,
    "DESCRIPTION": FieldType.DESCRIPTION,
    "MAKTX": FieldType.DESCRIPTION,
    "TEXT": FieldType.DESCRIPTION,
    "TXT": FieldType.DESCRIPTION,
    "NOTE": FieldType.DESCRIPTION,
    "REMARKS": FieldType.DESCRIPTION,
    "DATE": FieldType.DATE,
    "DATUM": FieldType.DATE,
    "CREATED": FieldType.DATETIME,
    "CREATED_AT": FieldType.DATETIME,
    "UPDATED_AT": FieldType.DATETIME,
    "MODIFIED": FieldType.DATETIME,
    "MODIFIED_AT": FieldType.DATETIME,
    "CHANGED_AT": FieldType.DATETIME,
    "ERDAT": FieldType.DATE,
    "AEDAT": FieldType.DATE,
    "BUDAT": FieldType.DATE,
    "TIMESTAMP": FieldType.TIMESTAMP,
    "TIMESTMP": FieldType.TIMESTAMP,
    "AMOUNT": FieldType.AMOUNT,
    "AMT": FieldType.AMOUNT,
    "VALUE": FieldType.AMOUNT,
    "PRICE": FieldType.AMOUNT,
    "NETWR": FieldType.AMOUNT,
    "DMBTR": FieldType.AMOUNT,
    "WRBTR": FieldType.AMOUNT,
    "QTY": FieldType.QUANTITY,
    "QUANTITY": FieldType.QUANTITY,
    "MENGE": FieldType.QUANTITY,
    "PCT": FieldType.PERCENTAGE,
    "PERCENT": FieldType.PERCENTAGE,
    "PERCENTAGE": FieldType.PERCENTAGE,
    "FLAG": FieldType.FLAG,
    "ACTIVE": FieldType.FLAG,
    "DELETED": FieldType.FLAG,
    "IS_ACTIVE": FieldType.FLAG,
}

_PRIMARY_KEY_SUFFIX = ("ID", "NUMBER", "NO", "KEY", "CODE")
_FLAG_VALUES = {"X", "Y", "N", " ", "", "TRUE", "FALSE", "0", "1"}

_CODE_RE = re.compile(r"^[A-Z0-9_-]{1,10}$")


def _field_tail(field_name: str) -> str:
    """Return the last underscore- or dot-separated token, uppercased."""
    if not field_name:
        return ""
    name = field_name.strip().upper()
    for sep in (".", "/"):
        if sep in name:
            name = name.rsplit(sep, 1)[-1]
    return name


def classify_field(field_name: str, *, sample_value: Optional[object] = None) -> FieldType:
    """Classify an SAP field by name (and optionally a sample value)."""
    if not field_name:
        return FieldType.UNKNOWN

    tail = _field_tail(field_name)

    if tail in _PRIMARY_KEYS:
        return FieldType.PRIMARY_KEY

    # Direct suffix map
    if tail in _SUFFIX_MAP:
        return _SUFFIX_MAP[tail]

    # Check the underscore-head (e.g. "TEL_NUMBER" → PHONE, "SMTP_ADDR" → EMAIL)
    if "_" in tail:
        first_token = tail.split("_", 1)[0]
        if first_token in _SUFFIX_MAP:
            return _SUFFIX_MAP[first_token]
        # Then the underscore-tail (e.g. "ORDER_EMAIL" → EMAIL)
        last_token = tail.rsplit("_", 1)[-1]
        if last_token in _SUFFIX_MAP:
            return _SUFFIX_MAP[last_token]

    # Generic ID suffix → foreign key
    for suf in _PRIMARY_KEY_SUFFIX:
        if tail.endswith(suf) and len(tail) <= 24:
            return FieldType.FOREIGN_KEY

    # Flag-value heuristic (sample ∈ {X, Y, N, ...})
    if sample_value is not None:
        sval = str(sample_value).strip().upper()
        if sval in _FLAG_VALUES and len(tail) <= 12:
            return FieldType.FLAG

    # Short opaque code
    if sample_value is not None:
        sval = str(sample_value).strip().upper()
        if _CODE_RE.match(sval) and len(sval) <= 10:
            return FieldType.CODE

    return FieldType.TEXT

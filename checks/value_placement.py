"""Values stored in the wrong field — detected, never guessed.

What a field *should* hold comes from its SAP data element (TELF1 → phone,
AD_SMTPADR → e-mail, PSTLZ → postal code, …), not from its name. A value is
flagged only when it is *positively* identified as another kind of data:
structure for e-mail/URL, mod-97 checksum for IBAN, a real calendar date,
explicit keywords for PO boxes, "c/o", "Attn", "Tel:". Each detector runs only
on the field kinds where a hit cannot be legitimate (a 10-digit number is a
phone in NAME2, never in a postal-code or bank-account field).

Rule families (generated per module, for the tables its rules read):
  VP-<T>-<F>       misplaced content          validity
  PH-<T>-<F>       placeholder instead of data ("N/A", "TBA", 0000000000)  completeness
  SW-<T>           postal code ↔ city swapped or merged                    accuracy
  ST-<T>           record marked dead in text ("DO NOT USE") but not blocked  consistency
  DT-<T>-<F>       creation/change date before 1970 or in the future           validity
  DO-<T>           changed before it was created                              consistency
(dates are typed by data element too: EKKO.AEDAT is ERDAT — a creation date)
Fields that already carry a format rule (regex/format/domain) in the module get
no VP/PH rule: that rule already fails the record — one defect, one finding.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import pandas as pd
import yaml

# ── what a field holds, by SAP data element ───────────────────────────────
KIND_BY_DATA_ELEMENT: dict[str, str] = {
    **{d: "name" for d in ("NAME1_GP", "NAME2_GP", "NAME3_GP", "NAME4_GP", "AD_NAME1", "AD_NAME2", "AD_NAME3",
                           "AD_NAME4", "AD_NAMETXT", "BU_NAMEOR1", "BU_NAMEOR2", "BU_NAMEOR3", "BU_NAMEOR4",
                           "BU_NAMEP_L", "BU_NAMEP_F", "BU_NAMEPL2", "BU_BIRTHNM", "BU_NAMEMID", "BU_NAMEGR1",
                           "BU_NAMEGR2", "KOINH_FI", "EBPP_ACCNAME")},
    **{d: "street" for d in ("STRAS_GP", "AD_STREET", "AD_STRSPP1", "AD_STRSPP2", "AD_STRSPP3", "AD_LCTN")},
    **{d: "city" for d in ("ORT01_GP", "AD_CITY1", "PFORT_GP", "ORT01_ANLA")},
    **{d: "district" for d in ("ORT02_GP", "AD_CITY2", "AD_CITY3")},
    **{d: "postcode" for d in ("PSTLZ", "PSTL2", "AD_PSTCD1", "AD_PSTCD2", "AD_PSTCD3")},
    **{d: "phone" for d in ("TELF1", "TELF2", "AD_TLNMBR1", "AD_TLNMBR", "AD_TELNRLG", "TLFNS")},
    **{d: "fax" for d in ("TELFX", "AD_FXNMBR1", "AD_FXNMBR", "TLFXS")},
    "AD_SMTPADR": "email",
    "URL": "url",
    **{d: "text" for d in ("MAKTX", "TXT20_SKAT", "TXT50_SKAT", "TXA50_ANLT", "KTX01")},
    **{d: "sort" for d in ("SORTL", "AD_SORT1", "AD_SORT2", "BU_SORT1", "BU_SORT2")},
    "BANKN": "bank_account",
    **{d: "tax_number" for d in ("STCD1", "STCD2", "STCD3", "STCD4", "STCEG")},
}

# detectors allowed per field kind — where a hit is never legitimate
FOREIGN: dict[str, tuple[str, ...]] = {
    "name": ("email", "url", "iban", "phone_keyword", "phone", "po_box", "date", "care_of_primary", "attention"),
    "street": ("email", "url", "iban", "phone_keyword", "phone", "po_box", "date"),
    "city": ("email", "url", "phone_keyword", "phone", "po_box", "date"),
    "district": ("email", "url", "phone_keyword", "phone", "date"),
    "text": ("email", "url", "phone_keyword"),
    "phone": ("email", "url"),
    "fax": ("email", "url"),
    "email": ("url_not_email", "phone"),
    "url": ("email_not_url",),
    "bank_account": ("iban",),
}
PLACEHOLDER_KINDS = ("name", "street", "city", "postcode", "phone", "fax", "email", "tax_number", "bank_account")
DIGIT_KINDS = ("phone", "fax", "tax_number", "bank_account")  # where 0000000000 / 1234567890 is a placeholder

TARGET = {  # where the value belongs (fix guidance)
    "email": "the e-mail address (ADR6.SMTP_ADDR — address data, communication tab)",
    "url_not_email": "the website/URL field (LFA1.LFURL / KNA1.KNURL, ADR12 in S/4HANA)",
    "email_not_url": "the e-mail address (ADR6.SMTP_ADDR)",
    "url": "the website/URL field (LFA1.LFURL / KNA1.KNURL, ADR12 in S/4HANA)",
    "iban": "the IBAN on the bank details (TIBAN; XK02/FD02 → Payment transactions → IBAN)",
    "phone": "the telephone field (TELF1 / ADR2)",
    "phone_keyword": "the telephone/fax fields (TELF1/TELFX, ADR2/ADR3)",
    "po_box": "the PO box fields (PFACH + PSTL2, ADRC.PO_BOX + POST_CODE2)",
    "date": "a date field — a date is not a name, address or number",
    "care_of_primary": "the c/o field (ADRC.NAME_CO) — NAME1 must be the party itself",
    "attention": "a contact person (KNVK / BP relationship), not the name",
}

# ── detectors: vectorised over a Series of stripped, non-blank strings ────
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
_URL = re.compile(r"(?i)\b(?:https?://|www\.)[^\s]+")
# a phone keyword followed by a number of >= 7 digits ('pH 7.5' and 'load cell 0-500 kg' are too short)
_PHONE_KW = re.compile(r"(?i)\b(?:tel|telephone|phone|ph|cell|mobile|mob|fax)\b\.?\s*:?\s*\+?\(?(?:\d[\s().\-]*){7,}")
_PHONE = re.compile(r"^(?:\+|00|0|\()[\d\s().\-]+$")
_PO_BOX = re.compile(r"(?i)\b(?:p\.?\s?o\.?\s?box|post\s?box|postbus|postfach|private\s+bag|p\.?\s?o\.?\s+bag|"
                     r"bo[iî]te\s+postale|apartado\s+postal|caixa\s+postal|casilla)\b")
_CARE_OF = re.compile(r"(?i)^(?:c/o|c\.o\.|care\s+of)\b")
_ATTN = re.compile(r"(?i)^(?:attn|attention|att)\b\.?:?\s")
_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$|^(\d{2})[./](\d{2})[./](\d{4})$")
_IBAN_TOKEN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")
_POSTCODE_ONLY = re.compile(r"^(?=(?:\D*\d){3})[A-Z0-9][A-Z0-9 \-]{2,9}$", re.I)
_CITY_WITH_CODE = re.compile(r"^\d{4,6}\s+\D{2,}|\D{2,}\s+\d{4,6}$")


def _iban_ok(s: str) -> bool:
    s = s.replace(" ", "").upper()
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", s):
        return False
    n = "".join(str(int(c, 36)) for c in s[4:] + s[:4])
    return int(n) % 97 == 1


def _has_iban(v: str) -> bool:
    compact = v.replace(" ", "").upper()
    return _iban_ok(compact) or any(_iban_ok(t) for t in _IBAN_TOKEN.findall(v.upper()))


def _real_date(v: str) -> bool:
    m = _DATE.match(v)
    if not m:
        return False
    y, mo, d = (m.group(1), m.group(2), m.group(3)) if m.group(1) else (m.group(6), m.group(5), m.group(4))
    try:
        pd.Timestamp(year=int(y), month=int(mo), day=int(d))
    except ValueError:
        # DD.MM vs MM/DD: accept the other reading only for "/" dates
        try:
            pd.Timestamp(year=int(y), month=int(d), day=int(mo))
        except ValueError:
            return False
    return 1900 <= int(y) <= 2100


def _digits(s: pd.Series) -> pd.Series:
    return s.str.count(r"\d")


DETECTORS = {
    "email": lambda s: s.str.contains(_EMAIL),
    "email_not_url": lambda s: s.str.contains(_EMAIL) & ~s.str.contains(_URL),
    "url": lambda s: s.str.contains(_URL),
    "url_not_email": lambda s: s.str.contains(_URL) & ~s.str.contains("@", regex=False),
    "iban": lambda s: s.map(_has_iban).astype(bool),
    "phone_keyword": lambda s: s.str.contains(_PHONE_KW),
    "phone": lambda s: s.str.match(_PHONE) & _digits(s).between(9, 15),
    "po_box": lambda s: s.str.contains(_PO_BOX),
    "date": lambda s: s.map(_real_date).astype(bool),
    "care_of_primary": lambda s: s.str.contains(_CARE_OF),
    "attention": lambda s: s.str.contains(_ATTN),
}


# EU VAT check digits — only published algorithms; other countries are not judged
def _vat_be(d: str) -> bool:
    return len(d) == 10 and 97 - int(d[:8]) % 97 == int(d[8:])


def _vat_de(d: str) -> bool:  # ISO 7064 MOD 11,10
    if len(d) != 9:
        return False
    product = 10
    for c in d[:8]:
        total = (int(c) + product) % 10 or 10
        product = (2 * total) % 11
    check = 11 - product
    return (0 if check == 10 else check) == int(d[8])


def _vat_it(d: str) -> bool:  # Luhn over the 11 digits
    if len(d) != 11:
        return False
    total = 0
    for i, c in enumerate(d):
        n = int(c) * (2 if i % 2 else 1)
        total += n - 9 if n > 9 else n
    return total % 10 == 0


def _vat_fr(d: str) -> bool:  # numeric key + SIREN
    return len(d) == 11 and int(d[:2]) == (12 + 3 * (int(d[2:]) % 97)) % 97


def _weighted(d: str, weights) -> int:
    return sum(int(x) * w for x, w in zip(d, weights))


def _luhn(d: str) -> bool:
    total = 0
    for i, x in enumerate(reversed(d)):
        n = int(x) * (2 if i % 2 else 1)
        total += n - 9 if n > 9 else n
    return total % 10 == 0


def _vat_at(d: str) -> bool:  # U + 8 digits; doubled digits summed, offset 4
    s = sum(int(x) if i % 2 == 0 else sum(divmod(int(x) * 2, 10)) for i, x in enumerate(d[:7]))
    return (10 - (s + 4) % 10) % 10 == int(d[7])


def _vat_nl(v: str) -> bool:  # 9 digits B 2 digits: MOD 11 (legal entities) or MOD 97 (sole traders, 2020)
    d = v[:9]
    mod11 = (_weighted(d[:8], range(9, 1, -1)) % 11) == int(d[8])
    mod97 = int("2321" + d + "11" + v[10:]) % 97 == 1
    return mod11 or mod97


def _vat_pl(d: str) -> bool:
    r = _weighted(d, (6, 5, 7, 2, 3, 4, 5, 6, 7)) % 11
    return r != 10 and r == int(d[9])


def _vat_dk(d: str) -> bool:
    return _weighted(d, (2, 7, 6, 5, 4, 3, 2, 1)) % 11 == 0


def _vat_fi(d: str) -> bool:
    r = _weighted(d, (7, 9, 10, 5, 8, 4, 2)) % 11
    return r != 1 and (0 if r == 0 else 11 - r) == int(d[7])


def _vat_se(d: str) -> bool:  # organisation number (Luhn) + 01
    return d.endswith("01") and _luhn(d[:10])


def _vat_pt(d: str) -> bool:
    c = 11 - _weighted(d, range(9, 1, -1)) % 11
    return (0 if c >= 10 else c) == int(d[8])


def _vat_gb(d: str) -> bool:  # 9 digits: MOD 97, or MOD 9755 (numbers issued since 2010)
    total = _weighted(d[:7], range(8, 1, -1)) + int(d[7:9])
    return total % 97 == 0 or (total + 55) % 97 == 0


VAT_CHECKS = {"BE": (_vat_be, r"^\d{10}$"), "DE": (_vat_de, r"^\d{9}$"), "IT": (_vat_it, r"^\d{11}$"),
              "FR": (_vat_fr, r"^\d{11}$"), "AT": (lambda b: _vat_at(b[1:]), r"^U\d{8}$"),
              "NL": (_vat_nl, r"^\d{9}B\d{2}$"), "PL": (_vat_pl, r"^\d{10}$"), "DK": (_vat_dk, r"^\d{8}$"),
              "FI": (_vat_fi, r"^\d{8}$"), "SE": (_vat_se, r"^\d{12}$"), "PT": (_vat_pt, r"^\d{9}$"),
              "GB": (_vat_gb, r"^\d{9}$")}


def vat_status(v: str) -> str:
    """'ok' | 'bad' (well-formed, wrong check digits) | 'n/a' (country not checked or malformed)."""
    v = re.sub(r"[\s.\-]", "", v.upper())
    cc, body = v[:2], v[2:]
    if cc not in VAT_CHECKS or not re.fullmatch(VAT_CHECKS[cc][1], body):
        return "n/a"  # malformed is the format rule's finding, not this one
    return "ok" if VAT_CHECKS[cc][0](body) else "bad"


_LEGAL_FORMS = re.compile(r"\b(?:PTY|PROPRIETARY|LTD|LIMITED|PLC|GMBH|MBH|AG|KG|OHG|EK|BV|NV|SA|SAS|SARL|SPA|SRL|"
                          r"INC|INCORPORATED|LLC|CORP|CORPORATION|CO|COMPANY|CC|AB|OY|AS|APS|SE)\b")


def name_key(s: pd.Series) -> pd.Series:
    """'Acme (Pty) Ltd.' == 'ACME PTY LTD' == 'acme': legal form, case and punctuation ignored."""
    t = s.astype("string").str.upper().str.replace(r"[^0-9A-Z ]", " ", regex=True)
    return t.str.replace(_LEGAL_FORMS, " ", regex=True).str.replace(r"\s+", "", regex=True)


@lru_cache(maxsize=1)
def lexicon() -> dict:
    return yaml.safe_load((Path(__file__).parent / "rules" / "value_lexicon.yaml").read_text())


def _placeholder_re(kind: str) -> re.Pattern:
    words = lexicon()["placeholders"]
    alts = [re.escape(w) for w in words]
    alts += [r"x{3,}", r"z{3,}", r"[-.?_*/#]+", r"(\S)\1{3,}"] if kind not in ("postcode",) else [r"[-.?_*/#]+", r"x{3,}"]
    return re.compile(r"(?i)^(?:" + "|".join(alts) + r")$")


def is_placeholder(s: pd.Series, kind: str) -> pd.Series:
    s = s.astype(object)
    hit = s.str.match(_placeholder_re(kind))
    if kind == "email":
        hit |= s.str.lower().str.contains("|".join(re.escape(e) for e in lexicon()["placeholder_emails"]))
    if kind in DIGIT_KINDS:
        d = s.str.replace(r"[\s().\-/+]", "", regex=True)
        hit |= d.str.fullmatch(r"(\d)\1{5,}") | d.isin(("1234567890", "123456789", "12345678", "0123456789"))
    if kind == "postcode":
        hit &= ~s.str.fullmatch(r"\d+")  # every numeric postcode is plausible somewhere
    return hit.fillna(False).astype(bool)


def status_markers(s: pd.Series) -> pd.Series:
    s = s.astype(object)
    pat = re.compile(r"(?i)" + "|".join(lexicon()["status_markers"]))
    return s.str.contains(pat).fillna(False).astype(bool)


# ── generation ───────────────────────────────────────────────────────────
_FORMAT_CLASSES = ("regex_check", "format_check", "domain_value_check")

# the SAP flags that make "DO NOT USE" in a name consistent (the record is blocked)
BLOCK_FIELDS = {
    "LFA1": ("SPERR", "SPERM"), "KNA1": ("SPERR", "AUFSD", "CASSD"), "BUT000": ("XBLCK",),
    "MARA": ("MSTAE",), "SKA1": ("XSPEB",), "ANLA": ("XSPEB",),
}
STATUS_TEXT = {  # table → where its name/description lives (attribute table joined 1:1)
    "LFA1": ("LFA1", ("NAME1", "NAME2", "NAME3", "NAME4", "SORTL")),
    "KNA1": ("KNA1", ("NAME1", "NAME2", "NAME3", "NAME4", "SORTL")),
    "BUT000": ("BUT000", ("NAME_ORG1", "NAME_ORG2", "NAME_LAST", "BU_SORT1", "BU_SORT2")),
    "MARA": ("MAKT", ("MAKTX",)),
    "ANLA": ("ANLA", ("TXT50", "TXA50")),
}
CREATED_DE = {"ERDAT", "ERDAT_RF", "ERSDA", "ANDAT", "BU_CRDAT", "ICRDT", "LTAK_BDATU"}
CHANGED_DE = {"AEDAT", "LAEDA", "AEDTM", "AEDAT_ANLA", "BU_CHDAT", "IUPDT", "LAGP_LAEDT"}
SWAP_PAIRS = {"LFA1": ("PSTLZ", "ORT01"), "KNA1": ("PSTLZ", "ORT01"), "ADRC": ("POST_CODE1", "CITY1")}


def kind_of(dictionary, table: str, field: str) -> str | None:
    f = dictionary.field(table, field)
    return KIND_BY_DATA_ELEMENT.get((f.data_element or "").upper()) if f is not None else None


# near-duplicate detection: name compared within a block (checks/types/similarity_check.py)
NEAR_DUPLICATE = {"LFA1": ("LFA1.NAME1", ("LFA1.LAND1", "LFA1.PSTLZ"), "LFA1"),
                  "KNA1": ("KNA1.NAME1", ("KNA1.LAND1", "KNA1.PSTLZ"), "KNA1"),
                  "MAKT": ("MAKT.MAKTX", ("MARA.MTART", "MARA.MATKL"), "MARA")}


def fields_for(table: str, dictionary) -> set[str]:
    """Fields of ``table`` these rules read (for extraction and column pruning)."""
    t = dictionary.table(table)
    if t is None:
        return set()
    out = {f.name for f in t.fields.values()
           if KIND_BY_DATA_ELEMENT.get((f.data_element or "").upper()) or (f.data_element or "").upper() in CREATED_DE | CHANGED_DE}
    out |= set(BLOCK_FIELDS.get(table, ()))
    out |= {c.split(".")[1] for name, block, _ in NEAR_DUPLICATE.values() for c in (name, *block)
            if c.startswith(table + ".")}
    for grain, (text_table, fields) in STATUS_TEXT.items():
        if text_table == table:
            out |= set(fields)
    return {f for f in out if dictionary.field(table, f) is not None}


def generate(module: str, static_rules: list[dict], dictionary) -> list[dict]:
    from checks.frames import tables_of
    from checks.runner import rule_columns

    cols = [c for r in static_rules for c in rule_columns(r)]
    tables = tables_of(cols)
    formatted = {r.get("field") for r in static_rules if r.get("check_class") in _FORMAT_CLASSES}
    rules: list[dict] = []
    base = {"module": module, "check_class": "value_placement_check", "rule_authority": "generated_value_placement"}
    for t in tables:
        tdef = dictionary.table(t)
        if tdef is None:
            continue
        for f in tdef.fields.values():
            col, kind = f"{t}.{f.name}", KIND_BY_DATA_ELEMENT.get((f.data_element or "").upper())
            if not kind or col in formatted:
                continue
            label = f.description or f.name
            if kind in FOREIGN:
                rules.append({**base, "id": f"VP-{t}-{f.name}", "family": "misplaced", "field": col, "kind": kind,
                              "severity": "medium", "dimension": "validity",
                              "message": f"{label} ({col}) holds data that belongs in another field",
                              "why_it_matters": "Data in the wrong field is invisible to every process that reads "
                                                "the right one: dunning e-mails, payment files, tax reports and "
                                                "duplicate checks miss it."})
            if kind in PLACEHOLDER_KINDS:
                rules.append({**base, "id": f"PH-{t}-{f.name}", "family": "placeholder", "field": col, "kind": kind,
                              "severity": "medium", "dimension": "completeness",
                              "message": f"{label} ({col}) holds a placeholder instead of real data",
                              "why_it_matters": "Placeholders ('N/A', 'TBA', 0000000000) pass mandatory-field "
                                                "checks but carry no information — the field is effectively empty."})
        created = [f"{t}.{f.name}" for f in tdef.fields.values() if (f.data_element or "").upper() in CREATED_DE]
        changed = [f"{t}.{f.name}" for f in tdef.fields.values() if (f.data_element or "").upper() in CHANGED_DE]
        for col in created + changed:
            rules.append({**base, "id": f"DT-{t}-{col.split('.')[1]}", "family": "date_range", "field": col,
                          "severity": "medium", "dimension": "validity",
                          "message": f"{col} is before 1970 or in the future",
                          "why_it_matters": "A record cannot be created or changed in the future or before the "
                                            "system existed: the date was loaded wrongly, and every age, aging and "
                                            "audit report built on it is wrong."})
        if created and changed:
            rules.append({**base, "id": f"DO-{t}", "family": "change_before_create", "field": changed[0],
                          "fields": [created[0], changed[0]], "severity": "low", "dimension": "consistency",
                          "message": f"{t} record was last changed before it was created ({changed[0]} < {created[0]})",
                          "why_it_matters": "A change date before the creation date means one of them was loaded "
                                            "or migrated wrongly; change-history and audit reporting cannot be "
                                            "trusted for this record."})
        if dictionary.field(t, "STCEG") is not None:
            rules.append({**base, "id": f"VT-{t}-STCEG", "family": "vat_checksum", "field": f"{t}.STCEG",
                          "severity": "high", "dimension": "validity",
                          "message": f"VAT registration number ({t}.STCEG) has wrong check digits",
                          "why_it_matters": "A VAT number with wrong check digits is not a registered number: "
                                            "EC sales lists and input-VAT claims citing it are rejected."})
        if t in ("LFA1", "KNA1") and all(dictionary.field(t, x) for x in ("NAME1", "PSTLZ", "LAND1")):
            rules.append({**base, "check_class": "uniqueness_check", "id": f"ND-{t}", "normalize": "name",
                          "field": f"{t}.NAME1", "fields": [f"{t}.NAME1", f"{t}.PSTLZ", f"{t}.LAND1"],
                          "severity": "medium", "dimension": "uniqueness",
                          "message": f"Probable duplicate: same name (ignoring legal form and punctuation), "
                                     f"postal code and country ({t})",
                          "why_it_matters": "The same business created twice splits its history, limits and open "
                                            "items across accounts and defeats duplicate-invoice and credit checks."})
        if t in NEAR_DUPLICATE and all(dictionary.resolve(c) for c in (NEAR_DUPLICATE[t][0], *NEAR_DUPLICATE[t][1])):
            name, block, grain = NEAR_DUPLICATE[t]
            rules.append({**base, "check_class": "similarity_check", "id": f"FZ-{t}", "field": name,
                          "block_by": list(block), "grain": grain, "threshold": 0.9,
                          "exact_rule": t in ("LFA1", "KNA1"),  # ND-<table> reports identical names
                          "severity": "medium", "dimension": "uniqueness",
                          "message": f"Possible duplicate: identical or near-identical name ({name}) within the same "
                                     f"{' / '.join(b.split('.')[1] for b in block)}",
                          "why_it_matters": "Records keyed in twice with a typo or different word order escape "
                                            "exact duplicate checks; the business ends up with two accounts or two "
                                            "materials, splitting history, stock, limits and open items."})
        if t in SWAP_PAIRS and all(dictionary.field(t, x) for x in SWAP_PAIRS[t]):
            pc, city = SWAP_PAIRS[t]
            rules.append({**base, "id": f"SW-{t}-{pc}-{city}", "family": "swap", "field": f"{t}.{city}",
                          "fields": [f"{t}.{pc}", f"{t}.{city}"], "severity": "medium", "dimension": "accuracy",
                          "message": f"Postal code and city are swapped or merged ({t}.{pc} / {t}.{city})",
                          "why_it_matters": "Address validation, tax jurisdiction and carrier routing read the "
                                            "postal code field; a postal code inside the city is lost to them."})
        if t in STATUS_TEXT:
            text_table, text_fields = STATUS_TEXT[t]
            texts = [f"{text_table}.{x}" for x in text_fields if dictionary.field(text_table, x)]
            blocks = [f"{t}.{x}" for x in BLOCK_FIELDS.get(t, ()) if dictionary.field(t, x)]
            if texts and blocks:
                rules.append({**base, "id": f"ST-{t}", "family": "status_text", "field": texts[0],
                              "fields": texts, "block_fields": blocks, "grain": t,
                              "severity": "high", "dimension": "consistency",
                              "message": f"{t} record is marked as not-to-be-used in its text, but is not blocked",
                              "why_it_matters": "'DO NOT USE' in a name stops nobody: SAP only enforces the block "
                                                "and deletion flags, so the record keeps receiving orders and "
                                                "postings."})
    return rules

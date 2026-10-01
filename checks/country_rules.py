"""Rules from the system's own country settings (T005) and bank master (BNKA).

T005 defines, per country, the length and check rule SAP applies on entry to
postal codes, tax numbers and bank details (PRPLZ / PRST1 / PRST2 / PRBKN /
PRBLZ with LNPLZ / LNST1 / LNST2 / LNBKN / LNBLZ) and whether a street
address needs a postal code (XPLZS). Data that was loaded around those checks
(migrations, interfaces, direct loads) is exactly what they find. Bank keys
must exist in the system's bank directory — judged only for countries whose
directory is loaded at all, so foreign banks are never condemned for a
directory the customer does not keep. Nothing is generated without the tables.
"""

from __future__ import annotations

# check rule codes (domain fixed values): 1-8 deterministic, 9 country edit format, 0 off
NUMERIC = {"2", "4", "6", "8"}
EXACT = {"3", "4", "7", "8"}
NO_GAPS = {"1", "2", "3", "4"}
ACTIVE = {"1", "2", "3", "4", "5", "6", "7", "8"}

KIND_FIELDS = {"postal": ("LNPLZ", "PRPLZ"), "tax1": ("LNST1", "PRST1"), "tax2": ("LNST2", "PRST2"),
               "bank_account": ("LNBKN", "PRBKN"), "bank_number": ("LNBLZ", "PRBLZ")}
# (table, field, country field, kind, street field that makes a postal code required)
TARGETS = (
    ("LFA1", "PSTLZ", "LFA1.LAND1", "postal", "LFA1.STRAS"),
    ("KNA1", "PSTLZ", "KNA1.LAND1", "postal", "KNA1.STRAS"),
    ("ADRC", "POST_CODE1", "ADRC.COUNTRY", "postal", "ADRC.STREET"),
    ("LFA1", "STCD1", "LFA1.LAND1", "tax1", None), ("LFA1", "STCD2", "LFA1.LAND1", "tax2", None),
    ("KNA1", "STCD1", "KNA1.LAND1", "tax1", None), ("KNA1", "STCD2", "KNA1.LAND1", "tax2", None),
    ("LFBK", "BANKN", "LFBK.BANKS", "bank_account", None), ("LFBK", "BANKL", "LFBK.BANKS", "bank_number", None),
    ("KNBK", "BANKN", "KNBK.BANKS", "bank_account", None), ("KNBK", "BANKL", "KNBK.BANKS", "bank_number", None),
    ("BUT0BK", "BANKN", "BUT0BK.BANKS", "bank_account", None), ("BUT0BK", "BANKL", "BUT0BK.BANKS", "bank_number", None),
)
LABELS = {"postal": "postal code", "tax1": "tax number 1", "tax2": "tax number 2",
          "bank_account": "bank account number", "bank_number": "bank key"}


def violates(value: str, length: int, rule: str) -> bool:
    """SAP's own country check (as in the T005 rule domain)."""
    if rule in NO_GAPS and " " in value:
        return True
    if rule in NUMERIC and not value.replace(" ", "").isdigit():
        return True
    if length:
        return len(value) != length if rule in EXACT else len(value) > length
    return False


def specs(config: dict[str, list[dict]]) -> dict[str, dict[str, tuple[int, str]]]:
    """{kind: {country: (length, rule)}} for active rules."""
    out: dict[str, dict[str, tuple[int, str]]] = {k: {} for k in KIND_FIELDS}
    for row in config.get("T005") or []:
        country = str(row.get("LAND1") or "").strip()
        for kind, (ln, pr) in KIND_FIELDS.items():
            rule = str(row.get(pr) or "").strip()
            if country and rule in ACTIVE:
                length = str(row.get(ln) or "0").strip()
                out[kind][country] = (int(length) if length.isdigit() else 0, rule)
    return out


def fields_for(table: str, dictionary) -> set[str]:
    """Fields these rules read on ``table`` (extraction and column pruning)."""
    out = set()
    for t, f, country, _, street in TARGETS:
        if t == table:
            out |= {f, country.split(".")[1]} | ({street.split(".")[1]} if street else set())
            if t in ("LFBK", "KNBK", "BUT0BK"):
                out.add("BANKL")
    return {f for f in out if dictionary.field(table, f) is not None}


def generate(module: str, static_rules: list[dict], config: dict[str, list[dict]], dictionary) -> list[dict]:
    from checks.frames import tables_of
    from checks.runner import rule_columns

    if not config.get("T005") and not config.get("BNKA"):
        return []
    tables = set(tables_of([c for r in static_rules for c in rule_columns(r)]))
    by_kind = specs(config)
    required = sorted(str(r.get("LAND1") or "").strip() for r in config.get("T005") or []
                      if str(r.get("XPLZS") or "").strip() == "X")
    base = {"module": module, "check_class": "country_format_check", "rule_authority": "system_country_settings"}
    rules: list[dict] = []
    for t, f, country, kind, street in TARGETS:
        col = f"{t}.{f}"
        if t not in tables or dictionary.field(t, f) is None or dictionary.resolve(country) is None:
            continue
        if by_kind[kind]:
            rules.append({**base, "id": f"CF-{t}-{f}", "family": "format", "field": col, "country_field": country,
                          "specs": {c: list(v) for c, v in sorted(by_kind[kind].items())},
                          "severity": "medium", "dimension": "validity",
                          "message": f"{LABELS[kind].capitalize()} ({col}) does not match the format this system "
                                     f"defines for its country (T005)",
                          "why_it_matters": "SAP checks this format on entry; a value that fails it was loaded around "
                                            "the check and is rejected by every process that validates it again "
                                            "(payment media, tax reporting, address validation)."})
        if kind == "postal" and street and required and dictionary.resolve(street) is not None:
            rules.append({**base, "id": f"CR-{t}-{f}", "family": "required", "field": col, "country_field": country,
                          "street_field": street, "countries": required, "severity": "medium",
                          "dimension": "completeness",
                          "message": f"Postal code ({col}) is missing although the country requires one for a "
                                     f"street address (T005-XPLZS)",
                          "why_it_matters": "The system's own country settings make the postal code mandatory for "
                                            "street addresses; deliveries, tax jurisdictions and carriers depend on it."})
        if kind == "bank_number" and config.get("BNKA"):
            keys = sorted({f"{str(r.get('BANKS') or '').strip()}|{str(r.get('BANKL') or '').strip()}"
                           for r in config["BNKA"]})
            rules.append({**base, "id": f"BK-{t}", "family": "exists", "field": col, "country_field": country,
                          "keys": keys, "countries": sorted({k.split("|")[0] for k in keys}),
                          "severity": "high", "dimension": "accuracy",
                          "message": f"Bank key ({col}) does not exist in the system's bank directory (BNKA)",
                          "why_it_matters": "Payment runs read the bank's SWIFT code and address from the bank "
                                            "directory; a bank key that is not there fails the payment medium."})
    return rules

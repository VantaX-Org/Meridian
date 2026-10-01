"""Rules from the system's own country settings (T005) and bank master (BNKA).

T005 defines, per country, the length and check rule SAP applies on entry to
postal codes, tax numbers and bank details (PRPLZ / PRST1 / PRST2 / PRBKN /
PRBLZ with LNPLZ / LNST1 / LNST2 / LNBKN / LNBLZ) and whether a street
address needs a postal code (XPLZS). Data that was loaded around those checks
(migrations, interfaces, direct loads) is exactly what they find. Bank keys
must exist in the system's bank directory — judged only for countries whose
directory is loaded at all, so foreign banks are never condemned for a
directory the customer does not keep. A licensed SWIFT directory the customer
uploads (REF_BIC) is checked the same way: only BICs of countries it lists are
judged. Nothing is generated without the tables.
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
    ("PA0006", "PSTLZ", "PA0006.LAND1", "postal", "PA0006.STRAS"),
    ("PA0009", "BANKN", "PA0009.BANKS", "bank_account", None), ("PA0009", "BANKL", "PA0009.BANKS", "bank_number", None),
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
            if t in ("LFBK", "KNBK", "BUT0BK", "PA0009"):
                out.add("BANKL")
    return {f for f in out if dictionary.field(table, f) is not None}


def generate(module: str, static_rules: list[dict], config: dict[str, list[dict]], dictionary) -> list[dict]:
    from checks.frames import tables_of
    from checks.runner import rule_columns

    if not any(config.get(t) for t in ("T005", "BNKA", "REF_POSTAL", "REF_BIC")):
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
        if kind == "postal" and config.get("REF_POSTAL"):
            keys = sorted({f"{str(r.get('COUNTRY') or '').strip().upper()}|"
                           f"{str(r.get('POSTCODE') or '').strip().upper()}" for r in config["REF_POSTAL"]})
            rules.append({**base, "id": f"PX-{t}-{f}", "family": "exists", "field": col, "country_field": country,
                          "keys": keys, "countries": sorted({k.split("|")[0] for k in keys}),
                          "reference": "REF_POSTAL", "rule_authority": "customer_reference_data",
                          "severity": "medium", "dimension": "accuracy",
                          "message": f"Postal code ({col}) is not in the official postal code list for its country",
                          "why_it_matters": "A postal code that does not exist cannot be delivered to and puts the "
                                            "address in the wrong tax jurisdiction and carrier zone. Judged only "
                                            "for countries whose official list is loaded."})
        if kind == "bank_number" and config.get("BNKA"):
            keys = sorted({f"{str(r.get('BANKS') or '').strip()}|{str(r.get('BANKL') or '').strip()}"
                           for r in config["BNKA"]})
            rules.append({**base, "id": f"BK-{t}", "family": "exists", "field": col, "country_field": country,
                          "keys": keys, "countries": sorted({k.split("|")[0] for k in keys}),
                          "severity": "high", "dimension": "accuracy",
                          "message": f"Bank key ({col}) does not exist in the system's bank directory (BNKA)",
                          "why_it_matters": "Payment runs read the bank's SWIFT code and address from the bank "
                                            "directory; a bank key that is not there fails the payment medium."})
    if config.get("REF_BIC") and "BNKA" in tables and dictionary.field("BNKA", "SWIFT") is not None:
        keys = sorted({str(r.get("BIC") or "").strip().upper() for r in config["REF_BIC"]} - {""})
        rules.append({**base, "id": "BX-BNKA", "family": "bic", "field": "BNKA.SWIFT", "country_field": "BNKA.BANKS",
                      "keys": keys, "countries": sorted({k[4:6] for k in keys}), "reference": "REF_BIC",
                      "rule_authority": "customer_reference_data", "severity": "high", "dimension": "accuracy",
                      "message": "SWIFT/BIC (BNKA.SWIFT) is not in the SWIFT directory loaded for its country",
                      "why_it_matters": "A well-formed BIC can still belong to no bank, or to a closed one. Payment "
                                        "media carry it unchanged and the bank rejects the transfer. Judged only "
                                        "for countries the loaded directory covers.",
                      "sap_impact": "Payments to every vendor and customer of this bank are rejected or returned.",
                      "fix_map": {"__other__": "Look the bank up in the SWIFT directory and correct the BIC in the "
                                               "bank directory (FI02)."},
                      "record_fix_template": "Bank {BNKA.BANKS}/{BNKA.BANKL}: BIC {BNKA.SWIFT} is not in the SWIFT "
                                             "directory."})
    return rules

"""South African data standardisation functions.

Pure Python — no database access, no LLM calls.
"""

import re


def title_case(name: str) -> str:
    """SA company name casing.

    Capitalise first letter of each word.  Preserve uppercase for PTY, LTD, CC,
    NPC, SOC, RF.  Keep lowercase for: and, of, the, in, t/a.
    Wrap PTY/LTD in canonical parenthesised form via legal_suffix.
    """
    if not name or not name.strip():
        return name

    preserve_upper = {"PTY", "LTD", "CC", "NPC", "SOC", "RF"}
    keep_lower = {"and", "of", "the", "in", "t/a"}

    words = name.split()
    result: list[str] = []
    for i, word in enumerate(words):
        upper = word.upper()
        if upper in preserve_upper:
            result.append(upper)
        elif word.lower() in keep_lower and i != 0:
            result.append(word.lower())
        else:
            result.append(word.capitalize())

    out = " ".join(result)
    return legal_suffix(out)


def legal_suffix(name: str) -> str:
    """Normalise SA legal entity variants to canonical form."""
    if not name or not name.strip():
        return name

    replacements: list[tuple[str, str]] = [
        (r"\bproprietary\s+limited\b", "(Pty) Ltd"),
        (r"\bpty\.?\s*ltd\.?", "(Pty) Ltd"),
        (r"\(pty\)\s*ltd\.?", "(Pty) Ltd"),
        (r"\bclose\s+corporation\b", "CC"),
        (r"\bnon[\s-]?profit\s+company\b", "NPC"),
    ]

    result = name
    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result


def sa_phone_number(phone: str) -> str:
    """Format SA phone numbers to +27 XX XXX XXXX."""
    if not phone:
        return phone

    digits = re.sub(r"\D", "", phone)

    if len(digits) == 11 and digits.startswith("27"):
        return f"+27 {digits[2:4]} {digits[4:7]} {digits[7:11]}"
    if len(digits) == 10 and digits.startswith("0"):
        digits = "27" + digits[1:]
        return f"+27 {digits[2:4]} {digits[4:7]} {digits[7:11]}"

    return phone


def country_code(country: str) -> str:
    """Map common SA-region country names to ISO 3166-1 alpha-2 codes."""
    if not country:
        return country

    mapping: dict[str, str] = {
        "south africa": "ZA",
        "rsa": "ZA",
        "sa": "ZA",
        "za": "ZA",
        "namibia": "NA",
        "botswana": "BW",
        "zimbabwe": "ZW",
        "mozambique": "MZ",
        "zambia": "ZM",
        "kenya": "KE",
        "nigeria": "NG",
    }

    result = mapping.get(country.strip().lower())
    return result if result else country.strip().upper()


def sap_uom(uom: str) -> str:
    """SAP Unit of Measure normalisation."""
    if not uom:
        return uom

    mapping: dict[str, str] = {
        "each": "EA",
        "pcs": "EA",
        "piece": "EA",
        "unit": "EA",
        "ea": "EA",
        "kg": "KG",
        "kgs": "KG",
        "kilogram": "KG",
        "g": "G",
        "gram": "G",
        "grams": "G",
        "l": "L",
        "lt": "L",
        "ltr": "L",
        "litre": "L",
        "liter": "L",
        "ml": "ML",
        "millilitre": "ML",
        "m": "M",
        "metre": "M",
        "meter": "M",
        "m2": "M2",
        "sqm": "M2",
        "square metre": "M2",
        "m3": "M3",
        "cbm": "M3",
        "cubic metre": "M3",
    }

    result = mapping.get(uom.strip().lower())
    return result if result else uom.strip().upper()


def validate_sa_id(id_number: str) -> dict:
    """Validate a 13-digit South African ID number.

    Extracts DOB, gender, citizenship and validates via Luhn mod-10 checksum.
    """
    if not id_number or not id_number.strip():
        return {"valid": False, "dob": None, "gender": None, "citizenship": None, "error": "empty"}

    digits = id_number.strip()
    if len(digits) != 13 or not digits.isdigit():
        return {"valid": False, "dob": None, "gender": None, "citizenship": None, "error": "must be 13 digits"}

    # Extract DOB (YYMMDD)
    yy, mm, dd = int(digits[0:2]), int(digits[2:4]), int(digits[4:6])
    year = 2000 + yy if yy <= 30 else 1900 + yy
    dob_str = f"{year:04d}-{mm:02d}-{dd:02d}"

    # Basic date validation
    if mm < 1 or mm > 12 or dd < 1 or dd > 31:
        return {"valid": False, "dob": None, "gender": None, "citizenship": None, "error": "invalid date in ID"}

    # Gender
    gender_code = int(digits[6:10])
    gender = "Male" if gender_code >= 5000 else "Female"

    # Citizenship
    cit_digit = int(digits[10])
    citizenship = "SA citizen" if cit_digit == 0 else "permanent resident" if cit_digit == 1 else None
    if citizenship is None:
        return {"valid": False, "dob": dob_str, "gender": gender, "citizenship": None, "error": "invalid citizenship digit"}

    # Luhn mod-10 checksum
    total = 0
    for i, d in enumerate(digits):
        n = int(d)
        if i % 2 == 1:  # 0-indexed: odd positions are doubled
            n *= 2
            if n > 9:
                n -= 9
        total += n

    if total % 10 != 0:
        return {"valid": False, "dob": dob_str, "gender": gender, "citizenship": citizenship, "error": "checksum failed"}

    return {"valid": True, "dob": dob_str, "gender": gender, "citizenship": citizenship, "error": None}


def validate_sa_bank_branch(branch_code: str) -> dict:
    """Validate against SA universal branch codes."""
    if not branch_code:
        return {"valid": False, "bank": None}

    code = branch_code.strip()
    mapping: dict[str, str] = {
        "250655": "FNB",
        "198765": "Nedbank",
        "051001": "Standard Bank",
        "632005": "ABSA",
        "470010": "Capitec",
        "679000": "African Bank",
        "430000": "Investec",
    }

    bank = mapping.get(code)
    return {"valid": bank is not None, "bank": bank}


def material_description(desc: str) -> str:
    """Uppercase, normalise spaces, apply abbreviations for material descriptions."""
    if not desc:
        return desc

    result = desc.upper().strip()
    result = re.sub(r"\s+", " ", result)

    abbreviations: list[tuple[str, str]] = [
        (r"\bSTAINLESS\s+STEEL\b", "SS"),
        (r"\bGALVANISED\b", "GALV"),
        (r"\bZINC\s+PLATED\b", "ZP"),
        (r"\bGRADE\b", "GR"),
        (r"\bDIAMETER\b", "DIA"),
        (r"\bMILLIMETRE\b", "MM"),
        (r"\bKILOGRAM\b", "KG"),
    ]

    for pattern, replacement in abbreviations:
        result = re.sub(pattern, replacement, result)

    return result

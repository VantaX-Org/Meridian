"""Deterministic check-digit / format-mask validation.

These are mathematical standards (ISO 13616 IBAN mod-97, GS1 GTIN mod-10,
ISO/IEC 7812 Luhn), not invented heuristics — a value either satisfies the
algorithm or it does not. No SAP config, no LLM, no network. Each validator
takes a single string and returns True when valid.

Null handling follows the engine-wide rule: null detection is null_check's job
alone, so blanks are excluded from the denominator here.
"""

import re

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


def valid_iban(s: str) -> bool:
    """ISO 13616 IBAN: move the first 4 chars to the end, map letters to
    digits (A=10..Z=35), the whole number mod 97 must equal 1."""
    s = s.strip().replace(" ", "").upper()
    if len(s) < 5 or len(s) > 34 or not s[:2].isalpha() or not s[2:4].isdigit():
        return False
    rearranged = s[4:] + s[:4]
    digits = []
    for ch in rearranged:
        if ch.isdigit():
            digits.append(ch)
        elif "A" <= ch <= "Z":
            digits.append(str(ord(ch) - 55))
        else:
            return False  # space/punctuation inside the body — invalid
    return int("".join(digits)) % 97 == 1


def valid_gtin(s: str) -> bool:
    """GS1 GTIN-8/12/13/14 (also EAN/UPC): mod-10 with 3,1,3,1… weighting
    applied right-to-left over the body, check digit is the last position."""
    s = s.strip()
    if not s.isdigit() or len(s) not in (8, 12, 13, 14):
        return False
    *body, check = [int(c) for c in s]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - (total % 10)) % 10 == check


def valid_luhn(s: str) -> bool:
    """ISO/IEC 7812 Luhn (payment cards, some national IDs): double every
    second digit from the right, subtract 9 if >9, sum mod 10 must be 0."""
    s = s.strip().replace(" ", "")
    if not s.isdigit() or len(s) < 2:
        return False
    total = 0
    for i, ch in enumerate(reversed(s)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


# ── National identifiers ─────────────────────────────────────────────────────
# Each validator checks the published shape and check digit of one national
# number. Customary separators (space . - /) are ignored; anything else fails.

def _plain(s: str) -> str:
    return re.sub(r"[ .\-/]", "", s.strip().upper())


def _weighted(digits: str, weights: list[int]) -> int:
    return sum(int(d) * w for d, w in zip(digits, weights))


def valid_ca_sin(s: str) -> bool:
    """Canada SIN: 9 digits, Luhn."""
    v = _plain(s)
    return len(v) == 9 and valid_luhn(v)


def valid_nl_bsn(s: str) -> bool:
    """Netherlands BSN: 9 digits, 11-proof (weights 9..2, last digit -1)."""
    v = _plain(s)
    return bool(re.fullmatch(r"\d{9}", v)) and (_weighted(v, [9, 8, 7, 6, 5, 4, 3, 2, -1]) % 11 == 0)


def valid_br_cpf(s: str) -> bool:
    """Brazil CPF: 11 digits, two mod-11 check digits; one repeated digit is invalid."""
    v = _plain(s)
    if not re.fullmatch(r"\d{11}", v) or len(set(v)) == 1:
        return False
    for n in (9, 10):
        r = _weighted(v[:n], list(range(n + 1, 1, -1))) * 10 % 11 % 10
        if r != int(v[n]):
            return False
    return True


def valid_es_dni(s: str) -> bool:
    """Spain DNI (8 digits + letter) or NIE (X/Y/Z + 7 digits + letter): number mod 23 selects the letter."""
    v = _plain(s)
    if not re.fullmatch(r"(\d{8}|[XYZ]\d{7})[A-Z]", v):
        return False
    num = int(str("XYZ".find(v[0])) + v[1:8] if v[0] in "XYZ" else v[:8])
    return "TRWAGMYFPDXBNJZSQVHLCKE"[num % 23] == v[8]


def valid_cn_rid(s: str) -> bool:
    """China resident ID: 17 digits + ISO 7064 MOD 11-2 check character (0-9 or X)."""
    v = _plain(s)
    if not re.fullmatch(r"\d{17}[\dX]", v):
        return False
    r = _weighted(v[:17], [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]) % 11
    return "10X98765432"[r] == v[17]


_CF_ODD = dict(zip("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                   [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21,
                    2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23]))


def valid_it_cf(s: str) -> bool:
    """Italy codice fiscale: 16 characters, last one is the check letter (odd/even tables, mod 26)."""
    v = _plain(s)
    if not re.fullmatch(r"[A-Z0-9]{15}[A-Z]", v):
        return False
    total = 0
    for i, ch in enumerate(v[:15]):
        if i % 2 == 0:
            total += _CF_ODD[ch]
        else:
            total += int(ch) if ch.isdigit() else ord(ch) - 65
    return chr(65 + total % 26) == v[15]


def valid_fr_nir(s: str) -> bool:
    """France NIR: 13 characters + 2-digit key = 97 - (number mod 97); Corsica 2A/2B count as 19/18."""
    v = _plain(s)
    if not re.fullmatch(r"[1-478]\d{4}(\d{2}|2[AB])\d{6}\d{2}", v):
        return False
    body = v[:13].replace("2A", "19", 1) if v[5:7] == "2A" else v[:13]
    body = body.replace("2B", "18", 1) if v[5:7] == "2B" else body
    return 97 - int(body) % 97 == int(v[13:])


def valid_au_tfn(s: str) -> bool:
    """Australia TFN: 8 or 9 digits, weighted sum mod 11 = 0."""
    v = _plain(s)
    if re.fullmatch(r"\d{9}", v):
        return _weighted(v, [1, 4, 3, 7, 5, 8, 6, 9, 10]) % 11 == 0
    if re.fullmatch(r"\d{8}", v):
        return _weighted(v, [10, 7, 8, 4, 6, 3, 5, 1]) % 11 == 0
    return False


_CURP_CHARS = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"


def valid_mx_curp(s: str) -> bool:
    """Mexico CURP: 18 characters, last digit = (10 - weighted sum mod 10) mod 10, weights 18..2."""
    v = _plain(s)
    if not re.fullmatch(r"[A-ZÑ]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d", v):
        return False
    total = sum(_CURP_CHARS.index(ch) * (18 - i) for i, ch in enumerate(v[:17]))
    return (10 - total % 10) % 10 == int(v[17])


def valid_sg_nric(s: str) -> bool:
    """Singapore NRIC/FIN (S, T, F, G series): weighted digits select the check letter."""
    v = _plain(s)
    if not re.fullmatch(r"[STFG]\d{7}[A-Z]", v):
        return False
    total = _weighted(v[1:8], [2, 7, 6, 5, 4, 3, 2]) + (4 if v[0] in "TG" else 0)
    letters = "JZIHGFEDCBA" if v[0] in "ST" else "XWUTRQPNMLK"
    return letters[total % 11] == v[8]


_VERHOEFF_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
               [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
               [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
               [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_VERHOEFF_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
               [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
               [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]


def valid_in_national(s: str) -> bool:
    """India: a PAN (AAAAA9999A, no check digit) or a 12-digit Aadhaar with a Verhoeff check digit."""
    v = _plain(s)
    if re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", v):
        return True
    if not re.fullmatch(r"[2-9]\d{11}", v):
        return False
    c = 0
    for i, ch in enumerate(reversed(v)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def valid_se_pnr(s: str) -> bool:
    """Sweden personnummer: (YY)YYMMDD + 4 digits (- or + separator), Luhn over the last 10 digits."""
    v = re.sub(r"[ ]", "", s.strip())
    if not re.fullmatch(r"(\d{2})?\d{6}[-+]?\d{4}", v):
        return False
    return valid_luhn(re.sub(r"[-+]", "", v)[-10:])


def valid_no_fnr(s: str) -> bool:
    """Norway fodselsnummer / D-number: 11 digits, two mod-11 check digits."""
    v = _plain(s)
    if not re.fullmatch(r"\d{11}", v):
        return False
    for n, w in ((9, [3, 7, 6, 1, 8, 9, 4, 5, 2]), (10, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2])):
        k = 11 - _weighted(v[:n], w) % 11
        if (0 if k == 11 else k) != int(v[n]):
            return False
    return True


def valid_fi_hetu(s: str) -> bool:
    """Finland henkilotunnus: DDMMYY, century sign, 3 digits, check character (number mod 31)."""
    v = s.strip().upper()
    if not re.fullmatch(r"\d{6}[-+A-FU-Y]\d{3}[0-9A-Y]", v):
        return False
    return "0123456789ABCDEFHJKLMNPRSTUVWXY"[int(v[:6] + v[7:10]) % 31] == v[10]


def valid_pl_pesel(s: str) -> bool:
    """Poland PESEL: 11 digits, weights 1,3,7,9 repeated, check = (10 - sum mod 10) mod 10."""
    v = _plain(s)
    return bool(re.fullmatch(r"\d{11}", v)) and \
        (10 - _weighted(v, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]) % 10) % 10 == int(v[10])


def valid_be_nn(s: str) -> bool:
    """Belgium national register number: 9 digits + 2-digit key = 97 - (number mod 97); born 2000+ prefixes 2."""
    v = _plain(s)
    if not re.fullmatch(r"\d{11}", v):
        return False
    key = int(v[9:])
    return key in (97 - int(v[:9]) % 97, 97 - int("2" + v[:9]) % 97)


def valid_tr_tckn(s: str) -> bool:
    """Turkey T.C. Kimlik No: 11 digits, first non-zero, two check digits."""
    v = _plain(s)
    if not re.fullmatch(r"[1-9]\d{10}", v):
        return False
    d = [int(c) for c in v]
    return (sum(d[0:9:2]) * 7 - sum(d[1:8:2])) % 10 == d[9] and sum(d[:10]) % 10 == d[10]


def valid_cl_rut(s: str) -> bool:
    """Chile RUT/RUN: body digits + check (0-9 or K), mod 11 with weights 2..7 from the right."""
    v = _plain(s)
    if not re.fullmatch(r"\d{7,8}[\dK]", v):
        return False
    total = sum(int(d) * (2 + i % 6) for i, d in enumerate(reversed(v[:-1])))
    k = 11 - total % 11
    return {11: "0", 10: "K"}.get(k, str(k)) == v[-1]


def valid_ch_ahv(s: str) -> bool:
    """Switzerland AHV/AVS number: 756 + 10 digits, EAN-13 check digit."""
    v = _plain(s)
    return bool(re.fullmatch(r"756\d{10}", v)) and valid_gtin(v)


def valid_ie_ppsn(s: str) -> bool:
    """Ireland PPSN: 7 digits + check letter (+ optional letter A, B, H or W); weighted sum mod 23."""
    v = _plain(s)
    if not re.fullmatch(r"\d{7}[A-W][ABHW]?", v):
        return False
    total = _weighted(v[:7], [8, 7, 6, 5, 4, 3, 2]) + ((ord(v[8]) - 64) * 9 if len(v) == 9 else 0)
    return "WABCDEFGHIJKLMNOPQRSTUV"[total % 23] == v[7]


def valid_ro_cnp(s: str) -> bool:
    """Romania CNP: 13 digits, weights 279146358279, sum mod 11 (10 counts as 1)."""
    v = _plain(s)
    if not re.fullmatch(r"[1-9]\d{12}", v):
        return False
    r = _weighted(v, [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]) % 11
    return (1 if r == 10 else r) == int(v[12])


def valid_jp_mynumber(s: str) -> bool:
    """Japan My Number: 12 digits, check digit from weights 2-7 and 2-6 over the first 11 digits."""
    v = _plain(s)
    if not re.fullmatch(r"\d{12}", v):
        return False
    total = sum(int(d) * (n + 1 if n <= 6 else n - 5) for n, d in enumerate(reversed(v[:11]), start=1))
    r = total % 11
    return (0 if r <= 1 else 11 - r) == int(v[11])


def valid_nz_ird(s: str) -> bool:
    """New Zealand IRD number: 8 or 9 digits in range, mod-11 check digit (secondary weights on 10)."""
    v = _plain(s)
    if not re.fullmatch(r"\d{8,9}", v) or not 10_000_000 < int(v) < 150_000_000:
        return False
    base = v.zfill(9)[:8]
    for w in ([3, 2, 7, 6, 5, 4, 3, 2], [7, 4, 3, 2, 5, 2, 7, 6]):
        r = _weighted(base, w) % 11
        c = 0 if r == 0 else 11 - r
        if c != 10:
            return c == int(v[-1])
    return False


def valid_at_svnr(s: str) -> bool:
    """Austria social insurance number: 3 digits, check digit, DDMMYY; weights 3,7,9,-,5,8,4,2,1,6 mod 11."""
    v = _plain(s)
    if not re.fullmatch(r"[1-9]\d{9}", v):
        return False
    r = _weighted(v[:3] + v[4:], [3, 7, 9, 5, 8, 4, 2, 1, 6]) % 11
    return r != 10 and r == int(v[3])


def valid_cz_rc(s: str) -> bool:
    """Czech/Slovak birth number: 9 digits (born before 1954) or 10 digits divisible by 11
    (or first nine digits mod 11 = 10 with check digit 0)."""
    v = _plain(s)
    if re.fullmatch(r"\d{9}", v):
        return True
    if not re.fullmatch(r"\d{10}", v):
        return False
    return int(v) % 11 == 0 or (int(v[:9]) % 11 == 10 and v[9] == "0")


def valid_th_pid(s: str) -> bool:
    """Thailand personal ID: 13 digits, weights 13..2, check = (11 - sum mod 11) mod 10."""
    v = _plain(s)
    return bool(re.fullmatch(r"\d{13}", v)) and \
        (11 - _weighted(v, list(range(13, 1, -1))) % 11) % 10 == int(v[12])


def _mod11_10(digits: str) -> int:
    """ISO 7064 MOD 11,10 check digit over a digit string."""
    a = 10
    for d in digits:
        a = (a + int(d)) % 10 or 10
        a = a * 2 % 11
    return (11 - a) % 10


def valid_hr_oib(s: str) -> bool:
    """Croatia OIB: 11 digits, ISO 7064 MOD 11,10 check digit."""
    v = _plain(s)
    return bool(re.fullmatch(r"\d{11}", v)) and _mod11_10(v[:10]) == int(v[10])


def valid_fr_siren(s: str) -> bool:
    """France SIREN: 9 digits, Luhn."""
    v = _plain(s)
    return bool(re.fullmatch(r"\d{9}", v)) and valid_luhn(v)


def valid_fr_siret(s: str) -> bool:
    """France SIRET: SIREN + 5-digit establishment number, 14 digits, Luhn.
    La Poste (SIREN 356000000) is the published exception: digit sum mod 5."""
    v = _plain(s)
    if not re.fullmatch(r"\d{14}", v):
        return False
    if v.startswith("356000000"):
        return sum(int(d) for d in v) % 5 == 0
    return valid_luhn(v)


def valid_de_ustid(s: str) -> bool:
    """Germany USt-IdNr: optional DE prefix, 9 digits, ISO 7064 MOD 11,10."""
    v = _plain(s).removeprefix("DE")
    return bool(re.fullmatch(r"[1-9]\d{8}", v)) and _mod11_10(v[:8]) == int(v[8])


def valid_pl_nip(s: str) -> bool:
    """Poland NIP: optional PL prefix, 10 digits, weights 6,5,7,2,3,4,5,6,7 mod 11
    (a remainder of 10 is never issued)."""
    v = _plain(s).removeprefix("PL")
    if not re.fullmatch(r"\d{10}", v):
        return False
    r = _weighted(v, [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11
    return r != 10 and r == int(v[9])


_USCC = "0123456789ABCDEFGHJKLMNPQRTUWXY"


def valid_cn_uscc(s: str) -> bool:
    """China Unified Social Credit Code (GB 32100-2015): 18 characters from a
    31-character set, check character = (31 - weighted sum mod 31) mod 31."""
    v = _plain(s)
    if len(v) != 18 or any(c not in _USCC for c in v):
        return False
    w = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
    total = sum(_USCC.index(c) * x for c, x in zip(v, w))
    return _USCC[(31 - total % 31) % 31] == v[17]


def valid_bg_egn(s: str) -> bool:
    """Bulgaria EGN: 10 digits, weights 2,4,8,5,10,9,7,3,6 mod 11 (10 counts as 0)."""
    v = _plain(s)
    return bool(re.fullmatch(r"\d{10}", v)) and \
        _weighted(v, [2, 4, 8, 5, 10, 9, 7, 3, 6]) % 11 % 10 == int(v[9])


VALIDATORS = {
    "iban": valid_iban,
    "gtin": valid_gtin,
    "ean": valid_gtin,   # EAN-13/8 are GTINs — same algorithm
    "upc": valid_gtin,   # UPC-A is GTIN-12
    "luhn": valid_luhn,
    "ca_sin": valid_ca_sin,
    "nl_bsn": valid_nl_bsn,
    "br_cpf": valid_br_cpf,
    "es_dni": valid_es_dni,
    "cn_rid": valid_cn_rid,
    "it_cf": valid_it_cf,
    "fr_nir": valid_fr_nir,
    "au_tfn": valid_au_tfn,
    "mx_curp": valid_mx_curp,
    "sg_nric": valid_sg_nric,
    "in_national": valid_in_national,
    "se_pnr": valid_se_pnr,
    "no_fnr": valid_no_fnr,
    "fi_hetu": valid_fi_hetu,
    "pl_pesel": valid_pl_pesel,
    "be_nn": valid_be_nn,
    "tr_tckn": valid_tr_tckn,
    "cl_rut": valid_cl_rut,
    "ch_ahv": valid_ch_ahv,
    "ie_ppsn": valid_ie_ppsn,
    "ro_cnp": valid_ro_cnp,
    "jp_mynumber": valid_jp_mynumber,
    "nz_ird": valid_nz_ird,
    "at_svnr": valid_at_svnr,
    "cz_rc": valid_cz_rc,
    "th_pid": valid_th_pid,
    "hr_oib": valid_hr_oib,
    "bg_egn": valid_bg_egn,
    "fr_siren": valid_fr_siren,
    "fr_siret": valid_fr_siret,
    "de_ustid": valid_de_ustid,
    "pl_nip": valid_pl_nip,
    "cn_uscc": valid_cn_uscc,
}


class FormatCheck(BaseCheck):
    """Non-blank values must satisfy a published check-digit standard."""

    check_class = "format_check"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field = self.rule["field"]
        fmt = str(self.rule.get("format", "")).lower()
        validator = VALIDATORS.get(fmt)
        if validator is None:
            raise ValueError(f"Unknown format '{fmt}' (known: {sorted(VALIDATORS)})")
        populated = ~is_blank(df[field])
        valid = df[field].astype("string").map(lambda v: isinstance(v, str) and validator(v))
        return Evaluation(populated, ~valid.astype(bool), {"format": fmt}, invalid_values_field=field)


if __name__ == "__main__":
    # Runnable check — real reference values from the published standards.
    assert valid_iban("GB82 WEST 1234 5698 7654 32")
    assert not valid_iban("GB82 WEST 1234 5698 7654 31")  # last digit wrong
    assert valid_gtin("4006381333931")    # EAN-13 textbook example
    assert not valid_gtin("4006381333932")
    assert valid_gtin("036000291452")     # UPC-A (GTIN-12)
    assert valid_luhn("4539148803436467")
    assert not valid_luhn("4539148803436468")
    # national identifiers — published specimen numbers, then one changed digit
    for fmt, good, bad in [
        ("ca_sin", "046 454 286", "046 454 287"), ("nl_bsn", "111222333", "111222334"),
        ("br_cpf", "111.444.777-35", "111.444.777-36"), ("es_dni", "12345678Z", "12345678A"),
        ("es_dni", "X1234567L", "X1234567M"), ("cn_rid", "11010519491231002X", "110105194912310021"),
        ("it_cf", "RSSMRA85T10A562S", "RSSMRA85T10A562T"), ("fr_nir", "255081416802538", "255081416802539"),
        ("au_tfn", "123456782", "123456783"), ("mx_curp", "HEGG560427MVZRRL04", "HEGG560427MVZRRL05"),
        ("sg_nric", "S1234567D", "S1234567E"), ("sg_nric", "G1234567X", "G1234567W"),
        ("in_national", "234123412346", "234123412347"), ("se_pnr", "811218-9876", "811218-9877"),
        ("no_fnr", "01010101006", "01010101007"), ("fi_hetu", "131052-308T", "131052-308U"),
        ("pl_pesel", "44051401359", "44051401358"), ("be_nn", "85.07.30-033.28", "85.07.30-033.29"),
        ("tr_tckn", "10000000146", "10000000147"), ("cl_rut", "12.345.678-5", "12.345.678-K"),
        ("ch_ahv", "756.9217.0769.85", "756.9217.0769.86"), ("ie_ppsn", "1234567T", "1234567A"),
        ("ro_cnp", "1800101221144", "1800101221145"), ("jp_mynumber", "123456789018", "123456789019"),
        ("nz_ird", "49091850", "49091851"), ("at_svnr", "1237010180", "1238010180"),
        ("cz_rc", "7103192745", "7103192746"), ("th_pid", "1101700207030", "1101700207031"),
        ("hr_oib", "69435151530", "69435151531"), ("bg_egn", "7523169263", "7523169264"),
        # synthetic numbers built for these tests, not issued identifiers
        ("fr_siren", "123 456 782", "123 456 783"), ("fr_siret", "123 456 782 00010", "123 456 782 00011"),
        ("fr_siret", "35600000000015", "35600000000016"), ("de_ustid", "DE123456788", "DE123456789"),
        ("pl_nip", "PL 123-456-32-18", "123-456-32-17"), ("cn_uscc", "91350100M00012345T", "91350100M00012345U"),
    ]:
        assert VALIDATORS[fmt](good), (fmt, good)
        assert not VALIDATORS[fmt](bad), (fmt, bad)
    assert valid_in_national("ABCPE1234F")      # a PAN carries no check digit
    assert not valid_br_cpf("111.111.111-11")   # one repeated digit
    # null/blank excluded, not failed
    df = pd.DataFrame({"IBAN": ["GB82 WEST 1234 5698 7654 32", None, "BAD"]})
    res = FormatCheck({"id": "F1", "field": "IBAN", "format": "iban"}).run(df)
    assert res.affected_count == 1 and res.total_count == 2 and res.pass_rate == 50.0
    print("format_check self-check OK")

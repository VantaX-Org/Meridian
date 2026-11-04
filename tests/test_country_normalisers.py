"""Country-aware phone / postcode / tax-number normalisers (synthetic values only)."""

import pandas as pd
import pytest

from api.services.cleaning_engine import CleaningEngine
from api.services.country_normalisers import (
    normalise_phone, normalise_postcode, normalise_tax_number,
    phone_e164, postcode, tax_number,
)

PHONES = [
    ("ZA", "082 123 4567", "+27821234567"),
    ("DE", "030 1234567", "+49301234567"),
    ("GB", "+44 (0)20 7946 0958", "+442079460958"),
    ("US", "(212) 555-0123", "+12125550123"),
    ("CA", "416-555-0123", "+14165550123"),
    ("AU", "02 9876 5432", "+61298765432"),
    ("FR", "01 23 45 67 89", "+33123456789"),
    ("NL", "020 123 4567", "+31201234567"),
    ("IN", "098765 43210", "+919876543210"),
    ("BR", "(11) 91234-5678", "+5511912345678"),
    ("CL", "2 2123 4567", "+56221234567"),
    ("PE", "01 234 5678", "+5112345678"),
    ("SA", "050 123 4567", "+966501234567"),
    ("AE", "050 123 4567", "+971501234567"),
]
POSTCODES = [
    ("ZA", "2196", "2196"), ("DE", "10115", "10115"), ("GB", "sw1a1aa", "SW1A 1AA"),
    ("US", "123456789", "12345-6789"), ("AU", "2000", "2000"), ("FR", "75001", "75001"),
    ("NL", "1012ab", "1012 AB"), ("IN", "110001", "110001"), ("BR", "01310100", "01310-100"),
    ("CL", "8320000", "8320000"), ("PE", "15001", "15001"), ("SA", "12345", "12345"),
    ("CA", "k1a0b1", "K1A 0B1"),
]
TAXES = [
    ("ZA", "4123456789", "4123456789"), ("DE", "de 123456789", "DE123456789"),
    ("GB", "123456789", "GB123456789"), ("FR", "fr12345678901", "FR12345678901"),
    ("NL", "NL123456789B01", "NL123456789B01"), ("AU", "51 824 753 556", "51824753556"),
    ("IN", "27AAPFU0939F1ZV", "27AAPFU0939F1ZV"), ("BR", "11.222.333/0001-81", "11222333000181"),
    ("CL", "12.345.678-5", "12345678-5"), ("PE", "20123456789", "20123456789"),
    ("SA", "300000000000003", "300000000000003"), ("AE", "100000000000003", "100000000000003"),
    ("CA", "123456789 rt 0001", "123456789RT0001"),
]


@pytest.mark.parametrize("c,raw,exp", PHONES)
def test_phone(c, raw, exp):
    assert phone_e164(raw, c) == exp
    assert phone_e164(exp, c) == exp  # idempotent


@pytest.mark.parametrize("c,raw,exp", POSTCODES)
def test_postcode(c, raw, exp):
    assert postcode(raw, c) == exp
    assert postcode(exp, c) == exp


@pytest.mark.parametrize("c,raw,exp", TAXES)
def test_tax(c, raw, exp):
    assert tax_number(raw, c) == exp
    assert tax_number(exp, c) == exp


def test_us_ein():
    assert tax_number("123456789", "US", "ein") == "12-3456789"
    assert tax_number("12-3456789", "US", "ein") == "12-3456789"


def test_saudi_is_not_south_africa():
    assert phone_e164("0501234567", "SA").startswith("+966")
    assert phone_e164("0821234567", "South Africa").startswith("+27")


def test_unknown_country_passthrough():
    for fn in (phone_e164, postcode, tax_number):
        assert fn("abc 123", "XX") == "abc 123"
        assert fn("abc 123", None) == "abc 123"
    assert normalise_postcode("12345", "AE").status == "unknown_country"  # AE has no postcodes
    assert tax_number("123456789", "US") == "123456789"  # no "vat" kind for US


@pytest.mark.parametrize("fn,val,c", [
    (normalise_phone, "12345", "DE"), (normalise_phone, "+49 30 1234567", "FR"),
    (normalise_phone, "082 123 456x", "ZA"),
    (normalise_postcode, "123", "DE"), (normalise_postcode, "0123 AB", "NL"),
    (normalise_postcode, "D1A 0B1", "CA"),
    (normalise_tax_number, "51 824 753 557", "AU"),  # bad ABN checksum
    (normalise_tax_number, "11.222.333/0001-82", "BR"),
    (normalise_tax_number, "12.345.678-9", "CL"),
    (normalise_tax_number, "3123", "SA"),
])
def test_invalid_stays_unchanged(fn, val, c):
    r = fn(val, c)
    assert r.value == val and r.status == "invalid"


def test_engine_uses_row_country():
    df = pd.DataFrame({
        "kunnr": ["1", "2", "3"],
        "land1": ["DE", "SA", None],
        "telf1": ["030 1234567", "050 123 4567", "082 123 4567"],
        "pstlz": ["10115", "12345", "2196"],
    })
    cands = CleaningEngine().detect_standardisation_issues(df, "customer", "v", "t")
    vals = [v for c in cands for v in c["record_data_after"].values()]
    assert "+49301234567" in vals and "+966501234567" in vals
    assert "+27 82 123 4567" in vals  # no country: legacy SA format kept
    assert not any("pstlz" in c["record_data_after"] for c in cands)  # already canonical

"""Check-digit validators for FR SIREN/SIRET, DE USt-IdNr, PL NIP and CN USCC.
All sample numbers are synthetic, built for these tests; none is an issued identifier."""

import pytest

from checks.types.format_check import VALIDATORS


@pytest.mark.parametrize("fmt, good, bad", [
    ("fr_siren", "123456782", "123456783"),
    ("fr_siren", "123 456 782", "12345678"),          # too short
    ("fr_siret", "12345678200010", "12345678200011"),
    ("fr_siret", "35600000000015", "35600000000016"),  # La Poste: digit sum mod 5
    ("de_ustid", "DE123456788", "DE123456789"),
    ("de_ustid", "123456788", "023456788"),            # first digit never 0
    ("pl_nip", "1234563218", "1234563217"),
    ("pl_nip", "PL 123-456-32-18", "123456789X"),
    ("cn_uscc", "91350100M00012345T", "91350100M00012345U"),
    ("cn_uscc", "91350100M00012345T", "91350100M0001234IT"),  # I is outside the charset
])
def test_validator(fmt, good, bad):
    assert VALIDATORS[fmt](good)
    assert not VALIDATORS[fmt](bad)


def test_pl_nip_remainder_ten_never_valid():
    # weighted sum of 123456789 mod 11 is 10: no check digit makes it valid
    assert not any(VALIDATORS["pl_nip"](f"123456789{d}") for d in range(10))

"""Unit tests for SA standardiser functions."""

import pytest
from api.services.standardisers import (
    title_case,
    legal_suffix,
    sa_phone_number,
    country_code,
    sap_uom,
    validate_sa_id,
    validate_sa_bank_branch,
    material_description,
)


class TestTitleCase:
    def test_basic_company(self):
        assert title_case("ACME TRADING PTY LTD") == "Acme Trading (Pty) Ltd"

    def test_preserves_cc(self):
        assert title_case("SMITH AND SONS CC") == "Smith and Sons CC"

    def test_lowercase_connectors(self):
        assert title_case("BANK OF THE SOUTH") == "Bank of the South"

    def test_empty_string(self):
        assert title_case("") == ""

    def test_npc(self):
        assert title_case("HOPE FOUNDATION NPC") == "Hope Foundation NPC"


class TestLegalSuffix:
    def test_pty_ltd_dotted(self):
        assert legal_suffix("Acme Pty. Ltd.") == "Acme (Pty) Ltd"

    def test_proprietary_limited(self):
        assert legal_suffix("Acme Proprietary Limited") == "Acme (Pty) Ltd"

    def test_close_corporation(self):
        assert legal_suffix("Smith Close Corporation") == "Smith CC"

    def test_non_profit_company(self):
        assert legal_suffix("Hope Non Profit Company") == "Hope NPC"

    def test_already_canonical(self):
        assert legal_suffix("Acme (Pty) Ltd") == "Acme (Pty) Ltd"


class TestSAPhoneNumber:
    def test_11_digit_with_27(self):
        assert sa_phone_number("27821234567") == "+27 82 123 4567"

    def test_10_digit_with_leading_zero(self):
        assert sa_phone_number("0821234567") == "+27 82 123 4567"

    def test_formatted_input(self):
        assert sa_phone_number("082 123 4567") == "+27 82 123 4567"

    def test_international_unchanged(self):
        assert sa_phone_number("+1 555 1234") == "+1 555 1234"

    def test_empty(self):
        assert sa_phone_number("") == ""


class TestCountryCode:
    def test_south_africa(self):
        assert country_code("South Africa") == "ZA"

    def test_rsa(self):
        assert country_code("RSA") == "ZA"

    def test_za(self):
        assert country_code("za") == "ZA"

    def test_namibia(self):
        assert country_code("Namibia") == "NA"

    def test_unknown(self):
        assert country_code("Germany") == "GERMANY"


class TestSapUom:
    def test_each(self):
        assert sap_uom("each") == "EA"

    def test_pcs(self):
        assert sap_uom("pcs") == "EA"

    def test_kilogram(self):
        assert sap_uom("kilogram") == "KG"

    def test_litre(self):
        assert sap_uom("litre") == "L"

    def test_square_metre(self):
        assert sap_uom("square metre") == "M2"

    def test_unknown(self):
        assert sap_uom("barrel") == "BARREL"


class TestValidateSAId:
    def test_valid_id(self):
        # 8001015009087 is a known valid SA ID (passes Luhn)
        result = validate_sa_id("8001015009087")
        assert result["valid"] is True
        assert result["dob"] == "1980-01-01"
        assert result["gender"] == "Male"
        assert result["citizenship"] == "SA citizen"

    def test_invalid_length(self):
        result = validate_sa_id("123456")
        assert result["valid"] is False
        assert result["error"] == "must be 13 digits"

    def test_invalid_checksum(self):
        result = validate_sa_id("8001015009086")
        assert result["valid"] is False
        assert result["error"] == "checksum failed"

    def test_female_id(self):
        result = validate_sa_id("8001014009086")
        assert result["gender"] == "Female"

    def test_empty(self):
        result = validate_sa_id("")
        assert result["valid"] is False


class TestValidateSABankBranch:
    def test_fnb(self):
        result = validate_sa_bank_branch("250655")
        assert result["valid"] is True
        assert result["bank"] == "FNB"

    def test_capitec(self):
        result = validate_sa_bank_branch("470010")
        assert result["valid"] is True
        assert result["bank"] == "Capitec"

    def test_invalid_code(self):
        result = validate_sa_bank_branch("999999")
        assert result["valid"] is False
        assert result["bank"] is None

    def test_standard_bank(self):
        result = validate_sa_bank_branch("051001")
        assert result["valid"] is True
        assert result["bank"] == "Standard Bank"


class TestMaterialDescription:
    def test_stainless_steel(self):
        result = material_description("Stainless Steel Bolt")
        assert result == "SS BOLT"

    def test_galvanised(self):
        result = material_description("galvanised pipe")
        assert result == "GALV PIPE"

    def test_zinc_plated(self):
        result = material_description("Zinc Plated Washer Grade A")
        assert result == "ZP WASHER GR A"

    def test_multiple_spaces(self):
        result = material_description("bolt   10mm   diameter")
        assert result == "BOLT 10MM DIA"

    def test_empty(self):
        assert material_description("") == ""

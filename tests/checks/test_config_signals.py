"""Tests for checks/config_signals.py"""
import pytest
import pandas as pd

from checks.config_signals import extract_config_signals

ALL_MODULES = [
    # ECC
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master",
    "sd_sales_orders",
    # SuccessFactors
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
    # Warehouse
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management",
    "wm_interface", "cross_system_integration",
]


def test_extract_signals_business_partner():
    df = pd.DataFrame({
        "PARTNER": ["1000001", "1000002", "1000003"],
        "BUKRS": ["ZA01", "ZA01", "ZA01"],
        "LAND1": ["ZA", "ZA", "ZA"],
        "ZZ_TIER": ["Gold", "Silver", "Gold"],
    })
    result = extract_config_signals("business_partner", df)

    assert result["company_codes"] == ["ZA01"]
    assert result["dominant_countries"] is not None
    assert "ZA" in result["dominant_countries"]
    assert result["dominant_countries"]["ZA"] > 0.9
    assert "ZZ_TIER" in result["custom_fields_present"]


def test_extract_signals_empty_dataframe():
    result = extract_config_signals("business_partner", pd.DataFrame())
    assert isinstance(result, dict)


@pytest.mark.parametrize("module", ALL_MODULES)
def test_extract_signals_never_raises(module):
    df = pd.DataFrame({"X": [1, 2, 3]})
    result = extract_config_signals(module, df)
    assert isinstance(result, dict)


def test_extract_signals_fi_gl():
    df = pd.DataFrame({
        "SAKNR": ["0001000000", "0001000001", "0001000002"],
        "BUKRS": ["ZA01", "ZA01", "ZA01"],
        "KTOPL": ["CAZA", "CAZA", "CAZA"],
    })
    result = extract_config_signals("fi_gl", df)

    assert result["chart_of_accounts"] == ["CAZA"]
    assert result["company_codes"] == ["ZA01"]


def test_universal_signals_null_rate():
    df = pd.DataFrame({
        "PARTNER": ["P1", "P2", None, None, None, None, None, None, None, None, None],
        "NAME": ["A"] * 11,
    })
    result = extract_config_signals("business_partner", df)
    # PARTNER has ~91% nulls — should appear in null_rate_by_column
    assert "PARTNER" in result["null_rate_by_column"]
    assert result["null_rate_by_column"]["PARTNER"] > 5.0


def test_universal_signals_custom_fields():
    df = pd.DataFrame({
        "MATNR": ["M1"],
        "ZZ_CUSTOM": ["X"],
        "Z_FIELD": ["Y"],
        "YY_EXTRA": ["Z"],
        "Y_FLAG": ["1"],
        "NORMAL_FIELD": ["N"],
    })
    result = extract_config_signals("material_master", df)
    custom = result["custom_fields_present"]
    assert "ZZ_CUSTOM" in custom
    assert "Z_FIELD" in custom
    assert "YY_EXTRA" in custom
    assert "Y_FLAG" in custom
    assert "NORMAL_FIELD" not in custom


def test_universal_number_range_pattern():
    df = pd.DataFrame({
        "PARTNER": ["1000001", "1000002", "1000003", "1000004"],
    })
    result = extract_config_signals("business_partner", df)
    nrp = result["number_range_pattern"]
    assert nrp is not None
    assert nrp["length_mode"] == 7
    assert nrp["all_numeric"] is True
    assert nrp["prefix_pattern"] is None  # all numeric → no alpha prefix


def test_ecc_sales_areas():
    df = pd.DataFrame({
        "KUNNR": ["C1", "C2", "C3"],
        "VKORG": ["1000", "1000", "2000"],
        "VTWEG": ["10", "10", "20"],
        "SPART": ["00", "00", "01"],
    })
    result = extract_config_signals("sd_customer_master", df)
    assert result["sales_areas"] is not None
    assert len(result["sales_areas"]) == 2  # two unique combos


def test_sf_signals_employee_central():
    df = pd.DataFrame({
        "PERNR": ["E001", "E002"],
        "COMPANY_ID": ["BU01", "BU01"],
        "ABKRS": ["MN", "MN"],
        "MOLGA": ["10", "10"],
        "PLANS": ["P50001", "P50002"],
    })
    result = extract_config_signals("employee_central", df)
    assert result["legal_entities"] == ["BU01"]
    assert result["pay_groups"] == ["MN"]
    assert result["country_groupings"] == ["10"]
    assert result["position_patterns"] == "P5"


def test_wh_signals_ewms_stock():
    df = pd.DataFrame({
        "MATNR": ["M1", "M2", "M3"],
        "LGNUM": ["001", "001", "002"],
        "LGTYP": ["001", "002", "001"],
        "CHARG": ["BATCH1", "BATCH2", "BATCH3"],
    })
    result = extract_config_signals("ewms_stock", df)
    assert set(result["warehouse_numbers"]) == {"001", "002"}
    assert set(result["storage_types"]) == {"001", "002"}
    assert result["batch_prefix_pattern"] == "BATCH1"[:6]


def test_unknown_module_returns_universal_signals():
    df = pd.DataFrame({"LAND1": ["ZA", "ZA", "US"], "X": [1, 2, 3]})
    result = extract_config_signals("completely_unknown_module", df)
    # Should still return universal signals, not raise
    assert isinstance(result, dict)
    assert "total_rows" in result
    assert result["total_rows"] == 3


def test_dominant_currencies():
    df = pd.DataFrame({
        "PARTNER": ["P1", "P2", "P3"],
        "WAERS": ["ZAR", "ZAR", "USD"],
    })
    result = extract_config_signals("business_partner", df)
    assert result["dominant_currencies"] is not None
    assert "ZAR" in result["dominant_currencies"]
    assert result["dominant_currencies"]["ZAR"] > 0.5

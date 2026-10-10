"""Download scope → RFC WHERE clauses (validated; only tables carrying the field)."""

import pytest

from sap.ddic import get_dictionary
from sap.extraction_plan import normalise_scope, plan_modules

D = get_dictionary("ecc6")


def test_company_code_and_date_scope():
    scope = normalise_scope({"company_codes": ["2000", "1000", "1000"], "date_from": "2026-01-01",
                             "date_to": "2026-03-31"})
    plans = plan_modules(["accounts_payable", "fi_gl"], D, scope)
    assert plans["LFB1"].where == "BUKRS IN ('1000', '2000')"
    assert plans["LFA1"].where is None  # general vendor data has no company code → read in full
    assert plans["BKPF"].where == "BUDAT >= '20260101' AND BUDAT <= '20260331' AND BUKRS IN ('1000', '2000')"


def test_no_scope_keeps_default_windows():
    assert plan_modules(["fi_gl"], D)["BKPF"].where.startswith("BUDAT >= '")


@pytest.mark.parametrize("bad", [
    {"plants": ["1000') OR ('1'='1"]},
    {"company_codes": ["TOO_LONG_CODE_X"]},
    {"date_from": "01/01/2026"},
    {"date_from": "2026-02-01", "date_to": "2026-01-01"},
])
def test_invalid_scope_rejected(bad):
    with pytest.raises(ValueError):
        normalise_scope(bad)


def test_odata_v2_dates_become_iso():
    from sap.successfactors import odata_date
    assert odata_date("/Date(1704067200000)/") == "2024-01-01"
    assert odata_date("/Date(1704110400000+0000)/") == "2024-01-01T12:00:00"
    assert odata_date("2024-01-01") == "2024-01-01"


def test_default_window_has_a_wider_fallback():
    from sap.extraction_plan import widen
    assert widen("BUDAT >= '{months_ago:3}'") == "BUDAT >= '{months_ago:12}'"
    assert widen("ERDAT >= '{months_ago:24}'") is None  # already at the cap: no second read
    assert widen("DATBI >= '{months_ago:0}'") is None  # validity window, not a recency window
    assert widen("CREDAT >= '{days_ago:90}'") is None
    assert plan_modules(["fi_gl"], D)["BKPF"].wide_where.startswith("BUDAT >= '")
    dated = normalise_scope({"date_from": "2026-01-01"})
    assert plan_modules(["fi_gl"], D, dated)["BKPF"].wide_where is None  # the user's range is never widened


def test_exclude_deleted_filters_plant_level_children_not_header():
    scope = normalise_scope({"exclude_deleted": True})
    plans = plan_modules(["material_master"], D, scope)
    assert plans["MARD"].where == "LVORM = ''" and plans["MARD"].partial
    assert plans["MARC"].where == "LVORM = ''"
    assert plans["MARA"].where is None and not plans["MARA"].partial  # header: read in full


def test_exclude_deleted_off_by_default_adds_nothing():
    plans = plan_modules(["material_master"], D, normalise_scope({}))
    assert plans["MARD"].where is None
    assert plans["MARC"].where is None


def test_exclude_deleted_uses_loevm_for_customer_children_not_header():
    scope = normalise_scope({"exclude_deleted": True})
    plans = plan_modules(["sd_customer_master"], D, scope)
    assert plans["KNB1"].where == "LOEVM = ''"
    assert plans["KNA1"].where is None  # header: read in full


def test_exclude_deleted_combines_with_org_scope_in_the_where_clause():
    scope = normalise_scope({"exclude_deleted": True, "company_codes": ["1000"]})
    plans = plan_modules(["accounts_payable"], D, scope)
    assert plans["LFB1"].where == "BUKRS IN ('1000') AND LOEVM = ''"


def test_exclude_deleted_filter_reaches_the_rfc_where_options():
    from sap.rfc import where_options

    plans = plan_modules(["material_master"], D, normalise_scope({"exclude_deleted": True}))
    assert where_options(plans["MARD"].where) == [{"TEXT": "LVORM = ''"}]


def test_process_discovery_tables_planned_with_12_month_windows():
    plans = plan_modules(["sd_sales_orders", "mm_purchasing"], D)
    for t, col in {"VBRK": "FKDAT", "LIKP": "ERDAT", "MKPF": "BUDAT", "EBAN": "BADAT"}.items():
        assert plans[t].where.startswith(f"{col} >= '") and plans[t].purpose == "data"
        assert plans[t].keys  # DDIC key always read
    assert {"BLART", "BUDAT"} <= plans["RBKP"].fields
    for t, f in {"TVAK": "AUART", "T156": "BWART", "TVLK": "LFART", "TVFK": "FKART"}.items():
        assert plans[t].purpose == "config" and f in plans[t].fields and plans[t].where is None
    assert "BKPF" not in plan_modules(["sd_sales_orders"], D) and "MSEG" not in plans

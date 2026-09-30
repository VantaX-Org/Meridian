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

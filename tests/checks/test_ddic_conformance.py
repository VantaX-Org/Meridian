"""DDIC conformance: fields judged against the system's own dictionary and check tables."""

import pandas as pd

from checks.ddic_conformance import run_conformance
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
LFM1 = pd.DataFrame({"LFM1.LIFNR": ["V1", "V2"], "LFM1.EKORG": ["1000", "1000"], "LFM1.ZTERM": ["0001", "9999"]})
REFS = {"T052.ZTERM": {"0001"}}


def _check_table(**kw):
    res = run_conformance("LFM1", LFM1, D, "accounts_payable", ["LFM1.LIFNR", "LFM1.EKORG"], REFS, **kw)
    return next((r for r in res if r.check_id == "DDIC-LFM1-CHECK_TABLE"), None)


def test_value_missing_from_the_check_table_is_found():
    r = _check_table()
    assert r.affected_count == 1 and r.failing_record_keys == ["LIFNR=V2|EKORG=1000"]


def test_field_a_rule_already_checks_is_not_reported_twice():
    # AP042 checks LFM1.ZTERM against T052: the same record must not come back as a second issue
    assert _check_table(value_checked={"LFM1.ZTERM"}) is None


def test_cell_a_specific_rule_already_reports_is_not_reported_again():
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["C1", "C2"], "KNA1.PSTLZ": ["Durban", "durban"]})
    res = run_conformance("KNA1", kna1, D, "accounts_receivable", ["KNA1.KUNNR"],
                          reported={"KNA1.PSTLZ": {"KUNNR=C1"}})  # e.g. SW-KNA1-PSTLZ-ORT01 on C1
    case = next(r for r in res if r.check_id == "DDIC-KNA1-CASE")
    assert case.failing_record_keys == ["KUNNR=C2"] and case.affected_count == 1


def test_percentage_condition_rate_unit_is_valid():
    # KONP.KONWA holds a currency, or '%' for a percentage condition; '%' is never in TCURC
    konp = pd.DataFrame({"KONP.KNUMH": ["1", "2"], "KONP.KOPOS": ["01", "01"], "KONP.KONWA": ["%", "XXX"]})
    res = run_conformance("KONP", konp, D, "mm_purchasing", ["KONP.KNUMH", "KONP.KOPOS"], {"TCURC.WAERS": {"EUR"}})
    r = next(r for r in res if r.check_id == "DDIC-KONP-CHECK_TABLE")
    assert r.failing_record_keys == ["KNUMH=2|KOPOS=01"]

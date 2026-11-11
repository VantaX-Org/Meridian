"""Post-load reconciliation: each difference is classified as expected (with its DDIC cause) or real."""
import pandas as pd

from api.services.migration.post_load import classify_difference, reconcile
from checks.frames import TableFrames
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def test_causes_read_from_the_target_dictionary():
    assert classify_difference("0000001234", "1234", D.field("KNA1", "KUNNR")) == "alpha_padding"  # ALPHA exit
    assert classify_difference("ab12", "AB12", D.field("KNA1", "STCEG")) == "case"  # not lowercase in DDIC
    assert classify_difference("Acme", "ACME", D.field("KNA1", "NAME1")) == "real"  # NAME1 keeps case: real
    assert classify_difference("x" * 45, "x" * 40, D.field("MAKT", "MAKTX")) == "truncation"  # CHAR40
    assert classify_difference("1.234,500", "1234.5", D.field("MARA", "BRGEW")) == "number_format"  # QUAN 13,3
    assert classify_difference("1234.6", "1234.5", D.field("MARA", "BRGEW")) == "real"
    assert classify_difference("01.02.2026", "20260201", D.field("MARA", "ERSDA")) == "date_format"  # DATS
    assert classify_difference("AB", "CD", D.field("KNA1", "STCEG")) == "real"


def test_confirmed_mapping_explains_the_difference_either_way():
    land = D.field("KNA1", "LAND1")
    assert classify_difference("UK", "GB", land, {"UK": "GB"}) == "value_mapping"
    assert classify_difference("GB", "UK", land, {"UK": "GB"}) == "value_mapping"
    assert classify_difference("UK", "US", land, {"UK": "GB"}) == "real"
    assert classify_difference("A", "B", None) == "real"  # unknown field, no mapping: real


def test_reconcile_counts_expected_and_real_per_table_and_field():
    exp = {"KNA1": pd.DataFrame({"SOURCE_RECORD": ["K=1", "K=2", "K=3"], "KUNNR": ["1", "2", "3"],
                                 "STCEG": ["de1", "DE2", "DE3"], "LAND1": ["UK", "DE", "FR"]})}
    tgt = TableFrames({"KNA1": pd.DataFrame({"KNA1.KUNNR": ["0000000001", "0000000002", "0000000003"],
                                             "KNA1.STCEG": ["DE1", "DE2", "XX"],
                                             "KNA1.LAND1": ["GB", "DE", "FR"]})}, D)
    res = reconcile(exp, {}, tgt, D, value_maps={"KNA1.LAND1": {"UK": "GB"}})
    t = res["tables"][0]
    assert (t["expected_differences"], t["real_differences"]) == (2, 1)
    assert t["causes"] == {"case": 1, "real": 1, "value_mapping": 1}
    stceg = next(f for f in t["fields"] if f["field"] == "STCEG")
    assert (stceg["expected_differences"], stceg["real_differences"]) == (1, 1)
    assert stceg["ddic"]["length"] == D.field("KNA1", "STCEG").length and stceg["ddic"]["lowercase"] is False
    rows = {(r["field"], r["cause"]) for r in t["records"] if r["kind"] == "differing"}
    assert rows == {("STCEG", "case"), ("STCEG", "real"), ("LAND1", "value_mapping")}
    assert (res["totals"]["expected_differences"], res["totals"]["real_differences"]) == (2, 1)

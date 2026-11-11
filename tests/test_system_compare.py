"""Source and target system comparison on synthetic MARA frames (api/services/system_compare.py)."""

import pandas as pd

from api.services.system_compare import compare_table, explain, totals
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def frame(rows):
    return pd.DataFrame([{f"MARA.{k}": v for k, v in r.items()} for r in rows])


SRC = frame([
    {"MATNR": "100", "MTART": "ROH", "ERSDA": "20260101", "BISMT": "X1"},
    {"MATNR": "200", "MTART": "HALB", "ERSDA": "20260102", "BISMT": "X2"},
    {"MATNR": "300", "MTART": "FERT", "ERSDA": "20260103", "BISMT": "X3"},
])
TGT = frame([
    {"MATNR": "100", "MTART": "ROH", "ERSDA": "2026-01-01", "BISMT": "X1"},
    {"MATNR": "200", "MTART": "ZHLB", "ERSDA": "20260102", "BISMT": "X2"},
    {"MATNR": "400", "MTART": "FERT", "ERSDA": "20260104", "BISMT": "X4"},
])


def test_explain():
    assert explain("a", "a") == "equal"
    assert explain("00012", "12") == "leading_zeros"
    assert explain("Steel  bar", "STEEL BAR") == "case"
    assert explain("PC", "ST", {"PC": "ST"}) == "code_map"
    assert explain("01.02.2026", "20260201") == "date_format"
    assert explain("1.234,5", "1.2345") is None
    assert explain("12,50-", "-12.5") == "numeric_format"
    assert explain("A", "B") is None


def test_counts_transforms_and_differences():
    r = compare_table("MARA", SRC, TGT, D, D)
    assert r["comparable"] and r["target_keys"] == ["MATNR"]
    assert (r["in_source"], r["in_target"], r["matched"], r["missing_in_target"], r["extra_in_target"]) == (3, 3, 2, 1, 1)
    f = {x["field"]: x for x in r["fields"]}
    assert f["ERSDA"]["transformed"] == {"date_format": 1} and f["ERSDA"]["differing"] == 0
    assert f["MTART"]["differing"] == 1 and f["MTART"]["description"] == "Material type"
    kinds = sorted(x["kind"] for x in r["records"])
    assert kinds == ["differing", "extra", "missing"]
    diff = next(x for x in r["records"] if x["kind"] == "differing")
    assert (diff["source"], diff["target"]) == ("HALB", "ZHLB")
    assert diff["key"] in r["pairs"] and r["pairs"][diff["key"]]["target"]["MTART"] == "ZHLB"
    assert totals([r])["differing_fields"] == 1
    assert compare_table("MARA", SRC, TGT, D, D) == r  # deterministic


def test_code_map_explains_value():
    r = compare_table("MARA", SRC, TGT, D, D, {"MARA.MTART": {"HALB": "ZHLB"}})
    f = {x["field"]: x for x in r["fields"]}
    assert f["MTART"]["transformed"] == {"code_map": 1} and f["MTART"]["differing"] == 0


def test_key_map_old_number_in_bismt():
    tgt = frame([{"MATNR": "N1", "BISMT": "100", "MTART": "ROH"}, {"MATNR": "N2", "BISMT": "200", "MTART": "HALB"}])
    r = compare_table("MARA", SRC, tgt, D, D, key_map={"source": ["MATNR"], "target": ["BISMT"]})
    assert r["comparable"] and r["matched"] == 2 and r["missing_in_target"] == 1 and r["extra_in_target"] == 0


def test_key_value_map_counts_mapped_keys():
    tgt = frame([{"MATNR": "900", "MTART": "ROH"}])
    r = compare_table("MARA", SRC, tgt, D, D, {"MARA.MATNR": {"100": "900"}})
    assert r["key_mapped"] == 1 and r["matched"] == 1


def test_not_comparable_paths():
    assert compare_table("MARA", SRC, None, D, D)["reason"] == "table_not_extracted"
    assert compare_table("MARA", SRC, TGT, D, D, not_comparable="target_extract_partial")["reason"] == "target_extract_partial"
    r = compare_table("MARA", SRC.drop(columns=["MARA.MATNR"]), TGT, D, D)
    assert r["reason"] == "key_not_extracted" and r["absent_keys"] == ["source:MATNR"]
    assert compare_table("MARA", SRC, TGT, D, D, key_map={"source": ["MATNR", "MTART"], "target": ["BISMT"]})["reason"] \
        == "key_map_mismatch"


def test_difference_rows_filter_and_describe():
    from types import SimpleNamespace

    from api.routes.system_compare import _rows

    r = compare_table("MARA", SRC, TGT, D, D)
    rec = SimpleNamespace(tables=[{k: v for k, v in r.items() if k not in ("records", "pairs")}],
                          records={"MARA": r["records"]})
    rows = _rows(rec, None, None, "differing", None)
    assert len(rows) == 1 and rows[0]["field_text"] == "Material type" and rows[0]["table_text"]
    assert _rows(rec, None, None, None, "zhlb")[0]["target"] == "ZHLB"
    assert _rows(rec, "MARC", None, None, None) == []

"""Post-load reconciliation: pure comparison of the expected load against the target extraction."""
import pandas as pd

from api.services.migration.post_load import reconcile, score_sides
from checks.frames import TableFrames
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def _target(rows, **kw):
    tf = TableFrames({"LFA1": pd.DataFrame(rows)}, D)
    for k, v in kw.items():
        setattr(tf, k, v)
    return tf


EXPECTED = {"LFA1": pd.DataFrame({
    "SOURCE_RECORD": ["LIFNR=1", "LIFNR=2", "LIFNR=3"],
    "LIFNR": ["1", "0000000002", "0000000003"],
    "NAME1": ["Alpha", "Beta", "Gamma"],
    "ORT01": ["", "Town", "City"],
})}


def _row(t):
    return reconcile(EXPECTED, {}, t, D)["tables"][0]


def test_missing_differing_and_alpha_key_match():
    # key "1" in the load matches "0000000001" in the target through ALPHA padding; 3 is missing
    t = _row(_target({"LFA1.LIFNR": ["0000000001", "0000000002"], "LFA1.NAME1": ["Alpha", "Other"],
                      "LFA1.ORT01": ["Filled by target", "Town"]}))
    assert (t["expected"], t["found"], t["missing"]) == (3, 2, 1)
    name = next(f for f in t["fields"] if f["field"] == "NAME1")
    assert (name["compared"], name["matched"], name["differing"]) == (2, 1, 1)
    ort = next(f for f in t["fields"] if f["field"] == "ORT01")
    assert ort["compared"] == 1 and ort["differing"] == 0  # blank in the load is not compared
    kinds = {(r["kind"], r["field"]) for r in t["records"]}
    assert kinds == {("missing", None), ("differing", "NAME1")}


def test_personal_field_is_counted_but_its_values_are_not_kept():
    exp = {"LFA1": EXPECTED["LFA1"].assign(LAND1=["DE", "DE", "DE"])}
    tgt = _target({"LFA1.LIFNR": ["0000000002"], "LFA1.NAME1": ["Changed"], "LFA1.LAND1": ["FR"]})
    t = reconcile(exp, {}, tgt, D)["tables"][0]
    rows = {r["field"]: r for r in t["records"] if r["kind"] == "differing"}
    assert (rows["NAME1"]["expected"], rows["NAME1"]["found"], rows["NAME1"]["withheld"]) == (None, None, True)
    assert (rows["LAND1"]["expected"], rows["LAND1"]["found"], rows["LAND1"]["withheld"]) == ("DE", "FR", False)
    assert next(f for f in t["fields"] if f["field"] == "NAME1")["differing"] == 1


def test_unexpected_only_for_held_back_keys():
    tgt = _target({"LFA1.LIFNR": ["0000000001", "0000000009", "0000000008"], "LFA1.NAME1": ["Alpha", "x", "y"]})
    held = {"LFA1": pd.DataFrame({"SOURCE_RECORD": ["LIFNR=9"], "LIFNR": ["9"], "NAME1": ["x"]})}
    t = reconcile(EXPECTED, held, tgt, D)["tables"][0]
    assert t["unexpected"] == 1  # 8 is in the target but not in the load's key set: no claim
    assert [r["key"] for r in t["records"] if r["kind"] == "unexpected"] == ["LIFNR=0000000009"]


def test_records_capped_and_stated():
    n = 30
    exp = {"LFA1": pd.DataFrame({"SOURCE_RECORD": [f"r{i}" for i in range(n)], "LIFNR": [str(i + 1) for i in range(n)]})}
    r = reconcile(exp, {}, _target({"LFA1.LIFNR": ["0000000999"]}), D, cap=5)
    t = r["tables"][0]
    assert t["missing"] == n and len(t["records"]) == 5 and t["capped"] and r["record_cap"] == 5


def test_not_comparable_reasons():
    assert _row(_target({"LFA1.LIFNR": ["0000000001"]}, partial={"LFA1"}))["reason"] == "target_extract_partial"
    assert _row(_target({"LFA1.LIFNR": ["0000000001"]}, incomplete={"LFA1"}))["reason"] == "target_extract_incomplete"
    t = reconcile(EXPECTED, {}, TableFrames({}, D), D)["tables"][0]
    assert t["reason"] == "table_not_extracted" and not t["comparable"]


def _f(cid, affected, total=100):
    return {"check_id": cid, "severity": "high", "dimension": "validity", "affected_count": affected,
            "total_count": total, "pass_rate": 100 - affected, "details": {}, "finding_type": "rule"}


def test_scores_null_without_target_analysis():
    summary = {"m": {"dest_dqs": {"source_score": 80.0, "composite_score": 85.0}}}
    s = score_sides(["m"], summary, None, {"m": [_f("a", 10)]}, {}, {})["modules"][0]
    assert (s["source"], s["projected"], s["actual"], s["actual_reason"]) == (80.0, 85.0, None, "no_target_analysis")


def test_scores_actual_and_reasons():
    summary = {"m": {"dest_dqs": {"source_score": 80.0, "composite_score": 85.0}}}
    s = score_sides(["m"], summary, {"m": [_f("a", 0), _f("b", 20)]}, {"m": [_f("a", 10), _f("b", 20)]}, {},
                    {"m": {"a": "Rule a"}})["modules"][0]
    assert s["actual"] is not None and [r["check_id"] for r in s["reasons"]] == ["a"]
    assert s["reasons"][0]["description"] == "Rule a" and s["reasons"][0]["change"] == 10.0


def test_dropped_non_key_column_is_compared_on_the_rest():
    # target extracted every record but lost NAME1 and ORT01 (columns_dropped, not partial): key compare plus present fields
    tgt = _target({"LFA1.LIFNR": ["0000000001", "0000000002"]})
    t = _row_with(tgt)
    assert t["comparable"] and t["missing"] == 1 and t["found"] == 2
    assert {f["field"]: f["in_target_extract"] for f in t["fields"]}["NAME1"] is False
    assert all(f["differing"] == 0 for f in t["fields"])


def test_windowed_read_stays_not_comparable_and_absent_key_is_reported():
    assert _row(_target({"LFA1.LIFNR": ["0000000001"]}, partial={"LFA1"}))["comparable"] is False
    t = _row(_target({"LFA1.NAME1": ["Alpha"]}))  # the key column itself was lost
    assert not t["comparable"] and t["reason"] == "key_not_in_target_extract"


def _row_with(tgt):
    return reconcile(EXPECTED, {}, tgt, D)["tables"][0]

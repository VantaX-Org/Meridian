"""aggregate_check (two signed totals per group must agree) and interval_check
(validity periods per group: no overlap; continuous = no gap either)."""

import pandas as pd

from checks.types.aggregate_check import AggregateCheck
from checks.types.interval_check import IntervalCheck

GRIR = {"id": "T", "module": "mm_purchasing", "field": "EKBE.MENGE", "check_class": "aggregate_check",
        "group_by": ["EKBE.EBELN", "EKBE.EBELP"], "amount": "EKBE.MENGE", "sign_field": "EKBE.SHKZG",
        "split_field": "EKBE.VGABE", "left_values": ["1"], "right_values": ["2"], "severity": "high", "message": "m"}


def _ekbe(rows):
    return pd.DataFrame([dict(zip(["EKBE.EBELN", "EKBE.EBELP", "EKBE.VGABE", "EKBE.SHKZG", "EKBE.MENGE"], r))
                         for r in rows])


def test_received_equals_invoiced_after_reversal():
    df = _ekbe([("1", "10", "1", "S", "10"), ("1", "10", "1", "H", "2"),   # GR 10, return 2
                ("1", "10", "2", "S", "8"),                                # invoiced 8
                ("2", "10", "1", "S", "5"), ("2", "10", "2", "S", "3"),    # 2 still to invoice
                ("3", "10", "1", "S", "4"), ("3", "10", "2", "S", "6")])   # over-invoiced
    r = AggregateCheck(GRIR).run(df)
    assert (r.total_count, r.affected_count) == (3, 2)
    assert r.details["largest_difference"] == 2.0
    assert AggregateCheck({**GRIR, "compare": "right_gt_left"}).run(df).affected_count == 1
    assert AggregateCheck({**GRIR, "compare": "left_gt_right"}).run(df).affected_count == 1


IT = {"id": "T", "module": "employee_central", "field": "PA0001.BEGDA", "check_class": "interval_check",
      "group_by": ["PA0001.PERNR"], "start": "PA0001.BEGDA", "end": "PA0001.ENDDA", "severity": "high", "message": "m"}


def _pa(rows):
    return pd.DataFrame([dict(zip(["PA0001.PERNR", "PA0001.BEGDA", "PA0001.ENDDA"], r)) for r in rows])


def test_overlap_gap_and_open_end():
    df = _pa([("1", "20200101", "20201231"), ("1", "20210101", "99991231"),    # continuous, open-ended
              ("2", "20200101", "20200630"), ("2", "20200601", "99991231"),    # overlap
              ("3", "20200101", "20200630"), ("3", "20200801", "20211231"),    # gap, and ends
              ("4", "20200101", "20191231")])                                  # ends before it starts: out
    r = IntervalCheck(IT).run(df)
    assert (r.total_count, r.affected_count) == (6, 1)
    assert IntervalCheck({**IT, "mode": "continuous"}).run(df).affected_count == 2
    assert IntervalCheck({**IT, "mode": "continuous", "open_ended": True}).run(df).affected_count == 2
    # the gap row and the group's last row are one and the same for employee 3
    df2 = _pa([("5", "20200101", "20201231")])
    assert IntervalCheck({**IT, "open_ended": True}).run(df2).affected_count == 1


def test_exists_check_against_live_partial_and_missing_targets():
    from checks.frames import TableFrames
    from checks.runner import run_rule
    from sap.ddic import get_dictionary

    d = get_dictionary("ecc6")
    rule = {"id": "T", "module": "accounts_payable", "field": "LFB1.LNRZE", "check_class": "exists_check",
            "target_table": "LFA1", "target_fields": ["LIFNR"], "target_when": {"LOEVM": {"blank": True}},
            "severity": "high", "message": "m"}
    lfb1 = pd.DataFrame({"LFB1.LIFNR": ["B1", "B2", "B3", "B4"], "LFB1.BUKRS": ["1000"] * 4,
                         "LFB1.LNRZE": ["H1", "H2", "H9", ""]})       # live, deleted, missing, none
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["H1", "H2", "B1", "B2", "B3", "B4"], "LFA1.LOEVM": ["", "X", "", "", "", ""]})
    frames = TableFrames({"LFB1": lfb1, "LFA1": lfa1}, d, module="accounts_payable")
    _, r = run_rule(rule, frames)
    assert (r.total_count, r.affected_count) == (3, 2)
    frames.partial = {"LFA1"}  # a scoped download cannot prove a vendor does not exist
    _, r = run_rule(rule, frames)
    assert r.error and "not read in full" in r.error
    _, r = run_rule(rule, TableFrames({"LFB1": lfb1}, d, module="accounts_payable"))
    assert r is None


def test_similarity_check_finds_typos_not_variants():
    from checks.types.similarity_check import SimilarityCheck

    rule = {"id": "T", "module": "material_master", "field": "MAKT.MAKTX", "block_by": ["MARA.MATKL"],
            "check_class": "similarity_check", "severity": "medium", "message": "m"}
    names = [("BOLT HEX M10X20 ZINC", "001"), ("BOLT HEX M10X25 ZINC", "001"),   # different size: distinct
             ("HYDRAULIC FILTER ELEMENT", "002"), ("HYDRAULC FILTER ELEMENT", "002"),  # typo: near-duplicate
             ("ELEMENT FILTER HYDRAULIC", "003"), ("HYDRAULIC FILTER ELEMENT", "004"),  # other blocks: never paired
             ("GEAR PUMP", "005"), ("GEAR PUMP", "005"),                    # exact: the uniqueness rule's job
             ("PUMP", "006"), ("PUMPS", "006")]                             # too short to judge
    df = pd.DataFrame({"MAKT.MAKTX": [n for n, _ in names], "MARA.MATKL": [g for _, g in names]})
    r = SimilarityCheck(rule).run(df)
    assert r.affected_count == 2 and r.details["near_duplicate_pairs"] == [
        ["HYDRAULIC FILTER ELEMENT", "HYDRAULC FILTER ELEMENT"]]
    # word order alone is a near-duplicate within one block
    df2 = pd.DataFrame({"MAKT.MAKTX": ["FILTER ELEMENT HYDRAULIC", "HYDRAULIC FILTER ELEMENT"],
                        "MARA.MATKL": ["002", "002"]})
    assert SimilarityCheck(rule).run(df2).affected_count == 2
    # an oversized block is skipped and counted, not silently judged
    big = pd.DataFrame({"MAKT.MAKTX": [f"PART NUMBER {i}" for i in range(5)], "MARA.MATKL": ["9"] * 5})
    r = SimilarityCheck({**rule, "max_block": 4}).run(big)
    assert r.affected_count == 0 and r.details["blocks_skipped_too_large"] == 1

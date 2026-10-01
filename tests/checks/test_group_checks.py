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

"""Grain resolution and non-fan-out joins (checks/frames.py)."""

import pandas as pd
import yaml

from checks.frames import TableFrames, _graph
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.null_check import NullCheck
from sap.ddic import get_dictionary


def _vendor_frames():
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["V1", "V2"], "LFA1.ADRNR": ["A1", "A2"], "LFA1.NAME1": ["X", ""]})
    lfb1 = pd.DataFrame({"LFB1.LIFNR": ["V1", "V1", "V2"], "LFB1.BUKRS": ["1000", "2000", "1000"],
                         "LFB1.AKONT": ["160000", "", "160000"]})
    adr6 = pd.DataFrame({"ADR6.ADDRNUMBER": ["A1", "A1"], "ADR6.CONSNUMBER": ["001", "002"],
                         "ADR6.FLGDEFAULT": ["", "X"], "ADR6.SMTP_ADDR": ["old@x.com", "ap@x.com"]})
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1, "ADR6": adr6}, module="accounts_payable")


def test_attribute_table_evaluated_at_parent_grain():
    frames = _vendor_frames()
    frame, grain, keys = frames.frame_for(["ADR6.SMTP_ADDR"])
    assert grain == "LFA1" and keys == ["LFA1.LIFNR"]
    res = NullCheck({"id": "E", "field": "ADR6.SMTP_ADDR"}).run(frame, key_cols=keys, grain=grain)
    # V2 has no e-mail row at all → fails; V1 uses its default (FLGDEFAULT=X) address
    assert (res.total_count, res.affected_count) == (2, 1)
    assert res.failing_record_keys == ["LIFNR=V2"]
    assert frame.loc[frame["LFA1.LIFNR"] == "V1", "ADR6.SMTP_ADDR"].item() == "ap@x.com"


def test_child_grain_joins_parent_without_fan_out():
    frames = _vendor_frames()
    frame, grain, keys = frames.frame_for(["LFB1.AKONT", "LFA1.NAME1"])
    assert grain == "LFB1" and len(frame) == 3
    assert keys == ["LFB1.LIFNR", "LFB1.BUKRS"]


def test_uniqueness_at_vendor_grain_has_no_false_duplicates():
    flat = pd.DataFrame({"LFA1.LIFNR": ["V1", "V1", "V2"], "LFB1.LIFNR": ["V1", "V1", "V2"],
                         "LFB1.BUKRS": ["1000", "2000", "1000"], "LFB1.AKONT": ["1", "2", "3"]})
    frames = TableFrames.from_flat(flat, module="accounts_payable")
    rule = {"id": "U", "field": "LFA1.LIFNR", "condition": "~`LFA1.LIFNR`.duplicated(keep=False)"}
    frame, grain, keys = frames.frame_for(CrossFieldCheck(rule).columns())
    res = CrossFieldCheck(rule).run(frame, key_cols=keys, grain=grain)
    assert grain == "LFA1" and res.total_count == 2 and res.affected_count == 0


def test_flat_upload_without_keys_falls_back_to_flat_frame():
    flat = pd.DataFrame({"LFA1.NAME1": ["A", ""]})
    frames = TableFrames.from_flat(flat)
    frame, grain, keys = frames.frame_for(["LFA1.NAME1"])
    assert grain is None and len(frame) == 2


def test_missing_table_skips_rule():
    assert _vendor_frames().frame_for(["LFBK.BANKN"]) is None


def test_s4_moved_fields_exposed_from_ecc_tables():
    vbak = pd.DataFrame({"VBAK.VBELN": ["1"]})
    vbuk = pd.DataFrame({"VBUK.VBELN": ["1"], "VBUK.GBSTK": ["C"]})
    frames = TableFrames({"VBAK": vbak, "VBUK": vbuk}, module="sd_sales_orders")
    frame, grain, _ = frames.frame_for(["VBAK.GBSTK"])
    assert grain == "VBAK" and frame["VBAK.GBSTK"].tolist() == ["C"]


def test_every_join_field_exists_in_the_dictionary():
    d = get_dictionary("s4hana")
    edges, anchors = _graph()
    missing = []
    for e in edges:
        for child_f, parent_f in e.on:
            for t, f in ((e.child, child_f), (e.parent, parent_f)):
                if d.field(t, f) is None:
                    missing.append(f"{t}.{f}")
        for f, _ in e.filter + e.prefer:
            if d.field(e.child, f) is None:
                missing.append(f"{e.child}.{f}")
    assert missing == []
    assert all(d.table(t) for t in anchors.values())

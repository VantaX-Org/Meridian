"""The record-level source→target field-status delta helper."""

import pandas as pd

from sap.field_status import FieldStatus
from api.services.migration.field_status import field_status_gaps


def test_blank_in_target_records_are_reported_per_group():
    # MARA: FERT group requires EAN11 in S/4 but it is optional in ECC → blank_in_target.
    frame = pd.DataFrame({
        "MARA.MATNR": ["1", "2", "3"],
        "MARA.MTART": ["FERT", "FERT", "ROH"],
        "MARA.EAN11": ["", "", "400"],
    })
    source = {"FERT": {"MARA.EAN11": FieldStatus.OPTIONAL}, "ROH": {"MARA.EAN11": FieldStatus.OPTIONAL}}
    target = {"FERT": {"MARA.EAN11": FieldStatus.REQUIRED}, "ROH": {"MARA.EAN11": FieldStatus.OPTIONAL}}

    gaps = field_status_gaps(frame, "MARA", "MARA.MTART", source, target)

    assert len(gaps) == 1
    g = gaps[0]
    assert g.field == "MARA.EAN11" and g.group == "FERT" and g.kind == "blank_in_target"
    assert set(g.record_keys) == {0, 1}  # the two FERT records


def test_obsolete_in_target_records_are_reported():
    frame = pd.DataFrame({
        "LFA1.LIFNR": ["1", "2"],
        "LFA1.KTOKK": ["KRED", "KRED"],
        "LFA1.STRAS": ["x", "y"],
    })
    source = {"KRED": {"LFA1.STRAS": FieldStatus.REQUIRED}}
    target = {"KRED": {"LFA1.STRAS": FieldStatus.SUPPRESSED}}

    gaps = field_status_gaps(frame, "LFA1", "LFA1.KTOKK", source, target)
    assert len(gaps) == 1 and gaps[0].kind == "obsolete_in_target"


def test_no_gap_when_statuses_agree_or_one_side_is_unknown():
    frame = pd.DataFrame({"MARA.MATNR": ["1"], "MARA.MTART": ["FERT"], "MARA.BRGEW": [""]})
    source = {"FERT": {"MARA.BRGEW": FieldStatus.REQUIRED}}
    target = {"FERT": {"MARA.BRGEW": FieldStatus.REQUIRED}}
    assert field_status_gaps(frame, "MARA", "MARA.MTART", source, target) == []

    # unknown on the target side → not a gap (absence is not optional)
    assert field_status_gaps(frame, "MARA", "MARA.MTART", source, {}) == []


def test_missing_group_field_or_empty_frame_gives_no_gaps():
    frame = pd.DataFrame({"MARA.MATNR": ["1"]})
    assert field_status_gaps(frame, "MARA", "MARA.MTART", {"FERT": {}}, {"FERT": {}}) == []
    assert field_status_gaps(pd.DataFrame(), "MARA", "MARA.MTART", {"FERT": {}}, {"FERT": {}}) == []


def test_composite_group_key_material_type_and_industry_sector():
    frame = pd.DataFrame({
        "MARA.MATNR": ["1", "2", "3"],
        "MARA.MTART": ["FERT", "FERT", "ROH"],
        "MARA.MBRSH": ["A", "M", "M"],
    })
    source = {"FERT|A": {"MARA.EAN11": FieldStatus.OPTIONAL}, "FERT|M": {"MARA.EAN11": FieldStatus.OPTIONAL},
              "ROH|M": {"MARA.EAN11": FieldStatus.OPTIONAL}}
    target = {"FERT|A": {"MARA.EAN11": FieldStatus.REQUIRED}, "FERT|M": {"MARA.EAN11": FieldStatus.OPTIONAL},
              "ROH|M": {"MARA.EAN11": FieldStatus.OPTIONAL}}

    gaps = field_status_gaps(frame, "MARA", ["MARA.MTART", "MARA.MBRSH"], source, target)

    assert len(gaps) == 1
    assert gaps[0].group == "FERT|A" and gaps[0].kind == "blank_in_target"
    assert set(gaps[0].record_keys) == {0}  # only material 1 (FERT|A)

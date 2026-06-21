"""Tests for sap/field_status.py — SAP field-status resolution.

Verifies the resolution contract:
  - live overrides (a resolved field-status group) win and are labelled LIVE_SPRO
  - the data-dictionary baseline derives REQUIRED from key/mandatory, else OPTIONAL
  - a customer-namespace (Z/Y) field the dictionary doesn't know resolves CUSTOM
    + OPTIONAL — recognised by name, never silently dropped
  - an unknown *standard*-namespace field returns None (no opinion — never
    silently "optional")
  - the dictionary alone can never yield SUPPRESSED/DISPLAY (only live config can)
"""

from __future__ import annotations

import pytest

from sap.data_dictionary import get_field_metadata, get_table_metadata
from sap.field_status import (
    FieldStatus,
    FieldStatusSource,
    required_fields,
    resolve_field_status,
    resolve_table_field_status,
)


# Pick a real dictionary table that exists so the baseline path is exercised
# against shipped data, not a fixture. LFA1 (vendor master) is in the dictionary.
_TABLE = "LFA1"


def _a_field_where(predicate) -> str:
    """Return one field name of _TABLE whose metadata satisfies *predicate*."""
    table_meta = get_table_metadata(_TABLE) or {}
    for fld, meta in table_meta.items():
        if predicate(meta):
            return fld
    pytest.skip(f"no field in {_TABLE} matching predicate")


# ── Dictionary baseline ──────────────────────────────────────────────────────


def test_key_field_is_required_from_dictionary():
    fld = _a_field_where(lambda m: m.get("key"))
    res = resolve_field_status(_TABLE, fld)
    assert res is not None
    assert res.status is FieldStatus.REQUIRED
    assert res.source is FieldStatusSource.DICTIONARY
    assert res.is_required
    assert not res.is_config_grounded


def test_mandatory_nonkey_field_is_required_from_dictionary():
    fld = _a_field_where(lambda m: m.get("mandatory") and not m.get("key"))
    res = resolve_field_status(_TABLE, fld)
    assert res is not None
    assert res.status is FieldStatus.REQUIRED
    assert res.source is FieldStatusSource.DICTIONARY


def test_plain_field_is_optional_from_dictionary():
    fld = _a_field_where(lambda m: not m.get("mandatory") and not m.get("key"))
    res = resolve_field_status(_TABLE, fld)
    assert res is not None
    assert res.status is FieldStatus.OPTIONAL
    assert res.source is FieldStatusSource.DICTIONARY


def test_unknown_standard_field_returns_none():
    # A standard-namespace field absent from the dictionary → no opinion. The
    # caller must not treat absence as "optional". (A Z/Y field is different —
    # see the custom-namespace section below.)
    assert resolve_field_status(_TABLE, "AENAM_NOT_A_REAL_FIELD") is None


def test_unknown_standard_table_returns_none():
    # "ANYTHING" is a standard-namespace field name on an unknown table.
    assert resolve_field_status("ZZ_NOT_A_TABLE", "ANYTHING") is None


def test_case_insensitive_lookup():
    fld = _a_field_where(lambda m: m.get("key"))
    lower = resolve_field_status(_TABLE.lower(), fld.lower())
    upper = resolve_field_status(_TABLE.upper(), fld.upper())
    assert lower is not None and upper is not None
    assert lower.status is upper.status
    assert lower.field == upper.field == fld.upper()


# ── Customer-namespace (Z/Y) custom fields ───────────────────────────────────


def test_custom_zz_append_field_resolves_optional_custom():
    # A ZZ* append field on a standard table is not in the shipped dictionary,
    # but is recognised by namespace and resolved OPTIONAL/CUSTOM rather than
    # dropped as "no opinion".
    res = resolve_field_status(_TABLE, "ZZRISK_CLASS")
    assert res is not None
    assert res.status is FieldStatus.OPTIONAL
    assert res.source is FieldStatusSource.CUSTOM
    assert res.is_custom
    assert not res.is_grounded  # name-only recognition is not evidence
    assert "custom" in res.reason.lower()


def test_custom_y_namespace_field_is_custom():
    res = resolve_field_status(_TABLE, "YYFLAG")
    assert res is not None and res.source is FieldStatusSource.CUSTOM


def test_qualified_custom_field_resolves_custom():
    # Qualified TABLE.FIELD form — the tail is what decides custom-ness.
    res = resolve_field_status(_TABLE, "LFA1.ZZSEGMENT")
    assert res is not None and res.source is FieldStatusSource.CUSTOM


def test_custom_field_known_to_dictionary_keeps_dictionary_source():
    # If a Z field somehow IS in the dictionary, the dictionary wins over the
    # bare custom recognition (CUSTOM is the weakest tier).
    fld = next(
        (f for f in (get_table_metadata(_TABLE) or {}) if f.upper().startswith(("Z", "Y"))),
        None,
    )
    if fld is None:
        pytest.skip(f"{_TABLE} has no Z/Y field in the dictionary")
    res = resolve_field_status(_TABLE, fld)
    assert res is not None and res.source is FieldStatusSource.DICTIONARY


def test_live_override_beats_custom_recognition():
    # A live field-status group for a Z field overrides the OPTIONAL/CUSTOM
    # baseline — config-grounded evidence wins.
    res = resolve_field_status(
        _TABLE, "ZZRISK_CLASS", account_group="0001",
        overrides={"ZZRISK_CLASS": FieldStatus.REQUIRED},
    )
    assert res is not None
    assert res.status is FieldStatus.REQUIRED
    assert res.source is FieldStatusSource.LIVE_SPRO


def test_smart_cascade_custom_field_falls_to_custom_baseline():
    from sap.field_status import resolve_field_status_smart

    res = resolve_field_status_smart(_TABLE, "ZZRISK_CLASS")
    assert res is not None
    assert res.status is FieldStatus.OPTIONAL
    assert res.source is FieldStatusSource.CUSTOM


def test_smart_cascade_inferred_beats_custom_baseline():
    from sap.field_status import resolve_field_status_smart

    # Inference says the Z field is always filled → REQUIRED beats CUSTOM.
    res = resolve_field_status_smart(
        _TABLE, "ZZRISK_CLASS",
        inferred_overrides={"ZZRISK_CLASS": FieldStatus.REQUIRED},
    )
    assert res is not None
    assert res.status is FieldStatus.REQUIRED
    assert res.source is FieldStatusSource.INFERRED


# ── Live override seam ───────────────────────────────────────────────────────


def test_override_wins_over_dictionary():
    # A key field is REQUIRED in the dictionary; a live field-status group that
    # suppresses it must win and be labelled config-grounded.
    fld = _a_field_where(lambda m: m.get("key"))
    res = resolve_field_status(
        _TABLE, fld, account_group="0001",
        overrides={fld: FieldStatus.SUPPRESSED},
    )
    assert res is not None
    assert res.status is FieldStatus.SUPPRESSED
    assert res.source is FieldStatusSource.LIVE_SPRO
    assert res.is_config_grounded
    assert res.account_group == "0001"


def test_override_display_state_only_reachable_via_live():
    # DISPLAY cannot come from the dictionary — only a live override yields it.
    fld = _a_field_where(lambda m: not m.get("key"))
    res = resolve_field_status(_TABLE, fld, overrides={fld: FieldStatus.DISPLAY})
    assert res is not None and res.status is FieldStatus.DISPLAY
    assert res.source is FieldStatusSource.LIVE_SPRO


def test_override_case_insensitive():
    fld = _a_field_where(lambda m: not m.get("key"))
    res = resolve_field_status(
        _TABLE, fld, overrides={fld.lower(): FieldStatus.REQUIRED}
    )
    assert res is not None and res.status is FieldStatus.REQUIRED
    assert res.source is FieldStatusSource.LIVE_SPRO


def test_override_absent_field_falls_back_to_dictionary():
    # Override mapping that doesn't mention this field → dictionary baseline.
    fld = _a_field_where(lambda m: m.get("key"))
    res = resolve_field_status(
        _TABLE, fld, overrides={"SOME_OTHER_FIELD": FieldStatus.OPTIONAL}
    )
    assert res is not None
    assert res.source is FieldStatusSource.DICTIONARY


# ── Table-level helpers ──────────────────────────────────────────────────────


def test_resolve_table_field_status_covers_all_dictionary_fields():
    table_meta = get_table_metadata(_TABLE) or {}
    resolved = resolve_table_field_status(_TABLE)
    assert set(resolved.keys()) == {f.upper() for f in table_meta.keys()}
    assert all(r.source is FieldStatusSource.DICTIONARY for r in resolved.values())


def test_table_level_override_preserves_live_only_field():
    # A field present only in the override (not the dictionary) must survive so
    # live SUPPRESSED/DISPLAY states are not dropped.
    resolved = resolve_table_field_status(
        _TABLE, overrides={"ZZ_LIVE_ONLY": FieldStatus.SUPPRESSED}
    )
    assert "ZZ_LIVE_ONLY" in resolved
    assert resolved["ZZ_LIVE_ONLY"].status is FieldStatus.SUPPRESSED
    assert resolved["ZZ_LIVE_ONLY"].source is FieldStatusSource.LIVE_SPRO


def test_required_fields_matches_dictionary_required():
    table_meta = get_table_metadata(_TABLE) or {}
    expected = {
        f.upper()
        for f, m in table_meta.items()
        if m.get("key") or m.get("mandatory")
    }
    assert set(required_fields(_TABLE)) == expected


def test_required_fields_respects_live_suppression():
    # Suppressing a normally-required key field via live config drops it from
    # the required set.
    table_meta = get_table_metadata(_TABLE) or {}
    key_field = next((f for f, m in table_meta.items() if m.get("key")), None)
    if key_field is None:
        pytest.skip(f"{_TABLE} has no key field")
    req = required_fields(_TABLE, overrides={key_field: FieldStatus.SUPPRESSED})
    assert key_field.upper() not in req


# ── SPROReader façade ────────────────────────────────────────────────────────


def test_spro_reader_facade_delegates():
    from api.services.spro_reader import SPROReader

    fld = _a_field_where(lambda m: m.get("key"))
    reader = SPROReader(system_type="ecc")
    res = reader.get_field_status(_TABLE, fld)
    assert res is not None
    assert res.status is FieldStatus.REQUIRED
    assert res.source is FieldStatusSource.DICTIONARY


# ── override_source provenance ───────────────────────────────────────────────


def test_override_labelled_inferred_when_source_inferred():
    fld = _a_field_where(lambda m: not m.get("key"))
    res = resolve_field_status(
        _TABLE,
        fld,
        overrides={fld: FieldStatus.SUPPRESSED},
        override_source=FieldStatusSource.INFERRED,
    )
    assert res is not None
    assert res.status is FieldStatus.SUPPRESSED
    assert res.source is FieldStatusSource.INFERRED
    assert res.is_data_grounded
    assert res.is_grounded
    assert not res.is_config_grounded
    assert "inferred" in res.reason.lower()


def test_override_source_dictionary_is_rejected():
    fld = _a_field_where(lambda m: not m.get("key"))
    with pytest.raises(ValueError):
        resolve_field_status(
            _TABLE,
            fld,
            overrides={fld: FieldStatus.OPTIONAL},
            override_source=FieldStatusSource.DICTIONARY,
        )


def test_live_source_keeps_config_grounded():
    fld = _a_field_where(lambda m: not m.get("key"))
    res = resolve_field_status(
        _TABLE,
        fld,
        overrides={fld: FieldStatus.REQUIRED},
        override_source=FieldStatusSource.LIVE_SPRO,
    )
    assert res is not None
    assert res.source is FieldStatusSource.LIVE_SPRO
    assert res.is_config_grounded
    assert res.is_grounded
    assert not res.is_data_grounded


# ── Smart cascade: live > inferred > dictionary ──────────────────────────────


def test_smart_cascade_live_wins_over_inferred_and_dictionary():
    from sap.field_status import resolve_field_status_smart

    fld = _a_field_where(lambda m: m.get("key"))  # dictionary REQUIRED
    res = resolve_field_status_smart(
        _TABLE,
        fld,
        account_group="0001",
        live_overrides={fld: FieldStatus.DISPLAY},
        inferred_overrides={fld: FieldStatus.SUPPRESSED},
    )
    assert res is not None
    assert res.status is FieldStatus.DISPLAY
    assert res.source is FieldStatusSource.LIVE_SPRO


def test_smart_cascade_falls_to_inferred_when_live_silent():
    from sap.field_status import resolve_field_status_smart

    fld = _a_field_where(lambda m: not m.get("key"))
    res = resolve_field_status_smart(
        _TABLE,
        fld,
        live_overrides={"SOME_OTHER_FIELD": FieldStatus.DISPLAY},  # silent on fld
        inferred_overrides={fld: FieldStatus.SUPPRESSED},
    )
    assert res is not None
    assert res.status is FieldStatus.SUPPRESSED
    assert res.source is FieldStatusSource.INFERRED


def test_smart_cascade_falls_to_dictionary_when_no_evidence():
    from sap.field_status import resolve_field_status_smart

    fld = _a_field_where(lambda m: m.get("key"))
    res = resolve_field_status_smart(_TABLE, fld)
    assert res is not None
    assert res.source is FieldStatusSource.DICTIONARY
    assert res.status is FieldStatus.REQUIRED


# ── Data inference engine ────────────────────────────────────────────────────


def _frame(rows: list[dict]):
    import pandas as pd

    return pd.DataFrame(rows)


def test_infer_required_when_always_filled():
    from sap.field_status import FieldStatus as FS
    from sap.field_status_inference import infer_field_status

    df = _frame([{"NAME1": f"Vendor {i}"} for i in range(50)])
    result = infer_field_status(df, min_sample=30)
    assert result.has_opinion
    assert result.overrides["NAME1"] is FS.REQUIRED
    assert result.evidence["NAME1"].fill_rate == 1.0


def test_infer_suppressed_when_never_filled():
    from sap.field_status import FieldStatus as FS
    from sap.field_status_inference import infer_field_status

    df = _frame([{"TELF1": ""} for _ in range(50)])
    result = infer_field_status(df, min_sample=30)
    assert result.overrides["TELF1"] is FS.SUPPRESSED
    assert result.evidence["TELF1"].n_filled == 0


def test_infer_optional_when_sometimes_filled():
    from sap.field_status import FieldStatus as FS
    from sap.field_status_inference import infer_field_status

    rows = [{"TELF1": "555-0100"} for _ in range(25)] + [{"TELF1": ""} for _ in range(25)]
    result = infer_field_status(_frame(rows), min_sample=30)
    assert result.overrides["TELF1"] is FS.OPTIONAL


def test_infer_treats_whitespace_and_none_as_absent():
    from sap.field_status_inference import infer_field_status

    rows = [{"TELF1": "   "} for _ in range(20)] + [{"TELF1": None} for _ in range(20)]
    result = infer_field_status(_frame(rows), min_sample=30)
    assert result.evidence["TELF1"].n_filled == 0


def test_infer_zero_is_present_not_absent():
    from sap.field_status import FieldStatus as FS
    from sap.field_status_inference import infer_field_status

    df = _frame([{"NUMC_FIELD": 0} for _ in range(40)])
    result = infer_field_status(df, min_sample=30)
    assert result.overrides["NUMC_FIELD"] is FS.REQUIRED  # 0 counts as filled


def test_infer_no_opinion_below_min_sample():
    from sap.field_status_inference import infer_field_status

    df = _frame([{"NAME1": "x"} for _ in range(5)])
    result = infer_field_status(df, min_sample=30)
    assert not result.has_opinion
    assert result.overrides == {}


def test_infer_never_yields_display():
    from sap.field_status import FieldStatus as FS
    from sap.field_status_inference import infer_field_status

    df = _frame([{"A": "x", "B": "", "C": "y" if i % 2 else ""} for i in range(40)])
    result = infer_field_status(df, min_sample=30)
    assert FS.DISPLAY not in result.overrides.values()


def test_build_overrides_splits_by_account_group():
    from sap.field_status import FieldStatus as FS
    from sap.field_status_inference import build_inferred_overrides

    # KTOKK 0001 always fills TELF1; 0002 never does.
    rows = (
        [{"KTOKK": "0001", "LIFNR": f"A{i}", "TELF1": "555"} for i in range(40)]
        + [{"KTOKK": "0002", "LIFNR": f"B{i}", "TELF1": ""} for i in range(40)]
    )
    by_group = build_inferred_overrides(_frame(rows), "LFA1")
    assert by_group["0001"].overrides["TELF1"] is FS.REQUIRED
    assert by_group["0002"].overrides["TELF1"] is FS.SUPPRESSED


def test_build_overrides_protects_key_fields():
    from sap.field_status_inference import build_inferred_overrides

    # LIFNR is the LFA1 key; even if we under-fill it, inference must not emit it.
    rows = [{"KTOKK": "0001", "LIFNR": "" if i else "A0", "NAME1": "x"} for i in range(40)]
    by_group = build_inferred_overrides(_frame(rows), "LFA1")
    assert "LIFNR" not in by_group["0001"].overrides
    # The account-group column itself is never inferred either.
    assert "KTOKK" not in by_group["0001"].overrides


def test_build_overrides_ungrouped_when_no_account_group_column():
    from sap.field_status_inference import build_inferred_overrides

    df = _frame([{"NAME1": "x"} for _ in range(40)])
    by_group = build_inferred_overrides(df, "LFA1")
    assert set(by_group.keys()) == {None}


# ── SPROReader smart resolution + live seam ──────────────────────────────────


def test_spro_reader_smart_uses_inference_from_records():
    from api.services.spro_reader import SPROReader

    reader = SPROReader(system_type="ecc")
    rows = [{"KTOKK": "0001", "LIFNR": f"A{i}", "TELF1": ""} for i in range(40)]
    res = reader.resolve_field_status_smart(
        "LFA1", "TELF1", account_group="0001", records=_frame(rows)
    )
    assert res is not None
    assert res.status is FieldStatus.SUPPRESSED
    assert res.source is FieldStatusSource.INFERRED


def test_spro_reader_live_seam_empty_without_decoder():
    from api.services.spro_reader import SPROReader

    reader = SPROReader(system_type="ecc")
    assert reader.live_field_status_overrides("LFA1", account_group="0001") is None


def test_spro_reader_live_decoder_wins_when_registered():
    from api.services.spro_reader import (
        SPROReader,
        register_field_selection_decoder,
        unregister_field_selection_decoder,
    )

    def fake_decoder(reader, table, account_group, module):
        return {"TELF1": FieldStatus.DISPLAY}

    register_field_selection_decoder("LFA1", fake_decoder)
    try:
        reader = SPROReader(system_type="ecc")
        rows = [{"KTOKK": "0001", "LIFNR": f"A{i}", "TELF1": ""} for i in range(40)]
        res = reader.resolve_field_status_smart(
            "LFA1", "TELF1", account_group="0001", records=_frame(rows)
        )
        assert res is not None
        # Live config (DISPLAY) must beat the inferred SUPPRESSED.
        assert res.status is FieldStatus.DISPLAY
        assert res.source is FieldStatusSource.LIVE_SPRO
    finally:
        unregister_field_selection_decoder("LFA1")


def test_spro_reader_live_decoder_exception_is_swallowed():
    from api.services.spro_reader import (
        SPROReader,
        register_field_selection_decoder,
        unregister_field_selection_decoder,
    )

    def boom(reader, table, account_group, module):
        raise RuntimeError("connector down")

    register_field_selection_decoder("LFA1", boom)
    try:
        reader = SPROReader(system_type="ecc")
        # Must not raise — falls through to dictionary.
        res = reader.live_field_status_overrides("LFA1", account_group="0001")
        assert res is None
    finally:
        unregister_field_selection_decoder("LFA1")

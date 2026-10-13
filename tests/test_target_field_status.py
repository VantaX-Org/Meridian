"""Target field-status resolution (dictionary + live) and the source→target delta."""

import pytest

from sap.field_status import FieldStatus, FieldStatusResolution, FieldStatusSource
from sap.target_field_status import (
    FieldStatusDelta,
    TargetFieldStatusSource,
    field_status_delta,
    resolve_target_field_status,
)


def _res(table, field, status, source=FieldStatusSource.LIVE_SPRO):
    return FieldStatusResolution(table=table, field=field, status=status, source=source,
                                reason="test", account_group="KRED")


def test_dictionary_source_resolves_a_declared_requirement():
    r = resolve_target_field_status("LFA1", "TELF1", account_group="KRED",
                                    source=TargetFieldStatusSource.DICTIONARY,
                                    payload={"LFA1.TELF1": "required"})
    assert r.status is FieldStatus.REQUIRED
    assert r.reason == "declared target field status"
    assert r.is_config_grounded


def test_dictionary_source_falls_back_to_the_s4_dictionary_for_undeclared_fields():
    # LFA1.NAME1 is a mandatory field in the dictionary, so the baseline resolves REQUIRED.
    r = resolve_target_field_status("LFA1", "NAME1", source=TargetFieldStatusSource.DICTIONARY, payload={})
    assert r is not None and r.status is FieldStatus.REQUIRED
    assert r.source is FieldStatusSource.DICTIONARY


def test_live_source_reads_the_targets_field_status_groups():
    payload = {"groups": {"KRED": {"TELF1": FieldStatus.SUPPRESSED, "STRAS": FieldStatus.REQUIRED}}}
    r = resolve_target_field_status("LFA1", "TELF1", account_group="KRED",
                                    source=TargetFieldStatusSource.LIVE, payload=payload)
    assert r.status is FieldStatus.SUPPRESSED
    assert r.source is FieldStatusSource.LIVE_SPRO


def test_delta_blank_in_target_when_required_in_s4_but_optional_in_ecc():
    d = field_status_delta(_res("LFA1", "TELF1", FieldStatus.OPTIONAL),
                           _res("LFA1", "TELF1", FieldStatus.REQUIRED))
    assert d.kind == "blank_in_target" and d.is_migration_risk


def test_delta_obsolete_in_target_when_required_in_ecc_but_suppressed_in_s4():
    d = field_status_delta(_res("LFA1", "STRAS", FieldStatus.REQUIRED),
                           _res("LFA1", "STRAS", FieldStatus.SUPPRESSED))
    assert d.kind == "obsolete_in_target" and d.is_migration_risk


def test_delta_none_when_the_source_is_at_least_as_strict_as_the_target():
    d = field_status_delta(_res("LFA1", "NAME1", FieldStatus.REQUIRED),
                           _res("LFA1", "NAME1", FieldStatus.REQUIRED))
    assert d.kind == "none" and not d.is_migration_risk
    # source required, target optional: no migration gap (the data is already there)
    d2 = field_status_delta(_res("LFA1", "NAME1", FieldStatus.REQUIRED),
                            _res("LFA1", "NAME1", FieldStatus.OPTIONAL))
    assert d2.kind == "none"


def test_delta_none_when_either_side_has_no_opinion():
    assert field_status_delta(None, _res("LFA1", "TELF1", FieldStatus.REQUIRED)) is None
    assert field_status_delta(_res("LFA1", "TELF1", FieldStatus.OPTIONAL), None) is None


def test_documentation_and_signavio_fall_back_to_the_dictionary_baseline():
    for src in (TargetFieldStatusSource.DOCUMENTATION, TargetFieldStatusSource.SIGNAVIO):
        r = resolve_target_field_status("LFA1", "NAME1", source=src, payload={})
        assert r is not None and r.source is FieldStatusSource.DICTIONARY

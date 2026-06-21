"""Deterministic gap-analyzer tests — no DB, no live SPRO, no LLM.

The analyzer's ``_reader`` (a SPROReader) is replaced with a controlled stub so
every SPRO answer is fixed; everything else (data dictionary, custom-namespace,
account-group inference, scoring) runs for real against module ``accounts_payable``
(primary table LFA1, account-group field KTOKK).
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from agents.readiness import compute_readiness_status
from api.services.migration.gap_analyzer import TransferGapAnalyzer
from api.services.migration.models import DomainProvenance, GapSeverity, GapType, VerdictStatus
from api.services.migration.serializers import gap_summary_from_result
from api.services.migration.source_target_map import SourceTargetMap

MODULE = "accounts_payable"


@dataclass(frozen=True)
class _Source:
    value: str


@dataclass(frozen=True)
class _Resolution:
    is_required: bool
    source: _Source
    is_grounded: bool = True


class _FakeReader:
    """Fixed SPRO answers. KTOKK governs the account group; ZTERM is governed."""

    def get_valid_values(self, module: str, qualified: str):
        return {
            "LFA1.KTOKK": ["KRED", "LIEF"],
            "LFB1.ZTERM": ["Z030", "N030"],
        }.get(qualified, [])

    def resolve_field_status_smart(self, table, field, *, account_group=None, module=None):
        required = field.upper() == "NAME1"
        return _Resolution(is_required=required, source=_Source("FAKE_SPRO"))


def _map():
    rows = [
        {"module": MODULE, "source_field": "KTOKK", "dest_table": "LFA1", "dest_field": "KTOKK"},
        {"module": MODULE, "source_field": "NAME1", "dest_table": "LFA1", "dest_field": "NAME1"},
        {"module": MODULE, "source_field": "ZTERM", "dest_table": "LFB1", "dest_field": "ZTERM"},
        {"module": MODULE, "source_field": "BADF", "dest_table": "LFA1", "dest_field": "NOPE"},
        # ZZNOTE intentionally absent → unmapped custom field
    ]
    return SourceTargetMap(rows)


def _analyzer():
    a = TransferGapAnalyzer("ecc")
    a._reader = _FakeReader()  # type: ignore[assignment]
    return a


def _findings_for(result, record_key):
    return [f for f in result.findings if f.record_key == record_key]


@pytest.fixture
def result():
    records = [
        {"record_key": "r1", "data": {"KTOKK": "KRED", "NAME1": ""}},          # mandatory blank
        {"record_key": "r2", "data": {"KTOKK": "KRED", "NAME1": "0"}},         # "0" is NOT blank
        {"record_key": "r3", "data": {"KTOKK": "KRED", "ZTERM": "XXXX"}},      # out-of-domain
        {"record_key": "r4", "data": {"KTOKK": "KRED", "NAME1": "Acme Ltd"}},  # clean
        {"record_key": "r5", "data": {"KTOKK": "KRED", "BADF": "x"}},          # dest field missing
        {"record_key": "r6", "data": {"KTOKK": "KRED", "ZZNOTE": "hi"}},       # unmapped custom
        {"record_key": "r7", "data": {"KTOKK": "ZZZ", "NAME1": "X"}},          # bad account group
    ]
    return _analyzer().analyze(MODULE, records, _map())


def test_target_mandatory_on_blank(result):
    fs = _findings_for(result, "r1")
    assert any(
        f.gap_type == GapType.TARGET_MANDATORY
        and f.severity == GapSeverity.CRITICAL
        and f.severity_is_blocking
        and f.status_source == "FAKE_SPRO"
        and f.is_grounded
        for f in fs
    )
    assert result.transfer_ready_by_record["r1"] is False


def test_zero_is_not_blank(result):
    # NAME1="0" must NOT trigger target_mandatory; NAME1 is free-form so no domain finding.
    assert _findings_for(result, "r2") == []
    assert result.transfer_ready_by_record["r2"] is True


def test_value_domain_live_spro(result):
    fs = _findings_for(result, "r3")
    f = next(f for f in fs if f.gap_type == GapType.VALUE_DOMAIN)
    assert f.severity == GapSeverity.HIGH
    assert f.domain_provenance == DomainProvenance.LIVE_SPRO
    assert not f.severity_is_blocking  # value-domain is non-blocking
    assert result.transfer_ready_by_record["r3"] is True


def test_clean_record_has_no_findings(result):
    assert _findings_for(result, "r4") == []
    assert result.transfer_ready_by_record["r4"] is True


def test_field_mapping_critical_on_missing_dest(result):
    fs = _findings_for(result, "r5")
    f = next(f for f in fs if f.gap_type == GapType.FIELD_MAPPING)
    assert f.severity == GapSeverity.CRITICAL and f.severity_is_blocking
    assert result.transfer_ready_by_record["r5"] is False


def test_unmapped_custom_field_is_low_not_blocking(result):
    fs = _findings_for(result, "r6")
    f = next(f for f in fs if f.gap_type == GapType.FIELD_MAPPING)
    assert f.severity == GapSeverity.LOW and not f.severity_is_blocking
    assert result.transfer_ready_by_record["r6"] is True


def test_account_group_sweep(result):
    sweep = [f for f in result.findings if f.record_key == "account_group:ZZZ"]
    assert sweep and sweep[0].severity == GapSeverity.CRITICAL
    assert sweep[0].domain_provenance == DomainProvenance.LIVE_SPRO
    assert result.transfer_ready_by_record["r7"] is False


def test_verdict_matches_readiness_function(result):
    s = result.score
    assert s.critical_count >= 2  # r1, r5, sweep
    assert s.score <= 70.0  # 2+ criticals cap
    assert s.status == VerdictStatus(compute_readiness_status(s.score, s.critical_count))
    assert s.status == VerdictStatus.NO_GO


def test_unknown_module_raises():
    with pytest.raises(ValueError):
        _analyzer().analyze("not_a_real_module", [], _map())


def test_gap_summary_rollup_leaks_no_raw_values(result):
    import json

    summary = gap_summary_from_result(result)
    blob = json.dumps(summary)
    # Distinctive raw master-data values from the fixtures must never appear in
    # the persisted rollup (CLAUDE.md: gap_summary is counts-only, no raw SAP data).
    for raw in ("Acme Ltd", "XXXX", "Whatever"):
        assert raw not in blob
    assert set(summary) >= {"score", "status", "critical", "high", "medium", "low", "n_records"}

"""Deterministic checks for the source→destination transfer gap analyzer.

Hermetic: the destination dictionary + live SPRO reader are stubbed so every
assertion is about the analyzer's own logic, not real SAP metadata. Run:

    pytest tests/test_migration_gap_analyzer.py
"""

import sys
import types
from types import SimpleNamespace

import pytest

# agents.readiness (the real deterministic verdict fn we want to exercise) sits
# in a module that imports the langchain LLM backends at top level. Those aren't
# installed in the test env and aren't used by the deterministic path, so stub
# the provider module before the import chain runs.
if "llm.provider" not in sys.modules:
    _stub = types.ModuleType("llm.provider")
    _stub.get_llm_safe = lambda *a, **k: None
    _stub.safe_invoke = lambda *a, **k: None
    _stub.test_llm_connection = lambda *a, **k: False
    sys.modules["llm.provider"] = _stub

import api.services.migration.gap_analyzer as ga
from agents.readiness import compute_readiness_status
from api.services.migration.gap_analyzer import TransferGapAnalyzer
from api.services.migration.models import GapSeverity, GapType
from api.services.migration.source_target_map import SourceTargetMap

MODULE = "txfer"

# Destination metadata the stubs answer with.
_FIELDS = {
    ("LFA1", "LIFNR"): {"data_type": "CHAR"},
    ("LFA1", "KTOKK"): {"data_type": "CHAR"},
    ("LFA1", "NAME1"): {"data_type": "CHAR"},
    ("LFA1", "LAND1"): {"data_type": "CHAR"},
    ("LFA1", "ZZNOTE"): {"data_type": "CHAR"},
}
_LIVE_DOMAIN = {"LFA1.KTOKK": ["KRED"], "LFA1.LAND1": ["US", "DE"]}


class _FakeReader:
    def __init__(self, *_a, **_k):
        pass

    def read_config(self, _module):
        return {}

    def get_valid_values(self, _module, qualified):
        return _LIVE_DOMAIN.get(qualified, [])

    def resolve_field_status_smart(self, _table, field, account_group=None, module=None):
        # Only NAME1 is mandatory in the destination.
        return SimpleNamespace(
            is_required=(field == "NAME1"),
            source=SimpleNamespace(value="live_customizing"),
            is_grounded=True,
        )


@pytest.fixture
def analyzer(monkeypatch):
    monkeypatch.setattr(ga, "SPRO_REGISTRY", {MODULE: [{"governs_fields": ["LFA1.KTOKK", "LFA1.LAND1"]}]})
    monkeypatch.setattr(ga, "SPROReader", _FakeReader)
    monkeypatch.setattr(ga, "get_key_fields", lambda t: ["LIFNR"] if t == "LFA1" else [])
    monkeypatch.setattr(ga, "account_group_field_for", lambda t: "KTOKK" if t == "LFA1" else None)
    monkeypatch.setattr(ga, "get_field_metadata", lambda t, f: _FIELDS.get((t, f)))
    monkeypatch.setattr(ga, "get_valid_values", lambda t, f: [])  # no dictionary domains here
    return TransferGapAnalyzer("ecc", None)


def _map(*pairs):
    """pairs of (source_field, dest_table, dest_field) → SourceTargetMap."""
    return SourceTargetMap(
        [{"module": MODULE, "source_field": s, "dest_table": dt, "dest_field": df} for s, dt, df in pairs]
    )


def _by_type(result, gap_type):
    return [f for f in result.findings if f.gap_type is gap_type]


def test_module_not_in_registry_raises(analyzer):
    with pytest.raises(ValueError):
        analyzer.analyze("not_a_module", [{"LIFNR": "1"}], _map())


def test_unmapped_field_severity_and_custom_never_critical(analyzer):
    # PLAIN unmapped → MEDIUM; ZZX custom unmapped → LOW; neither CRITICAL.
    res = analyzer.analyze(MODULE, [{"PLAIN": "a", "ZZX": "b"}], _map())
    fm = {f.source_field: f.severity for f in _by_type(res, GapType.FIELD_MAPPING)}
    assert fm["PLAIN"] is GapSeverity.MEDIUM
    assert fm["ZZX"] is GapSeverity.LOW
    assert all(f.severity is not GapSeverity.CRITICAL for f in res.findings)


def test_mapped_to_nonexistent_dest_is_critical(analyzer):
    res = analyzer.analyze(MODULE, [{"GHOST": "x"}], _map(("GHOST", "LFA1", "NOPE")))
    crit = [f for f in _by_type(res, GapType.FIELD_MAPPING) if f.severity is GapSeverity.CRITICAL]
    assert len(crit) == 1
    assert crit[0].dest_field == "NOPE"


def test_target_mandatory_fires_on_blank_not_on_zero(analyzer):
    fmap = _map(("LIFNR", "LFA1", "LIFNR"), ("NAME1", "LFA1", "NAME1"))
    blank = analyzer.analyze(MODULE, [{"LIFNR": "1", "NAME1": ""}], fmap)
    assert len(_by_type(blank, GapType.TARGET_MANDATORY)) == 1
    assert _by_type(blank, GapType.TARGET_MANDATORY)[0].severity is GapSeverity.CRITICAL

    # "0" is a real SAP value, not blank — no mandatory gap.
    zero = analyzer.analyze(MODULE, [{"LIFNR": "1", "NAME1": "0"}], fmap)
    assert _by_type(zero, GapType.TARGET_MANDATORY) == []


def test_value_domain_live_spro_high_and_silent_when_valid(analyzer):
    fmap = _map(("LIFNR", "LFA1", "LIFNR"), ("KTOKK", "LFA1", "KTOKK"), ("LAND1", "LFA1", "LAND1"))
    bad = analyzer.analyze(MODULE, [{"LIFNR": "1", "KTOKK": "KRED", "LAND1": "FR"}], fmap)
    vd = _by_type(bad, GapType.VALUE_DOMAIN)
    assert len(vd) == 1 and vd[0].severity is GapSeverity.HIGH
    assert vd[0].domain_provenance == "live_spro"

    ok = analyzer.analyze(MODULE, [{"LIFNR": "1", "KTOKK": "KRED", "LAND1": "US"}], fmap)
    assert _by_type(ok, GapType.VALUE_DOMAIN) == []


def test_account_group_sweep_once_per_bad_group(analyzer):
    fmap = _map(("LIFNR", "LFA1", "LIFNR"), ("KTOKK", "LFA1", "KTOKK"))
    res = analyzer.analyze(
        MODULE,
        [{"LIFNR": "1", "KTOKK": "BADGRP"}, {"LIFNR": "2", "KTOKK": "BADGRP"}],
        fmap,
    )
    sweep = [f for f in _by_type(res, GapType.VALUE_DOMAIN) if f.record_key.startswith("account_group=")]
    assert len(sweep) == 1  # one finding for the group, not one per record
    assert sweep[0].severity is GapSeverity.CRITICAL


def test_clean_record_is_ready_and_verdict_matches_readiness(analyzer):
    fmap = _map(
        ("LIFNR", "LFA1", "LIFNR"),
        ("KTOKK", "LFA1", "KTOKK"),
        ("NAME1", "LFA1", "NAME1"),
        ("LAND1", "LFA1", "LAND1"),
    )
    res = analyzer.analyze(
        MODULE,
        [{"LIFNR": "1", "KTOKK": "KRED", "NAME1": "Acme", "LAND1": "US"}],
        fmap,
        record_keys=["1"],
    )
    assert res.findings == []
    assert "1" in res.ready_record_keys
    assert res.module_score.status == "go"
    assert res.module_score.status == compute_readiness_status(
        res.module_score.score, res.module_score.critical_count
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))

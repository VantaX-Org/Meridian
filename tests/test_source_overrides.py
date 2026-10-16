"""A tenant's own API surface must win over the shared canonical map.

The canonical dictionaries describe the standard successfactors/a riba/concur API. A tenant
differs - entity sets suffixed per tenant (``Goal_<planId>``), spellings that vary
(``workscheduleCode`` vs ``workScheduleCode``) - and when a canonical source does not resolve
there, the rule reading it is silently not evaluated.

Corrections therefore belong to the system they were found on, not to the file every customer
reads. This has already gone wrong once: a correction was made to the canonical map, confirmed
in the running image, and still did not reach extraction because a saved per-system snapshot
outranked it (see tests/sap/test_dictionary_overlay.py).
"""

import yaml

from api.services import source_overrides as so


def test_a_builtin_default_applies_for_any_system():
    """SuccessFactors' own quirks ship as defaults so a deployment need not rediscover them."""
    got = so.resolve_source("successfactors", "any-system-id", "GOALPLAN", "GOAL_ID", "Goal.id")
    assert got == "Goal_1.id"


def test_a_file_override_wins_over_the_builtin():
    """A per-system file is the most specific layer."""
    so.clear_cache()
    so._file_overrides.cache_clear()
    real = so._file_overrides
    try:
        so._file_overrides = lambda st: {"sys-1": {"GOALPLAN.GOAL_ID": "Goal_9.id"}}
        assert so.resolve_source("successfactors", "sys-1", "GOALPLAN", "GOAL_ID", "Goal.id") == "Goal_9.id"
        # a different system is unaffected
        assert so.resolve_source("successfactors", "sys-2", "GOALPLAN", "GOAL_ID", "Goal.id") == "Goal_1.id"
    finally:
        so._file_overrides = real
        so.clear_cache()


def test_canonical_is_kept_when_there_is_no_override():
    assert so.resolve_source("successfactors", "s", "EMPJOB", "SOME_FIELD", "EmpJob.someField") == "EmpJob.someField"
    assert so.resolve_source("successfactors", "s", "EMPJOB", "SOME_FIELD", None) is None


def test_a_malformed_override_file_does_not_break_extraction(tmp_path, monkeypatch):
    """A bad override must degrade to the canonical map, not take the run down."""
    (tmp_path / "successfactors.yaml").write_text("this: [is: not: valid: yaml\n")
    monkeypatch.setattr(so, "OVERRIDE_DIR", tmp_path)
    so.clear_cache()
    try:
        assert so._file_overrides("successfactors") == {}
        assert so.resolve_source("successfactors", "s", "GOALPLAN", "GOAL_ID", "Goal.id") == "Goal_1.id"
    finally:
        so.clear_cache()


def test_the_shipped_defaults_name_real_canonical_fields():
    """Every builtin key must be a field the canonical SF dictionary declares, so a typo in the
    override table cannot silently do nothing."""
    canon = yaml.safe_load(
        (so.ROOT / "sap" / "dictionaries" / "canonical" / "successfactors.yaml").read_text(encoding="utf-8")
    )["tables"]
    bad = []
    for system_type, by_system in so.BUILTIN.items():
        for _system_id, mapping in by_system.items():
            for key in mapping:
                table, _, field = key.partition(".")
                if table not in canon or field not in (canon[table].get("fields") or {}):
                    bad.append(f"{system_type}:{key}")
    assert not bad, f"override keys that do not exist in the canonical dictionary: {bad}"

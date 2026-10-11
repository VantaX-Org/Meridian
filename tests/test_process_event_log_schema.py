"""Process event log ORM shape (spec §2.1). No database needed."""

from __future__ import annotations

from db.schema import (
    PD_COVERAGE,
    PD_STATUSES,
    ProcessDiscoveryRun,
    ProcessDiscoveryVariant,
    ProcessEvent,
    ProcessVariant,
    SAPSystem,
)


def test_tables_are_named_and_do_not_clash() -> None:
    assert ProcessDiscoveryRun.__tablename__ == "process_discovery_runs"
    assert ProcessEvent.__tablename__ == "process_events"
    assert ProcessDiscoveryVariant.__tablename__ == "process_discovery_variants"
    assert ProcessVariant.__tablename__ == "process_variants"  # existing, unrelated


def test_event_columns_and_lengths() -> None:
    c = ProcessEvent.__table__.c
    assert c.case_id.type.length == 160
    assert c.activity.type.length == 64
    assert c.l5_id.type.length == 120
    assert c.source_table.type.length == 40
    assert c.seq.default is None and c.seq.server_default is not None
    idx = {i.name: [col.name for col in i.columns] for i in ProcessEvent.__table__.indexes}
    assert idx["ix_pe_case"] == ["tenant_id", "system_id", "l1", "case_type", "case_id", "ts", "seq", "id"]
    assert idx["ix_pe_activity"] == ["tenant_id", "system_id", "l1", "activity"]
    assert idx["ix_pe_ts"] == ["tenant_id", "system_id", "l1", "ts"]


def test_variant_primary_key() -> None:
    pk = [c.name for c in ProcessDiscoveryVariant.__table__.primary_key.columns]
    assert pk == ["run_id", "case_type", "variant_hash"]


def test_status_vocab_and_timezone() -> None:
    assert PD_STATUSES == ("queued", "waiting", "extracting", "building", "mining", "completed", "failed")
    assert PD_COVERAGE == ("discovered", "partial", "reference")
    assert SAPSystem.__table__.c.timezone.nullable is True

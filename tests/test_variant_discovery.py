"""Variant discovery: classification, aggregates, and idempotent persistence."""

import os
import uuid

import pandas as pd
import pytest

from api.services.config_intelligence.variant_discovery import discover_variants

AS_OF = "2026-10-01"


def _frames() -> dict[str, pd.DataFrame]:
    return {
        "VBAK": pd.DataFrame({"VBAK.AUART": ["OR", "OR", "ZOR", "TA", "TA"],
                              "VBAK.ERDAT": ["20260901", "20260915", "20260801", "20240101", "20240201"]}),
        "TVAK": pd.DataFrame({"TVAK.AUART": ["OR", "TA", "SO", "ZOR"]}),
        "EKKO": pd.DataFrame({"EKKO.BSART": ["NB", "NB", "FO"],
                              "EKKO.BEDAT": ["20260910", "20260920", "00000000"]}),
        "T161": pd.DataFrame({"T161.BSART": ["NB", "FO", "UB"]}),
    }


def _by(rows):
    return {(r.sap_table, r.sap_field, r.value): r for r in rows}


def test_classification_and_aggregate():
    rows = _by(discover_variants(_frames(), AS_OF))
    assert rows[("VBAK", "AUART", "OR")].classification == "implemented"
    assert rows[("VBAK", "AUART", "OR")].doc_count == 2
    assert rows[("VBAK", "AUART", "OR")].first_seen == "2026-09-01"
    assert rows[("VBAK", "AUART", "TA")].classification == "dormant"
    assert rows[("VBAK", "AUART", "SO")].classification == "configured_not_used"
    assert rows[("VBAK", "AUART", "ZOR")].classification == "customer_specific"
    assert rows[("VBAK", "AUART", "SO")].config_table == "TVAK"
    agg = rows[("VBAK", "AUART", "*")]
    assert agg.doc_count == 5 and agg.classification == "implemented" and agg.last_seen == "2026-09-15"
    # unreadable date is no proof of dormancy
    assert rows[("EKKO", "BSART", "FO")].classification == "implemented"
    # a config value outside the detector's set is customer specific
    assert rows[("EKKO", "BSART", "UB")].classification == "customer_specific"
    assert all(r.evidence == "extracted" for r in rows.values())


def test_signal_without_extracted_table_yields_nothing():
    assert discover_variants({"VBRK": pd.DataFrame({"VBRK.KNUMV": ["1"]})}, AS_OF) == []
    assert discover_variants({}, AS_OF) == []


def test_output_has_no_record_values():
    for r in discover_variants(_frames(), AS_OF):
        assert set(r.model_dump()) >= {"value", "doc_count"} and len(r.value) <= 4


@pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="needs a migrated Postgres")
def test_save_variants_is_idempotent():
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.services.config_intelligence.persistence import ConfigIntelligencePersistence

    tid = "00000000-0000-0000-0000-000000000001"
    vid = str(uuid.uuid4())
    url = os.environ["MERIDIAN_TEST_DB_URL"].replace("postgresql://", "postgresql+asyncpg://", 1)
    variants = discover_variants(_frames(), AS_OF)

    async def run() -> list[int]:
        eng = create_async_engine(url)
        counts = []
        try:
            async with async_sessionmaker(eng, expire_on_commit=False)() as db:
                await db.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'variants') ON CONFLICT DO NOTHING"),
                                 {"t": tid})
                for _ in range(2):
                    await ConfigIntelligencePersistence().save_variants(db, tid, vid, variants)
                    n = (await db.execute(text("SELECT count(*) FROM process_variants WHERE version_id = :v"),
                                          {"v": vid})).scalar_one()
                    counts.append(n)
                await db.execute(text("DELETE FROM process_variants WHERE version_id = :v"), {"v": vid})
                await db.commit()
        finally:
            await eng.dispose()
        return counts

    assert asyncio.run(run()) == [len(variants)] * 2

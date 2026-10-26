"""The object catalogue is built once per discovery snapshot and stored.

Planning every module is minutes (material_master alone ~17 s in the container), so
/systems/{id}/objects exceeded every client timeout and the screen rendered empty - objects looked
like they had no extraction tables even though every one of them has some.
"""
from pathlib import Path

SRC = (Path(__file__).resolve().parents[1] / "api" / "routes" / "system_objects.py").read_text(encoding="utf-8")


def test_catalogue_is_stored_against_the_snapshot():
    assert "_stored_catalogue" in SRC and "_store_catalogue" in SRC
    assert "ddic_snapshots" in SRC, "the snapshot row is the cache location"
    assert "system_info" in SRC, "stored in the snapshot's own metadata"


def test_a_stored_catalogue_is_returned_without_planning():
    body = SRC[SRC.index("def _catalogue_for"):SRC.index("return built")]
    assert "if cached:" in body, "must return the stored copy before planning"
    # the early return has to come before dictionary_for, which is part of the expensive path
    assert body.index("if cached:") < body.index("dictionary_for(")


def test_stored_catalogue_is_keyed_by_an_input_fingerprint(monkeypatch):
    """A catalogue stored by an older rule pack / extraction plan / app version is rebuilt, not reused."""
    import os
    import uuid

    import pytest

    url = os.environ.get("MERIDIAN_TEST_DB_URL")
    if not url:
        pytest.skip("MERIDIAN_TEST_DB_URL not set")
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from api.routes import system_objects as so

    fp = so._catalogue_fingerprint()
    assert len(fp) == 16 and fp == so._catalogue_fingerprint()
    eng = create_engine(url)
    tid = str(uuid.uuid4())
    try:
        with Session(eng) as s:
            s.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'CAT')"), {"t": tid})
            sid = s.execute(text("INSERT INTO sap_systems (tenant_id, name, system_type) VALUES (:t, 'PRD', 'ecc') "
                                 "RETURNING id"), {"t": tid}).scalar()
            snap = str(s.execute(text("INSERT INTO ddic_snapshots (tenant_id, system_id, source, system_info) "
                                      "VALUES (:t, :s, 'rfc', CAST(:i AS jsonb)) RETURNING id"),
                                 {"t": tid, "s": sid, "i": '{"object_catalogue": [{"object": "fi_gl"}]}'}).scalar())
            s.commit()
            assert so._stored_catalogue(s, snap) is None  # pre-fingerprint format: stale
            payload = ({"object": "fi_gl", "tables": ["BKPF"]},)
            so._store_catalogue(s, snap, payload)
            assert so._stored_catalogue(s, snap) == payload
            info = s.execute(text("SELECT system_info FROM ddic_snapshots WHERE id = :i"), {"i": snap}).scalar()
            assert info["object_catalogue"]["fingerprint"] == fp
            # new rules / tables / version: the stored copy no longer counts
            monkeypatch.setattr(so, "_catalogue_fingerprint", lambda: "changed-inputs")
            assert so._stored_catalogue(s, snap) is None
    finally:
        with eng.begin() as c:
            c.execute(text("DELETE FROM ddic_snapshots WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
        eng.dispose()

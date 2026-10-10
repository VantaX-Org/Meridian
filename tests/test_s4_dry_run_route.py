"""Worker mode s4_dry_run: load_sim findings are folded into the module verdict and
persisted alongside the ordinary transfer gaps.

Runs with MERIDIAN_TEST_DB_URL, same skip convention as test_insights_impact_route.py.
"""

from __future__ import annotations

import os
import uuid

import pandas as pd
import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def seeded():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, sid, rid, vid = (str(uuid.uuid4()) for _ in range(4))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES "
                       "(:s, :t, 'PRD', 'ecc6')"), {"s": sid, "t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, modules, status) "
                       "VALUES (:r, :t, 's4_dry_run', :s, '{material_master}', 'queued')"),
                  {"r": rid, "t": tid, "s": sid})
    yield {"tid": tid, "sid": sid, "rid": rid, "vid": vid, "engine": engine}
    with engine.begin() as c:
        c.execute(text("DELETE FROM migration_gap_findings WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM migration_runs WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


def test_s4_dry_run_folds_load_sim_into_verdict(seeded, monkeypatch):
    from checks.frames import TableFrames
    from sap.ddic import get_dictionary
    from workers.tasks import run_migration as mod

    # Two MARA rows that collide after ALPHA conversion: "123" and "0000123" both
    # resolve to the same internal material key.
    mara = pd.DataFrame({"MATNR": ["123", "0000123"], "MTART": ["ROH", "ROH"]})
    frames = TableFrames({"MARA": mara}, get_dictionary("s4hana"))

    monkeypatch.setattr(mod, "resolve_source_version",
                        lambda session, source_system_id, source_version_id: (seeded["vid"], {"dataset_path": "x/"}))
    monkeypatch.setattr("workers.dataset.load_dataset",
                        lambda *a, **k: (frames, None, len(mara), len(mara.columns)))

    out = mod.run_migration.run(seeded["tid"], seeded["rid"], "s4_dry_run", None, None,
                                ["material_master"])
    assert out["status"] == "analysed", out

    engine = seeded["engine"]
    with engine.begin() as c:
        rows = c.execute(text("SELECT gap_type, detail FROM migration_gap_findings WHERE run_id = :r "
                              "AND gap_type = 's4_load'"), {"r": seeded["rid"]}).fetchall()
        gap_summary = c.execute(text("SELECT gap_summary FROM migration_runs WHERE id = :r"),
                                {"r": seeded["rid"]}).scalar()

    assert len(rows) == 2
    assert all(d.startswith("S4L-MM-MATNR-ALPHA") for _, d in rows)
    assert gap_summary["material_master"]["verdict"] == "no-go"
    assert gap_summary["material_master"]["mode"] == "s4_dry_run"
    assert gap_summary["material_master"]["s4_load"]["S4L-MM-MATNR-ALPHA"] == 2

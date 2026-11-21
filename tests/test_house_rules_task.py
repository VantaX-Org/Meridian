"""Mining task: wires frames_for (dataset bundling + parent-code joins) and upsert_rows
(JSON-ready proposal rows) for the house_rules Celery task."""
import pandas as pd

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle
from checks.house_rules import Proposal
from sap.ddic import get_dictionary
from workers.tasks.mining import house_rules as task


def test_bundle_child_chunks_carry_parent_codes(monkeypatch):
    # MARA needs enough rows for MTART (k=2) to clear the candidate cardinality-share
    # filter (<=20% of filled rows); MAKTX stays unique per row so it never qualifies.
    matnrs = [str(i) for i in range(1, 11)]
    mtarts = ["ROH", "FERT", "ROH", "ROH", "ROH", "ROH", "ROH", "ROH", "ROH", "FERT"]
    mara = pd.DataFrame({"MATNR": matnrs, "MTART": mtarts, "MAKTX": [f"text{i}" for i in matnrs]})
    marc = pd.DataFrame({"MATNR": ["1", "1", "2"], "WERKS": ["1000", "2000", "1000"], "BESKZ": ["F", "F", "E"]})
    objects = {"b/MARA.parquet": mara, "b/MARC.parquet": marc}

    def fake_chunks(path, keep=None, chunk_rows=0):
        df = objects[path]
        yield df[[c for c in df.columns if keep is None or keep(c)]]

    monkeypatch.setattr(task, "iter_parquet_chunks", fake_chunks)
    frames = {name: (list(chunks), keys) for name, chunks, keys in
              task.frames_for("b/", ["MARA", "MARC"], get_dictionary("s4hana"))}
    marc_chunk = frames["MARC"][0][0]
    assert marc_chunk["MARA.MTART"].astype(str).tolist() == ["ROH", "ROH", "FERT"]
    assert "MARA.MAKTX" not in marc_chunk                   # free text never joined
    assert frames["MARC"][1] == ["MARC.MATNR", "MARC.WERKS"]


def test_upsert_rows_are_json_ready():
    p = Proposal("dependency", "MARC.BESKZ", "MARA.MTART", {"check_class": "dependency_check"}, 0.99, 1000, 10,
                 ("MATNR=1",))
    (row,) = task.upsert_rows([p], "material_master", "v1", "t1")
    assert row["fingerprint"] == p.fingerprint and row["table_name"] == "MARC"
    assert row["sample_keys"] == '["MATNR=1"]' and row["body"] == '{"check_class": "dependency_check"}'


def test_parent_without_join_keys_is_skipped_not_crashed(monkeypatch):
    # Prod 2026-11-20: a parent table missing its join key made pd.concat([]) raise
    # "No objects to concatenate" and killed the whole mining task.
    mara = pd.DataFrame({"MTART": ["ROH"] * 9 + ["FERT"]})
    marc = pd.DataFrame({"MATNR": ["1"], "WERKS": ["1000"], "BESKZ": ["F"]})
    objects = {"b/MARA.parquet": mara, "b/MARC.parquet": marc}

    def fake_chunks(path, keep=None, chunk_rows=0):
        df = objects[path]
        cols = [c for c in df.columns if keep is None or keep(c)]
        if cols:
            yield df[cols]

    monkeypatch.setattr(task, "iter_parquet_chunks", fake_chunks)
    frames = {name: list(chunks) for name, chunks, _ in
              task.frames_for("b/", ["MARA", "MARC"], get_dictionary("s4hana"))}
    assert frames["MARC"][0].columns.tolist() == ["MARC.MATNR", "MARC.WERKS", "MARC.BESKZ"]


def test_parent_with_qualified_columns_still_joins(monkeypatch):
    matnrs = [str(i) for i in range(1, 11)]
    mara = pd.DataFrame({"MARA.MATNR": matnrs, "MARA.MTART": ["ROH"] * 8 + ["FERT", "FERT"]})
    marc = pd.DataFrame({"MATNR": ["9"], "WERKS": ["1000"], "BESKZ": ["F"]})
    objects = {"b/MARA.parquet": mara, "b/MARC.parquet": marc}

    def fake_chunks(path, keep=None, chunk_rows=0):
        df = objects[path]
        yield df[[c for c in df.columns if keep is None or keep(c)]]

    monkeypatch.setattr(task, "iter_parquet_chunks", fake_chunks)
    frames = {name: list(chunks) for name, chunks, _ in
              task.frames_for("b/", ["MARA", "MARC"], get_dictionary("s4hana"))}
    assert frames["MARC"][0]["MARA.MTART"].astype(str).tolist() == ["FERT"]

"""Runs are numbered within their lineage and linked to the run they repeat.

A re-run already created a new analysis_versions row, but two runs of the same objects on one day
were distinguishable only by the clock, and every run shipped with a NULL label so the picker fell
back to the object list. Version identity is what makes a re-run pickable.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "db" / "migrations" / "versions" / "093_run_identity.py").read_text(encoding="utf-8")
SCHEMA = (ROOT / "db" / "schema.py").read_text(encoding="utf-8")
INSERT = (ROOT / "workers" / "tasks" / "run_extraction.py").read_text(encoding="utf-8")
API = (ROOT / "api" / "routes" / "versions.py").read_text(encoding="utf-8")


def test_the_migration_adds_and_backfills_identity():
    assert 'revision: str = "093"' in MIGRATION
    assert "run_number" in MIGRATION and "parent_version_id" in MIGRATION
    assert "ROW_NUMBER() OVER" in MIGRATION, "existing runs are numbered per lineage"
    assert "LAG(id) OVER" in MIGRATION, "and linked to the run they repeat"
    assert "ON DELETE SET NULL" in MIGRATION, "deleting a parent must not cascade"


def test_the_model_matches_the_migration():
    assert "run_number = Column(Integer" in SCHEMA
    assert 'ForeignKey("analysis_versions.id"' in SCHEMA


def test_a_new_run_is_numbered_at_creation():
    assert "run_number, parent_version_id" in INSERT
    assert "max(run_number)" in INSERT, "next number within the lineage"
    assert "ORDER BY run_at DESC, id DESC LIMIT 1" in INSERT, "parent is the previous matching run"


def test_the_api_returns_identity():
    assert "run_number: Optional[int]" in API
    assert "parent_version_id: Optional[str]" in API

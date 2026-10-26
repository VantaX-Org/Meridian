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

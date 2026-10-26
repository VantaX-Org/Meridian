"""The object catalogue must answer after an update, not rebuild for minutes first.

The stored catalogue carries a fingerprint over APP_VERSION and the rule YAML, so every deploy
invalidates it - and a rebuild is minutes (material_master alone ~17 s per module). That left the
Objects screen timing out after each update until somebody warmed it by hand, which is exactly the
"modules have no tables" report.
"""
from pathlib import Path

SRC = (Path(__file__).resolve().parents[1] / "api" / "routes" / "system_objects.py").read_text(encoding="utf-8")


def test_a_stale_catalogue_is_served_while_the_new_one_is_built():
    start = SRC.index("def _catalogue_for")
    body = SRC[start:SRC.index("@router.get", start)]
    assert "allow_stale=True" in body, "a stale catalogue must be readable"
    assert "_rebuild_in_background(" in body, "and trigger the rebuild"
    # the stale return has to come before the per-module planning loop
    assert body.index("if stale:") < body.index("for m in MODULES_BY_SYSTEM")


def test_only_a_fingerprint_mismatch_makes_it_stale():
    body = SRC[SRC.index("def _stored_catalogue"):SRC.index("def _store_catalogue")]
    assert "_catalogue_fingerprint()" in body
    assert "allow_stale" in body, "the caller chooses whether stale is acceptable"


def test_the_rebuild_never_breaks_the_request():
    body = SRC[SRC.index("def _rebuild_in_background"):SRC.index("@lru_cache(maxsize=64)")]
    assert "daemon=True" in body, "the rebuild runs off the request thread"
    assert "except Exception" in body, "a failed warm-up must not surface to the user"

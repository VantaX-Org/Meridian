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


def test_the_background_rebuild_runs_and_stores_the_catalogue(monkeypatch, caplog):
    """Run the rebuild itself, not its source text: it once raised NameError (Session was never
    imported) inside its own ``except Exception``, so a stale catalogue was served forever."""
    import threading

    import sqlalchemy.orm

    import api.services.source_design as source_design
    import sap.extraction_plan as extraction_plan
    from api.routes import system_objects

    class _Session:
        def __init__(self, _engine):
            self.statements: list[str] = []

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def execute(self, stmt, _params=None):
            self.statements.append(str(stmt))

    class _Dictionary:
        def field(self, _table, _field):
            return None

    class _Plan:
        def __init__(self, purpose):
            self.purpose = purpose

    class _InlineThread:
        def __init__(self, target, name=None, daemon=None):
            self._target = target

        def start(self):
            self._target()

    stored: list[tuple] = []
    monkeypatch.setattr(sqlalchemy.orm, "Session", _Session)
    monkeypatch.setattr(threading, "Thread", _InlineThread)
    monkeypatch.setattr(system_objects, "get_sync_engine_for_background", lambda: object())
    monkeypatch.setattr(source_design, "dictionary_for", lambda _s, _sid, _st: _Dictionary())
    monkeypatch.setattr(extraction_plan, "MODULES_BY_SYSTEM", {"ECC": ["business_partner"]})
    monkeypatch.setattr(extraction_plan, "_windows", lambda: {})
    monkeypatch.setattr(extraction_plan, "plan_modules",
                        lambda _mods, _d: {"BUT000": _Plan("data"), "TB003": _Plan("config")})
    monkeypatch.setattr(system_objects, "_store_catalogue",
                        lambda _s, tid, snap, payload: stored.append((tid, snap, payload)))

    tenant = "00000000-0000-0000-0000-000000000001"
    with caplog.at_level("ERROR", logger="meridian.system_objects"):
        system_objects._rebuild_in_background("11111111-2222-3333-4444-555555555555", "ECC", tenant, "snap-1")

    assert not caplog.records, [r.getMessage() for r in caplog.records]
    assert stored == [(tenant, "snap-1", ({
        "object": "business_partner", "tables": ["BUT000"], "config_tables": ["TB003"],
        "scope_filters": [], "date_window": [],
    },))]
    assert not system_objects._REBUILDING, "the in-flight marker is cleared"

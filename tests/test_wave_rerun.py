"""run_checks completion re-runs every open wave sourced from the analysed system."""

import uuid

from workers.tasks import run_checks


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Wave:
    def __init__(self, modules, target=None):
        self.id = uuid.uuid4()
        self.modules = modules
        self.target_system_id = target
        self.target_release = "s4hana"


class _Session:
    def __init__(self, waves):
        self.waves = waves
        self.sql: list[tuple[str, dict]] = []

    def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params or {}))
        return _Rows(self.waves if "FROM migration_waves" in str(stmt) else [])

    def commit(self):
        pass


def test_enqueues_one_run_per_open_wave(monkeypatch):
    calls = []

    class _T:
        id = "task"

    monkeypatch.setattr("workers.tasks.run_migration.run_migration.delay", lambda *a: calls.append(a) or _T())
    target = uuid.uuid4()
    s = _Session([_Wave(["material_master"], target), _Wave(["fi_gl"])])
    assert run_checks.enqueue_wave_reruns(s, "t1", "sys1", "v9") == 2
    select = next(q for q, _ in s.sql if "FROM migration_waves" in q)
    assert "signed_off_at IS NULL" in select and "source_system_id" in select
    assert [c[2:] for c in calls] == [
        ("source_to_destination", "sys1", str(target), ["material_master"], "v9", "s4hana"),
        ("source_to_destination", "sys1", None, ["fi_gl"], "v9", "s4hana"),
    ]
    inserts = [p for q, p in s.sql if "INSERT INTO migration_runs" in q]
    assert [p["wid"] for p in inserts] == [str(w.id) for w in s.waves]


def test_upload_without_system_enqueues_nothing(monkeypatch):
    monkeypatch.setattr("workers.tasks.run_migration.run_migration.delay",
                        lambda *a: (_ for _ in ()).throw(AssertionError("must not enqueue")))
    assert run_checks.enqueue_wave_reruns(_Session([]), "t1", None, "v9") == 0

"""Migration 070 chains from 068 and the system update accepts a go-live date."""

import importlib.util
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_070_follows_068():
    path = ROOT / "db" / "migrations" / "versions" / "070_finding_root_causes.py"
    spec = importlib.util.spec_from_file_location("m070", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (mod.revision, mod.down_revision) == ("070", "068")


def test_system_update_takes_go_live():
    from api.routes.systems import UpdateSystemRequest

    assert UpdateSystemRequest(go_live="2016-01-01").go_live == date(2016, 1, 1)

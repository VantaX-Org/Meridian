"""Per-module checkpoints of the run_checks task against a real Postgres (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
The rule engine is replaced by a fake that yields fixed results per module; everything
else (checkpoint, findings upsert, streamed finding_records, scoring, partial status,
resume) is the task's own code.

  run 1  material_master completes, accounts_payable hits the soft time limit mid-module
         → version partial, material_master's findings and records kept
  run 2  resumes: material_master is not re-run, accounts_payable is; no duplicates
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import Engine, text

from checks.base import CheckResult
from checks.frames import TableFrames
from sap.ddic import get_dictionary

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_ckpt_app"
MATNR = [f"{i:018d}" for i in range(1, 7)]
LIFNR = [f"{i:010d}" for i in range(1, 5)]

# module -> [(check_id, field, grain, failing keys)]
RULES: dict[str, list[tuple[str, str, str, list[str]]]] = {
    "material_master": [
        ("CKPT-MM-1", "MARA.MTART", "MARA", [f"MATNR={m}" for m in MATNR[:2]]),
        ("CKPT-MM-2", "MARA.MEINS", "MARA", [f"MATNR={m}" for m in MATNR[1:4]]),
        ("CKPT-MM-3", "MARA.MATKL", "MARA", []),
    ],
    "accounts_payable": [
        ("CKPT-AP-1", "LFA1.NAME1", "LFA1", [f"LIFNR={v}" for v in LIFNR[:1]]),
        ("CKPT-AP-2", "LFA1.LAND1", "LFA1", [f"LIFNR={v}" for v in LIFNR[:3]]),
    ],
}
MODULES = list(RULES)
EXPECTED_RECORDS = sum(len(keys) for rules in RULES.values() for *_, keys in rules)


@pytest.fixture(scope="module")
def engines() -> Iterator[tuple[Engine, Engine]]:
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True, check=False,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {ROLE}"))
    owner.dispose()


def _frames() -> TableFrames:
    return TableFrames({"MARA": pd.DataFrame({"MARA.MATNR": MATNR, "MARA.MTART": ["FERT"] * len(MATNR)}),
                        "LFA1": pd.DataFrame({"LFA1.LIFNR": LIFNR, "LFA1.NAME1": ["x"] * len(LIFNR)})},
                       get_dictionary("s4hana"))


def _result(module: str, check_id: str, field: str, grain: str, keys: list[str]) -> CheckResult:
    total = len(MATNR) if grain == "MARA" else len(LIFNR)
    r = CheckResult(check_id=check_id, module=module, field=field, severity="high", dimension="validity",
                    passed=not keys, affected_count=len(keys), total_count=total,
                    pass_rate=round((total - len(keys)) / total * 100, 2), message="",
                    details={"record_key_fields": [f"{grain}.{'MATNR' if grain == 'MARA' else 'LIFNR'}"]},
                    failing_record_keys=list(keys), failing_record_values=[{field: "v"} for _ in keys], grain=grain)
    r._all_failing_keys = pd.Series(keys, dtype="string")
    return r


class FakeRules:
    """Stands in for checks.runner.run_checks: yields RULES[module] through on_result like the
    runner, and raises the soft time limit after the first rule of ``stop_in``."""

    def __init__(self, stop_in: str | None = None) -> None:
        self.stop_in = stop_in
        self.ran: list[str] = []
        self.seen: list[CheckResult] = []

    def __call__(self, module: str, frames: TableFrames, tenant_id: str, *,
                 on_result: Callable[[CheckResult], None], stats: dict[str, int],
                 **_: object) -> list[CheckResult]:
        self.ran.append(module)
        out = []
        for i, (cid, field, grain, keys) in enumerate(RULES[module]):
            if module == self.stop_in and i == 1:
                raise SoftTimeLimitExceeded()
            r = _result(module, cid, field, grain, keys)
            on_result(r)
            r._all_failing_keys = None
            self.seen.append(r)
            out.append(r)
        return out


def _run(app: Engine, tid: str, vid: str, rules: FakeRules) -> None:
    from workers.tasks import run_checks as mod

    with ExitStack() as st:
        st.enter_context(patch.object(mod, "get_sync_engine", return_value=app))
        st.enter_context(patch.object(mod, "record_step"))
        st.enter_context(patch.object(mod, "update_task_progress"))
        st.enter_context(patch.object(mod, "_redis_client", return_value=None))
        st.enter_context(patch.object(mod.run_checks, "update_state", MagicMock()))
        st.enter_context(patch("workers.dataset.load_dataset", return_value=(_frames(), None, 10, 4)))
        st.enter_context(patch("checks.runner.run_checks", rules))
        st.enter_context(patch("checks.outliers.find", return_value={}))
        st.enter_context(patch("api.services.field_profiles.profile_and_store", return_value={}))
        st.enter_context(patch("checks.ztables.discover_ztable_rules", return_value=[]))
        st.enter_context(patch("checks.ddic_conformance.run_conformance", return_value=[]))
        st.enter_context(patch("celery.app.task.Task.apply_async", MagicMock()))
        st.enter_context(patch.dict(os.environ, {"SKIP_AGENTS": "1", "SKIP_AI_ENRICHMENT": "1"}))
        mod.run_checks.run(vid, tid, "/data/ckpt.parquet", reanalyse=True)


def _version(owner: Engine, vid: str) -> tuple[str, dict, dict]:
    with owner.begin() as c:
        row = c.execute(text("SELECT status, dqs_summary, metadata FROM analysis_versions WHERE id = :v"),
                        {"v": vid}).one()
    return row.status, row.dqs_summary or {}, row.metadata or {}


def _stored(owner: Engine, vid: str) -> tuple[dict[str, int], dict[str, int]]:
    with owner.begin() as c:
        findings = dict(c.execute(text("SELECT check_id, count(*) FROM findings WHERE version_id = :v "
                                       "GROUP BY check_id"), {"v": vid}).fetchall())
        records = dict(c.execute(text("SELECT check_id, count(*) FROM finding_records WHERE version_id = :v "
                                      "GROUP BY check_id"), {"v": vid}).fetchall())
    return findings, records


def test_timeout_leaves_partial_version_and_rerun_resumes_without_duplicates(engines: tuple[Engine, Engine]) -> None:
    owner, app = engines
    tid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Checkpoint')"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'pending', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"modules": MODULES})})

    first = FakeRules(stop_in="accounts_payable")
    with pytest.raises(SoftTimeLimitExceeded):
        _run(app, tid, vid, first)

    status, dqs, meta = _version(owner, vid)
    assert status == "partial"
    assert meta["checks_partial"]["completed"] == ["material_master"]
    assert meta["checks_partial"]["missing"] == ["accounts_payable"]
    assert dqs["accounts_payable"]["missing"] is True and dqs["accounts_payable"]["composite_score"] is None
    assert dqs["material_master"]["composite_score"] is not None
    assert "material_master" in meta["checks_checkpoint"]["modules"]
    findings, records = _stored(owner, vid)
    assert set(findings) == {"CKPT-MM-1", "CKPT-MM-2", "CKPT-MM-3"}  # nothing of the unfinished module
    assert records["CKPT-MM-1"] == 2 and records["CKPT-MM-2"] == 3
    assert records.get("CKPT-AP-1") == 1  # streamed before the limit hit; the rerun replaces it

    second = FakeRules()
    _run(app, tid, vid, second)

    assert second.ran == ["accounts_payable"]  # the checkpointed module is not run again
    status, dqs, meta = _version(owner, vid)
    assert status == "complete"
    assert "checks_checkpoint" not in meta and "checks_partial" not in meta
    assert dqs["material_master"]["composite_score"] is not None
    assert dqs["accounts_payable"]["composite_score"] is not None and "missing" not in dqs["accounts_payable"]
    findings, records = _stored(owner, vid)
    assert findings == {cid: 1 for rules in RULES.values() for cid, *_ in rules}
    assert sum(records.values()) == EXPECTED_RECORDS
    with owner.begin() as c:  # the issue lifecycle saw the resumed module's records too
        issues = c.execute(text("SELECT count(*) FROM record_issues WHERE tenant_id = :t"), {"t": tid}).scalar()
    assert issues == EXPECTED_RECORDS

    # memory cap: no result keeps its record values or (outside record-level suppressions) its keys
    assert first.seen and second.seen
    assert all(r.failing_record_values is None and not r.failing_record_keys for r in first.seen + second.seen)

    # a third run of the same version after completion starts over (no checkpoint): same rows again,
    # and records of a check that no longer fails go at the end
    with owner.begin() as c:
        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key) "
                       "VALUES (:t, :v, 'CKPT-MM-3', 'material_master', 'MARA', 'MATNR=stale')"), {"t": tid, "v": vid})
    third = FakeRules()
    _run(app, tid, vid, third)
    assert third.ran == MODULES
    assert _stored(owner, vid) == (findings, records)

    # a fourth run dies before its first checkpoint: the complete run's records stay browsable
    fourth = FakeRules(stop_in="material_master")
    with pytest.raises(SoftTimeLimitExceeded):
        _run(app, tid, vid, fourth)
    assert _stored(owner, vid)[1] == records

    # a changed cost model starts over rather than resuming the checkpoint
    fifth = FakeRules(stop_in="accounts_payable")
    with pytest.raises(SoftTimeLimitExceeded):
        _run(app, tid, vid, fifth)
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET cost_model = CAST(:c AS jsonb) WHERE id = :t"),
                  {"t": tid, "c": json.dumps({"currency": "EUR"})})
    sixth = FakeRules()
    _run(app, tid, vid, sixth)
    assert sixth.ran == MODULES
    assert _stored(owner, vid) == (findings, records)

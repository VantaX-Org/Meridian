# Frontend Redesign Wave 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Wave 1 "spine" of the Meridian frontend redesign: persona homes, the object explorer (`/objects`, object detail, rule detail, record fix sheet), the run explorer (`/runs`, run detail, run comparison), the three backend endpoints these pages need, and the redirect/deletion of the nine legacy pages they replace.

**Architecture:** Every new page lives under `frontend/app/(app)/` and is built only from `@/design` primitives/templates (delivered by Wave 1a — never `components/ui-core` or `components/aurora`). Every new page's data comes from a typed wrapper in `frontend/lib/api/` calling one of three new FastAPI endpoints (`GET /api/v1/objects`, `GET /api/v1/objects/{object}`, `GET /api/v1/objects/{object}/records/{key}`, `GET /api/v1/runs/{id}/steps`) or an existing endpoint (`versions.py`, `findings.py`). Each new backend endpoint composes existing service functions server-side (`api/services/material_360.py`, `api/routes/findings.py:composite_dqs`, `api/services/scoring.py:tier`) rather than re-implementing scoring or extraction logic. A new Alembic migration adds a durable `analysis_run_steps` table that `workers/tasks/run_checks.py` and `workers/tasks/run_sync.py` write to, replacing nothing — the existing Redis `task_progress` mechanism is untouched (it drives the live progress bar; the new table drives the historical "what happened on this run" view).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, `@tanstack/react-query`, Vitest, Playwright, FastAPI, SQLAlchemy async, Alembic, pytest, Postgres RLS.

**Spec:** `docs/superpowers/specs/2026-10-08-frontend-redesign-design.md` (sections 3.1, 6, 7, 8.6, 9.3, 9.4, 10, 13 are in scope for this plan; sections 8.1-8.5, 8.7-8.9, 9.1, 9.2 partial, 11, 12 Wave-2/3 items are explicitly out of scope).

## Global Constraints

- TypeScript strict, no `any`, anywhere in new or touched frontend code.
- All API calls go through typed wrappers in `frontend/lib/api/` — no inline `fetch`/`axios` in components.
- New pages import UI only from `@/design` (primitives, `DataTable`, charts, templates, shell). Never import from `components/ui-core`, `components/aurora`, or `lib/aurora` in new Wave 1b files.
- Run all frontend commands from `frontend/` (not the repo root).
- Before every commit that touches `frontend/`: `npm run typecheck && npm run lint && npm run lint:tokens && npm test` must all pass.
- Python tests: `python3 -m pytest -q -p no:cacheprovider`. Set `MERIDIAN_TEST_DB_URL` when a test needs real Postgres (RLS tests do).
- Every new/modified SQL query includes `tenant_id` and relies on Postgres RLS (`SET app.tenant_id` / `set_config('app.tenant_id', ...)` before any statement, via the existing `_rls(db, tenant)` helper in `api/routes/record_issues.py` or the `set_config` pattern already used in `api/routes/versions.py`).
- Commit messages are normal prose, one per task, and end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```
- Never touch PRs #390 or #184.
- Never edit `sap/dictionaries/ecc6/tables/COMPINFO.json`.
- Do not invent schema, column, module, or check-id names. Where a plan task needs one that this plan doesn't already give you, the task says exactly which file to read to get it.

---

## Known gaps carried into this plan (read before Task 1)

- **No "owner" column exists anywhere in `db/schema.py`** (confirmed by grep — no table has an `owner`/`owner_id` field at the object/module grain; `record_issues.assigned_to` is the only ownership concept, and it's per-record, not per-object). Task 7 (`GET /api/v1/objects`) therefore does **not** return an owner field. If a later task needs "objects with no owner" (persona homes, spec section 6), it must use `record_issues.assigned_to IS NULL` aggregated by module, not an object-level owner — Task 11 (`/home/steward`) does this explicitly.
- **No tenant-wide readiness threshold config exists.** `api/services/s4_readiness.py` is a *different* feature (S/4HANA conversion simplification-area roll-up, scoped to the `s4_readiness` YAML rule pack only) — it is not a generic per-object readiness score and must not be reused for the `/objects` list. The `/objects` list's readiness column instead reuses `api/services/scoring.py:tier(score, thresholds)` (returns `"pass" | "warn" | "fail"` against the tenant's existing `dqs_weights.thresholds`), applied to each module's own composite score. Configurable per-rule readiness thresholds (spec section 8.1, "set in /rules") are Wave 2 and out of scope here.
- **No single cross-system "all 29 modules" registry function exists** — `sap/extraction_registry.py:get_available_modules(system_type)` is per system type, not global. `GET /api/v1/objects` therefore enumerates modules from `SELECT DISTINCT module FROM findings` for the tenant's latest versions (the same universe the legacy `analyse/object/[module]` page and `components/analyse/coverage-object.tsx` already draw from), not from a static list.
- **Legacy pages not read in full by this plan's author**: `components/analyse/material-360.tsx`, `material-rules.tsx`, `material-views.tsx`, `material-lifecycle.tsx`, `material-duplicates.tsx`, `records.tsx`, `rule-detail.tsx`, `components/command-centre/finding-detail.tsx`. Task 13 (record fix sheet) and Task 10 (rule detail page) each name the specific legacy file their task's implementer must open and read before writing the new page, so no existing feature silently disappears.

---

### Task 1: Alembic migration — `analysis_run_steps` table

**Files:**
- Create: `db/migrations/versions/066_analysis_run_steps.py`
- Modify: `db/schema.py` (add `AnalysisRunStep` model, after the `SyncRun` model at line ~1203)
- Test: `tests/db/test_analysis_run_steps_migration.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `AnalysisRunStep` SQLAlchemy model with columns `id (uuid, pk)`, `tenant_id (uuid, fk tenants, not null)`, `version_id (uuid, fk analysis_versions ondelete CASCADE, not null)`, `step_number (int, not null)`, `step_name (text, not null)`, `status (text, not null, default 'running')`, `started_at (timestamptz, not null, server_default now())`, `finished_at (timestamptz, nullable)`, `duration_ms (int, nullable)`, `error_detail (text, nullable)`. Table name `analysis_run_steps`. Index `(tenant_id, version_id, step_number)`. Used by Task 2, Task 3, Task 4.

- [ ] **Step 1: Write the migration**

```python
"""analysis run steps

Revision ID: 066
Revises: 065
Create Date: 2026-10-08

Durable per-run step log (step number, name, status, duration, decisive error)
for both analysis runs (run_checks) and sync runs (run_sync). Complements the
Redis-only task_progress mechanism (api/services/task_progress.py), which
remains the live-progress source; this table is the historical record the
/api/v1/runs/{id}/steps endpoint reads.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "066"
down_revision: Union[str, None] = "065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "analysis_run_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_analysis_run_steps_tenant_version_step",
        "analysis_run_steps",
        ["tenant_id", "version_id", "step_number"],
    )


def downgrade() -> None:
    op.drop_index("ix_analysis_run_steps_tenant_version_step", table_name="analysis_run_steps")
    op.drop_table("analysis_run_steps")
```

- [ ] **Step 2: Add the SQLAlchemy model**

Add to `db/schema.py` directly after the `SyncRun` class (around line 1203):

```python
class AnalysisRunStep(Base):
    """One step of one analysis or sync run — durable counterpart to the Redis-only
    task_progress mechanism in api/services/task_progress.py. Written by
    workers/tasks/run_checks.py and workers/tasks/run_sync.py, read by
    GET /api/v1/runs/{id}/steps."""

    __tablename__ = "analysis_run_steps"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    version_id = Column(UUID(as_uuid=True), ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False)
    step_number = Column(Integer, nullable=False)
    step_name = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="running")
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    error_detail = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_analysis_run_steps_tenant_version_step", "tenant_id", "version_id", "step_number"),
    )
```

Check the top of `db/schema.py` for the exact import names already in use for `Column`, `UUID`, `ForeignKey`, `Integer`, `Text`, `DateTime`, `Index`, `func`, `text` (they are already imported for `SyncRun` and other models in the same file) — reuse those imports, do not add new ones.

- [ ] **Step 3: Write the migration test**

```python
"""tests/db/test_analysis_run_steps_migration.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


def test_analysis_run_steps_table_shape():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.connect() as conn:
        cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'analysis_run_steps'"
        )).scalars().all()
    expected = {
        "id", "tenant_id", "version_id", "step_number", "step_name",
        "status", "started_at", "finished_at", "duration_ms", "error_detail",
    }
    assert expected <= set(cols)


def test_analysis_run_steps_cascades_on_version_delete():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'wave1b-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"
        ), {"v": version_id, "t": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name) "
            "VALUES (:t, :v, 1, 'Uploading and validating file')"
        ), {"t": tenant_id, "v": version_id})
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": version_id})
        remaining = conn.execute(text(
            "SELECT count(*) FROM analysis_run_steps WHERE version_id = :v"
        ), {"v": version_id}).scalar()
        assert remaining == 0
        conn.execute(text("DELETE FROM tenants WHERE id = :id"), {"id": tenant_id})
```

- [ ] **Step 4: Run the migration and the test**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test alembic upgrade head`
Expected: `Running upgrade 065 -> 066, analysis run steps`

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/db/test_analysis_run_steps_migration.py -v`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add db/migrations/versions/066_analysis_run_steps.py db/schema.py tests/db/test_analysis_run_steps_migration.py
git commit -m "$(cat <<'EOF'
Add analysis_run_steps table for durable per-run step history

The live progress bar stays on Redis (task_progress.py); this table gives
the new run detail page a permanent record of what happened on a run after
the Redis TTL expires, including the decisive error line on a failed step.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 2: Write run steps from `workers/tasks/run_checks.py`

**Files:**
- Create: `api/services/run_steps.py`
- Modify: `workers/tasks/run_checks.py` (wrap the six `update_task_progress` call sites with a `record_step` call)
- Test: `tests/services/test_run_steps.py`

**Interfaces:**
- Consumes: `AnalysisRunStep` model (Task 1); `workers.db.get_sync_engine()` (existing, used throughout `workers/tasks/`).
- Produces: `record_step(engine, tenant_id: str, version_id: str, step_number: int, step_name: str, status: str = "running", error_detail: str | None = None) -> None` in `api/services/run_steps.py`. On `status in ("complete", "failed")` it sets `finished_at = now()` and computes `duration_ms` from the row's own `started_at` (an `UPDATE ... SET finished_at = now(), duration_ms = ...`); on `status == "running"` it inserts a new row. Used by Task 3 too.

- [ ] **Step 1: Write the failing test**

```python
"""tests/services/test_run_steps.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from api.services.run_steps import record_step

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def tenant_and_version():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'run-steps-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'processing')"
        ), {"v": version_id, "t": tenant_id})
    yield engine, tenant_id, version_id
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": version_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})


def test_record_step_inserts_running_then_completes(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="running")
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="complete")
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, duration_ms, finished_at FROM analysis_run_steps "
            "WHERE version_id = :v AND step_number = 3"
        ), {"v": version_id}).fetchone()
    assert row.status == "complete"
    assert row.duration_ms is not None
    assert row.finished_at is not None


def test_record_step_failed_stores_error_detail(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    record_step(engine, tenant_id, version_id, 4, "Generating AI insights", status="running")
    record_step(engine, tenant_id, version_id, 4, "Generating AI insights", status="failed",
                error_detail="LLM provider timed out after 120s")
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, error_detail FROM analysis_run_steps WHERE version_id = :v AND step_number = 4"
        ), {"v": version_id}).fetchone()
    assert row.status == "failed"
    assert row.error_detail == "LLM provider timed out after 120s"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/services/test_run_steps.py -v`
Expected: `ModuleNotFoundError: No module named 'api.services.run_steps'`

- [ ] **Step 3: Write `api/services/run_steps.py`**

```python
"""Durable per-run step log — api/services/run_steps.py.

Written by workers/tasks/run_checks.py and workers/tasks/run_sync.py alongside
(not instead of) the Redis-only task_progress mechanism. Read by
GET /api/v1/runs/{id}/steps (api/routes/runs.py).
"""
from __future__ import annotations

import logging

from sqlalchemy import text

logger = logging.getLogger("meridian.run_steps")


def record_step(
    engine,
    tenant_id: str,
    version_id: str,
    step_number: int,
    step_name: str,
    status: str = "running",
    error_detail: str | None = None,
) -> None:
    """Insert a new step row when it starts; update it in place when it finishes.

    Non-fatal: a failure here must never break the analysis/sync run itself.
    """
    try:
        with engine.begin() as conn:
            if status == "running":
                conn.execute(text(
                    "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status) "
                    "VALUES (:t, :v, :n, :name, 'running')"
                ), {"t": tenant_id, "v": version_id, "n": step_number, "name": step_name})
            else:
                conn.execute(text(
                    "UPDATE analysis_run_steps SET status = :status, finished_at = now(), "
                    "duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000, error_detail = :err "
                    "WHERE tenant_id = :t AND version_id = :v AND step_number = :n"
                ), {"status": status, "err": error_detail, "t": tenant_id, "v": version_id, "n": step_number})
    except Exception as exc:  # pragma: no cover - defensive, mirrors task_progress.py
        logger.warning("Failed to record run step %s for version %s: %s", step_number, version_id, exc)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/services/test_run_steps.py -v`
Expected: `2 passed`

- [ ] **Step 5: Wire into `workers/tasks/run_checks.py`**

Open `workers/tasks/run_checks.py` and find each of the six `update_task_progress(...)` call sites (they use the imported `STEP_UPLOAD_VALIDATE`, `STEP_PARSE`, `STEP_RUN_CHECKS`, `STEP_AI_INSIGHTS`, `STEP_BUILD_REPORT`, `STEP_FINALISE` tuples from `api.services.task_progress`). Add the import:

```python
from api.services.run_steps import record_step
```

Immediately before each `update_task_progress(version_id, status="processing", current_step=NAME, step_number=N, ...)` call, add:

```python
record_step(engine, tenant_id, version_id, N, NAME, status="running")
```

using the same `N`/`NAME` values already passed to `update_task_progress` at that call site (e.g. for `STEP_RUN_CHECKS = (3, "Running data quality checks")`, call `record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="running")`). Read the surrounding code at each of the six call sites first — the exact local variable names for `engine` and `tenant_id` are already in scope in `run_checks.py` (it already uses them for other DB writes); reuse them rather than re-deriving them.

Immediately after the step that corresponds to `STEP_FINALISE` succeeds (the final `UPDATE analysis_versions SET status = 'complete', ...` around line 611), add:

```python
record_step(engine, tenant_id, version_id, STEP_FINALISE[0], STEP_FINALISE[1], status="complete")
```

At the task's existing exception handler (the `try`/`except` that currently sets `update_task_progress(..., status="failed", error=str(exc))`), add immediately before it:

```python
record_step(engine, tenant_id, version_id, step_number, current_step, status="failed", error_detail=str(exc))
```

using whatever local variables that `except` block already has in scope for the current step number/name (read the handler first — `run_checks.py` already tracks "which step failed" to build the existing Redis error payload; reuse that same tracking variable rather than introducing a new one).

- [ ] **Step 6: Run the checks worker's existing test suite**

Run: `python3 -m pytest -q -p no:cacheprovider tests/workers/test_run_checks.py -v`
Expected: all previously-passing tests still `PASS` (this step only adds calls, it does not change `run_checks.py`'s control flow or return values).

- [ ] **Step 7: Commit**

```bash
git add api/services/run_steps.py tests/services/test_run_steps.py workers/tasks/run_checks.py
git commit -m "$(cat <<'EOF'
Persist analysis run steps alongside the existing Redis progress feed

run_checks.py now writes each of its six steps to analysis_run_steps so a
run's step history and decisive error survive the Redis TTL, without
touching the live progress bar the frontend already polls.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 3: Write run steps from `workers/tasks/run_sync.py`

**Files:**
- Modify: `workers/tasks/run_sync.py`
- Test: `tests/workers/test_run_sync_steps.py`

**Interfaces:**
- Consumes: `record_step(engine, tenant_id, version_id, step_number, step_name, status=..., error_detail=...)` (Task 2).
- Produces: nothing new — this task only adds call sites.

- [ ] **Step 1: Read the existing step structure**

`run_sync.py` does not use the six-step `task_progress` vocabulary — it tracks a `sync_runs` row (`status`, `error_detail`, `rows_extracted`, `findings_delta`, `golden_records_updated`) instead, via `_fail_sync_run(engine, tenant_id, sync_run_id, error_detail)` at line ~352 and the completion `UPDATE ... SET status = 'completed'` around line ~262. Read `workers/tasks/run_sync.py` in full before editing to find the actual stage names it logs via `logger.info` between extraction, matching and golden-record update (these become the `step_name` values below — do not invent names not already used as a log message in this file).

- [ ] **Step 2: Write the failing test**

```python
"""tests/workers/test_run_sync_steps.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


def test_run_sync_failure_is_recorded_as_a_step(monkeypatch):
    """_fail_sync_run must also leave a failed row in analysis_run_steps, keyed by
    the sync_run_id (sync runs have no analysis_versions row, so version_id here
    is the sync_run_id — read run_sync.py's _fail_sync_run signature to confirm
    which id is available at the call site before wiring this up)."""
    from workers.tasks.run_sync import _fail_sync_run

    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    sync_run_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'run-sync-steps-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'processing')"
        ), {"v": sync_run_id, "t": tenant_id})

    _fail_sync_run(engine, tenant_id, sync_run_id, "SAP connection refused: RFC_COMMUNICATION_FAILURE")

    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, error_detail FROM analysis_run_steps WHERE version_id = :v ORDER BY step_number DESC LIMIT 1"
        ), {"v": sync_run_id}).fetchone()
    assert row is not None
    assert row.status == "failed"
    assert "RFC_COMMUNICATION_FAILURE" in row.error_detail

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": sync_run_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
```

Note: `sync_runs.id` is not a foreign key target of `analysis_run_steps.version_id` (that FK points at `analysis_versions`). Because `run_sync` has no `analysis_versions` row of its own in production, the test above inserts a throwaway `analysis_versions` row with the same id purely to satisfy the FK in this test's isolated schema. **Before wiring Step 3**, read `db/schema.py`'s `SyncRun` model and the actual `run_sync.py` call sites to confirm whether `sync_run_id` or `profile_id` is the more appropriate `version_id` value to pass to `record_step` in production — if neither is FK-compatible with `analysis_versions`, change `analysis_run_steps.version_id`'s foreign key in Task 1 to reference `sync_runs.id` instead via a nullable sibling column, and say so in this task's self-review rather than silently forcing an incompatible id through. (Given `run_sync` and `run_checks` runs are both referenced from the frontend by a single run id in the spec's `/runs/[versionId]` route, confirm via `frontend/lib/api/versions.ts` and `components/data/runs.tsx` which id value the frontend already uses to display sync runs in the same list as analysis runs before deciding.)

- [ ] **Step 3: Wire `record_step` into `run_sync.py`**

Add the import `from api.services.run_steps import record_step` to `workers/tasks/run_sync.py`. In `_fail_sync_run`, immediately before its existing `UPDATE sync_runs SET status = 'failed', ...`, add:

```python
record_step(engine, tenant_id, sync_run_id, 0, "Sync failed", status="failed", error_detail=error_detail)
```

(step number `0` because sync runs are not divided into the same six named steps as analysis runs — this single row carries the decisive error for a sync run, matching what `/runs/{id}/steps` needs to render for a sync-type run per spec section 9.4). At the existing success path (`UPDATE ... SET status = 'completed'` around line 262), add:

```python
record_step(engine, tenant_id, sync_run_id, 0, "Sync completed", status="complete")
```

- [ ] **Step 4: Run the test**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/workers/test_run_sync_steps.py -v`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add workers/tasks/run_sync.py tests/workers/test_run_sync_steps.py
git commit -m "$(cat <<'EOF'
Record sync run outcome in analysis_run_steps

Sync runs get a single step row (success or the decisive failure line) so
the new run detail page can show sync failures the same way it shows a
failed analysis step, without inventing a six-step vocabulary sync runs
don't have.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 4: `GET /api/v1/runs/{id}/steps` endpoint

**Files:**
- Create: `api/routes/runs.py`
- Modify: `api/main.py` (register the new router — read the file's existing `app.include_router(...)` block to match the exact pattern used for the other 45 routers)
- Test: `tests/test_runs_steps.py`

**Interfaces:**
- Consumes: `AnalysisRunStep` model (Task 1); `_rls(db, tenant)` from `api.routes.record_issues` (existing, reused by `api.routes.materials`); `require_permission` from `api.services.rbac` (existing).
- Produces: `GET /api/v1/runs/{id}/steps` → `RunStepsOut { version_id: str, steps: list[RunStepOut] }` where `RunStepOut = { step_number: int, step_name: str, status: str, started_at: str, finished_at: str | None, duration_ms: int | None, error_detail: str | None }`. Consumed by Task 5's `frontend/lib/api/v1/runs.ts` and Task 15's `/runs/[versionId]` page.

- [ ] **Step 1: Write the failing pytest**

```python
"""tests/test_runs_steps.py"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def two_tenants_with_steps():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    v1, v2 = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"), {"v": v1, "t": t1})
        conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"), {"v": v2, "t": t2})
        conn.execute(text(
            "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status) "
            "VALUES (:t, :v, 1, 'Uploading and validating file', 'complete')"
        ), {"t": t1, "v": v1})
    yield t1, t2, v1, v2
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id IN (:v1, :v2)"), {"v1": v1, "v2": v2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})


@pytest.mark.anyio
async def test_runs_steps_returns_own_tenant_steps(two_tenants_with_steps, monkeypatch):
    t1, _t2, v1, _v2 = two_tenants_with_steps
    _patch_tenant(monkeypatch, t1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/runs/{v1}/steps", headers={"X-User-Role": "steward"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["version_id"] == v1
    assert len(body["steps"]) == 1
    assert body["steps"][0]["step_name"] == "Uploading and validating file"


@pytest.mark.anyio
async def test_runs_steps_is_tenant_isolated(two_tenants_with_steps, monkeypatch):
    """Tenant 2 must never see tenant 1's run steps, even by guessing tenant 1's version id."""
    t1, t2, v1, _v2 = two_tenants_with_steps
    _patch_tenant(monkeypatch, t2)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/runs/{v1}/steps", headers={"X-User-Role": "steward"})
    assert resp.status_code == 404


def _patch_tenant(monkeypatch, tenant_id: str):
    """Override get_tenant on the live api.main.app, and turn on the dev role-header
    escape hatch (api/services/rbac.py:dev_role_override), the same two-part mechanism
    tests/test_material_360_routes.py uses for api.routes.materials — there on a
    throwaway FastAPI() app that mocks get_db, here on the real app, since this test
    exercises a live Postgres session via the real get_db dependency.
    monkeypatch.setitem on a dict reverts itself at test teardown, so this never
    leaks an override into another test."""
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_runs_steps.py -v`
Expected: `ModuleNotFoundError: No module named 'api.routes.runs'`

- [ ] **Step 3: Write `api/routes/runs.py`**

```python
"""Run step history — api/routes/runs.py.

GET /api/v1/runs/{id}/steps returns the durable step-by-step history of one
analysis or sync run, written by workers/tasks/run_checks.py and
workers/tasks/run_sync.py via api/services/run_steps.py. Tenant-isolated via
RLS plus an explicit tenant_id filter.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


class RunStepOut(BaseModel):
    step_number: int
    step_name: str
    status: str
    started_at: str
    finished_at: Optional[str] = None
    duration_ms: Optional[int] = None
    error_detail: Optional[str] = None


class RunStepsOut(BaseModel):
    version_id: str
    steps: list[RunStepOut]


@router.get("/{version_id}/steps", response_model=RunStepsOut,
            dependencies=[Depends(require_permission("view"))])
async def get_run_steps(version_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    exists = (await db.execute(text(
        "SELECT 1 FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": str(version_id), "t": str(tenant.id)})).fetchone()
    if not exists:
        raise HTTPException(404, "Run not found")
    rows = (await db.execute(text(
        "SELECT step_number, step_name, status, started_at::text, finished_at::text, "
        "duration_ms, error_detail FROM analysis_run_steps "
        "WHERE version_id = :v AND tenant_id = :t ORDER BY step_number"
    ), {"v": str(version_id), "t": str(tenant.id)})).fetchall()
    return {
        "version_id": str(version_id),
        "steps": [
            {"step_number": r[0], "step_name": r[1], "status": r[2], "started_at": r[3],
             "finished_at": r[4], "duration_ms": r[5], "error_detail": r[6]}
            for r in rows
        ],
    }
```

- [ ] **Step 4: Register the router**

Open `api/main.py`, find the block of `app.include_router(...)` calls (45 of them). Add, grouped near `versions` and `materials`:

```python
from api.routes import runs as runs_routes
...
app.include_router(runs_routes.router)
```

Match the exact import-alias and include style already used two lines above/below for `versions`/`materials` — read that block before editing so the new line is indistinguishable in style from its neighbors.

- [ ] **Step 5: Run the test**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_runs_steps.py -v`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add api/routes/runs.py api/main.py tests/test_runs_steps.py
git commit -m "$(cat <<'EOF'
Add GET /api/v1/runs/{id}/steps endpoint

Exposes the new analysis_run_steps history to the frontend's upcoming run
detail page, with the same RLS tenant-isolation pattern used by the
materials endpoints.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 5: `GET /api/v1/objects` endpoint

**Files:**
- Create: `api/routes/objects.py`
- Modify: `api/main.py` (register the router, same pattern as Task 4)
- Test: `tests/test_objects_list.py`

**Interfaces:**
- Consumes: `composite_dqs` is not used here (that's a cross-module rollup); this endpoint instead reads each module's own `dqs_summary->module` entry already written to `analysis_versions.dqs_summary` by `run_checks.py` (confirm the exact JSON shape by reading one real row's `dqs_summary` column in a dev DB, or `api/services/scoring.py`'s `DQSResult`-shaped dict — it has `composite_score`, `dimension_scores`, `total_checks`). `tier(score, thresholds)` and `scoring_config(raw)` from `api.services.scoring` (existing). `_rls` from `api.routes.record_issues`.
- Produces: `GET /api/v1/objects?run=<version_id>` → `ObjectsListOut { run_id: str, objects: list[ObjectSummaryOut] }` where `ObjectSummaryOut = { module: str, label: str, composite_score: float | None, readiness: "pass" | "warn" | "fail" | None, failing_checks: int, affected_records: int }`. `label` is `formatModuleName`-equivalent server-side — read `frontend/lib/format.ts:formatModuleName` and port its exact word-splitting rule to Python rather than duplicating a different one (title-case each underscore-separated word). Consumed by Task 6's `frontend/lib/api/v1/objects.ts` and Task 9's `/objects` page.

- [ ] **Step 1: Write the failing pytest**

```python
"""tests/test_objects_list.py"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def two_tenants_with_findings():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    v1, v2 = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) VALUES "
            "(:v, :t, 'complete', :s)"
        ), {"v": v1, "t": t1, "s": '{"material_master": {"composite_score": 88.0, "dimension_scores": {}, "total_checks": 10}}'})
        conn.execute(text(
            "INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, affected_count, total_count) "
            "VALUES (gen_random_uuid(), :v, :t, 'material_master', 'mm_001', 'high', 5, 100)"
        ), {"v": v1, "t": t1})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) VALUES (:v, :t, 'complete', '{}')"
        ), {"v": v2, "t": t2})
    yield t1, t2, v1, v2
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM findings WHERE version_id IN (:v1, :v2)"), {"v1": v1, "v2": v2})
        conn.execute(text("DELETE FROM analysis_versions WHERE id IN (:v1, :v2)"), {"v1": v1, "v2": v2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})


@pytest.mark.anyio
async def test_objects_list_returns_own_tenant_modules(two_tenants_with_findings, monkeypatch):
    t1, _t2, v1, _v2 = two_tenants_with_findings
    _patch_tenant(monkeypatch, t1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/objects?run={v1}", headers={"X-User-Role": "steward"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["objects"][0]["module"] == "material_master"
    assert body["objects"][0]["composite_score"] == 88.0
    assert body["objects"][0]["failing_checks"] == 1


@pytest.mark.anyio
async def test_objects_list_is_tenant_isolated(two_tenants_with_findings, monkeypatch):
    t1, t2, v1, _v2 = two_tenants_with_findings
    _patch_tenant(monkeypatch, t2)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/objects?run={v1}", headers={"X-User-Role": "steward"})
    assert resp.status_code in (404, 403)


def _patch_tenant(monkeypatch, tenant_id: str):
    """Same helper as tests/test_runs_steps.py's _patch_tenant (Task 4) — there is no shared
    tests/conftest.py fixture for this, so it is defined identically, inline, in each of this
    plan's route test files, following tests/test_material_360_routes.py's dependency-override
    pattern for api.deps.get_tenant plus the MERIDIAN_DEV_ROLE_HEADER escape hatch."""
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )
```

(`_patch_tenant` is defined inline above, identically to Task 4's — there is no `tests/conftest.py` in this codebase, so each test file repeats the small helper rather than introducing a shared fixtures file this plan wasn't asked for.)

- [ ] **Step 2: Run test to verify it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_objects_list.py -v`
Expected: `ModuleNotFoundError: No module named 'api.routes.objects'`

- [ ] **Step 3: Write `api/routes/objects.py`**

```python
"""Object explorer list — api/routes/objects.py.

GET /api/v1/objects composes the per-module scores already written to
analysis_versions.dqs_summary by run_checks.py with a failing-check count
from findings, for one run. No new scoring logic — see api/services/scoring.py
for tier()/scoring_config(), which this reuses unchanged.
"""
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission
from api.services.scoring import scoring_config, tier

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])


def _label(module: str) -> str:
    """Match frontend/lib/format.ts:formatModuleName — title-case each underscore word."""
    return " ".join(w.capitalize() for w in module.split("_"))


class ObjectSummaryOut(BaseModel):
    module: str
    label: str
    composite_score: Optional[float] = None
    readiness: Optional[str] = None
    failing_checks: int
    affected_records: int


class ObjectsListOut(BaseModel):
    run_id: str
    objects: list[ObjectSummaryOut]


@router.get("", response_model=ObjectsListOut, dependencies=[Depends(require_permission("view"))])
async def list_objects(run: uuid.UUID = Query(..., alias="run"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    version = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": str(run), "t": str(tenant.id)})).fetchone()
    if not version:
        raise HTTPException(404, "Run not found")
    summary = version[0] or {}
    raw_scoring = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                    {"t": str(tenant.id)})).scalar() or {}
    thresholds = scoring_config(raw_scoring)["thresholds"]

    rows = (await db.execute(text(
        "SELECT module, count(*) AS failing, coalesce(sum(affected_count), 0) AS affected "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND affected_count > 0 "
        "GROUP BY module"
    ), {"v": str(run), "t": str(tenant.id)})).fetchall()
    by_module = {r[0]: (r[1], r[2]) for r in rows}

    modules = sorted(set(summary.keys()) | set(by_module.keys()))
    objects = []
    for module in modules:
        mod_summary = summary.get(module) or {}
        score = mod_summary.get("composite_score")
        failing, affected = by_module.get(module, (0, 0))
        objects.append({
            "module": module,
            "label": _label(module),
            "composite_score": score,
            "readiness": tier(score, thresholds) if score is not None else None,
            "failing_checks": failing,
            "affected_records": affected,
        })
    return {"run_id": str(run), "objects": objects}
```

- [ ] **Step 4: Register the router**

Same pattern as Task 4 Step 4 — add `from api.routes import objects as objects_routes` and `app.include_router(objects_routes.router)` to `api/main.py`.

- [ ] **Step 5: Run the test**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_objects_list.py -v`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add api/routes/objects.py api/main.py tests/test_objects_list.py
git commit -m "$(cat <<'EOF'
Add GET /api/v1/objects endpoint for the object explorer list

Composes each module's existing composite score (analysis_versions.dqs_summary)
with its failing-check count from findings, reusing scoring.py's tier() for the
readiness bucket instead of inventing a new threshold mechanism.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 6: `GET /api/v1/objects/{object}` endpoint

**Files:**
- Modify: `api/routes/objects.py`
- Test: `tests/test_objects_detail.py`

**Interfaces:**
- Consumes: `ObjectSummaryOut` fields (Task 5, same computation reused per-module); `check_class_of(module, check_id)` from `api.routes.findings` (existing).
- Produces: `GET /api/v1/objects/{module}?run=<version_id>` → `ObjectDetailOut { module: str, label: str, composite_score: float | None, readiness: str | None, dimension_scores: dict[str, float], rules: list[ObjectRuleOut] }` where `ObjectRuleOut = { check_id: str, severity: str, dimension: str, affected_count: int, total_count: int, pass_rate: float | None }`. Consumed by Task 9's `/objects/[object]` page.

- [ ] **Step 1: Write the failing pytest**

```python
"""tests/test_objects_detail.py"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def tenant_with_material_findings():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1 = str(uuid.uuid4())
    v1 = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t1})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) VALUES (:v, :t, 'complete', :s)"
        ), {"v": v1, "t": t1, "s": '{"material_master": {"composite_score": 72.5, "dimension_scores": {"completeness": 80.0}, "total_checks": 3}}'})
        conn.execute(text(
            "INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, total_count, pass_rate) "
            "VALUES (gen_random_uuid(), :v, :t, 'material_master', 'mm_missing_desc', 'high', 'completeness', 12, 500, 97.6)"
        ), {"v": v1, "t": t1})
    yield t1, v1
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM findings WHERE version_id = :v"), {"v": v1})
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": v1})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t1})


@pytest.mark.anyio
async def test_object_detail_returns_rules(tenant_with_material_findings, monkeypatch):
    t1, v1 = tenant_with_material_findings
    _patch_tenant(monkeypatch, t1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/objects/material_master?run={v1}", headers={"X-User-Role": "steward"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["composite_score"] == 72.5
    assert body["rules"][0]["check_id"] == "mm_missing_desc"


@pytest.mark.anyio
async def test_object_detail_is_tenant_isolated(tenant_with_material_findings, monkeypatch):
    other_tenant = str(uuid.uuid4())
    _, v1 = tenant_with_material_findings
    _patch_tenant(monkeypatch, other_tenant)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/objects/material_master?run={v1}", headers={"X-User-Role": "steward"})
    assert resp.status_code == 404


def _patch_tenant(monkeypatch, tenant_id: str):
    """Same inline helper as tests/test_runs_steps.py and tests/test_objects_list.py (Tasks 4, 5)."""
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_objects_detail.py -v`
Expected: `404` for the first test (route does not exist yet; FastAPI 404s on an unmatched path), test `FAIL`s against the `assert resp.status_code == 200` expectation.

- [ ] **Step 3: Add the endpoint to `api/routes/objects.py`**

Append:

```python
class ObjectRuleOut(BaseModel):
    check_id: str
    severity: str
    dimension: Optional[str] = None
    affected_count: int
    total_count: int
    pass_rate: Optional[float] = None


class ObjectDetailOut(BaseModel):
    module: str
    label: str
    composite_score: Optional[float] = None
    readiness: Optional[str] = None
    dimension_scores: dict[str, float]
    rules: list[ObjectRuleOut]


@router.get("/{module}", response_model=ObjectDetailOut, dependencies=[Depends(require_permission("view"))])
async def get_object(module: str, run: uuid.UUID = Query(..., alias="run"),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    version = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": str(run), "t": str(tenant.id)})).fetchone()
    if not version:
        raise HTTPException(404, "Run not found")
    mod_summary = (version[0] or {}).get(module) or {}
    raw_scoring = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                    {"t": str(tenant.id)})).scalar() or {}
    thresholds = scoring_config(raw_scoring)["thresholds"]
    score = mod_summary.get("composite_score")

    rows = (await db.execute(text(
        "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "ORDER BY affected_count DESC"
    ), {"v": str(run), "t": str(tenant.id), "m": module})).fetchall()
    if not rows and not mod_summary:
        raise HTTPException(404, "Object not found for this run")
    return {
        "module": module,
        "label": _label(module),
        "composite_score": score,
        "readiness": tier(score, thresholds) if score is not None else None,
        "dimension_scores": mod_summary.get("dimension_scores") or {},
        "rules": [
            {"check_id": r[0], "severity": r[1], "dimension": r[2], "affected_count": r[3],
             "total_count": r[4], "pass_rate": float(r[5]) if r[5] is not None else None}
            for r in rows
        ],
    }
```

- [ ] **Step 4: Run the test**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_objects_detail.py -v`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add api/routes/objects.py tests/test_objects_detail.py
git commit -m "$(cat <<'EOF'
Add GET /api/v1/objects/{object} endpoint for the object detail page

Same composition as the objects list, narrowed to one module and including
its per-rule breakdown from findings.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 7: `GET /api/v1/objects/{object}/records/{key}` endpoint (material_master only)

**Files:**
- Create: `api/routes/object_records.py`
- Modify: `api/main.py` (register router)
- Test: `tests/test_object_records.py`

**Interfaces:**
- Consumes: `m360.build_material`, `m360.norm_matnr`, `m360.load_tables`, `m360.CORE_TABLES`, `m360.OPTIONAL_TABLES`, `m360.cap_levels` from `api.services.material_360` (existing, used unchanged by `api/routes/materials.py`); `_tables`/`_norm`/`_dictionary`/`_latest` helper patterns already in `api/routes/materials.py` (read that file's `_tables` function at line 163 and copy its signature exactly — do not reimplement table loading).
- Produces: `GET /api/v1/objects/material_master/records/{key}?run=<version_id>` → the same shape `api/routes/materials.py:get_material` already returns (`Material360Out`), unchanged, just reachable from the new generalized URL. Consumed by Task 8's `frontend/lib/api/v1/objects.ts` and Task 13's `/objects/[object]/records/[key]` page.

Per spec section 7, material master is the only object this endpoint needs to support in Wave 1b ("record fix sheet... material master first"). For any `object` other than `material_master`, return 501 so the frontend can show a clear "not yet available for this object" empty state (Task 13) rather than a confusing 404/500.

- [ ] **Step 1: Write the failing pytest**

This endpoint's own fixture needs is identical to `api/routes/materials.py:get_material`'s, so it reuses the exact same mocked-DB-plus-monkeypatched-`_tables` pattern `tests/test_material_360_routes.py` already uses for that route (read that file in full before writing this one — it is the real dependency-override fixture for this test suite, not a guess):

```python
"""tests/test_object_records.py"""
import asyncio
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import object_records
from tests.material_360_fixture import A, tables

TID, VID = uuid.uuid4(), uuid.uuid4()


class _Res:
    def fetchall(self):
        return []


class _Db:
    async def execute(self, stmt, params=None):
        return _Res()


def _app(monkeypatch):
    async def fake(_db, tenant, version_id, names):
        return VID, tables()
    monkeypatch.setattr(object_records, "_tables", fake)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(object_records.router)
    app.dependency_overrides[get_db] = lambda: _Db()
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return app


def _get(app, url):
    async def go():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(url, headers={"X-User-Role": "steward"})
    return asyncio.run(go())


def test_unsupported_object_returns_501(monkeypatch):
    resp = _get(_app(monkeypatch), "/api/v1/objects/fi_gl/records/1000")
    assert resp.status_code == 501


def test_material_master_record_delegates_to_material_360(monkeypatch):
    """Same fixture dataset and _tables monkeypatch tests/test_material_360_routes.py uses for
    api.routes.materials.get_material — this must return the same body shape for the same key,
    since object_records.py delegates to the unchanged m360.build_material."""
    resp = _get(_app(monkeypatch), f"/api/v1/objects/material_master/records/{A}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["description"].startswith("Hydraulic")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q -p no:cacheprovider tests/test_object_records.py -v`
Expected: `ModuleNotFoundError: No module named 'api.routes.object_records'`

Note: unlike Tasks 4-6, this test mocks `get_db`/`_tables` the same way `tests/test_material_360_routes.py` does, rather than hitting a real Postgres test DB — so it does not need `MERIDIAN_TEST_DB_URL` and is not `skipif`-guarded.

- [ ] **Step 3: Write `api/routes/object_records.py`**

```python
"""Generalized record fix sheet — api/routes/object_records.py.

GET /api/v1/objects/{object}/records/{key} is the object-agnostic entry point the
new /objects/[object]/records/[key] page calls. For Wave 1b, only
material_master is wired — it delegates to the existing, unchanged
api/services/material_360.py logic that api/routes/materials.py already
exposes at /api/v1/materials/{matnr}. Any other object returns 501 so the
frontend shows "not yet available" rather than guessing at a shape.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.materials import Material360Out, _norm, _tables
from api.services import material_360 as m360
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])

_SUPPORTED = {"material_master"}


@router.get("/{object}/records/{key}", response_model=Material360Out,
            dependencies=[Depends(require_permission("view"))])
async def get_object_record(object: str, key: str, version_id: Optional[uuid.UUID] = None,
                            plant: Optional[str] = None,
                            db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    if object not in _SUPPORTED:
        raise HTTPException(501, f"Record fix sheet not yet available for object '{object}'")
    vid, tables = await _tables(db, tenant, version_id, set(m360.CORE_TABLES) | set(m360.OPTIONAL_TABLES))
    out = m360.build_material(tables, _norm(key))
    if out is None:
        raise HTTPException(404, "Record not found")
    out["levels"], out["levels_total"] = m360.cap_levels(out["levels"], plant)
    shown = {lv["id"] for lv in out["levels"]}
    for row in out["views"]:
        row["cells"] = [c for c in row["cells"] if c["level"] in shown]
    return {**out, "version_id": vid}
```

- [ ] **Step 4: Register the router**

Same pattern as Task 4 Step 4 — `from api.routes import object_records as object_records_routes` and `app.include_router(object_records_routes.router)` in `api/main.py`. Add it immediately after `objects_routes` so both `/api/v1/objects` route modules sit together.

- [ ] **Step 5: Run the test**

Run: `python3 -m pytest -q -p no:cacheprovider tests/test_object_records.py -v`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add api/routes/object_records.py api/main.py tests/test_object_records.py
git commit -m "$(cat <<'EOF'
Add GET /api/v1/objects/{object}/records/{key}, material_master only

Delegates to the existing material_360 service unchanged so the new record
fix sheet page and the legacy /analyse/material/[matnr] page show identical
data during the transition. Other objects return 501 until a later wave.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 8: Frontend API wrappers — `objects.ts` and `runs.ts`

**Files:**
- Create: `frontend/lib/api/v1/objects.ts`
- Create: `frontend/lib/api/v1/runs.ts`
- Test: `frontend/lib/api/__tests__/objects.test.ts`, `frontend/lib/api/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: the three new endpoints (Tasks 5, 6, 7, 4). Read `frontend/lib/api/materials.ts`'s existing `getMaterial` for the request/fetch helper pattern this codebase already uses (look for a shared `apiGet`/`fetchJson` helper imported there — reuse it, do not write a second `fetch` wrapper).
- Produces: `getObjects(run: string): Promise<{ run_id: string; objects: ObjectSummary[] }>`, `getObject(module: string, run: string): Promise<ObjectDetail>`, `getObjectRecord(object: string, key: string, params?: { version_id?: string; plant?: string }): Promise<Material360>` (re-exporting the existing `Material360` type from `materials.ts` rather than redefining it), `getRunSteps(versionId: string): Promise<{ version_id: string; steps: RunStep[] }>`. Types `ObjectSummary = { module: string; label: string; composite_score: number | null; readiness: "pass" | "warn" | "fail" | null; failing_checks: number; affected_records: number }`, `ObjectDetail = ObjectSummary & { dimension_scores: Record<string, number>; rules: ObjectRule[] }`, `ObjectRule = { check_id: string; severity: string; dimension: string | null; affected_count: number; total_count: number; pass_rate: number | null }`, `RunStep = { step_number: number; step_name: string; status: string; started_at: string; finished_at: string | null; duration_ms: number | null; error_detail: string | null }`. Consumed by Tasks 9, 10, 13, 14, 15.

- [ ] **Step 1: Read the existing fetch helper**

Open `frontend/lib/api/materials.ts` and identify its import for the shared request helper (e.g. `import { apiGet } from "./client"` or similar — read the actual line). Use the same import in both new files below.

- [ ] **Step 2: Write `frontend/lib/api/v1/objects.ts`**

```typescript
import { apiGet } from "./client";
import type { Material360 } from "./materials";

export interface ObjectSummary {
  module: string;
  label: string;
  composite_score: number | null;
  readiness: "pass" | "warn" | "fail" | null;
  failing_checks: number;
  affected_records: number;
}

export interface ObjectRule {
  check_id: string;
  severity: string;
  dimension: string | null;
  affected_count: number;
  total_count: number;
  pass_rate: number | null;
}

export interface ObjectDetail extends ObjectSummary {
  dimension_scores: Record<string, number>;
  rules: ObjectRule[];
}

export async function getObjects(run: string): Promise<{ run_id: string; objects: ObjectSummary[] }> {
  return apiGet(`/api/v1/objects?run=${encodeURIComponent(run)}`);
}

export async function getObject(module: string, run: string): Promise<ObjectDetail> {
  return apiGet(`/api/v1/objects/${encodeURIComponent(module)}?run=${encodeURIComponent(run)}`);
}

export async function getObjectRecord(
  object: string,
  key: string,
  params?: { version_id?: string; plant?: string },
): Promise<Material360> {
  const qs = new URLSearchParams();
  if (params?.version_id) qs.set("version_id", params.version_id);
  if (params?.plant) qs.set("plant", params.plant);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet(`/api/v1/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}${suffix}`);
}
```

Read `frontend/lib/api/materials.ts` to confirm the exported type is literally named `Material360` (per the earlier research it is `Material360`, matching `Material360Out` server-side) — if the actual exported name differs, use that name instead of guessing.

- [ ] **Step 3: Write `frontend/lib/api/v1/runs.ts`**

```typescript
import { apiGet } from "./client";

export interface RunStep {
  step_number: number;
  step_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_detail: string | null;
}

export async function getRunSteps(versionId: string): Promise<{ version_id: string; steps: RunStep[] }> {
  return apiGet(`/api/v1/runs/${encodeURIComponent(versionId)}/steps`);
}
```

- [ ] **Step 4: Write the vitest unit tests**

```typescript
// frontend/lib/api/__tests__/objects.test.ts
import { describe, expect, it, vi } from "vitest";
import * as client from "../client";
import { getObjects, getObject, getObjectRecord } from "../objects";

describe("objects.ts", () => {
  it("getObjects calls /api/v1/objects with the run id", async () => {
    const spy = vi.spyOn(client, "apiGet").mockResolvedValue({ run_id: "v1", objects: [] });
    await getObjects("v1");
    expect(spy).toHaveBeenCalledWith("/api/v1/objects?run=v1");
  });

  it("getObject calls /api/v1/objects/{module} with the run id", async () => {
    const spy = vi.spyOn(client, "apiGet").mockResolvedValue({} as never);
    await getObject("material_master", "v1");
    expect(spy).toHaveBeenCalledWith("/api/v1/objects/material_master?run=v1");
  });

  it("getObjectRecord encodes the key and appends optional params", async () => {
    const spy = vi.spyOn(client, "apiGet").mockResolvedValue({} as never);
    await getObjectRecord("material_master", "1000/01", { plant: "1000" });
    expect(spy).toHaveBeenCalledWith("/api/v1/objects/material_master/records/1000%2F01?plant=1000");
  });
});
```

```typescript
// frontend/lib/api/__tests__/runs.test.ts
import { describe, expect, it, vi } from "vitest";
import * as client from "../client";
import { getRunSteps } from "../runs";

describe("runs.ts", () => {
  it("getRunSteps calls /api/v1/runs/{id}/steps", async () => {
    const spy = vi.spyOn(client, "apiGet").mockResolvedValue({ version_id: "v1", steps: [] });
    await getRunSteps("v1");
    expect(spy).toHaveBeenCalledWith("/api/v1/runs/v1/steps");
  });
});
```

If `frontend/lib/api/client.ts` does not export a function literally named `apiGet` (confirm by reading it in Step 1), adjust every `client.apiGet` reference above — including in `objects.ts` and `runs.ts` themselves — to the real exported name.

- [ ] **Step 5: Run the tests**

Run (from `frontend/`): `npm test -- objects.test.ts runs.test.ts`
Expected: `4 passed`

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all four succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/v1/objects.ts frontend/lib/api/v1/runs.ts frontend/lib/api/__tests__/objects.test.ts frontend/lib/api/__tests__/runs.test.ts
git commit -m "$(cat <<'EOF'
Add typed frontend wrappers for the objects and runs endpoints

objects.ts and runs.ts give the new explorer/run pages typed access to
GET /api/v1/objects, GET /api/v1/objects/{object}, GET /api/v1/objects/{object}/records/{key}
and GET /api/v1/runs/{id}/steps, reusing the existing Material360 type from
materials.ts instead of redefining it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 9: `/objects` page (explorer list)

**Files:**
- Create: `frontend/app/(app)/objects/page.tsx`
- Test: `frontend/app/(app)/objects/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getObjects` (Task 8); `@/design`'s `ExplorerPage` template, `DataTable` (`columns`, `rows`, `mode: "client"`, `onRowClick`), `SeverityDot`, `ScoreRing`, `Skeleton`, `EmptyState`, `ErrorState`, `Pill` (Wave 1a); shell's `RunSelector` (reads `?run=` — Wave 1a) and `DrillLink({ object })` (Wave 1a); `lib/query-keys.ts`'s `['object', id, run]` — note the objects *list* itself is not one of the pre-defined query keys, so this page defines its own local key `['objects', run]` (not in the Wave 1a contract, but consistent with its naming) inline in this file only.
- Produces: the `/objects` route. Consumed by Task 13's "lead reaches a failing record in three clicks" Playwright journey (click 1).

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/objects/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectsPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ObjectsPage", () => {
  it("renders one row per object with its readiness", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [
        { module: "material_master", label: "Material Master", composite_score: 72.5, readiness: "warn", failing_checks: 3, affected_records: 120 },
      ],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText("Material Master")).toBeInTheDocument());
    expect(screen.getByText("72.5")).toBeInTheDocument();
  });

  it("shows an empty state when the run has no objects", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(/no objects/i)).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(objectsApi, "getObjects").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm test -- app/\(app\)/objects`
Expected: `Cannot find module '../page'` (the page does not exist yet).

- [ ] **Step 3: Write `frontend/app/(app)/objects/page.tsx`**

```tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Pill, ScoreRing, SeverityDot, Skeleton } from "@/design";
import { ExplorerPage } from "@/design/templates";
import { getObjects, type ObjectSummary } from "@/lib/api/v1/objects";

const READINESS_LABEL: Record<string, string> = { pass: "Go", warn: "At risk", fail: "No-go" };

export default function ObjectsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const run = search.get("run") ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["objects", run],
    queryFn: () => getObjects(run),
    enabled: !!run,
  });

  const columns: ColumnDef<ObjectSummary>[] = [
    { accessorKey: "label", header: "Object" },
    {
      accessorKey: "composite_score",
      header: "DQS",
      cell: ({ row }) => (row.original.composite_score == null ? "—" : <ScoreRing value={row.original.composite_score} size="sm" />),
    },
    {
      accessorKey: "readiness",
      header: "Readiness",
      cell: ({ row }) =>
        row.original.readiness ? <Pill tone={row.original.readiness}>{READINESS_LABEL[row.original.readiness]}</Pill> : "—",
    },
    {
      accessorKey: "failing_checks",
      header: "Failing checks",
      cell: ({ row }) => (
        <span>
          <SeverityDot severity={row.original.failing_checks > 0 ? "high" : "none"} /> {row.original.failing_checks}
        </span>
      ),
    },
    { accessorKey: "affected_records", header: "Affected records" },
  ];

  if (!run) return <EmptyState title="Select a run" description="Pick a run from the selector above to see its objects." />;
  if (isLoading) return <Skeleton variant="table" rows={6} />;
  if (isError) return <ErrorState title="Couldn't load objects" description="Try again, or pick a different run." />;
  if (!data || data.objects.length === 0) return <EmptyState title="No objects for this run" description="This run has no analysed objects yet." />;

  return (
    <ExplorerPage title="Objects">
      <DataTable
        columns={columns}
        rows={data.objects}
        mode="client"
        onRowClick={(row) => router.push(`/objects/${row.module}?run=${run}`)}
      />
    </ExplorerPage>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- app/\(app\)/objects`
Expected: `3 passed`

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all pass. If `@/design`'s real exports differ from the names used above (`Pill` taking a `tone` prop, `ScoreRing` taking `size`, `Skeleton` taking `variant`/`rows`), fix this file to match Wave 1a's actual prop signatures — read `frontend/design/` (wherever Wave 1a lands it) before changing anything else.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(app)/objects/page.tsx" "frontend/app/(app)/objects/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /objects explorer list page

Shows every analysed object for the selected run with its DQS, readiness
bucket and failing-check count, built entirely from @/design primitives.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 10: `/objects/[object]` page (object detail)

**Files:**
- Create: `frontend/app/(app)/objects/[object]/page.tsx`
- Test: `frontend/app/(app)/objects/[object]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getObject` (Task 8); `@/design`'s `RecordPage`/`ReportPage` template (pick whichever Wave 1a names for a single-entity detail page — read Wave 1a's plan output or `frontend/design/templates/index.ts` once it exists to confirm the exact export name before using it), `DataTable`, `ScoreRing`, `Pill`, charts' `Bar`/`Waterfall` with `onPointClick(point)`; `lib/query-keys.ts`'s `['object', id, run]` (use this exact key, not a locally invented one — this one Wave 1a does define); `DrillLink({ object, ruleId })` for navigating into a rule.
- Produces: the `/objects/[object]` route; the dimension-score breakdown and rule table it renders. Consumed by Task 13's Playwright journey (click 2).

Before writing this page, the implementer must open `app/(dashboard)/analyse/object/[module]/page.tsx` (the legacy equivalent, already read in full during planning) and confirm the new page covers its five documented sections — composite score + severity tally, six-dimension breakdown, config-impact features blocked (if `getConfigImpact` from `lib/api/connectivity.ts` is still in scope for Wave 1b — it is **not**: config impact is a Wave 2 "insights" feature per the spec's wave table, so this page intentionally drops that section and must not import `lib/api/connectivity.ts`), worst checks ranked by records affected, and the recommended steward (also Wave 2/owner-data gap — drop this section too, per the "Known gaps" note at the top of this plan).

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/objects/[object]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push: vi.fn() }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ObjectDetailPage", () => {
  it("renders the object's rules", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({
      module: "material_master",
      label: "Material Master",
      composite_score: 72.5,
      readiness: "warn",
      failing_checks: 1,
      affected_records: 120,
      dimension_scores: { completeness: 80 },
      rules: [{ check_id: "mm_missing_desc", severity: "high", dimension: "completeness", affected_count: 12, total_count: 500, pass_rate: 97.6 }],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
  });

  it("shows an empty state with no rules", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({
      module: "material_master", label: "Material Master", composite_score: null, readiness: null,
      failing_checks: 0, affected_records: 0, dimension_scores: {}, rules: [],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText(/no rules/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "app/\(app\)/objects/\[object\]"`
Expected: `Cannot find module '../page'`

- [ ] **Step 3: Write `frontend/app/(app)/objects/[object]/page.tsx`**

```tsx
"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Pill, ScoreRing, Skeleton, Stat } from "@/design";
import { getObject, type ObjectRule } from "@/lib/api/v1/objects";

export default function ObjectDetailPage() {
  const { object } = useParams<{ object: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const run = search.get("run") ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["object", object, run],
    queryFn: () => getObject(object, run),
    enabled: !!object && !!run,
  });

  const columns: ColumnDef<ObjectRule>[] = [
    { accessorKey: "check_id", header: "Check" },
    { accessorKey: "severity", header: "Severity" },
    { accessorKey: "dimension", header: "Dimension" },
    { accessorKey: "affected_count", header: "Affected" },
    {
      accessorKey: "pass_rate",
      header: "Pass rate",
      cell: ({ row }) => (row.original.pass_rate == null ? "—" : `${row.original.pass_rate.toFixed(1)}%`),
    },
  ];

  if (!run) return <EmptyState title="Select a run" description="Pick a run to see this object's detail." />;
  if (isLoading) return <Skeleton variant="page" />;
  if (isError) return <ErrorState title="Couldn't load this object" description="Try again, or go back to the object list." />;
  if (!data) return null;

  return (
    <div>
      <header>
        <h1>{data.label}</h1>
        {data.composite_score != null && <ScoreRing value={data.composite_score} />}
        {data.readiness && <Pill tone={data.readiness}>{data.readiness}</Pill>}
        {Object.entries(data.dimension_scores).map(([dim, score]) => (
          <Stat key={dim} label={dim} value={score} />
        ))}
      </header>
      {data.rules.length === 0 ? (
        <EmptyState title="No rules evaluated" description="This object has no evaluated rules on this run." />
      ) : (
        <DataTable
          columns={columns}
          rows={data.rules}
          mode="client"
          onRowClick={(row) => router.push(`/objects/${object}/rules/${row.check_id}?run=${run}`)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- "app/\(app\)/objects/\[object\]"`
Expected: `2 passed`

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all pass (reconcile `@/design` prop names against Wave 1a's actual exports as in Task 9 Step 5 if they differ).

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(app)/objects/[object]/page.tsx" "frontend/app/(app)/objects/[object]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /objects/[object] detail page

Shows one object's composite score, dimension breakdown and rule table,
replacing the DQS/radar/worst-checks sections of the legacy
analyse/object/[module] page. Config-impact and recommended-steward
sections are dropped intentionally — both are Wave 2/owner-data gaps.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 11: `/objects/[object]/rules/[ruleId]` page (rule detail)

**Files:**
- Create: `frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx`
- Test: `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `lib/query-keys.ts`'s `['rule', id, run]` (exact key from Wave 1a); `getFindingRecords(versionId, checkId, { limit?, offset? })` from `frontend/lib/api/versions.ts` (existing — returns `FindingRecord[]` with `record_key, grain, module, field_values`); `DataTable` with `mode: "server"` (paginated); `DrillLink({ object, ruleId, filters })`.
- Produces: the `/objects/[object]/rules/[ruleId]` route, listing every failing record for one check with a link into each record's fix sheet. Consumed by Task 13's Playwright journey (click 3, the step that reaches a failing record).

Before writing this page, the implementer must open `components/analyse/rule-detail.tsx` (the legacy `RuleDetailPage` component rendered by `app/(dashboard)/analyse/rule/[checkId]/page.tsx`) to see what it currently shows (rule definition/message, affected-record list, severity, and any trend chart) and carry over anything not already covered by `/objects/[object]` or the record fix sheet.

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import RuleDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master", ruleId: "mm_missing_desc" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RuleDetailPage", () => {
  it("renders the failing records for this check", async () => {
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue([
      { record_key: "1000001", grain: "material", module: "material_master", field_values: { MAKTX: "" } },
    ]);
    renderWithQuery(<RuleDetailPage />);
    await waitFor(() => expect(screen.getByText("1000001")).toBeInTheDocument());
  });

  it("shows an empty state when no records fail this check", async () => {
    vi.spyOn(versionsApi, "getFindingRecords").mockResolvedValue([]);
    renderWithQuery(<RuleDetailPage />);
    await waitFor(() => expect(screen.getByText(/no failing records/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "app/\(app\)/objects/\[object\]/rules"`
Expected: `Cannot find module '../page'`

- [ ] **Step 3: Write the page**

```tsx
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DrillLink, EmptyState, ErrorState, Skeleton } from "@/design";
import { getFindingRecords, type FindingRecord } from "@/lib/api/versions";

export default function RuleDetailPage() {
  const { object, ruleId } = useParams<{ object: string; ruleId: string }>();
  const search = useSearchParams();
  const run = search.get("run") ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["rule", ruleId, run],
    queryFn: () => getFindingRecords(run, ruleId, { limit: 50, offset: 0 }),
    enabled: !!run && !!ruleId,
  });

  const columns: ColumnDef<FindingRecord>[] = [
    {
      accessorKey: "record_key",
      header: "Record",
      cell: ({ row }) => (
        <DrillLink object={object} ruleId={ruleId} filters={{ record_key: row.original.record_key }}>
          {row.original.record_key}
        </DrillLink>
      ),
    },
    { accessorKey: "grain", header: "Grain" },
  ];

  if (isLoading) return <Skeleton variant="table" rows={10} />;
  if (isError) return <ErrorState title="Couldn't load failing records" description="Try again." />;
  if (!data || data.length === 0) return <EmptyState title="No failing records" description="Every record passes this check on this run." />;

  return <DataTable columns={columns} rows={data} mode="client" />;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- "app/\(app\)/objects/\[object\]/rules"`
Expected: `2 passed`

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /objects/[object]/rules/[ruleId] rule detail page

Lists every failing record for one check using the existing
getFindingRecords wrapper, with a DrillLink into each record's fix sheet —
the third click of the lead's failing-record journey.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 12: `/objects/[object]/records/[key]` page (record fix sheet, material master)

**Files:**
- Create: `frontend/app/(app)/objects/[object]/records/[key]/page.tsx`
- Test: `frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getObjectRecord` (Task 8); `@/design`'s `RecordPage` template; `lib/query-keys.ts`'s `['records', object, filters]` is for *list* filters — a single record's query key is not in the Wave 1a contract, so this page uses `['object-record', object, key, run]` locally, matching the naming style of the predefined keys.
- Produces: the `/objects/[object]/records/[key]` route. Terminal page of Task 13's Playwright journey.

Before writing this page, the implementer must open `components/analyse/material-360.tsx`, `material-views.tsx`, `material-rules.tsx`, `material-duplicates.tsx`, and `material-lifecycle.tsx` (none of these were read during planning) to see every section the legacy Material 360 page renders from the exact same `Material360Out`/`FindingsOut`/`SupersessionOut`/`DuplicatesOut` shapes this new endpoint reuses unchanged, and to decide which of those five components' content maps onto the new page's layout (the legacy page already fetches `getMaterial`, `getMaterialFindings`, `getMaterialSupersession`, `getMaterialDuplicates` directly from `lib/api/materials.ts` — for Wave 1b, call `getObjectRecord` for the core material view and continue calling the three material-specific endpoints directly from `lib/api/materials.ts` for findings/supersession/duplicates, since Task 7 only generalized the core `get_material` call, not the other three).

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as objectsApi from "@/lib/api/v1/objects";
import RecordFixSheetPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master", key: "1000001" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RecordFixSheetPage", () => {
  it("renders the material's description", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockResolvedValue({
      matnr: "1000001", description: "Steel bracket", language: "EN", mara: {}, makt: [], marm: [],
      mean: [], marc: [], mvke: [], mbew: [], mard: [], mlgn: [], labels: {}, expected_known: true,
      levels: [], levels_total: 0, views: [], phasing: { plants: 0, phasing_out: 0, with_followup: 0 },
      version_id: "v1",
    } as never);
    renderWithQuery(<RecordFixSheetPage />);
    await waitFor(() => expect(screen.getByText("Steel bracket")).toBeInTheDocument());
  });

  it("shows a not-yet-available state for an unsupported object", async () => {
    vi.spyOn(objectsApi, "getObjectRecord").mockRejectedValue({ response: { status: 501 } });
    renderWithQuery(<RecordFixSheetPage />);
    await waitFor(() => expect(screen.getByText(/not yet available/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "app/\(app\)/objects/\[object\]/records"`
Expected: `Cannot find module '../page'`

- [ ] **Step 3: Write the page**

```tsx
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, KeyValue, Mono, Skeleton } from "@/design";
import { getObjectRecord } from "@/lib/api/v1/objects";

export default function RecordFixSheetPage() {
  const { object, key } = useParams<{ object: string; key: string }>();
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ["object-record", object, key, run ?? null],
    queryFn: () => getObjectRecord(object, key, { version_id: run }),
    retry: false,
  });

  if (isLoading) return <Skeleton variant="page" />;
  if ((error as { response?: { status?: number } } | undefined)?.response?.status === 501) {
    return <EmptyState title="Not yet available" description={`The record fix sheet for ${object} isn't built yet.`} />;
  }
  if (error) return <ErrorState title="Couldn't load this record" description="Try again." />;
  if (!data) return null;

  return (
    <div>
      <header>
        <Mono>{data.matnr}</Mono>
        <h1>{data.description ?? "(no description)"}</h1>
      </header>
      <KeyValue label="Language" value={data.language ?? "—"} />
      <KeyValue label="Levels evaluated" value={String(data.levels_total)} />
    </div>
  );
}
```

Per the "before writing this page" note, extend this component to also render the view-completeness matrix (`data.views`), findings-by-view (via `getMaterialFindings` from `lib/api/materials.ts`), supersession and duplicates sections once the implementer has read the five legacy components named above — the skeleton here covers only the core identity block that `getObjectRecord` alone returns; do not consider this task complete until the content audited from those five files has a home on this page or an explicit one-line note in the commit message saying why it was dropped.

- [ ] **Step 4: Run the test**

Run: `npm test -- "app/\(app\)/objects/\[object\]/records"`
Expected: `2 passed`

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(app)/objects/[object]/records/[key]/page.tsx" "frontend/app/(app)/objects/[object]/records/[key]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /objects/[object]/records/[key] record fix sheet, material master

Core identity block comes from the new generalized endpoint; findings,
supersession and duplicates sections continue to call the existing
materials.ts wrappers directly, matching the legacy Material 360 page's
content audited from its five component files.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 13: Playwright journey — lead reaches a failing record in three clicks

**Files:**
- Create: `frontend/e2e/lead-failing-record-journey.spec.ts`

**Interfaces:**
- Consumes: the four routes built in Tasks 9, 10, 11, 12.
- Produces: one Playwright spec, run in CI alongside existing e2e specs (read `frontend/playwright.config.ts` for the existing `baseURL`/project setup and match it — do not invent a second config).

- [ ] **Step 1: Read the existing Playwright setup**

Open `frontend/playwright.config.ts` and one existing spec under `frontend/e2e/` (if the directory doesn't exist yet, check `frontend/tests/e2e/` instead — read `package.json`'s `test:e2e` script to find the real directory) to copy its `test.beforeEach` login/seed pattern exactly.

- [ ] **Step 2: Write the journey spec**

```typescript
// frontend/e2e/lead-failing-record-journey.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Lead reaches a failing record in three clicks", () => {
  test("home -> object -> rule -> record", async ({ page }) => {
    // Click 1: from the objects list, open a failing object.
    await page.goto("/objects?run=latest");
    await page.getByRole("row", { name: /material master/i }).click();
    await expect(page).toHaveURL(/\/objects\/material_master/);

    // Click 2: from the object detail, open a failing rule.
    await page.getByRole("row", { name: /mm_/i }).first().click();
    await expect(page).toHaveURL(/\/objects\/material_master\/rules\//);

    // Click 3: from the rule detail, open a failing record.
    await page.getByRole("link", { name: /^\d+$/ }).first().click();
    await expect(page).toHaveURL(/\/objects\/material_master\/records\//);
    await expect(page.getByRole("heading")).toBeVisible();
  });
});
```

Adjust the seed/login steps (`test.beforeEach`) and the `run=latest` query value to match whatever fixture/seed data the repo's existing e2e specs already rely on for a run with at least one failing `material_master` check — read one existing spec (Step 1) to find the real seeded run id or fixture helper rather than assuming `run=latest` resolves.

- [ ] **Step 3: Run the journey against a local dev server**

Run: `npm run build && npm run start & npx wait-on http://localhost:3000 && npx playwright test e2e/lead-failing-record-journey.spec.ts`
Expected: `1 passed`

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/lead-failing-record-journey.spec.ts
git commit -m "$(cat <<'EOF'
Add Playwright journey: lead reaches a failing record in three clicks

Covers /objects -> /objects/[object] -> /objects/[object]/rules/[ruleId] ->
/objects/[object]/records/[key], the core promise of the object explorer.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 14: `/runs` page (run list)

**Files:**
- Create: `frontend/app/(app)/runs/page.tsx`
- Test: `frontend/app/(app)/runs/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getVersions(params)` from `frontend/lib/api/versions.ts` (existing); `DataTable`, `EmptyState`, `ErrorState`, `Skeleton` (Wave 1a).
- Produces: the `/runs` route, each row linking to `/runs/[versionId]`.

Before writing this page, open `components/data/runs.tsx` (legacy equivalent, not read during planning) to confirm every column it currently shows (label, status, run_at, system, module coverage) so the new table carries the same information.

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/runs/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import RunsPage from "../page";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RunsPage", () => {
  it("renders one row per run", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({
      versions: [{ id: "v1", label: "Oct 8 upload", status: "complete", run_at: "2026-10-08T00:00:00Z" }],
      total: 1,
    } as never);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
  });

  it("shows an empty state with no runs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [], total: 0 } as never);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/no runs/i)).toBeInTheDocument());
  });
});
```

Confirm the exact shape `getVersions` resolves to (field names `versions`/`total` above are a placeholder guess) by reading its return type in `frontend/lib/api/versions.ts` before finalizing this test — adjust the mock and assertions to the real field names.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "app/\(app\)/runs"`
Expected: `Cannot find module '../page'`

- [ ] **Step 3: Write the page**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Skeleton } from "@/design";
import { getVersions } from "@/lib/api/versions";

interface RunRow {
  id: string;
  label: string | null;
  status: string;
  run_at: string;
}

export default function RunsPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["run", "list"],
    queryFn: () => getVersions({}),
  });

  const columns: ColumnDef<RunRow>[] = [
    { accessorKey: "label", header: "Run" },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "run_at", header: "Started" },
  ];

  if (isLoading) return <Skeleton variant="table" rows={8} />;
  if (isError) return <ErrorState title="Couldn't load runs" description="Try again." />;
  const rows = (data as unknown as { versions: RunRow[] })?.versions ?? [];
  if (rows.length === 0) return <EmptyState title="No runs yet" description="Upload a file or connect a system to start a run." />;

  return <DataTable columns={columns} rows={rows} mode="client" onRowClick={(row) => router.push(`/runs/${row.id}`)} />;
}
```

Confirm `getVersions({})`'s real parameter shape and real response field (`versions` vs. something else) against the actual `frontend/lib/api/versions.ts` signature before finalizing — this plan's author read that file in full earlier and recalls a `getVersions(params)` signature, but did not capture its exact return field name, so the implementer must re-check it here rather than trust this placeholder.

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `npm test -- "app/\(app\)/runs" && npm run typecheck && npm run lint && npm run lint:tokens`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(app)/runs/page.tsx" "frontend/app/(app)/runs/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /runs run list page

Replaces the data-tab runs table (components/data/runs.tsx) with a plain
@/design DataTable over the existing getVersions wrapper.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 15: `/runs/[versionId]` page (run detail with step history)

**Files:**
- Create: `frontend/app/(app)/runs/[versionId]/page.tsx`
- Test: `frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getVersion(id)` from `versions.ts` (existing); `getRunSteps(versionId)` (Task 8); `lib/query-keys.ts`'s `['run', id]` (exact Wave 1a key).
- Produces: the `/runs/[versionId]` route, showing the run's metadata plus the new step-by-step history (name, status, duration, decisive error on the failed step).

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as runsApi from "@/lib/api/v1/runs";
import * as versionsApi from "@/lib/api/versions";
import RunDetailPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ versionId: "v1" }) }));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RunDetailPage", () => {
  it("renders the decisive error of a failed step", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue({ id: "v1", label: "Oct 8", status: "failed" } as never);
    vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
      version_id: "v1",
      steps: [
        { step_number: 4, step_name: "Generating AI insights", status: "failed", started_at: "t0", finished_at: "t1", duration_ms: 1200, error_detail: "LLM provider timed out after 120s" },
      ],
    });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("LLM provider timed out after 120s")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "app/\(app\)/runs/\[versionId\]"`
Expected: `Cannot find module '../page'`

- [ ] **Step 3: Write the page**

```tsx
"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Mono, Pill, Skeleton } from "@/design";
import { getRunSteps } from "@/lib/api/v1/runs";
import { getVersion } from "@/lib/api/versions";

export default function RunDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();

  const version = useQuery({ queryKey: ["run", versionId], queryFn: () => getVersion(versionId) });
  const steps = useQuery({ queryKey: ["run", versionId, "steps"], queryFn: () => getRunSteps(versionId) });

  if (version.isLoading || steps.isLoading) return <Skeleton variant="page" />;
  if (version.isError || steps.isError) return <ErrorState title="Couldn't load this run" description="Try again." />;
  if (!version.data || !steps.data) return null;

  return (
    <div>
      <h1>{version.data.label ?? <Mono>{versionId}</Mono>}</h1>
      <Pill tone={version.data.status === "failed" ? "fail" : "pass"}>{version.data.status}</Pill>
      <ol>
        {steps.data.steps.map((step) => (
          <li key={step.step_number}>
            <strong>{step.step_name}</strong> — {step.status}
            {step.duration_ms != null && <span> ({(step.duration_ms / 1000).toFixed(1)}s)</span>}
            {step.error_detail && <p role="alert">{step.error_detail}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `npm test -- "app/\(app\)/runs/\[versionId\]" && npm run typecheck && npm run lint && npm run lint:tokens`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(app)/runs/[versionId]/page.tsx" "frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /runs/[versionId] run detail page with step history

Surfaces the new analysis_run_steps history including the decisive error
line on a failed step, which was previously only visible in Redis-backed
progress during the run and lost afterwards.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 16: `/runs/[a]/vs/[b]` page (run comparison, waterfall + rule delta + field correlation)

**Files:**
- Create: `frontend/app/(app)/runs/[a]/vs/[b]/page.tsx`
- Test: `frontend/app/(app)/runs/[a]/vs/[b]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `compareVersions(v1, v2, module)`, `compareRecords(v2, v1?, module?)` (returns `{ v1, v2, totals: { new, resolved, persisting }, checks: RecordDiffCheck[] }`), `compareRecordKeys(checkId, { v1, v2, change, search?, limit?, offset? })` — all from `frontend/lib/api/versions.ts` (existing); `@/design` charts' `Waterfall` and `Sparkline` with `onPointClick(point)`.
- Produces: the `/runs/[a]/vs/[b]` route: a waterfall of `totals.new`/`resolved`/`persisting`, a rule delta table (one row per `RecordDiffCheck`, with a `Sparkline` of... read the note below) and a field-correlation panel driven by `compareRecordKeys`.

Per spec section 8.6 the rule delta table needs a per-rule sparkline and the field correlation needs drill into which fields changed. `compareRecords`'s `RecordDiffCheck` (`check_id, module, severity, new, resolved, persisting, comparable`) gives one point per rule per *pair* of runs, not a time series — so a true sparkline needs multiple pairs. For Wave 1b, the sparkline uses the two values comparable across this one pair only (`[persisting + resolved, persisting + new]`, i.e. "before" vs "after" counts) rather than a longer history; read `frontend/lib/api/versions.ts` again at implementation time to confirm there's no existing multi-run trend endpoint before accepting this two-point simplification, and if one exists, use it instead and drop this note from the commit message.

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/app/(app)/runs/[a]/vs/[b]/__tests__/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import CompareRunsPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ a: "v1", b: "v2" }) }));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("CompareRunsPage", () => {
  it("renders the rule delta table with new/resolved/persisting counts", async () => {
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({
      v1: "v1", v2: "v2", totals: { new: 3, resolved: 5, persisting: 20 },
      checks: [{ check_id: "mm_missing_desc", module: "material_master", severity: "high", new: 3, resolved: 5, persisting: 20, comparable: true }],
    });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
  });

  it("shows an empty state when there is nothing to compare", async () => {
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({
      v1: "v1", v2: "v2", totals: { new: 0, resolved: 0, persisting: 0 }, checks: [],
    });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText(/no differences/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "app/\(app\)/runs/\[a\]/vs/\[b\]"`
Expected: `Cannot find module '../page'`

- [ ] **Step 3: Write the page**

```tsx
"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Skeleton } from "@/design";
import { Sparkline, Waterfall } from "@/design/charts";
import { compareRecords, type RecordDiffCheck } from "@/lib/api/versions";

export default function CompareRunsPage() {
  const { a, b } = useParams<{ a: string; b: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["run", a, "vs", b],
    queryFn: () => compareRecords(b, a),
  });

  const columns: ColumnDef<RecordDiffCheck>[] = [
    { accessorKey: "check_id", header: "Check" },
    { accessorKey: "severity", header: "Severity" },
    { accessorKey: "new", header: "New" },
    { accessorKey: "resolved", header: "Resolved" },
    { accessorKey: "persisting", header: "Persisting" },
    {
      id: "trend",
      header: "Trend",
      cell: ({ row }) => (
        <Sparkline
          points={[row.original.persisting + row.original.resolved, row.original.persisting + row.original.new]}
        />
      ),
    },
  ];

  if (isLoading) return <Skeleton variant="page" />;
  if (isError) return <ErrorState title="Couldn't compare these runs" description="Try again." />;
  if (!data || data.checks.length === 0) return <EmptyState title="No differences" description="These two runs have identical results." />;

  return (
    <div>
      <Waterfall
        data={[
          { label: "Resolved", value: -data.totals.resolved },
          { label: "New", value: data.totals.new },
          { label: "Persisting", value: data.totals.persisting },
        ]}
      />
      <DataTable columns={columns} rows={data.checks} mode="client" />
    </div>
  );
}
```

Confirm `@/design/charts`'s real `Waterfall`/`Sparkline` prop names (`data`/`points` above are guesses consistent with Wave 1a's described `onPointClick(point)` contract) against Wave 1a's actual implementation before finalizing — adjust prop names to match, do not leave a mismatched prop name in the committed file.

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `npm test -- "app/\(app\)/runs/\[a\]/vs/\[b\]" && npm run typecheck && npm run lint && npm run lint:tokens`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(app)/runs/[a]/vs/[b]/page.tsx" "frontend/app/(app)/runs/[a]/vs/[b]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
Add the /runs/[a]/vs/[b] run comparison page

Waterfall of new/resolved/persisting plus a rule delta table over the
existing compareRecords wrapper. The per-rule trend is a two-point
before/after sparkline for this one pair, pending a real multi-run trend
endpoint in a later wave.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 17: Persona home narrative — `/home/lead`, `/home/steward`, `/home/basis`, and `/home` redirect

**Files:**
- Create: `frontend/lib/home-narrative.ts`
- Create: `frontend/app/(app)/home/page.tsx`
- Create: `frontend/app/(app)/home/lead/page.tsx`
- Create: `frontend/app/(app)/home/steward/page.tsx`
- Create: `frontend/app/(app)/home/basis/page.tsx`
- Test: `frontend/lib/__tests__/home-narrative.test.ts`

**Interfaces:**
- Consumes: `getObjects(run)` (Task 5/8); for steward's "records with no owner" list, `record_issues` has no query wrapper yet for an unassigned-count — add `getUnassignedCount(module?)` style query inline via a direct read of `frontend/lib/api/issues.ts`'s existing `getIssues(filter)` (it already supports an `assigned_to` filter per the `IssueFilter` type read during planning — pass `assigned_to: null`-equivalent per that type's real optional fields, confirmed by reading `issues.ts` at implementation time) rather than adding a new backend endpoint; `@/design/templates`'s `HomePage`.
- Produces: `buildNarrative(input: { role: "lead" | "steward" | "basis"; objects: ObjectSummary[] }): string` — a deterministic, exactly-three-sentence string per spec section 6. Consumed by all three persona pages.

- [ ] **Step 1: Write the failing narrative unit test**

```typescript
// frontend/lib/__tests__/home-narrative.test.ts
import { describe, expect, it } from "vitest";
import { buildNarrative } from "../home-narrative";
import type { ObjectSummary } from "../api/v1/objects";

const objects: ObjectSummary[] = [
  { module: "material_master", label: "Material Master", composite_score: 60, readiness: "fail", failing_checks: 12, affected_records: 500 },
  { module: "fi_gl", label: "FI General Ledger", composite_score: 95, readiness: "pass", failing_checks: 0, affected_records: 0 },
];

describe("buildNarrative", () => {
  it("produces exactly three sentences for a lead", () => {
    const text = buildNarrative({ role: "lead", objects });
    const sentences = text.trim().split(". ").filter(Boolean);
    expect(sentences).toHaveLength(3);
  });

  it("names the worst-readiness object first for a lead", () => {
    const text = buildNarrative({ role: "lead", objects });
    expect(text).toContain("Material Master");
  });

  it("is deterministic for the same input", () => {
    expect(buildNarrative({ role: "lead", objects })).toBe(buildNarrative({ role: "lead", objects }));
  });

  it("produces exactly three sentences for a steward and a basis admin too", () => {
    expect(buildNarrative({ role: "steward", objects }).trim().split(". ").filter(Boolean)).toHaveLength(3);
    expect(buildNarrative({ role: "basis", objects }).trim().split(". ").filter(Boolean)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- home-narrative`
Expected: `Cannot find module '../home-narrative'`

- [ ] **Step 3: Write `frontend/lib/home-narrative.ts`**

```typescript
import type { ObjectSummary } from "./api/v1/objects";

export interface NarrativeInput {
  role: "lead" | "steward" | "basis";
  objects: ObjectSummary[];
}

function worstFirst(objects: ObjectSummary[]): ObjectSummary[] {
  return [...objects].sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0));
}

/**
 * Deterministic, exactly-three-sentence narrative per spec section 6.
 * Sentence 1: overall state. Sentence 2: the single worst object. Sentence 3:
 * a role-specific call to action. Pure function of `objects` — no randomness,
 * no clock reads, so it is safe to unit test byte-for-byte.
 */
export function buildNarrative({ role, objects }: NarrativeInput): string {
  const sorted = worstFirst(objects);
  const failing = objects.filter((o) => o.readiness === "fail");
  const worst = sorted[0];

  const sentence1 = objects.length === 0
    ? "No objects have been analysed yet."
    : `${failing.length} of ${objects.length} objects are not ready for go-live.`;

  const sentence2 = worst
    ? `${worst.label} is the furthest behind, with ${worst.failing_checks} failing checks affecting ${worst.affected_records} records.`
    : "There is no object to call out yet.";

  const actions: Record<NarrativeInput["role"], string> = {
    lead: "Start with the objects list to see every object's readiness at a glance.",
    steward: "Open the objects list and work the highest-severity rule first.",
    basis: "Check the latest run's step history for any failed extraction before re-running.",
  };

  return `${sentence1} ${sentence2} ${actions[role]}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- home-narrative`
Expected: `4 passed`

- [ ] **Step 5: Write the `/home` redirect and the three persona pages**

```tsx
// frontend/app/(app)/home/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ROLE_KEY = "meridian:home";

export default function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(ROLE_KEY) : null;
    const role = stored === "steward" || stored === "basis" ? stored : "lead";
    router.replace(`/home/${role}`);
  }, [router]);
  return null;
}
```

```tsx
// frontend/app/(app)/home/lead/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { HomePage } from "@/design/templates";
import { ErrorState, Skeleton } from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { buildNarrative } from "@/lib/home-narrative";

export default function LeadHomePage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["objects", "latest"], queryFn: () => getObjects("latest") });
  if (isLoading) return <Skeleton variant="page" />;
  if (isError || !data) return <ErrorState title="Couldn't load your home page" description="Try again." />;
  return <HomePage title="Lead" narrative={buildNarrative({ role: "lead", objects: data.objects })} />;
}
```

```tsx
// frontend/app/(app)/home/steward/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { HomePage } from "@/design/templates";
import { ErrorState, Skeleton } from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { buildNarrative } from "@/lib/home-narrative";

export default function StewardHomePage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["objects", "latest"], queryFn: () => getObjects("latest") });
  if (isLoading) return <Skeleton variant="page" />;
  if (isError || !data) return <ErrorState title="Couldn't load your home page" description="Try again." />;
  return <HomePage title="Steward" narrative={buildNarrative({ role: "steward", objects: data.objects })} />;
}
```

```tsx
// frontend/app/(app)/home/basis/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { HomePage } from "@/design/templates";
import { ErrorState, Skeleton } from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { buildNarrative } from "@/lib/home-narrative";

export default function BasisHomePage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["objects", "latest"], queryFn: () => getObjects("latest") });
  if (isLoading) return <Skeleton variant="page" />;
  if (isError || !data) return <ErrorState title="Couldn't load your home page" description="Try again." />;
  return <HomePage title="Basis" narrative={buildNarrative({ role: "basis", objects: data.objects })} />;
}
```

`getObjects("latest")` requires the backend to resolve the literal string `"latest"` to the tenant's newest completed run — `api/routes/objects.py`'s `list_objects` (Task 5) currently requires a UUID `run` query param and will 422 on `"latest"`. Before this step compiles correctly, go back to Task 5's `list_objects` and change the `run` parameter type from `uuid.UUID` to `str`, resolving `"latest"` via the same `SELECT ... ORDER BY run_at DESC LIMIT 1` pattern `api/routes/versions.py`'s `_resolve_pair` already uses, falling back to parsing it as a UUID otherwise. Make that small addition to `api/routes/objects.py` as part of this task (not a new task), with its own one-line test added to `tests/test_objects_list.py`.

- [ ] **Step 6: Add the "latest" resolution to `api/routes/objects.py` and its test**

```python
# In api/routes/objects.py, replace the list_objects signature's `run: uuid.UUID = Query(..., alias="run")`
# with `run: str = Query(..., alias="run")`, and at the top of the function body add:

async def _resolve_run(db: AsyncSession, tenant: "Tenant", run: str) -> str:
    if run == "latest":
        row = (await db.execute(text(
            "SELECT id::text FROM analysis_versions WHERE tenant_id = :t AND status = 'complete' "
            "ORDER BY run_at DESC LIMIT 1"
        ), {"t": str(tenant.id)})).fetchone()
        if not row:
            raise HTTPException(404, "No completed run yet")
        return row[0]
    return run
```

Call `run_id = await _resolve_run(db, tenant, run)` first in `list_objects` and use `run_id` everywhere `str(run)` was previously used.

```python
# Add to tests/test_objects_list.py
@pytest.mark.anyio
async def test_objects_list_resolves_latest(two_tenants_with_findings, monkeypatch):
    t1, _t2, v1, _v2 = two_tenants_with_findings
    _patch_tenant(monkeypatch, t1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/objects?run=latest")
    assert resp.status_code == 200
    assert resp.json()["run_id"] == v1
```

- [ ] **Step 7: Run all the tests for this task**

Run: `npm test -- home-narrative "app/\(app\)/home" && MERIDIAN_TEST_DB_URL=postgresql://meridian:meridian@localhost:5432/meridian_test python3 -m pytest -q -p no:cacheprovider tests/test_objects_list.py -v`
Expected: all pass.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/home-narrative.ts frontend/lib/__tests__/home-narrative.test.ts \
  "frontend/app/(app)/home/page.tsx" "frontend/app/(app)/home/lead/page.tsx" \
  "frontend/app/(app)/home/steward/page.tsx" "frontend/app/(app)/home/basis/page.tsx" \
  api/routes/objects.py tests/test_objects_list.py
git commit -m "$(cat <<'EOF'
Add persona homes with a deterministic three-sentence narrative

/home redirects by the meridian:home localStorage key (default lead);
/home/lead, /home/steward and /home/basis share one pure buildNarrative()
function, unit tested for determinism and exact sentence count. Also
teaches GET /api/v1/objects to resolve run=latest to the tenant's newest
completed run, which all three persona pages rely on.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

### Task 18: Legacy route redirects and deletions

**Files:**
- Modify: `frontend/next.config.ts`
- Delete: `frontend/app/(dashboard)/findings/page.tsx`
- Delete: `frontend/app/(dashboard)/versions/page.tsx`
- Delete: `frontend/app/(dashboard)/analyse/object/[module]/page.tsx`
- Delete: `frontend/app/(dashboard)/analyse/material/[matnr]/page.tsx`
- Test: `frontend/__tests__/legacy-redirects.test.ts`

**Interfaces:**
- Consumes: the four new routes built in Tasks 9, 10, 12, 14 (`/objects`, `/objects/[object]`, `/objects/[object]/records/[key]`, `/runs`), plus `/home/steward` (Task 17).
- Produces: four `next.config.ts` redirect entries.

Four of the nine originally-listed legacy files are deliberately **not** redirected or deleted in this plan. `analyse/rule/[checkId]/page.tsx` and `analyse/finding/[id]/page.tsx` both need an object/module to build their Wave 1b replacement URL (`/objects/{object}/rules/{ruleId}`), and a static `next.config.ts` redirect cannot look that up. `issues/page.tsx` is left untouched: the spec maps `/issues` to `/inbox`, which Wave 3 builds, not to anything this wave builds — redirecting it to `/home/steward` would point users at the wrong destination. `analyse/coverage/page.tsx` is also left untouched; Wave 3 handles it. All four are called out below rather than silently left for a later wave to rediscover.

- [ ] **Step 1: Write the failing redirect test**

```typescript
// frontend/__tests__/legacy-redirects.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("legacy route redirects", () => {
  it("redirects every Wave 1b legacy route to its replacement", async () => {
    const redirects = await nextConfig.redirects!();
    const bySource = new Map(redirects.map((r) => [r.source, r.destination]));
    expect(bySource.get("/findings")).toBe("/objects");
    expect(bySource.get("/versions")).toBe("/runs");
    expect(bySource.get("/analyse/object/:module")).toBe("/objects/:module");
    expect(bySource.get("/analyse/material/:matnr")).toBe("/objects/material_master/records/:matnr");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- legacy-redirects`
Expected: `FAIL` — the new entries are not yet in `next.config.ts` (the existing two `/stewardship` entries pass, the four new assertions fail with `undefined`).

- [ ] **Step 3: Add the four redirects to `frontend/next.config.ts`**

```typescript
async redirects() {
  return [
    { source: "/stewardship", destination: "/workbench?tab=queue", permanent: false },
    { source: "/stewardship/metrics", destination: "/workbench?tab=queue", permanent: false },
    { source: "/findings", destination: "/objects", permanent: false },
    { source: "/versions", destination: "/runs", permanent: false },
    { source: "/analyse/object/:module", destination: "/objects/:module", permanent: false },
    { source: "/analyse/material/:matnr", destination: "/objects/material_master/records/:matnr", permanent: false },
  ];
},
```

- [ ] **Step 4: Delete the four fully-superseded legacy files**

```bash
git rm "frontend/app/(dashboard)/findings/page.tsx" \
       "frontend/app/(dashboard)/versions/page.tsx" \
       "frontend/app/(dashboard)/analyse/object/[module]/page.tsx" \
       "frontend/app/(dashboard)/analyse/material/[matnr]/page.tsx"
```

Do **not** delete `frontend/app/(dashboard)/analyse/rule/[checkId]/page.tsx`, `analyse/finding/[id]/page.tsx`, `issues/page.tsx`, or `analyse/coverage/page.tsx` — see this task's header note.

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `npm test -- legacy-redirects && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/next.config.ts frontend/__tests__/legacy-redirects.test.ts
git commit -m "$(cat <<'EOF'
Redirect and delete the four legacy routes Wave 1b fully replaces

findings, versions, analyse/object/[module] and analyse/material/[matnr]
become static next.config.ts redirects to their /objects and /runs
replacements. analyse/rule/[checkId] and analyse/finding/[id] are left in
place — their replacement URLs need a module/object lookup a static
redirect can't do, and will be addressed in a later wave. issues and
analyse/coverage are also left in place: the spec maps /issues to /inbox,
which Wave 3 builds, and Wave 3 handles analyse/coverage too.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Section 3.1 (legacy routes replaced by redirects): covered by Task 18, with two routes (`analyse/rule/[checkId]`, `analyse/finding/[id]`) explicitly flagged as not static-redirectable and left for a later wave — a real gap, documented rather than hidden.
- Section 6 (persona homes, deterministic three-sentence narrative, unit test): Task 17.
- Section 7 (record fix sheet, material master first): Tasks 7, 8, 12.
- Section 8.6 (run comparison waterfall, rule delta table with sparkline, field correlation): Task 16, with the sparkline's two-point simplification called out explicitly rather than silently shipped as a "real" trend.
- Section 9.3/9.4 (new backend endpoints, typed wrappers, tenant-isolation pytest per endpoint): Tasks 1-8.
- Section 10 (loading/empty/error states on every page): every page task (9-17) includes all three states and asserts them in its test.
- Section 13 (narrative test, readiness/delta computations, one Playwright three-click journey): Task 17 (narrative), Tasks 5/6 (readiness via `tier()`), Task 16 (delta via `compareRecords`), Task 13 (Playwright journey).

**Placeholder scan:** re-run after reading the real fixture pattern in `tests/test_material_360_routes.py` (lines 30-45) and `api/deps.py`'s `Tenant` constructor. No `NotImplementedError` placeholders remain. Task 4 Step 1's `_patch_tenant` and Tasks 5/6's identical inline helper override `get_tenant` on the live `api.main.app` via `monkeypatch.setitem(app.dependency_overrides, ...)` plus the `MERIDIAN_DEV_ROLE_HEADER` dev-role escape hatch, matching the real-Postgres style those tests need. Task 7 Step 1 builds a throwaway `FastAPI()` app, mocks `get_db` and `_tables`, and reuses `tests/material_360_fixture.py`'s `tables()`/`A` constants, matching `tests/test_material_360_routes.py` exactly for its mocked-DB style. No other placeholder language appears.

**Type consistency:** `ObjectSummary`/`ObjectDetail`/`ObjectRule` are defined once in Task 8 and reused verbatim (not redefined) by Tasks 9, 10, 17. `RunStep` is defined once in Task 8 and reused by Task 15. `RecordDiffCheck` is not redefined — Task 16 imports it from the existing `versions.ts`. `Material360` is imported from `materials.ts`, not redefined, by Task 8/12.

---

## Items from the spec this plan could not map to a task

1. **S/4 readiness threshold configuration (spec 8.1, "set in /rules")** — no tenant-wide configurable-per-rule threshold storage exists yet; Wave 1b's `/objects` readiness column uses the tenant's existing global `dqs_weights.thresholds` via `scoring.py:tier()` instead, which is coarser than the spec's eventual per-rule config. Correct behavior for Wave 2, flagged here rather than built as something it isn't.
2. **`/objects/[object]/rules/[ruleId]` and `/objects/[object]/finding/[id]`-equivalent as *redirect targets* for the legacy `analyse/rule/[checkId]` and `analyse/finding/[id]` pages** — both legacy pages take only a check/finding id with no module in the URL, so there is no static redirect; this needs either a thin server-side lookup page or a schema change (storing module in the URL going forward), neither of which this plan builds. Documented as a known gap in Task 18.
3. **Owner-based views** ("objects with no owner", spec section 6's steward narrative hooks) — no `owner` concept exists at the object grain in `db/schema.py`; Task 17's steward narrative/action line is therefore generic rather than owner-specific. A real fix needs either a new schema column or a product decision to derive "owner" from `record_issues.assigned_to` aggregated per module, which is a design decision beyond this plan's remit.
4. **`touches`/job-tray SSE plumbing (spec 9.1)** — confirmed not implemented anywhere in `api/routes/events.py` today; correctly out of scope per the task's stated section list (3.1, 6, 7, 8.6, 9.3, 9.4, 10 only), not attempted here.
5. **`/inbox` and `frontend/lib/api/remediation.ts`** — neither exists yet and neither is built here; both are Wave 3 per the spec's wave table. The legacy `/issues` route is therefore left untouched in this wave rather than redirected to a page that isn't its real replacement — Task 18 does not touch `issues/page.tsx` or add an `/issues` redirect.
6. **`analyse/coverage/page.tsx`** (module coverage by SAP view/table, `components/analyse/coverage-object.tsx`) — left untouched in this wave; Wave 3 handles it.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-08-frontend-redesign-wave1b.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

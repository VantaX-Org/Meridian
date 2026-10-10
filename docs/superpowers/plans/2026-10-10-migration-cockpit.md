# Migration Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing migration engine into a migration cockpit. Waves become rows with systems, scope, target date, stage, thresholds and sign-off. Each wave shows its readiness, trend, top blockers and S/4 areas. Runs re-trigger when the source system's data is refreshed. The UI lives at `/migration`.

**Architecture:**
- Data:
  - Migration 068 adds the `migration_waves` table (tenant RLS) and `migration_runs.wave_id`.
  - It copies each tenant's `alert_thresholds.readiness_waves` into rows.
- Backend:
  - `api/services/insights_readiness.py` maps the engine verdicts (`go`, `conditional`, `no-go`) to the grid verdicts (`go`, `at_risk`, `no_go`). Each cell gains `score` and `records_blocked`.
  - `/insights/readiness` reads waves from the table and no longer returns 409.
  - `api/routes/migration.py` adds wave CRUD, run, cockpit, sign-off, report (xlsx and pdf) and blocker fix-batch routes. All of them reuse the existing `start_migration` enqueue path through one extracted helper.
  - `workers/tasks/run_checks.py` enqueues a wave run for each open wave sourced from the system that has just been analysed.
- Frontend:
  - `/migration` lists the waves and has a dialog to create one.
  - `/migration/[waveId]` has five tabs: Objects, Blockers, Mapping, S/4 areas and Downloads.
  - The nav entry "Migration" points to `/migration`.

**Tech Stack:** FastAPI, SQLAlchemy `text()` SQL on Postgres with RLS, Alembic, Celery, Jinja + WeasyPrint (`api/services/pdf_reports.render`), pandas + openpyxl, Next.js App Router, React Query, `@/design`, vitest + Testing Library, Playwright (HAR replay), pytest.

**Spec:** `docs/superpowers/specs/2026-10-10-monitoring-migration-breadth-design.md`, section 2 only (lines 46-107).

**Global constraints:**
- No `any` in TypeScript and no `Any` in new Python signatures. Narrow API data with types; do not use `as` casts on API data.
- Never add to the `lint:tokens` allowlist. Use design tokens only: `var(--m-ink)`, `var(--m-ink-2)`, `var(--m-ink-3)`, `var(--m-line)`, `var(--m-pass)`, `var(--m-critical)`, `var(--m-accent)`.
- No customer names in code, tests, fixtures or commit messages. Use neutral names such as `PRD`, `S4D` and `Wave 1`.
- Rule IDs are append-only. This plan adds no rules.
- Migration 068 revises `"067"` and must downgrade cleanly.
- Every new table gets tenant RLS (`ENABLE` + `FORCE` + a `tenant_id = current_setting('app.tenant_id')::uuid` policy), and every tenant-scoped ORM model needs an RLS migration (`tests/test_rls_conformance.py`).
- Times shown to users are in SAST with the zone label: `formatDate(iso, "datetime", "SAST")` in the frontend and the new `sast` filter in PDFs.
- The eslint copy rules apply. Do not use "Cancel", "Submit", "OK", "Error", "Loading", "dashboard", "click here", "Oops" or "Sorry" in UI copy. Verdict sentences end with a full stop.
- The UI uses Aurora (`@/design`) only. Import charts from `@/design`, never from `recharts`. Only `PageHeader` renders an `h1`.
- Reporting means both an Excel export and a branded PDF.
- Implementers do not run `npm run build`.
- Backend test command: `python3 -m pytest <file> -q -p no:cacheprovider`. Postgres tests skip unless `MERIDIAN_TEST_DB_URL` is set. Run them with `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test`.
- Frontend gate, for every frontend task: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`. `npm test` runs `vitest run`.
- Frontend tests live in `__tests__/` next to the file under test. Component tests use `renderWithQuery` from `@/__tests__/render`.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

**Spec corrections (verified against the code at 48b85d59):**
1. **Endpoint count.** `api/routes/migration.py` has 15 endpoints, not about 20.
2. **Verdict spelling.** The engine and `migration_runs.readiness_verdict` use `go`, `conditional` and `no-go` (hyphen). The grid uses `go`, `at_risk` and `no_go` (underscore). The `conditional`-as-`no_go` mapping is at `insights_readiness.py:37-38` (`if mr.verdict != "go"`), not only line 38.
3. **RLS pattern source.** Migration 043 is the RLS backfill. The per-table pattern this plan copies (`ENABLE`, `FORCE`, `DROP POLICY IF EXISTS`, `CREATE POLICY`) comes from 044, 048 and 057. The new migration is 068, revising 067.
4. **Column names.** `migration_runs` calls the target `dest_system_id`. `migration_waves` uses `target_system_id`, as the spec says. The run helper maps one to the other.
5. **Nav entry exists.** `frontend/lib/nav.ts:107` already has a "Migration" entry. It points to `/insights/readiness`. Task 7 repoints it; it does not add a second entry.
6. **ORM model required.** `tests/test_rls_conformance.py` fails unless every tenant-scoped table is also a model in `db/schema.py`. Task 1 adds `MigrationWave` and `MigrationRun.wave_id`.
7. **S/4 areas already have an endpoint.** `GET /findings/s4-readiness?version_id=` (`api/routes/findings.py:455`) rolls up the S/4 rules of one analysis version. The cockpit returns the wave's `source_version_id`, and the S/4 areas tab calls that endpoint. The cockpit does not duplicate the rollup.
8. **Audit.** `api/middleware/audit.py` already audits every POST under `/api/v1/`, but it stores only the request body. The sign-off route also writes its own `audit_log` row, in the same transaction, with `before_json` and `after_json`.
9. **PDF times.** The `dt` filter in `api/services/pdf_reports.py:78` prints UTC. The readiness report needs SAST, so Task 5 adds a `sast` filter. Existing reports are unchanged.
10. **`/insights/summary` catches the 409.** `api/routes/insights.py:248-252` wraps `get_readiness` in `try/except HTTPException` for the 409. Task 2 removes the 409, so it removes that guard too.

**Rulings (decisions this plan makes where the spec is silent):**
1. **Waves come from rows only.** The grid reads `migration_waves`. `AlertThresholds.readiness_waves` stays in the settings model for now but nothing reads it after Task 2. Removing it is follow-up work.
2. **No waves means an empty grid.** `/insights/readiness` returns `cells: []` instead of 409.
3. **Which run a wave uses.** A wave's readiness comes from its latest `analysed` run with that `wave_id`. A wave with no run of its own (for example a wave copied from settings, which has no source system) falls back to the tenant's latest analysed run. This keeps today's grid for existing tenants.
4. **Cell and wave verdict.** Engine `no-go` becomes `no_go`, and engine `conditional` becomes `at_risk`. Engine `go` becomes `at_risk` when the score is below `min_readiness` or the DQS is below `min_dqs`. Otherwise it is `go`. The wave verdict is the worst cell verdict. A wave with no modules is `no_go`.
5. **`blocker_count` changes meaning.** It was the number of blocked records. It becomes the number of blocking gaps (every gap type except `unmapped_field` and `target_config_unverified`). The number of blocked records moves to the new `records_blocked` field.
6. **Top 20 blockers.** These are `critical` and `high` gaps, grouped by `(module, gap_type, field)` and ordered by `COUNT(DISTINCT record_key)`, then by gap count. Structural gaps have no record key and count 0 records, so they sort after record-level gaps with the same count. That is acceptable because they appear in the verdict anyway.
7. **Trend.** The trend is `readiness_score` and `completed_at` of the wave's last 30 `analysed` runs, oldest first.
8. **Sign-off.**
   - It needs `approve` and the wave verdict must be `go`. Otherwise it returns 409.
   - Signing off a wave that is already signed off returns 409.
   - Any PATCH of a signed-off wave clears the sign-off.
9. **Auto re-run.** When `run_checks` completes for a system, it enqueues one `run_migration` for every wave whose `source_system_id` is that system and whose `signed_off_at` is null. The run analyses the new version (`source_version_id = version_id`). A signed-off wave is frozen.
10. **Create fix batch.** The new route `POST /migration/waves/{id}/blockers/fix-batch` takes `{module, gap_type, field}` and needs the `apply` permission.
    - It joins the blocker's record keys to open `record_issues` on `(module, record_key)` and calls `remediation.draft_batch`.
    - If no open DQ issue matches, it returns 400 with "No open data quality issues match these records. Fix the mapping in the Mapping tab." Mapping-only gaps are fixed in the Mapping tab.
11. **Business-object labels.** The map lives in `api/services/migration/__init__.py`. Unknown modules fall back to title case. The frontend gets the label from the API (`label` on each object), so the map has one home.

---

## File map

| File | Change | Task |
|---|---|---|
| `db/migrations/versions/068_migration_waves.py` | new: `migration_waves` with RLS, `migration_runs.wave_id`, settings copy | 1 |
| `db/schema.py` | `MigrationWave`; `MigrationRun.wave_id` | 1 |
| `tests/test_migration_waves_pg.py` | new: RLS isolation, settings copy, downgrade | 1 |
| `api/services/insights_readiness.py` | `cell_verdict`, `wave_verdict`, `blocker_count`, per-wave `build_wave_cells` | 2 |
| `api/routes/insights.py` | grid reads `migration_waves`; no 409; summary guard removed | 2 |
| `tests/test_insights_readiness.py` | rewritten for the new functions | 2 |
| `tests/test_insights_readiness_route.py` | 409 tests become empty-grid and wave-row tests | 2 |
| `frontend/lib/api/insights.ts` | `ReadinessCell.score`, `records_blocked` | 2 |
| `frontend/app/(app)/insights/readiness/page.tsx` | score and records-blocked columns | 2 |
| `frontend/app/(app)/insights/readiness/__tests__/page.test.tsx` | fixtures gain the new fields | 2 |
| `api/services/migration/__init__.py` | `OBJECT_LABELS`, `object_label()` | 3 |
| `api/routes/migration.py` | `_enqueue_run`; wave CRUD; `POST /waves/{id}/run` | 3 |
| `tests/test_migration_waves_routes.py` | new: CRUD, validation, tenant isolation, run enqueue | 3 |
| `api/services/migration/cockpit.py` | new: `load_cockpit()` (async SQL) | 4 |
| `api/routes/migration.py` | `GET /waves/{id}/cockpit`; `POST /waves/{id}/signoff` | 4 |
| `tests/test_migration_cockpit_pg.py` | new: cockpit SQL, verdict, blockers, sign-off and audit | 4 |
| `api/services/pdf_reports.py` | `fmt_sast` and the `sast` filter | 5 |
| `templates/migration_readiness_report.html` | new branded PDF template | 5 |
| `api/routes/migration.py` | `GET /waves/{id}/report.{xlsx,pdf}`; `POST /waves/{id}/blockers/fix-batch` | 5 |
| `tests/test_migration_report.py` | new: xlsx sheets, PDF render, fix-batch | 5 |
| `workers/tasks/run_checks.py` | `enqueue_wave_reruns()` and the completion hook | 6 |
| `tests/test_wave_rerun.py` | new | 6 |
| `frontend/types/api.ts` | `MigrationWave`, `WaveVerdict`, `WaveCockpit`, `WaveBlocker`, `WaveObject` | 7 |
| `frontend/lib/api/migration.ts` | wave client functions | 7, 8 |
| `frontend/lib/query-keys.ts` | `migrationWaves`, `migrationCockpit`, `migrationFieldMap`, `migrationValueMap`, `migrationGaps` | 7, 8 |
| `frontend/app/(app)/migration/page.tsx` | new: wave list | 7 |
| `frontend/app/(app)/migration/create-wave-dialog.tsx` | new | 7 |
| `frontend/app/(app)/migration/__tests__/page.test.tsx` | new | 7 |
| `frontend/lib/nav.ts` | "Migration" points to `/migration` | 7 |
| `frontend/app/(app)/migration/[waveId]/page.tsx` | new: cockpit header and tabs | 8 |
| `frontend/app/(app)/migration/[waveId]/blockers-tab.tsx` | new | 8 |
| `frontend/app/(app)/migration/[waveId]/mapping-tab.tsx` | new | 8 |
| `frontend/app/(app)/migration/[waveId]/s4-tab.tsx` | new | 8 |
| `frontend/app/(app)/migration/[waveId]/__tests__/page.test.tsx` | new | 8 |
| `frontend/e2e/migration-cockpit.spec.ts` | new | 8 |
| `frontend/e2e/routes.json` | `/migration` and `/migration/[waveId]` entries | 8 |

---

### Task 1: Migration 068: the `migration_waves` table

**Files:**
- Create: `db/migrations/versions/068_migration_waves.py`
- Modify: `db/schema.py`. Add `MigrationWave` above `class MigrationRun` (line 729), and add `wave_id` to `MigrationRun`.
- Test: `tests/test_migration_waves_pg.py` (new)

**Interfaces:**
- Consumes: `tenants.alert_thresholds` (JSONB, keys `readiness_waves` and `readiness_dqs_threshold`), `sap_systems`, `users`, `migration_runs`.
- Produces:
  - Table `migration_waves`:
    - `id`, `tenant_id`, `name` (unique per tenant).
    - `source_system_id`, `target_system_id` (both nullable, `ON DELETE SET NULL`).
    - `target_release` (default `'s4hana'`).
    - `modules text[]`, `target_date date`.
    - `stage` (CHECK: `plan`, `mock1`, `mock2`, `dress`, `cutover`; default `plan`).
    - `min_readiness float NOT NULL DEFAULT 95`, `min_dqs float NULL`.
    - `signed_off_by` (FK `users`), `signed_off_at`, `created_at`, `updated_at`.
  - `migration_runs.wave_id` (FK, `ON DELETE SET NULL`) and the index `ix_migration_runs_wave`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_waves_pg.py`:

```python
"""Migration 068: migration_waves is tenant-isolated, seeded from settings, and reversible.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so the policy is really exercised.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_waves_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def app_engine():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant(owner, thresholds: dict | None = None) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, alert_thresholds) VALUES (:t, :n, CAST(:a AS jsonb))"),
                  {"t": tid, "n": f"D-{tid[:8]}", "a": json.dumps(thresholds) if thresholds else None})
    return tid


@pg
def test_waves_are_tenant_isolated(app_engine):
    from sqlalchemy import text

    owner, app = app_engine
    a, b = _tenant(owner), _tenant(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        c.execute(text("INSERT INTO migration_waves (tenant_id, name, modules) VALUES (:t, 'Wave 1', '{material_master}')"),
                  {"t": a})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
        assert c.execute(text("SELECT COUNT(*) FROM migration_waves")).scalar() == 0
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        row = c.execute(text("SELECT stage, min_readiness, min_dqs FROM migration_waves")).one()
        assert (row.stage, row.min_readiness, row.min_dqs) == ("plan", 95.0, None)


@pg
def test_stage_is_constrained(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, _app = app_engine
    t = _tenant(owner)
    with pytest.raises(IntegrityError):
        with owner.begin() as c:
            c.execute(text("INSERT INTO migration_waves (tenant_id, name, stage) VALUES (:t, 'W', 'golive')"), {"t": t})


@pg
def test_settings_waves_are_copied_and_downgrade_is_clean(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    t = _tenant(owner, {"readiness_dqs_threshold": 80,
                        "readiness_waves": {"Wave 1": ["material_master", "business_partner"], "Wave 2": []}})
    _alembic("downgrade", "067")
    try:
        with owner.begin() as c:
            assert c.execute(text("SELECT to_regclass('migration_waves')")).scalar() is None
            assert c.execute(text("SELECT 1 FROM information_schema.columns WHERE table_name = 'migration_runs' "
                                  "AND column_name = 'wave_id'")).scalar() is None
    finally:
        _alembic("upgrade", "head")
    with owner.begin() as c:
        rows = c.execute(text("SELECT name, modules, min_dqs FROM migration_waves WHERE tenant_id = :t ORDER BY name"),
                         {"t": t}).all()
    assert [(r.name, list(r.modules), r.min_dqs) for r in rows] == [
        ("Wave 1", ["material_master", "business_partner"], 80.0),
        ("Wave 2", [], 80.0),
    ]
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_waves_pg.py -q -p no:cacheprovider`
Expected: FAIL. `relation "migration_waves" does not exist`.

- [ ] **Step 3: Implement**

Create `db/migrations/versions/068_migration_waves.py`:

```python
"""migration waves

Revision ID: 068
Revises: 067
Create Date: 2026-10-10

A wave is a planned cutover unit: source and target systems, modules, target
date, stage, readiness thresholds and sign-off. migration_runs.wave_id ties a
run to its wave so the cockpit can show a trend. Existing tenant settings
(alert_thresholds.readiness_waves: name -> [modules]) are copied into rows.
The copy runs before RLS is enabled, as the migration owner.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "068"
down_revision: Union[str, None] = "067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STAGES = ("plan", "mock1", "mock2", "dress", "cutover")


def upgrade() -> None:
    op.create_table(
        "migration_waves",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("source_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("target_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("target_release", sa.Text(), nullable=False, server_default="s4hana"),
        sa.Column("modules", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("stage", sa.Text(), nullable=False, server_default="plan"),
        sa.Column("min_readiness", sa.Float(), nullable=False, server_default="95"),
        sa.Column("min_dqs", sa.Float(), nullable=True),
        sa.Column("signed_off_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("signed_off_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("stage IN ('plan', 'mock1', 'mock2', 'dress', 'cutover')", name="ck_migration_waves_stage"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_migration_waves_tenant_name"),
    )
    op.create_index("ix_migration_waves_source", "migration_waves", ["tenant_id", "source_system_id"])
    op.add_column("migration_runs", sa.Column(
        "wave_id", UUID(as_uuid=True), sa.ForeignKey("migration_waves.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_migration_runs_wave", "migration_runs", ["wave_id", "completed_at"])

    op.execute("""
        INSERT INTO migration_waves (tenant_id, name, modules, min_dqs)
        SELECT t.id, w.key,
               ARRAY(SELECT jsonb_array_elements_text(w.value)),
               (t.alert_thresholds->>'readiness_dqs_threshold')::float
          FROM tenants t,
               jsonb_each(COALESCE(t.alert_thresholds->'readiness_waves', '{}'::jsonb)) AS w
         WHERE jsonb_typeof(w.value) = 'array'
        ON CONFLICT (tenant_id, name) DO NOTHING
    """)

    op.execute("ALTER TABLE migration_waves ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE migration_waves FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS migration_waves_rls ON migration_waves")
    op.execute("CREATE POLICY migration_waves_rls ON migration_waves "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_index("ix_migration_runs_wave", table_name="migration_runs")
    op.drop_column("migration_runs", "wave_id")
    op.execute("DROP POLICY IF EXISTS migration_waves_rls ON migration_waves")
    op.drop_index("ix_migration_waves_source", table_name="migration_waves")
    op.drop_table("migration_waves")
```

In `db/schema.py`, add this class directly above `class MigrationRun(Base):`. `Date`, `Float`, `CheckConstraint` and `UniqueConstraint` must be imported; add any that the `from sqlalchemy import (...)` block at line 15 is missing.

```python
class MigrationWave(Base):
    __tablename__ = "migration_waves"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    source_system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="SET NULL"), nullable=True)
    target_system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="SET NULL"), nullable=True)
    target_release = Column(Text, nullable=False, server_default="s4hana")
    modules = Column(ARRAY(Text), nullable=False, server_default="{}")
    target_date = Column(Date, nullable=True)
    stage = Column(Text, nullable=False, server_default="plan")  # plan|mock1|mock2|dress|cutover
    min_readiness = Column(Float, nullable=False, server_default="95")
    min_dqs = Column(Float, nullable=True)
    signed_off_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    signed_off_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("stage IN ('plan', 'mock1', 'mock2', 'dress', 'cutover')", name="ck_migration_waves_stage"),
        UniqueConstraint("tenant_id", "name", name="uq_migration_waves_tenant_name"),
        Index("ix_migration_waves_source", "tenant_id", "source_system_id"),
    )
```

In `MigrationRun`, add after `dest_system_id`:

```python
    wave_id = Column(UUID(as_uuid=True), ForeignKey("migration_waves.id", ondelete="SET NULL"), nullable=True)
```

and extend its `__table_args__`:

```python
    __table_args__ = (
        Index("ix_migration_runs_tenant_status", "tenant_id", "status"),
        Index("ix_migration_runs_wave", "wave_id", "completed_at"),
    )
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_waves_pg.py tests/test_rls_conformance.py -q -p no:cacheprovider`
Expected: PASS (3 + the conformance tests).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/versions/068_migration_waves.py db/schema.py tests/test_migration_waves_pg.py
git commit -m "feat(migration): migration_waves table with RLS and wave_id on runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 2: Readiness grid by wave row, with `at_risk`, `score` and `records_blocked`

**Files:**
- Modify: `api/services/insights_readiness.py` (rewrite; 45 lines today)
- Modify: `api/routes/insights.py:25-77` (`get_readiness`) and `:245-255` (the summary's 409 guard)
- Modify: `tests/test_insights_readiness.py` (rewrite), `tests/test_insights_readiness_route.py`
- Modify: `frontend/lib/api/insights.ts`, `frontend/app/(app)/insights/readiness/page.tsx`, `frontend/app/(app)/insights/readiness/__tests__/page.test.tsx`

**Interfaces:**
- Consumes:
  - `migration_waves` (Task 1).
  - `migration_runs.gap_summary`, keyed by module, with `{records, blocked_records, score, verdict, gaps: {gap_type: n}}` (see `workers/tasks/run_migration.py:176`).
  - `analysis_versions.dqs_summary`.
- Produces:
  - `ReadinessCell(module, wave, verdict, blocker_count, dqs, score, records_blocked)`.
  - `cell_verdict(engine_verdict, score, dqs, min_readiness, min_dqs) -> str`.
  - `wave_verdict(cells) -> str`. Order is `no_go` > `at_risk` > `go`. No cells gives `no_go`.
  - `blocking_gaps(gap_counts) -> int`.
  - `build_wave_cells(wave, modules, gap_summary, dqs_by_module, min_readiness, min_dqs) -> list[ReadinessCell]`.
  - `GET /api/v1/insights/readiness` returns `{version_id, threshold, cells}`. `cells` is empty when the tenant has no waves.

- [ ] **Step 1: Write the failing tests**

Replace `tests/test_insights_readiness.py`:

```python
from api.services.insights_readiness import (
    ReadinessCell,
    blocking_gaps,
    build_wave_cells,
    cell_verdict,
    wave_verdict,
)


def test_engine_verdicts_map_to_grid_verdicts():
    assert cell_verdict("no-go", 50.0, 90.0, 95, None) == "no_go"
    assert cell_verdict("conditional", 96.0, 90.0, 95, None) == "at_risk"
    assert cell_verdict("go", 100.0, 90.0, 95, None) == "go"
    assert cell_verdict(None, None, None, 95, None) == "no_go"


def test_go_drops_to_at_risk_below_a_threshold():
    assert cell_verdict("go", 94.9, None, 95, None) == "at_risk"
    assert cell_verdict("go", 100.0, 60.0, 95, 70) == "at_risk"
    assert cell_verdict("go", 100.0, 70.0, 95, 70) == "go"
    assert cell_verdict("go", 100.0, None, 95, 70) == "go"


def test_blocking_gaps_ignore_informational_types():
    assert blocking_gaps({"unmapped_field": 9, "target_config_unverified": 2, "value_unmapped": 3,
                          "key_missing": 1}) == 4
    assert blocking_gaps({}) == 0


def test_cells_carry_score_and_records_blocked():
    gap_summary = {"material_master": {"records": 100, "blocked_records": 4, "score": 96.0,
                                       "verdict": "conditional", "gaps": {"value_unmapped": 4, "unmapped_field": 2}}}
    cells = build_wave_cells("Wave 1", ["material_master", "asset_accounting"], gap_summary,
                             {"material_master": 88.0}, 95, None)
    assert cells == [
        ReadinessCell("material_master", "Wave 1", "at_risk", 4, 88.0, 96.0, 4),
        ReadinessCell("asset_accounting", "Wave 1", "no_go", 0, None, None, 0),
    ]


def test_wave_verdict_is_the_worst_cell():
    def c(v: str) -> ReadinessCell:
        return ReadinessCell("m", "W", v, 0, None, None, 0)

    assert wave_verdict([c("go"), c("go")]) == "go"
    assert wave_verdict([c("go"), c("at_risk")]) == "at_risk"
    assert wave_verdict([c("at_risk"), c("no_go")]) == "no_go"
    assert wave_verdict([]) == "no_go"
```

In `tests/test_insights_readiness_route.py`, replace `test_readiness_requires_waves_configured` and `test_readiness_is_tenant_isolated` with the tests below. Keep the fixture and `_patch_tenant` as they are.

```python
@pytest.mark.anyio
async def test_readiness_without_waves_is_an_empty_grid(two_tenants, monkeypatch):
    t1, _t2 = two_tenants
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    assert r.json()["cells"] == []


@pytest.mark.anyio
async def test_readiness_reads_wave_rows_and_is_tenant_isolated(two_tenants, monkeypatch):
    t1, t2 = two_tenants
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO migration_waves (tenant_id, name, modules) VALUES (:t, 'Wave 1', '{material_master}')"),
                     {"t": t1})
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    assert r.json()["cells"] == [{"module": "material_master", "wave": "Wave 1", "verdict": "no_go",
                                  "blocker_count": 0, "dqs": None, "score": None, "records_blocked": 0}]

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r2 = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r2.json()["cells"] == []
```

The `two_tenants` teardown deletes tenants, so it must delete the waves first. Change its teardown to:

```python
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM migration_waves WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
```

In `frontend/app/(app)/insights/readiness/__tests__/page.test.tsx`, change the first test's cell to `{ module: "material_master", wave: "Wave 1", verdict: "go", blocker_count: 0, dqs: 92, score: 100, records_blocked: 0 }`, and add this assertion at the end of that test:

```tsx
    expect(screen.getByText("100.0%")).toBeInTheDocument();
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python3 -m pytest tests/test_insights_readiness.py -q -p no:cacheprovider`
Expected: FAIL. `ImportError: cannot import name 'blocking_gaps'`.
Run: `cd frontend && npx vitest run "app/(app)/insights/readiness"`
Expected: FAIL on the `100.0%` assertion only.

- [ ] **Step 3: Implement**

Replace `api/services/insights_readiness.py`:

```python
"""Deterministic readiness grid for /insights/readiness and the migration cockpit (spec 2).

Rows are modules; columns are migration_waves rows. Engine verdicts (engine.py) are
go / conditional / no-go; grid verdicts are go / at_risk / no_go:
  no-go (or no result)  -> no_go
  conditional           -> at_risk
  go                    -> at_risk when score < min_readiness or DQS < min_dqs, else go
"""
from dataclasses import dataclass

_ENGINE = {"go": "go", "conditional": "at_risk", "no-go": "no_go"}
_RANK = {"go": 0, "at_risk": 1, "no_go": 2}
# gap types that never block a record on their own (engine.py)
_INFORMATIONAL = frozenset({"unmapped_field", "target_config_unverified"})


@dataclass
class ReadinessCell:
    module: str
    wave: str
    verdict: str
    blocker_count: int
    dqs: float | None
    score: float | None
    records_blocked: int


def cell_verdict(engine_verdict: str | None, score: float | None, dqs: float | None,
                 min_readiness: float, min_dqs: float | None) -> str:
    v = _ENGINE.get(engine_verdict or "", "no_go")
    if v != "go":
        return v
    if score is not None and score < min_readiness:
        return "at_risk"
    if dqs is not None and min_dqs is not None and dqs < min_dqs:
        return "at_risk"
    return "go"


def wave_verdict(cells: list[ReadinessCell]) -> str:
    if not cells:
        return "no_go"
    return max((c.verdict for c in cells), key=_RANK.__getitem__)


def blocking_gaps(gap_counts: dict[str, int]) -> int:
    return sum(n for t, n in gap_counts.items() if t not in _INFORMATIONAL)


def build_wave_cells(wave: str, modules: list[str], gap_summary: dict[str, dict], dqs_by_module: dict[str, float | None],
                     min_readiness: float, min_dqs: float | None) -> list[ReadinessCell]:
    cells: list[ReadinessCell] = []
    for module in modules:
        mr = gap_summary.get(module)
        dqs = dqs_by_module.get(module)
        if mr is None:
            cells.append(ReadinessCell(module, wave, "no_go", 0, dqs, None, 0))
            continue
        score = mr.get("score")
        cells.append(ReadinessCell(
            module, wave, cell_verdict(mr.get("verdict"), score, dqs, min_readiness, min_dqs),
            blocking_gaps(mr.get("gaps") or {}), dqs, score, int(mr.get("blocked_records") or 0)))
    return cells
```

In `api/routes/insights.py`:
- Change the import to `from api.services.insights_readiness import build_wave_cells`.
- Replace the body of `get_readiness` after `await _rls(db, tenant)` with the code below.

```python
    thresholds = (await db.execute(
        text("SELECT alert_thresholds FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).scalar() or {}
    dqs_threshold = thresholds.get("readiness_dqs_threshold", 70)
    waves = (await db.execute(text(
        "SELECT id, name, modules, min_readiness, min_dqs FROM migration_waves "
        "WHERE tenant_id = :t ORDER BY target_date NULLS LAST, name"), {"t": str(tenant.id)})).fetchall()

    # A wave reads its own latest analysed run; a wave without one falls back to the tenant's
    # latest analysed run (optionally pinned by version_id), so grids built from settings still show.
    run_sql = """
        SELECT gap_summary, source_version_id FROM migration_runs
        WHERE tenant_id = :t AND status = 'analysed'
          AND (CAST(:wid AS uuid) IS NULL OR wave_id = CAST(:wid AS uuid))
          AND (CAST(:vid AS uuid) IS NULL OR source_version_id = CAST(:vid AS uuid))
        ORDER BY completed_at DESC LIMIT 1
    """
    vid = str(version_id) if version_id else None
    fallback = (await db.execute(text(run_sql), {"t": str(tenant.id), "wid": None, "vid": vid})).fetchone()

    async def dqs_for(version) -> dict:
        if not version:
            return {}
        row = (await db.execute(
            text("SELECT dqs_summary FROM analysis_versions WHERE id = :vid AND tenant_id = :t"),
            {"vid": str(version), "t": str(tenant.id)},
        )).fetchone()
        return {m: (d or {}).get("composite_score") for m, d in ((row[0] if row else {}) or {}).items()}

    cells = []
    for w in waves:
        run = (await db.execute(text(run_sql), {"t": str(tenant.id), "wid": str(w.id), "vid": vid})).fetchone() or fallback
        cells += build_wave_cells(w.name, list(w.modules or []), (run[0] if run else {}) or {},
                                  await dqs_for(run[1] if run else None), w.min_readiness,
                                  w.min_dqs if w.min_dqs is not None else dqs_threshold)
    resolved = fallback[1] if fallback else version_id
    return {
        "version_id": str(resolved) if resolved else None,
        "threshold": dqs_threshold,
        "cells": [c.__dict__ for c in cells],
    }
```

Then:
- Remove the `HTTPException` import from `api/routes/insights.py` only if nothing else in the file uses it. Lines 209 and 245 still do, so keep it.
- At line 248, replace the `try: readiness = await get_readiness(...) / except HTTPException as exc: if exc.status_code != 409: raise ...` block with `readiness = await get_readiness(version_id, db, tenant)`. Keep whatever the `except` branch assigned as the default only if later code reads it. Read lines 240-275 first. If the branch set `readiness = None`, the `None` path is now dead and can go.

In `frontend/lib/api/insights.ts`, extend `ReadinessCell`:

```ts
export interface ReadinessCell {
  module: string;
  wave: string;
  verdict: "go" | "at_risk" | "no_go";
  /** Blocking gaps (every gap type except unmapped_field and target_config_unverified). */
  blocker_count: number;
  dqs: number | null;
  /** Transfer readiness %, from the wave's latest migration run. */
  score: number | null;
  records_blocked: number;
}
```

In `frontend/app/(app)/insights/readiness/page.tsx`, add two cells next to the verdict pill in the row that renders a cell (line 66), using the same cell markup as the existing columns:

```tsx
<td className="text-right tabular-nums">{cell.score === null ? "—" : `${cell.score.toFixed(1)}%`}</td>
<td className="text-right tabular-nums">{cell.records_blocked.toLocaleString()}</td>
```

Add the matching header cells "Readiness" and "Records blocked" in the table head.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_insights_readiness.py -q -p no:cacheprovider`. Expected: PASS (5).
Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_insights_readiness_route.py tests/test_settings_insights.py -q -p no:cacheprovider`. Expected: PASS.
Run the frontend gate. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/insights_readiness.py api/routes/insights.py tests/test_insights_readiness.py \
  tests/test_insights_readiness_route.py frontend/lib/api/insights.ts "frontend/app/(app)/insights/readiness"
git commit -m "feat(insights): readiness grid by wave row, conditional shown as at_risk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 3: Business-object labels, wave CRUD and "run now"

**Files:**
- Modify: `api/services/migration/__init__.py`
- Modify: `api/routes/migration.py`. Extract `_enqueue_run` from `start_migration` (lines 102-163). Add the wave routes after the `# ── Runs ──` section.
- Test: `tests/test_migration_waves_routes.py` (new)

**Interfaces:**
- Consumes: `migration_waves` (Task 1), `run_migration.delay(tenant, run_id, mode, src, dest, modules, source_version_id, target_release)`.
- Produces:
  - `OBJECT_LABELS: dict[str, str]` and `object_label(module) -> str`.
  - `_enqueue_run(db, tenant_id, user_id, mode, src, dest, modules, source_version_id, target_release, wave_id=None) -> dict`. It commits, and returns `{run_id, task_id, status, mode, modules}`.
  - `GET /api/v1/migration/waves` (`view`) returns `{"waves": [...]}`. Each wave carries its columns plus the latest run fields `last_run_id`, `last_verdict`, `last_score`, `last_completed_at` and `trend: [score, ...]` (the last 12 analysed scores, oldest first).
  - `POST /api/v1/migration/waves` (`analyse`) takes a `WaveCreate` body and returns the wave. Validation:
    - A name that already exists returns 409.
    - An unknown system returns 404.
    - Source equal to target returns 400.
    - An unknown stage returns 422.
  - `PATCH /api/v1/migration/waves/{id}` (`analyse`) takes a `WaveUpdate` body. It clears the sign-off.
  - `DELETE /api/v1/migration/waves/{id}` (`analyse`) returns 204. Its runs keep `wave_id = NULL`.
  - `POST /api/v1/migration/waves/{id}/run` (`analyse`) enqueues `source_to_destination` for the wave. It returns 400 when the wave has no source system or no modules.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_waves_routes.py`:

```python
"""Wave CRUD and run-now (api/routes/migration.py) on Postgres, through the real app and RLS."""

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app
from api.services.migration import object_label

pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
H = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


def test_object_labels():
    assert object_label("material_master") == "Material"
    assert object_label("accounts_payable") == "BP supplier"
    assert object_label("sd_customer_master") == "BP customer"
    assert object_label("fi_gl") == "GL account"
    assert object_label("asset_accounting") == "Fixed asset"
    assert object_label("plant_maintenance") == "Plant Maintenance"


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2, prd, s4d = (str(uuid.uuid4()) for _ in range(4))
    with engine.begin() as c:
        for t in (t1, t2):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:p, :t, 'PRD'), (:s, :t, 'S4D')"),
                  {"p": prd, "s": s4d, "t": t1})
    yield t1, t2, prd, s4d
    with engine.begin() as c:
        c.execute(text("DELETE FROM migration_runs WHERE tenant_id IN (:a, :b)"), {"a": t1, "b": t2})
        c.execute(text("DELETE FROM migration_waves WHERE tenant_id IN (:a, :b)"), {"a": t1, "b": t2})
        c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :a"), {"a": t1})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": t1, "b": t2})
    engine.dispose()


async def _as(monkeypatch, tenant_id: str) -> AsyncClient:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002",
                                               "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))
    await api_deps.engine.dispose()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pg
@pytest.mark.anyio
async def test_wave_crud_is_tenant_isolated(tenants, monkeypatch):
    t1, t2, prd, s4d = tenants
    async with await _as(monkeypatch, t1) as c:
        r = await c.post("/api/v1/migration/waves", headers=H, json={
            "name": "Wave 1", "source_system_id": prd, "target_system_id": s4d,
            "modules": ["material_master"], "target_date": "2027-03-01", "stage": "mock1"})
        assert r.status_code == 200, r.text
        wid = r.json()["id"]
        assert r.json()["min_readiness"] == 95.0
        assert (await c.post("/api/v1/migration/waves", headers=H, json={"name": "Wave 1"})).status_code == 409
        assert (await c.post("/api/v1/migration/waves", headers=H,
                             json={"name": "W2", "source_system_id": prd, "target_system_id": prd})).status_code == 400
        assert (await c.post("/api/v1/migration/waves", headers=H,
                             json={"name": "W3", "stage": "golive"})).status_code == 422
        r = await c.patch(f"/api/v1/migration/waves/{wid}", headers=H, json={"stage": "mock2", "min_dqs": 75})
        assert r.status_code == 200 and r.json()["stage"] == "mock2" and r.json()["min_dqs"] == 75.0
        waves = (await c.get("/api/v1/migration/waves", headers=H)).json()["waves"]
        assert [w["name"] for w in waves] == ["Wave 1"] and waves[0]["trend"] == []
    async with await _as(monkeypatch, t2) as c:
        assert (await c.get("/api/v1/migration/waves", headers=H)).json()["waves"] == []
        assert (await c.patch(f"/api/v1/migration/waves/{wid}", headers=H, json={"stage": "dress"})).status_code == 404
        assert (await c.delete(f"/api/v1/migration/waves/{wid}", headers=H)).status_code == 404
    async with await _as(monkeypatch, t1) as c:
        assert (await c.delete(f"/api/v1/migration/waves/{wid}", headers=H)).status_code == 204


@pg
@pytest.mark.anyio
async def test_run_now_enqueues_a_wave_run(tenants, monkeypatch):
    t1, _t2, prd, s4d = tenants
    calls = []

    class _Task:
        id = "task-1"

    def fake_delay(*args):
        calls.append(args)
        return _Task()

    monkeypatch.setattr("workers.tasks.run_migration.run_migration.delay", fake_delay)
    async with await _as(monkeypatch, t1) as c:
        wid = (await c.post("/api/v1/migration/waves", headers=H, json={
            "name": "Wave 1", "source_system_id": prd, "target_system_id": s4d,
            "modules": ["material_master"]})).json()["id"]
        r = await c.post(f"/api/v1/migration/waves/{wid}/run", headers=H)
        assert r.status_code == 200 and r.json()["status"] == "queued"
        empty = (await c.post("/api/v1/migration/waves", headers=H, json={"name": "Empty"})).json()["id"]
        assert (await c.post(f"/api/v1/migration/waves/{empty}/run", headers=H)).status_code == 400
    assert calls == [(t1, r.json()["run_id"], "source_to_destination", prd, s4d, ["material_master"], None, "s4hana")]
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as conn:
        assert str(conn.execute(text("SELECT wave_id FROM migration_runs WHERE id = :r"),
                                {"r": r.json()["run_id"]}).scalar()) == wid
    engine.dispose()
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_waves_routes.py -q -p no:cacheprovider`
Expected: FAIL. `ImportError: cannot import name 'object_label'`.

- [ ] **Step 3: Implement**

Replace `api/services/migration/__init__.py`:

```python
"""Source → target transfer readiness (deterministic, no LLM). See engine.py."""

# Module id -> the S/4 business object a migration lead recognises.
OBJECT_LABELS: dict[str, str] = {
    "material_master": "Material",
    "business_partner": "Business partner",
    "sd_customer_master": "BP customer",
    "accounts_receivable": "BP customer",
    "accounts_payable": "BP supplier",
    "fi_gl": "GL account",
    "asset_accounting": "Fixed asset",
}


def object_label(module: str) -> str:
    return OBJECT_LABELS.get(module) or module.replace("_", " ").title()
```

In `api/routes/migration.py`, add `import datetime` to the imports, add `from typing import Literal`, and add these models after `ValueMapUpsert`:

```python
Stage = Literal["plan", "mock1", "mock2", "dress", "cutover"]


class WaveCreate(BaseModel):
    name: str
    source_system_id: Optional[uuid.UUID] = None
    target_system_id: Optional[uuid.UUID] = None
    target_release: str = "s4hana"
    modules: list[str] = []
    target_date: Optional[datetime.date] = None
    stage: Stage = "plan"
    min_readiness: float = 95.0
    min_dqs: Optional[float] = None


class WaveUpdate(BaseModel):
    name: Optional[str] = None
    source_system_id: Optional[uuid.UUID] = None
    target_system_id: Optional[uuid.UUID] = None
    target_release: Optional[str] = None
    modules: Optional[list[str]] = None
    target_date: Optional[datetime.date] = None
    stage: Optional[Stage] = None
    min_readiness: Optional[float] = None
    min_dqs: Optional[float] = None


# Columns update_wave may write. Keep in step with WaveUpdate.
_WAVE_EDITABLE = frozenset(WaveUpdate.model_fields)
```

Extract the insert-and-enqueue tail of `start_migration` into a helper above it, and make `start_migration` end with `return await _enqueue_run(db, tenant.id, current_user_id(request), body.mode, body.source_system_id, dest_id, body.modules, body.source_version_id, body.target_release)`:

```python
async def _enqueue_run(db: AsyncSession, tenant_id: uuid.UUID, user_id: Optional[str], mode: str,
                       src: Optional[str], dest: Optional[str], modules: list[str],
                       source_version_id: Optional[str], target_release: str,
                       wave_id: Optional[str] = None) -> dict:
    run_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO migration_runs
                (id, tenant_id, mode, source_system_id, dest_system_id, modules, status, requested_by, wave_id)
            VALUES (:id, :tid, :mode, :src, :dst, :mods, 'queued', :uid, :wid)
        """),
        {"id": run_id, "tid": str(tenant_id), "mode": mode, "src": src, "dst": dest, "mods": modules,
         "uid": user_id, "wid": wave_id},
    )
    await db.commit()

    from workers.tasks.run_migration import run_migration
    task = run_migration.delay(str(tenant_id), run_id, mode, src, dest, modules, source_version_id, target_release)
    await db.execute(text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"), {"tid": task.id, "rid": run_id})
    await db.commit()
    return {"run_id": run_id, "task_id": task.id, "status": "queued", "mode": mode, "modules": modules}
```

Add the wave routes (a new `# ── Waves ──` section after `get_run`):

```python
_WAVE_COLS = ("id, name, source_system_id, target_system_id, target_release, modules, target_date, stage, "
              "min_readiness, min_dqs, signed_off_by, signed_off_at, created_at, updated_at")


async def _load_wave(db: AsyncSession, tenant_id: uuid.UUID, wave_id: uuid.UUID):
    row = (await db.execute(text(f"SELECT {_WAVE_COLS} FROM migration_waves WHERE id = :w AND tenant_id = :t"),
                            {"w": str(wave_id), "t": str(tenant_id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Wave not found.")
    return row


async def _check_systems(db: AsyncSession, tenant_id: uuid.UUID, src: Optional[uuid.UUID],
                         dst: Optional[uuid.UUID]) -> None:
    if src and dst and src == dst:
        raise HTTPException(status_code=400, detail="Target must differ from the source system.")
    for sid in (src, dst):
        if sid and not await _load_system(db, tenant_id, str(sid)):
            raise HTTPException(status_code=404, detail="System not found.")


@router.get("/waves")
async def list_waves(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    rows = await db.execute(text(f"""
        SELECT w.{_WAVE_COLS.replace(', ', ', w.')},
               last.id AS last_run_id, last.readiness_verdict AS last_verdict,
               last.readiness_score AS last_score, last.completed_at AS last_completed_at,
               COALESCE(trend.scores, '{{}}') AS trend
          FROM migration_waves w
          LEFT JOIN LATERAL (
                SELECT id, readiness_verdict, readiness_score, completed_at FROM migration_runs
                 WHERE wave_id = w.id AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1) last ON true
          LEFT JOIN LATERAL (
                SELECT array_agg(readiness_score ORDER BY completed_at) AS scores FROM (
                    SELECT readiness_score, completed_at FROM migration_runs
                     WHERE wave_id = w.id AND status = 'analysed' AND readiness_score IS NOT NULL
                     ORDER BY completed_at DESC LIMIT 12) t) trend ON true
         WHERE w.tenant_id = :t
         ORDER BY w.target_date NULLS LAST, w.name
    """), {"t": str(tenant.id)})
    return {"waves": [_row(r) for r in rows.fetchall()]}


@router.post("/waves")
async def create_wave(
    body: WaveCreate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    await _check_systems(db, tenant.id, body.source_system_id, body.target_system_id)
    if (await db.execute(text("SELECT 1 FROM migration_waves WHERE tenant_id = :t AND name = :n"),
                         {"t": str(tenant.id), "n": body.name})).scalar():
        raise HTTPException(status_code=409, detail=f"A wave named '{body.name}' already exists.")
    row = (await db.execute(text(f"""
        INSERT INTO migration_waves (tenant_id, name, source_system_id, target_system_id, target_release, modules,
                                     target_date, stage, min_readiness, min_dqs)
        VALUES (:t, :name, :src, :dst, :rel, :mods, :date, :stage, :minr, :mind)
        RETURNING {_WAVE_COLS}
    """), {"t": str(tenant.id), "name": body.name,
           "src": str(body.source_system_id) if body.source_system_id else None,
           "dst": str(body.target_system_id) if body.target_system_id else None,
           "rel": body.target_release, "mods": body.modules, "date": body.target_date, "stage": body.stage,
           "minr": body.min_readiness, "mind": body.min_dqs})).fetchone()
    await db.commit()
    return _row(row)


@router.patch("/waves/{wave_id}")
async def update_wave(
    wave_id: uuid.UUID,
    body: WaveUpdate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    current = await _load_wave(db, tenant.id, wave_id)
    changes = body.model_dump(exclude_unset=True)
    await _check_systems(db, tenant.id, changes.get("source_system_id", current.source_system_id),
                         changes.get("target_system_id", current.target_system_id))
    params = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in changes.items()}
    unknown = params.keys() - _WAVE_EDITABLE
    if unknown:  # never interpolate a column name that is not on the allow-list
        raise HTTPException(status_code=400, detail=f"Not editable: {', '.join(sorted(unknown))}")
    sets = "".join(f"{k} = :{k}, " for k in params)
    # any edit invalidates a sign-off: what was signed is no longer what is planned
    row = (await db.execute(text(f"""
        UPDATE migration_waves SET {sets}signed_off_by = NULL, signed_off_at = NULL, updated_at = now()
         WHERE id = :w AND tenant_id = :t RETURNING {_WAVE_COLS}
    """), {**params, "w": str(wave_id), "t": str(tenant.id)})).fetchone()
    await db.commit()
    return _row(row)


@router.delete("/waves/{wave_id}", status_code=204)
async def delete_wave(
    wave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    await _load_wave(db, tenant.id, wave_id)
    await db.execute(text("DELETE FROM migration_waves WHERE id = :w AND tenant_id = :t"),
                     {"w": str(wave_id), "t": str(tenant.id)})
    await db.commit()


@router.post("/waves/{wave_id}/run")
async def run_wave(
    wave_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if not w.source_system_id or not w.modules:
        raise HTTPException(status_code=400, detail="Set a source system and at least one module first.")
    return await _enqueue_run(db, tenant.id, current_user_id(request), "source_to_destination",
                              str(w.source_system_id), str(w.target_system_id) if w.target_system_id else None,
                              list(w.modules), None, w.target_release, str(wave_id))
```

The `sets` f-string is safe. Its keys can only be `WaveUpdate` field names, because `model_dump` emits declared fields only. A PATCH with an empty body still clears the sign-off and touches `updated_at`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_waves_routes.py tests/test_migration_engine.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/migration/__init__.py api/routes/migration.py tests/test_migration_waves_routes.py
git commit -m "feat(migration): wave CRUD, run now, business-object labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 4: Wave cockpit and sign-off

**Files:**
- Create: `api/services/migration/cockpit.py`
- Modify: `api/routes/migration.py`. Add `GET /waves/{id}/cockpit` and `POST /waves/{id}/signoff`.
- Test: `tests/test_migration_cockpit_pg.py` (new)

**Interfaces:**
- Consumes:
  - `migration_waves`, `migration_runs` (`wave_id`, `gap_summary`, `readiness_score`, `source_version_id`), `migration_gap_findings`, `analysis_versions.dqs_summary`, `sap_systems.system_type`.
  - `build_wave_cells`, `wave_verdict` (Task 2), `object_label` (Task 3).
- Produces `load_cockpit(db, tenant_id, wave) -> dict`:

  ```
  {wave: {...}, run_id, source_version_id, dest_system_type, verdict, score, records_total, records_blocked,
   objects: [{module, label, verdict, score, records, records_blocked, blocker_count, dqs}],
   trend: [{run_id, completed_at, score}],
   blockers: [{module, label, gap_type, field, severity, records, gaps}]}
  ```

  - `verdict` is the grid verdict.
  - `dest_system_type` is the target system's `system_type`, or `target_release` when no target system is set. The Mapping tab needs it for `getFieldMap`.
  - `blockers` holds at most 20 entries.
- Produces `GET /api/v1/migration/waves/{id}/cockpit` (`view`).
- Produces `POST /api/v1/migration/waves/{id}/signoff` (`approve`):
  - It returns the updated wave.
  - It returns 409 unless the verdict is `go` and the wave is not yet signed off.
  - It writes an `audit_log` row with `action = 'signoff'`, `entity_type = 'migration_wave'`, and `before_json` and `after_json` holding `{stage, signed_off_by, signed_off_at, verdict, score}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_cockpit_pg.py`:

```python
"""GET /migration/waves/{id}/cockpit and POST /signoff on Postgres.

Seed: wave 'Wave 1' (PRD -> S4D, material_master + accounts_payable), two analysed runs.
  run 1 (3 days ago) score 80
  run 2 (1 hour ago) score 97: material_master go 100, accounts_payable conditional 94 with gaps
"""

import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
H = {"Authorization": "Bearer test-token"}


@pytest.fixture
def seeded():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, prd, s4d, wid, vid, r1, r2 = (str(uuid.uuid4()) for _ in range(7))
    summary = {
        "material_master": {"records": 50, "blocked_records": 0, "score": 100.0, "verdict": "go", "gaps": {}},
        "accounts_payable": {"records": 50, "blocked_records": 3, "score": 94.0, "verdict": "conditional",
                             "gaps": {"value_unmapped": 3, "unmapped_field": 1}},
    }
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES "
                       "(:p, :t, 'PRD', 'ecc6'), (:s, :t, 'S4D', 's4hana')"), {"p": prd, "s": s4d, "t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                       "(:v, :t, 'complete', now(), CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": prd}),
                   "q": json.dumps({"material_master": {"composite_score": 91.0},
                                    "accounts_payable": {"composite_score": 72.0}})})
        c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, source_system_id, target_system_id, modules) "
                       "VALUES (:w, :t, 'Wave 1', :p, :s, '{material_master,accounts_payable}')"),
                  {"w": wid, "t": tid, "p": prd, "s": s4d})
        for rid, score, ago, gs in ((r1, 80.0, "3 days", {}), (r2, 97.0, "1 hour", summary)):
            c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, "
                           "modules, status, readiness_verdict, readiness_score, records_total, records_blocked, "
                           "gap_summary, source_version_id, wave_id, completed_at) VALUES (:r, :t, "
                           "'source_to_destination', :p, :s, '{material_master,accounts_payable}', 'analysed', "
                           "'conditional', :sc, 100, 3, CAST(:gs AS jsonb), :v, :w, now() - CAST(:ago AS interval))"),
                      {"r": rid, "t": tid, "p": prd, "s": s4d, "sc": score, "gs": json.dumps(gs), "v": vid,
                       "w": wid, "ago": ago})
        for key in ("LIFNR=1", "LIFNR=2", "LIFNR=3"):
            c.execute(text("INSERT INTO migration_gap_findings (tenant_id, run_id, module, record_key, field, "
                           "gap_type, severity) VALUES (:t, :r, 'accounts_payable', :k, 'BUT000.BU_GROUP', "
                           "'value_unmapped', 'critical')"), {"t": tid, "r": r2, "k": key})
        c.execute(text("INSERT INTO migration_gap_findings (tenant_id, run_id, module, field, gap_type, severity) "
                       "VALUES (:t, :r, 'accounts_payable', 'LFA1.ZZOLD', 'unmapped_field', 'medium')"),
                  {"t": tid, "r": r2})
    yield {"tid": tid, "wid": wid, "vid": vid, "r2": r2, "engine": engine}
    with engine.begin() as c:
        c.execute(text("DELETE FROM audit_log WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM migration_runs WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM migration_waves WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


async def _client(monkeypatch, tenant_id: str) -> AsyncClient:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002",
                                               "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))
    await api_deps.engine.dispose()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_cockpit(seeded, monkeypatch):
    async with await _client(monkeypatch, seeded["tid"]) as c:
        r = await c.get(f"/api/v1/migration/waves/{seeded['wid']}/cockpit", headers={**H, "X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["run_id"] == seeded["r2"] and b["source_version_id"] == seeded["vid"]
    assert b["dest_system_type"] == "s4hana"
    assert b["verdict"] == "at_risk" and b["score"] == 97.0
    assert [(o["module"], o["label"], o["verdict"], o["blocker_count"], o["dqs"]) for o in b["objects"]] == [
        ("material_master", "Material", "go", 0, 91.0),
        ("accounts_payable", "BP supplier", "at_risk", 3, 72.0),
    ]
    assert [p["score"] for p in b["trend"]] == [80.0, 97.0]
    assert b["blockers"] == [{"module": "accounts_payable", "label": "BP supplier", "gap_type": "value_unmapped",
                              "field": "BUT000.BU_GROUP", "severity": "critical", "records": 3, "gaps": 3}]


@pytest.mark.anyio
async def test_signoff_needs_go_and_approve_and_is_audited(seeded, monkeypatch):
    url = f"/api/v1/migration/waves/{seeded['wid']}/signoff"
    async with await _client(monkeypatch, seeded["tid"]) as c:
        assert (await c.post(url, headers={**H, "X-User-Role": "analyst"})).status_code == 403
        assert (await c.post(url, headers={**H, "X-User-Role": "approver"})).status_code == 409  # at_risk
        with seeded["engine"].begin() as conn:
            conn.execute(text("UPDATE migration_waves SET min_readiness = 90 WHERE id = :w"), {"w": seeded["wid"]})
            conn.execute(text("UPDATE migration_runs SET gap_summary = jsonb_set(gap_summary, "
                              "'{accounts_payable,verdict}', '\"go\"') WHERE id = :r"), {"r": seeded["r2"]})
        r = await c.post(url, headers={**H, "X-User-Role": "approver"})
        assert r.status_code == 200, r.text
        assert r.json()["signed_off_at"] is not None
        assert (await c.post(url, headers={**H, "X-User-Role": "approver"})).status_code == 409  # already signed
    with seeded["engine"].begin() as conn:
        row = conn.execute(text("SELECT before_json, after_json FROM audit_log WHERE tenant_id = :t "
                                "AND action = 'signoff' AND entity_type = 'migration_wave'"),
                           {"t": seeded["tid"]}).one()
    assert row.before_json["signed_off_at"] is None
    assert row.after_json["signed_off_at"] is not None and row.after_json["verdict"] == "go"
```

If the role names `viewer`, `analyst` and `approver` differ in `api/services/rbac.py`, use the names that hold only `view`, `analyse` without `approve`, and `approve`. Check `ROLE_PERMISSIONS` before running.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_cockpit_pg.py -q -p no:cacheprovider`
Expected: FAIL with 404 on `/cockpit`.

- [ ] **Step 3: Implement**

Create `api/services/migration/cockpit.py`:

```python
"""One wave's cockpit: objects, verdict, trend and top blockers (spec 2, build 3).

S/4 areas are not here: the UI calls GET /findings/s4-readiness with source_version_id.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.insights_readiness import build_wave_cells, wave_verdict
from api.services.migration import object_label

TOP_BLOCKERS = 20


async def load_cockpit(db: AsyncSession, tenant_id: str, wave) -> dict:
    run = (await db.execute(text("""
        SELECT id, gap_summary, readiness_score, records_total, records_blocked, source_version_id
          FROM migration_runs WHERE tenant_id = :t AND wave_id = :w AND status = 'analysed'
         ORDER BY completed_at DESC LIMIT 1"""), {"t": tenant_id, "w": str(wave.id)})).fetchone()
    dest_type = wave.target_release
    if wave.target_system_id:
        dest_type = (await db.execute(text("SELECT system_type FROM sap_systems WHERE id = :s"),
                                      {"s": str(wave.target_system_id)})).scalar() or dest_type
    dqs: dict[str, float | None] = {}
    if run and run.source_version_id:
        summary = (await db.execute(text("SELECT dqs_summary FROM analysis_versions WHERE id = :v"),
                                    {"v": str(run.source_version_id)})).scalar() or {}
        dqs = {m: (d or {}).get("composite_score") for m, d in summary.items()}
    gap_summary = (run.gap_summary if run else None) or {}
    min_dqs = wave.min_dqs
    cells = build_wave_cells(wave.name, list(wave.modules or []), gap_summary, dqs, wave.min_readiness, min_dqs)
    objects = [{"module": c.module, "label": object_label(c.module), "verdict": c.verdict, "score": c.score,
                "records": int((gap_summary.get(c.module) or {}).get("records") or 0),
                "records_blocked": c.records_blocked, "blocker_count": c.blocker_count, "dqs": c.dqs}
               for c in cells]

    trend = (await db.execute(text("""
        SELECT id AS run_id, completed_at, readiness_score AS score FROM (
            SELECT id, completed_at, readiness_score FROM migration_runs
             WHERE tenant_id = :t AND wave_id = :w AND status = 'analysed' AND readiness_score IS NOT NULL
             ORDER BY completed_at DESC LIMIT 30) t
         ORDER BY completed_at"""), {"t": tenant_id, "w": str(wave.id)})).fetchall()

    blockers = []
    if run:
        blockers = (await db.execute(text("""
            SELECT module, gap_type, field, MIN(severity) AS severity,
                   COUNT(DISTINCT record_key) AS records, COUNT(*) AS gaps
              FROM migration_gap_findings
             WHERE run_id = :r AND severity IN ('critical', 'high')
             GROUP BY module, gap_type, field
             ORDER BY COUNT(DISTINCT record_key) DESC, COUNT(*) DESC, module, gap_type
             LIMIT :n"""), {"r": str(run.id), "n": TOP_BLOCKERS})).fetchall()

    return {
        "wave": dict(wave._mapping),
        "run_id": str(run.id) if run else None,
        "source_version_id": str(run.source_version_id) if run and run.source_version_id else None,
        "dest_system_type": dest_type,
        "verdict": wave_verdict(cells),
        "score": run.readiness_score if run else None,
        "records_total": run.records_total if run else 0,
        "records_blocked": run.records_blocked if run else 0,
        "objects": objects,
        "trend": [{"run_id": str(t.run_id), "completed_at": t.completed_at, "score": t.score} for t in trend],
        "blockers": [{**dict(b._mapping), "label": object_label(b.module)} for b in blockers],
    }
```

`MIN(severity)` on text gives `'critical'` before `'high'` alphabetically, so a group holding both reports `critical`.

In `api/routes/migration.py`, add the routes after `run_wave`:

```python
@router.get("/waves/{wave_id}/cockpit")
async def wave_cockpit(
    wave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    from api.services.migration.cockpit import load_cockpit

    await _set_rls(db, tenant.id)
    return await load_cockpit(db, str(tenant.id), await _load_wave(db, tenant.id, wave_id))


@router.post("/waves/{wave_id}/signoff")
async def signoff_wave(
    wave_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    import json

    from api.services.migration.cockpit import load_cockpit
    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if w.signed_off_at:
        raise HTTPException(status_code=409, detail="This wave is already signed off.")
    cockpit = await load_cockpit(db, str(tenant.id), w)
    if cockpit["verdict"] != "go":
        raise HTTPException(status_code=409, detail="Only a wave with a go verdict can be signed off.")
    uid = current_user_id(request)
    row = (await db.execute(text(f"""
        UPDATE migration_waves SET signed_off_by = :u, signed_off_at = now(), updated_at = now()
         WHERE id = :w AND tenant_id = :t RETURNING {_WAVE_COLS}"""),
        {"u": uid, "w": str(wave_id), "t": str(tenant.id)})).fetchone()

    def snap(r) -> dict:
        return {"stage": r.stage, "signed_off_by": str(r.signed_off_by) if r.signed_off_by else None,
                "signed_off_at": r.signed_off_at.isoformat() if r.signed_off_at else None,
                "verdict": cockpit["verdict"], "score": cockpit["score"]}

    await db.execute(text("""
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path,
                               status_code, before_json, after_json)
        VALUES (:t, :u, :e, 'signoff', 'migration_wave', :w, 'POST', :p, 200,
                CAST(:b AS jsonb), CAST(:a AS jsonb))"""),
        {"t": str(tenant.id), "u": uid, "e": current_user_label(), "w": str(wave_id), "p": request.url.path,
         "b": json.dumps(snap(w)), "a": json.dumps(snap(row))})
    await db.commit()
    return _row(row)
```

Before running, check that `audit_log.entity_id` is text, not uuid (`grep -n "audit_log" -A20 db/schema.py`). If it is uuid, pass `CAST(:w AS uuid)`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_cockpit_pg.py tests/test_migration_waves_routes.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/migration/cockpit.py api/routes/migration.py tests/test_migration_cockpit_pg.py
git commit -m "feat(migration): wave cockpit and audited sign-off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 5: Readiness report (Excel and branded PDF) and blocker fix batch

**Files:**
- Modify: `api/services/pdf_reports.py`. Add `fmt_sast` after `fmt_dt` (line 78) and register it as `sast` in `_env()` (line 130).
- Create: `templates/migration_readiness_report.html`
- Modify: `api/routes/migration.py`. Add the report and fix-batch routes after `signoff_wave`.
- Test: `tests/test_migration_report.py` (new)

**Interfaces:**
- Consumes:
  - `load_cockpit` (Task 4) and `pdf_reports.render`.
  - The `_base.html` context: `title`, `eyebrow`, `scope_label`, `generated_at`, `meta`.
  - `remediation.draft_batch(session, tenant_id, name, filter_json, issues, user_id, user_label)`.
- Produces:
  - `fmt_sast(v) -> str`, for example `"3 Jan 2026, 02:00 SAST"`.
  - `readiness_report_context(cockpit, tenant_name, generated_at) -> dict` and `readiness_report_sheets(cockpit) -> dict[str, DataFrame]`, both in `api/services/migration/cockpit.py`.
  - `GET /api/v1/migration/waves/{id}/report.xlsx` and `/report.pdf` (`export`).
    - The xlsx has the sheets `Summary`, `Objects`, `Blockers` and `Trend`.
  - `POST /api/v1/migration/waves/{id}/blockers/fix-batch` (`apply`) takes `{module, gap_type, field}` and returns the `draft_batch` result.
    - It returns 404 when the wave has no analysed run.
    - It returns 400 when no open issue matches.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_report.py`:

```python
"""Wave readiness report: xlsx sheets, PDF render, SAST filter. Pure: no database."""

import io
from datetime import datetime, timezone

import pytest

from api.services import pdf_reports as pr
from api.services.migration.cockpit import readiness_report_context, readiness_report_sheets

COCKPIT = {
    "wave": {"name": "Wave 1", "stage": "mock1", "target_date": "2027-03-01", "min_readiness": 95.0,
             "min_dqs": None, "signed_off_at": None},
    "run_id": "r2", "source_version_id": "v1", "dest_system_type": "s4hana",
    "verdict": "at_risk", "score": 97.0, "records_total": 100, "records_blocked": 3,
    "objects": [{"module": "accounts_payable", "label": "BP supplier", "verdict": "at_risk", "score": 94.0,
                 "records": 50, "records_blocked": 3, "blocker_count": 3, "dqs": 72.0}],
    "trend": [{"run_id": "r1", "completed_at": datetime(2026, 10, 7, 8, tzinfo=timezone.utc), "score": 80.0},
              {"run_id": "r2", "completed_at": datetime(2026, 10, 10, 8, tzinfo=timezone.utc), "score": 97.0}],
    "blockers": [{"module": "accounts_payable", "label": "BP supplier", "gap_type": "value_unmapped",
                  "field": "BUT000.BU_GROUP", "severity": "critical", "records": 3, "gaps": 3}],
}


def test_sast_filter():
    assert pr.fmt_sast(datetime(2026, 1, 3, 0, 0, tzinfo=timezone.utc)) == "3 Jan 2026, 02:00 SAST"
    assert pr.fmt_sast(None) == "—"


def test_xlsx_sheets():
    sheets = readiness_report_sheets(COCKPIT)
    assert list(sheets) == ["Summary", "Objects", "Blockers", "Trend"]
    assert sheets["Objects"].iloc[0]["Object"] == "BP supplier"
    assert sheets["Blockers"].iloc[0]["Records"] == 3
    assert sheets["Trend"].iloc[1]["Completed (SAST)"] == "10 Oct 2026, 10:00 SAST"


def test_pdf_renders():
    pytest.importorskip("weasyprint")
    ctx = readiness_report_context(COCKPIT, "Demo", datetime(2026, 10, 10, 12, tzinfo=timezone.utc))
    assert ctx["title"] == "Migration readiness: Wave 1"
    pdf = pr.render("migration_readiness_report.html", ctx)
    assert pdf.startswith(b"%PDF")


def test_empty_wave_renders():
    pytest.importorskip("weasyprint")
    empty = {**COCKPIT, "run_id": None, "score": None, "verdict": "no_go", "objects": [], "trend": [], "blockers": []}
    pdf = pr.render("migration_readiness_report.html", readiness_report_context(empty, "Demo", None))
    assert pdf.startswith(b"%PDF")
```

Add this fix-batch test to `tests/test_migration_cockpit_pg.py`. It reuses the `seeded` fixture from Task 4.

```python
@pytest.mark.anyio
async def test_blocker_fix_batch(seeded, monkeypatch):
    captured = {}

    def fake_draft(session, tenant_id, name, filter_json, issues, uid, label):
        captured.update(name=name, issues=issues)
        return {"id": "b1", "items": len(issues)}

    monkeypatch.setattr("api.services.remediation.draft_batch", fake_draft)
    body = {"module": "accounts_payable", "gap_type": "value_unmapped", "field": "BUT000.BU_GROUP"}
    url = f"/api/v1/migration/waves/{seeded['wid']}/blockers/fix-batch"
    async with await _client(monkeypatch, seeded["tid"]) as c:
        assert (await c.post(url, json=body, headers={**H, "X-User-Role": "admin"})).status_code == 400
        with seeded["engine"].begin() as conn:
            conn.execute(text("INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, "
                              "status, first_seen_version, last_seen_version) VALUES (:t, 'upload', "
                              "'accounts_payable', 'AP-001', 'LIFNR=2', 'critical', 'open', :v, :v)"), {"t": seeded["tid"], "v": seeded["vid"]})
        r = await c.post(url, json=body, headers={**H, "X-User-Role": "admin"})
    assert r.status_code == 200, r.text
    assert [i["record_key"] for i in captured["issues"]] == ["LIFNR=2"]
    assert captured["name"] == "Wave 1: BP supplier value_unmapped BUT000.BU_GROUP"
```

The insert lists every NOT NULL column of `record_issues` without a server default (`db/schema.py:873-900`). Also add `DELETE FROM record_issues WHERE tenant_id = :t` to the fixture teardown before the tenant delete.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python3 -m pytest tests/test_migration_report.py -q -p no:cacheprovider`
Expected: FAIL. `ImportError: cannot import name 'readiness_report_context'`.

- [ ] **Step 3: Implement**

In `api/services/pdf_reports.py`, add the following after `fmt_dt`, and add `from zoneinfo import ZoneInfo` to the imports:

```python
_SAST = ZoneInfo("Africa/Johannesburg")


def fmt_sast(v: object) -> str:
    d = _to_dt(v)
    return "—" if d is None else d.astimezone(_SAST).strftime("%-d %b %Y, %H:%M SAST")
```

Register it in `_env()`: `env.filters.update(n=fmt_n, ..., css_str=css_str, sast=fmt_sast)`.

Append to `api/services/migration/cockpit.py`:

```python
_VERDICT_LABEL = {"go": "Go", "at_risk": "At risk", "no_go": "No-go"}
_VERDICT_SENTENCE = {
    "go": "Every object meets the wave's readiness and data-quality thresholds.",
    "at_risk": "No object is blocked outright, but at least one is below a threshold or needs conditional fixes.",
    "no_go": "At least one object has blocking gaps or has not been analysed.",
}


def readiness_report_context(cockpit: dict, tenant_name: str, generated_at) -> dict:
    from datetime import datetime, timezone

    from api.services.pdf_reports import fmt_pct, fmt_sast

    w = cockpit["wave"]
    return {
        "title": f"Migration readiness: {w['name']}",
        "eyebrow": "Migration cockpit",
        "scope_label": tenant_name,
        "generated_at": generated_at or datetime.now(timezone.utc),
        "meta": [
            ("Stage", w["stage"]),
            ("Target date", str(w["target_date"]) if w.get("target_date") else "Not set"),
            ("Target", cockpit["dest_system_type"]),
            ("Readiness", fmt_pct(cockpit["score"])),
            ("Minimum readiness", fmt_pct(w["min_readiness"])),
            ("Signed off", fmt_sast(w["signed_off_at"]) if w.get("signed_off_at") else "Not signed off"),
        ],
        "verdict": cockpit["verdict"],
        "verdict_label": _VERDICT_LABEL[cockpit["verdict"]],
        "verdict_sentence": _VERDICT_SENTENCE[cockpit["verdict"]],
        "objects": cockpit["objects"],
        "blockers": cockpit["blockers"],
        "trend": cockpit["trend"],
        "has_run": cockpit["run_id"] is not None,
    }


def readiness_report_sheets(cockpit: dict) -> dict:
    import pandas as pd

    from api.services.pdf_reports import fmt_sast

    w = cockpit["wave"]
    return {
        "Summary": pd.DataFrame([{"Wave": w["name"], "Stage": w["stage"], "Target date": w.get("target_date"),
                                  "Verdict": _VERDICT_LABEL[cockpit["verdict"]], "Readiness %": cockpit["score"],
                                  "Records": cockpit["records_total"], "Records blocked": cockpit["records_blocked"]}]),
        "Objects": pd.DataFrame([{"Object": o["label"], "Module": o["module"], "Verdict": _VERDICT_LABEL[o["verdict"]],
                                  "Readiness %": o["score"], "Records": o["records"],
                                  "Records blocked": o["records_blocked"], "Blocking gaps": o["blocker_count"],
                                  "DQS": o["dqs"]} for o in cockpit["objects"]]),
        "Blockers": pd.DataFrame([{"Object": b["label"], "Gap type": b["gap_type"], "Field": b["field"],
                                   "Severity": b["severity"], "Records": b["records"], "Gaps": b["gaps"]}
                                  for b in cockpit["blockers"]]),
        "Trend": pd.DataFrame([{"Completed (SAST)": fmt_sast(t["completed_at"]), "Readiness %": t["score"]}
                               for t in cockpit["trend"]]),
    }
```

Create `templates/migration_readiness_report.html`:

```html
{% extends "_base.html" %}
{% block body %}
<h2>Verdict</h2>
<p><span class="st {{ verdict | st }}">{{ verdict_label }}</span> {{ verdict_sentence }}</p>

<h2>Objects</h2>
{% if objects %}
<table class="data">
<thead><tr><th>Object</th><th>Verdict</th><th class="r">Readiness</th><th class="r">Records</th><th class="r">Blocked</th><th class="r">Blocking gaps</th><th class="r">DQS</th></tr></thead>
<tbody>
{% for o in objects %}
<tr><td>{{ o.label }}<span class="sub mono">{{ o.module }}</span></td><td>{{ o.verdict | module }}</td>
    <td class="r">{{ o.score | pct }}</td><td class="r">{{ o.records | n }}</td><td class="r">{{ o.records_blocked | n }}</td>
    <td class="r">{{ o.blocker_count | n }}</td><td class="r">{{ o.dqs | n(1) }}</td></tr>
{% endfor %}
</tbody>
</table>
{% else %}
<div class="empty">This wave has no objects in scope.</div>
{% endif %}

<h2>Top blockers</h2>
{% if blockers %}
<table class="data">
<thead><tr><th>Object</th><th>Gap</th><th>Field</th><th>Severity</th><th class="r">Records</th></tr></thead>
<tbody>
{% for b in blockers %}
<tr><td>{{ b.label }}</td><td>{{ b.gap_type | module }}</td><td class="mono">{{ b.field or "—" }}</td>
    <td><span class="st {{ b.severity | st }}">{{ b.severity | capitalize }}</span></td><td class="r">{{ b.records | n }}</td></tr>
{% endfor %}
</tbody>
</table>
{% elif has_run %}
<div class="empty">The latest run found no critical or high gaps.</div>
{% else %}
<div class="empty">This wave has not been analysed yet.</div>
{% endif %}

<h2>Readiness over time</h2>
{% if trend %}
<table class="data">
<thead><tr><th>Run completed</th><th class="r">Readiness</th></tr></thead>
<tbody>
{% for t in trend %}<tr><td>{{ t.completed_at | sast }}</td><td class="r">{{ t.score | pct }}</td></tr>{% endfor %}
</tbody>
</table>
{% else %}
<div class="empty">No completed runs yet.</div>
{% endif %}
{% endblock %}
```

Keep the template free of colour literals. It inherits `assets/report.css`, which holds the brand.

In `api/routes/migration.py`, add:

```python
class FixBatchBody(BaseModel):
    module: str
    gap_type: str
    field: Optional[str] = None


@router.get("/waves/{wave_id}/report.{fmt}")
async def wave_report(
    wave_id: uuid.UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    import asyncio

    import pandas as pd

    from api.services.migration.cockpit import load_cockpit, readiness_report_context, readiness_report_sheets
    from api.services.pdf_reports import render

    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=404, detail="Unknown report format.")
    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    cockpit = await load_cockpit(db, str(tenant.id), w)
    name = f"migration_readiness_{w.name.replace(' ', '_')}"
    if fmt == "pdf":
        pdf = await asyncio.to_thread(render, "migration_readiness_report.html",
                                      readiness_report_context(cockpit, tenant.name, None))
        return _stream(pdf, "application/pdf", f"{name}.pdf")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for sheet, df in readiness_report_sheets(cockpit).items():
            df.to_excel(xw, sheet_name=sheet, index=False)
    return _stream(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx")


@router.post("/waves/{wave_id}/blockers/fix-batch")
async def blocker_fix_batch(
    wave_id: uuid.UUID,
    body: FixBatchBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("apply")),
):
    """Draft a cleaning batch for the open DQ issues on the records one blocker affects.
    Migration and DQ share the record-key format (checks/base.record_keys), so (module, record_key) joins."""
    from api.services import remediation
    from api.services.migration import object_label
    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    run_id = (await db.execute(text("SELECT id FROM migration_runs WHERE tenant_id = :t AND wave_id = :w "
                                    "AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1"),
                               {"t": str(tenant.id), "w": str(wave_id)})).scalar()
    if run_id is None:
        raise HTTPException(status_code=404, detail="This wave has not been analysed yet.")
    rows = (await db.execute(text("""
        SELECT ri.id AS issue_id, ri.scope, ri.module, ri.check_id, ri.record_key, ri.grain,
               ri.last_seen_version, f.details->>'field_checked' AS field
          FROM record_issues ri
          LEFT JOIN findings f ON f.version_id = ri.last_seen_version AND f.check_id = ri.check_id
         WHERE ri.tenant_id = :t AND ri.module = :m AND ri.status IN ('open', 'in_progress')
           AND ri.record_key IN (
                SELECT DISTINCT record_key FROM migration_gap_findings
                 WHERE run_id = :r AND module = :m AND gap_type = :g
                   AND field IS NOT DISTINCT FROM :fld AND record_key IS NOT NULL)
         ORDER BY ri.record_key
         LIMIT 50001"""),
        {"t": str(tenant.id), "m": body.module, "r": str(run_id), "g": body.gap_type, "fld": body.field})).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="No open data quality issues match these records. "
                                                    "Fix the mapping in the Mapping tab.")
    if len(rows) > 50_000:
        raise HTTPException(status_code=400, detail="More than 50000 records; fix this blocker in parts.")
    issues = [dict(r._mapping) for r in rows]
    name = f"{w.name}: {object_label(body.module)} {body.gap_type} {body.field or ''}".rstrip()
    uid, label = current_user_id(request), current_user_label()
    out = await db.run_sync(lambda s: remediation.draft_batch(s, str(tenant.id), name, body.model_dump_json(),
                                                              issues, uid, label))
    await db.commit()
    return out
```

The test monkeypatches `api.services.remediation.draft_batch`. The route looks the function up through the module (`remediation.draft_batch`) at call time, so the patch applies.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_migration_report.py tests/test_pdf_reports.py -q -p no:cacheprovider`. Expected: PASS (the PDF tests skip without weasyprint).
Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_migration_cockpit_pg.py -q -p no:cacheprovider`. Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add api/services/pdf_reports.py api/services/migration/cockpit.py templates/migration_readiness_report.html \
  api/routes/migration.py tests/test_migration_report.py tests/test_migration_cockpit_pg.py
git commit -m "feat(migration): wave readiness report (xlsx, pdf) and blocker fix batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 6: Re-run waves when the source system is re-analysed

**Files:**
- Modify: `workers/tasks/run_checks.py`. Add a module-level `enqueue_wave_reruns` near `DQS_HISTORY_UPSERT` (line 29), and call it in the completion fan-out after the `send_notification.delay` block (about line 815).
- Test: `tests/test_wave_rerun.py` (new)

**Interfaces:**
- Consumes: `migration_waves`, `run_migration.delay`, and `metadata.get("system_id")` (already used at `run_checks.py:683`).
- Produces `enqueue_wave_reruns(session, tenant_id, system_id, version_id) -> int`. For every wave with `source_system_id = system_id`, `signed_off_at IS NULL` and at least one module, it inserts a queued `migration_runs` row (`wave_id` set, `requested_by` NULL) and calls `run_migration.delay(..., source_version_id=version_id, target_release)`. It returns the number enqueued. An upload (no `system_id`) enqueues nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/test_wave_rerun.py`:

```python
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_wave_rerun.py -q -p no:cacheprovider`
Expected: FAIL. `AttributeError: module 'workers.tasks.run_checks' has no attribute 'enqueue_wave_reruns'`.

- [ ] **Step 3: Implement**

In `workers/tasks/run_checks.py`, add after `DQS_HISTORY_UPSERT`:

```python
def enqueue_wave_reruns(session, tenant_id, system_id, version_id) -> int:
    """Re-run the migration analysis of every open wave sourced from this system against
    the version just analysed, so the cockpit trend follows the monitoring schedule.
    Signed-off waves are frozen. Uploads have no system and re-run nothing."""
    if not system_id:
        return 0
    import uuid as _uuid

    from workers.tasks.run_migration import run_migration

    waves = session.execute(text(
        "SELECT id, modules, target_system_id, target_release FROM migration_waves "
        "WHERE source_system_id = :s AND signed_off_at IS NULL AND cardinality(modules) > 0"),
        {"s": str(system_id)}).fetchall()
    for w in waves:
        run_id = str(_uuid.uuid4())
        dest = str(w.target_system_id) if w.target_system_id else None
        session.execute(text(
            "INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, modules, status, wave_id) "
            "VALUES (:id, :t, 'source_to_destination', :s, :d, :m, 'queued', :wid)"),
            {"id": run_id, "t": str(tenant_id), "s": str(system_id), "d": dest, "m": list(w.modules),
             "wid": str(w.id)})
        session.commit()
        task = run_migration.delay(str(tenant_id), run_id, "source_to_destination", str(system_id), dest,
                                   list(w.modules), str(version_id), w.target_release)
        session.execute(text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"), {"tid": task.id, "rid": run_id})
        session.commit()
    return len(waves)
```

In the completion fan-out, after the `send_notification.delay(...)` `try/except` block, add:

```python
        # Migration waves sourced from this system re-run against the fresh version
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                n = enqueue_wave_reruns(session, tenant_id, metadata.get("system_id"), version_id)
            if n:
                logger.info(f"Enqueued {n} migration wave re-run(s) for version_id={version_id}")
        except Exception as e:
            logger.warning(f"Failed to enqueue migration wave re-runs (non-fatal): {e}")
```

The test's `_Session` asserts the `delay` arguments with `[2:]`, which drops tenant and run id. The positional order matches `run_migration(self, tenant_id, run_id, mode, source_system_id, dest_system_id, modules, source_version_id, target_release)`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_wave_rerun.py -q -p no:cacheprovider`. Expected: PASS (2).
Also run whichever of `tests/test_run_checks*.py` exist: `python3 -m pytest tests -k run_checks -q -p no:cacheprovider`. Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add workers/tasks/run_checks.py tests/test_wave_rerun.py
git commit -m "feat(migration): re-run open waves when their source system is re-analysed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 7: Frontend: wave client, `/migration` wave list, create dialog and nav

**Files:**
- Modify: `frontend/types/api.ts`. Add the types after `MigrationRun` (line 1089).
- Modify: `frontend/lib/api/migration.ts`, `frontend/lib/query-keys.ts`, `frontend/lib/nav.ts:107`
- Create: `frontend/app/(app)/migration/page.tsx`, `frontend/app/(app)/migration/create-wave-dialog.tsx`
- Test: `frontend/app/(app)/migration/__tests__/page.test.tsx` (new)

**Interfaces:**
- Consumes: the Task 3 routes, and `getSystems` from `@/lib/api/systems` (check the exact export name with `grep -n "export async function getSystems" frontend/lib/api/systems.ts`).
- Produces:
  - Types: `WaveStage`, `WaveVerdict`, `MigrationWave`, `WaveObject`, `WaveBlocker`, `WaveTrendPoint`, `WaveCockpit`.
  - Client: `getWaves()`, `createWave(body)`, `updateWave(id, body)`, `deleteWave(id)`, `runWave(id)`.
  - Query keys: `queryKeys.migrationWaves()`.
  - Page `/migration`, with:
    - one row per wave: name, stage, target date, verdict pill, readiness %, a sparkline of the trend, and "Run now" (needs `analyse`);
    - a "Create wave" button that opens the dialog.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(app)/migration/__tests__/page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as migrationApi from "@/lib/api/migration";
import * as systemsApi from "@/lib/api/systems";
import type { MigrationWave } from "@/types/api";
import MigrationPage from "../page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/migration",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const WAVE: MigrationWave = {
  id: "w1", name: "Wave 1", source_system_id: "s1", target_system_id: null, target_release: "s4hana",
  modules: ["material_master"], target_date: "2027-03-01", stage: "mock1", min_readiness: 95, min_dqs: null,
  signed_off_by: null, signed_off_at: null, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
  last_run_id: "r2", last_verdict: "conditional", last_score: 97, last_completed_at: "2026-10-10T08:00:00Z",
  trend: [80, 97],
};

describe("MigrationPage", () => {
  it("lists waves with verdict, readiness and run now", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([WAVE]);
    const run = vi.spyOn(migrationApi, "runWave").mockResolvedValue({
      run_id: "r3", task_id: "t", status: "queued", mode: "source_to_destination", modules: ["material_master"],
    });
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText("Wave 1")).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    expect(screen.getByText("97.0%")).toBeInTheDocument();
    expect(screen.getByText("Mock 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("w1"));
  });

  it("opens a wave on row click", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([WAVE]);
    renderWithQuery(<MigrationPage />);
    fireEvent.click(await screen.findByText("Wave 1"));
    expect(push).toHaveBeenCalledWith("/migration/w1");
  });

  it("creates a wave", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([]);
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    const create = vi.spyOn(migrationApi, "createWave").mockResolvedValue({ ...WAVE, id: "w2", name: "Wave 2" });
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText(/no migration waves yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Create wave" })[0]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wave 2" } });
    fireEvent.change(screen.getByLabelText("Modules"), { target: { value: "material_master, fi_gl" } });
    fireEvent.click(screen.getByRole("button", { name: "Save wave" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Wave 2", modules: ["material_master", "fi_gl"], stage: "plan", min_readiness: 95,
    })));
  });

  it("shows the error with a retry", async () => {
    vi.spyOn(migrationApi, "getWaves").mockRejectedValue(new Error("network down"));
    renderWithQuery(<MigrationPage />);
    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });
});
```

If `getSystems` returns a wrapper object instead of an array, adapt the mock to its real return type.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run "app/(app)/migration/__tests__/page.test.tsx"`
Expected: FAIL. `Failed to resolve import "../page"`.

- [ ] **Step 3: Implement**

Append to `frontend/types/api.ts` after `MigrationRun`:

```ts
export type WaveStage = "plan" | "mock1" | "mock2" | "dress" | "cutover";
/** Grid verdict (engine "conditional" is shown as at_risk). */
export type WaveVerdict = "go" | "at_risk" | "no_go";

export interface MigrationWave {
  id: string;
  name: string;
  source_system_id: string | null;
  target_system_id: string | null;
  target_release: string;
  modules: string[];
  target_date: string | null;
  stage: WaveStage;
  min_readiness: number;
  min_dqs: number | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  created_at: string;
  updated_at: string;
  /** List view only: the latest analysed run (engine verdict) and its recent scores. */
  last_run_id?: string | null;
  last_verdict?: TransferVerdict | null;
  last_score?: number | null;
  last_completed_at?: string | null;
  trend?: number[];
}

export interface WaveObject {
  module: string;
  label: string;
  verdict: WaveVerdict;
  score: number | null;
  records: number;
  records_blocked: number;
  blocker_count: number;
  dqs: number | null;
}

export interface WaveBlocker {
  module: string;
  label: string;
  gap_type: MigrationGapType;
  field: string | null;
  severity: Severity;
  records: number;
  gaps: number;
}

export interface WaveTrendPoint {
  run_id: string;
  completed_at: string;
  score: number;
}

export interface WaveCockpit {
  wave: MigrationWave;
  run_id: string | null;
  source_version_id: string | null;
  dest_system_type: string;
  verdict: WaveVerdict;
  score: number | null;
  records_total: number;
  records_blocked: number;
  objects: WaveObject[];
  trend: WaveTrendPoint[];
  blockers: WaveBlocker[];
}
```

Append to `frontend/lib/api/migration.ts`, adding `MigrationWave` and `WaveStage` to the type import:

```ts
export interface WaveInput {
  name: string;
  source_system_id?: string | null;
  target_system_id?: string | null;
  target_release?: string;
  modules: string[];
  target_date?: string | null;
  stage: WaveStage;
  min_readiness: number;
  min_dqs?: number | null;
}

export async function getWaves(): Promise<MigrationWave[]> {
  const { data } = await apiClient.get<{ waves: MigrationWave[] }>("/api/v1/migration/waves");
  return data.waves;
}

export async function createWave(body: WaveInput): Promise<MigrationWave> {
  const { data } = await apiClient.post<MigrationWave>("/api/v1/migration/waves", body);
  return data;
}

export async function updateWave(id: string, body: Partial<WaveInput>): Promise<MigrationWave> {
  const { data } = await apiClient.patch<MigrationWave>(`/api/v1/migration/waves/${id}`, body);
  return data;
}

export async function deleteWave(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/migration/waves/${id}`);
}

export async function runWave(
  id: string,
): Promise<{ run_id: string; task_id: string; status: string; mode: MigrationMode; modules: string[] }> {
  const { data } = await apiClient.post(`/api/v1/migration/waves/${id}/run`);
  return data;
}
```

In `frontend/lib/query-keys.ts`, add next to `systems`:

```ts
  migrationWaves: () => ["migration", "waves"] as const,
  migrationCockpit: (waveId: string) => ["migration", "cockpit", waveId] as const,
```

In `frontend/lib/nav.ts:107`, change `href: "/insights/readiness"` to `href: "/migration"`, and add `wave cutover readiness` to its keywords.

Create `frontend/app/(app)/migration/create-wave-dialog.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog } from "@/design";
import { apiErrorMessage } from "@/lib/api/optional";
import { createWave } from "@/lib/api/migration";
import { getSystems } from "@/lib/api/systems";
import { queryKeys } from "@/lib/query-keys";
import type { WaveStage } from "@/types/api";

export const STAGE_LABEL: Record<WaveStage, string> = {
  plan: "Plan", mock1: "Mock 1", mock2: "Mock 2", dress: "Dress rehearsal", cutover: "Cutover",
};

const field = "w-full rounded-md border px-2 py-1 text-[13px]";
const fieldStyle = { borderColor: "var(--m-line)", color: "var(--m-ink)" };

export function CreateWaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: open });
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [modules, setModules] = useState("");
  const [date, setDate] = useState("");
  const [stage, setStage] = useState<WaveStage>("plan");
  const [minReadiness, setMinReadiness] = useState("95");

  const save = useMutation({
    mutationFn: () =>
      createWave({
        name: name.trim(),
        source_system_id: source || null,
        target_system_id: target || null,
        modules: modules.split(",").map((m) => m.trim()).filter(Boolean),
        target_date: date || null,
        stage,
        min_readiness: Number(minReadiness),
      }),
    onSuccess: (w) => {
      toast.success(`Wave ${w.name} created.`);
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const systemOptions = systems.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create wave">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Name
          <input className={field} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Source system
          <select className={field} style={fieldStyle} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">None yet</option>
            {systemOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Target system
          <select className={field} style={fieldStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">S/4HANA standard</option>
            {systemOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Modules
          <input className={field} style={fieldStyle} value={modules} onChange={(e) => setModules(e.target.value)}
                 placeholder="material_master, accounts_payable" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
            Target date
            <input type="date" className={field} style={fieldStyle} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
            Stage
            <select className={field} style={fieldStyle} value={stage}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v in STAGE_LABEL) setStage(v as WaveStage);
                    }}>
              {Object.entries(STAGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
            Minimum readiness %
            <input type="number" min={0} max={100} className={field} style={fieldStyle} value={minReadiness}
                   onChange={(e) => setMinReadiness(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" disabled={!name.trim() || save.isPending}>Save wave</Button>
        </div>
      </form>
    </Dialog>
  );
}
```

The `as WaveStage` cast narrows a value that the `in STAGE_LABEL` guard has just checked. It is not a cast on API data. If lint flags it, replace it with a `isWaveStage(v): v is WaveStage` guard.

Create `frontend/app/(app)/migration/page.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, DataTable, ExplorerPage, Pill, Sparkline, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { getWaves, runWave } from "@/lib/api/migration";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationWave, TransferVerdict, WaveVerdict } from "@/types/api";
import { CreateWaveDialog, STAGE_LABEL } from "./create-wave-dialog";

export const VERDICT_TONE: Record<WaveVerdict, PillTone> = { go: "go", at_risk: "at-risk", no_go: "no-go" };
export const VERDICT_LABEL: Record<WaveVerdict, string> = { go: "Go", at_risk: "At risk", no_go: "No-go" };
const FROM_ENGINE: Record<TransferVerdict, WaveVerdict> = { go: "go", conditional: "at_risk", "no-go": "no_go" };

export default function MigrationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [creating, setCreating] = useState(false);
  const waves = useQuery({ queryKey: queryKeys.migrationWaves(), queryFn: getWaves });
  const run = useMutation({
    mutationFn: runWave,
    onSuccess: () => {
      toast.success("Run queued. Readiness updates when it completes.");
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns: ColumnDef<MigrationWave>[] = [
    { accessorKey: "name", header: "Wave" },
    { id: "stage", header: "Stage", cell: ({ row }) => STAGE_LABEL[row.original.stage] },
    {
      id: "date", header: "Target date",
      cell: ({ row }) => (row.original.target_date ? formatDate(row.original.target_date, "date") : "Not set"),
    },
    {
      id: "verdict", header: "Verdict",
      cell: ({ row }) => {
        const v = row.original.last_verdict ? FROM_ENGINE[row.original.last_verdict] : null;
        return v ? <Pill tone={VERDICT_TONE[v]}>{VERDICT_LABEL[v]}</Pill> : <Pill>Not run</Pill>;
      },
    },
    {
      id: "score", header: "Readiness",
      cell: ({ row }) => (row.original.last_score == null ? "—" : `${row.original.last_score.toFixed(1)}%`),
    },
    {
      id: "trend", header: "Trend",
      cell: ({ row }) => <Sparkline data={(row.original.trend ?? []).map((y, x) => ({ x, y }))} />,
    },
    {
      id: "actions", header: "",
      cell: ({ row }) =>
        can("analyse") ? (
          <Button variant="secondary" disabled={run.isPending}
                  onClick={(e) => { e.stopPropagation(); run.mutate(row.original.id); }}>
            Run now
          </Button>
        ) : null,
    },
  ];

  const data = waves.data ?? [];
  const createButton = can("analyse") ? <Button onClick={() => setCreating(true)}>Create wave</Button> : undefined;
  return (
    <>
      <ExplorerPage
        filterBar={<div className="flex justify-end">{createButton}</div>}
        table={<DataTable columns={columns} data={data} getRowId={(w) => w.id}
                          onRowClick={(w) => router.push(`/migration/${w.id}`)} />}
        state={waves.isPending ? "loading" : waves.isError ? "error" : data.length === 0 ? "empty" : undefined}
        emptyProps={{ title: "No migration waves yet. Create one to track readiness.", action: createButton }}
        errorProps={{ message: apiErrorMessage(waves.error), onRetry: () => void waves.refetch() }}
      />
      <CreateWaveDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
```

Check two things against the real code and adjust:
- `formatDate`'s accepted modes in `@/lib/format`. A date has no time, so it does not need a zone.
- That `DataTable`'s `onRowClick` and `Sparkline` match the signatures in `frontend/design`.

`apiErrorMessage` must accept `unknown` or `Error | null`. Read its signature in `@/lib/api/optional`.

- [ ] **Step 4: Run the gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: PASS, including the 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/types/api.ts frontend/lib/api/migration.ts frontend/lib/query-keys.ts frontend/lib/nav.ts \
  "frontend/app/(app)/migration"
git commit -m "feat(migration-ui): wave list with verdict, readiness trend, run now and create wave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 8: Frontend: the `/migration/[waveId]` cockpit tabs and the e2e test

**Files:**
- Modify: `frontend/lib/api/migration.ts`, `frontend/lib/query-keys.ts`
- Create: `frontend/app/(app)/migration/[waveId]/page.tsx`, `blockers-tab.tsx`, `mapping-tab.tsx`, `s4-tab.tsx`
- Test: `frontend/app/(app)/migration/[waveId]/__tests__/page.test.tsx` (new)
- Create: `frontend/e2e/migration-cockpit.spec.ts`. Modify `frontend/e2e/routes.json`.

**Interfaces:**
- Consumes:
  - The Task 4 and Task 5 routes.
  - The existing client functions `getMigrationFindings`, `getFieldMap`, `updateFieldMap`, `getValueMap`, `saveValueMap`, `downloadMigrationExport` and `downloadMigrationGaps`.
  - The existing endpoint `GET /api/v1/findings/s4-readiness`.
- Produces:
  - Client: `getWaveCockpit(id)`, `signoffWave(id)`, `createBlockerFixBatch(id, body)`, `downloadWaveReport(id, fmt)` and `getS4Readiness(versionId)`.
  - Query keys: `migrationGaps(runId, filter)`, `migrationFieldMap(module, destType)`, `migrationValueMap(module)` and `s4Readiness(versionId)`.
  - The page `/migration/[waveId]`:
    - Header: name, stage, target date, sign-off line.
    - Stats: verdict, readiness, records blocked, and the trend (`Line`).
    - Tabs: `objects`, `blockers`, `mapping`, `s4`, `downloads`, kept in `?tab=`.
    - "Sign off" appears only with the `approve` permission and when the verdict is `go`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(app)/migration/[waveId]/__tests__/page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as migrationApi from "@/lib/api/migration";
import type { WaveCockpit } from "@/types/api";
import WaveCockpitPage from "../page";

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/migration/w1",
  useSearchParams: () => search,
  useParams: () => ({ waveId: "w1" }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COCKPIT: WaveCockpit = {
  wave: {
    id: "w1", name: "Wave 1", source_system_id: "s1", target_system_id: null, target_release: "s4hana",
    modules: ["accounts_payable"], target_date: "2027-03-01", stage: "mock1", min_readiness: 95, min_dqs: null,
    signed_off_by: null, signed_off_at: null, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
  },
  run_id: "r2", source_version_id: "v1", dest_system_type: "s4hana", verdict: "at_risk", score: 97,
  records_total: 100, records_blocked: 3,
  objects: [{ module: "accounts_payable", label: "BP supplier", verdict: "at_risk", score: 94, records: 50,
              records_blocked: 3, blocker_count: 3, dqs: 72 }],
  trend: [{ run_id: "r1", completed_at: "2026-10-07T08:00:00Z", score: 80 },
          { run_id: "r2", completed_at: "2026-10-10T08:00:00Z", score: 97 }],
  blockers: [{ module: "accounts_payable", label: "BP supplier", gap_type: "value_unmapped",
               field: "BUT000.BU_GROUP", severity: "critical", records: 3, gaps: 3 }],
};

describe("WaveCockpitPage", () => {
  it("shows the header, verdict and objects", async () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText("Wave 1")).toBeInTheDocument();
    expect(screen.getAllByText("At risk").length).toBeGreaterThan(0);
    expect(screen.getByText("97.0%")).toBeInTheDocument();
    expect(screen.getByText("BP supplier")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign off" })).not.toBeInTheDocument();
  });

  it("drafts a fix batch from a blocker", async () => {
    search = new URLSearchParams("tab=blockers");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    const fix = vi.spyOn(migrationApi, "createBlockerFixBatch").mockResolvedValue({ id: "b1" });
    renderWithQuery(<WaveCockpitPage />);
    expect(await screen.findByText("BUT000.BU_GROUP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create fix batch" }));
    await waitFor(() => expect(fix).toHaveBeenCalledWith("w1", {
      module: "accounts_payable", gap_type: "value_unmapped", field: "BUT000.BU_GROUP",
    }));
  });

  it("offers sign-off when the verdict is go", async () => {
    search = new URLSearchParams();
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue({ ...COCKPIT, verdict: "go" });
    const sign = vi.spyOn(migrationApi, "signoffWave").mockResolvedValue(COCKPIT.wave);
    renderWithQuery(<WaveCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign off" }));
    await waitFor(() => expect(sign).toHaveBeenCalledWith("w1"));
  });

  it("downloads the readiness report", async () => {
    search = new URLSearchParams("tab=downloads");
    vi.spyOn(migrationApi, "getWaveCockpit").mockResolvedValue(COCKPIT);
    const dl = vi.spyOn(migrationApi, "downloadWaveReport").mockResolvedValue();
    renderWithQuery(<WaveCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Readiness report (PDF)" }));
    expect(dl).toHaveBeenCalledWith("w1", "pdf");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run "app/(app)/migration/\[waveId\]"`
Expected: FAIL. `Failed to resolve import "../page"`.

- [ ] **Step 3: Implement**

Append to `frontend/lib/api/migration.ts`, adding `WaveCockpit` to the type import:

```ts
export async function getWaveCockpit(id: string): Promise<WaveCockpit> {
  const { data } = await apiClient.get<WaveCockpit>(`/api/v1/migration/waves/${id}/cockpit`);
  return data;
}

export async function signoffWave(id: string): Promise<MigrationWave> {
  const { data } = await apiClient.post<MigrationWave>(`/api/v1/migration/waves/${id}/signoff`);
  return data;
}

export async function createBlockerFixBatch(
  id: string,
  body: { module: string; gap_type: string; field: string | null },
): Promise<{ id: string }> {
  const { data } = await apiClient.post(`/api/v1/migration/waves/${id}/blockers/fix-batch`, body);
  return data;
}

export function downloadWaveReport(id: string, fmt: "xlsx" | "pdf"): Promise<void> {
  return downloadBlob(`/api/v1/migration/waves/${id}/report.${fmt}`, {}, `migration_readiness_${id}.${fmt}`);
}

export interface S4Area {
  area: string;
  label: string;
  simplification_item: string | null;
  rules: number;
  failing: number;
  failing_records: number;
  blocking_failing: number;
  status: string;
}

export async function getS4Readiness(versionId: string): Promise<{ status: string; areas: S4Area[] }> {
  const { data } = await apiClient.get("/api/v1/findings/s4-readiness", { params: { version_id: versionId } });
  return data;
}
```

`draft_batch` returns the new batch under `id` (`api/services/remediation.py:97-148`), so the client reads `id`.

In `frontend/lib/query-keys.ts`:

```ts
  migrationGaps: (runId: string, filter: Record<string, unknown>) =>
    ["migration", "gaps", runId, normalizeFilters(filter)] as const,
  migrationFieldMap: (module: string, destType: string) => ["migration", "field-map", module, destType] as const,
  migrationValueMap: (module: string) => ["migration", "value-map", module] as const,
  s4Readiness: (versionId: string) => ["s4-readiness", versionId] as const,
```

Create `frontend/app/(app)/migration/[waveId]/page.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, ErrorState, Line, Pill, Skeleton, Stat, Tabs } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import {
  downloadMigrationExport, downloadMigrationGaps, downloadWaveReport, getWaveCockpit, signoffWave,
} from "@/lib/api/migration";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { WaveObject } from "@/types/api";
import { STAGE_LABEL } from "../create-wave-dialog";
import { VERDICT_LABEL, VERDICT_TONE } from "../page";
import { BlockersTab } from "./blockers-tab";
import { MappingTab } from "./mapping-tab";
import { S4Tab } from "./s4-tab";

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

const OBJECT_COLUMNS: ColumnDef<WaveObject>[] = [
  { accessorKey: "label", header: "Object" },
  { id: "verdict", header: "Verdict", cell: ({ row }) => (
      <Pill tone={VERDICT_TONE[row.original.verdict]}>{VERDICT_LABEL[row.original.verdict]}</Pill>) },
  { id: "score", header: "Readiness", cell: ({ row }) => pct(row.original.score) },
  { id: "records", header: "Records", cell: ({ row }) => row.original.records.toLocaleString() },
  { id: "blocked", header: "Records blocked", cell: ({ row }) => row.original.records_blocked.toLocaleString() },
  { id: "gaps", header: "Blocking gaps", cell: ({ row }) => row.original.blocker_count.toLocaleString() },
  { id: "dqs", header: "DQS", cell: ({ row }) => (row.original.dqs == null ? "—" : row.original.dqs.toFixed(1)) },
];

export default function WaveCockpitPage() {
  const { waveId } = useParams<{ waveId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { can } = useRole();
  const cockpit = useQuery({ queryKey: queryKeys.migrationCockpit(waveId), queryFn: () => getWaveCockpit(waveId) });
  const signoff = useMutation({
    mutationFn: () => signoffWave(waveId),
    onSuccess: () => {
      toast.success("Wave signed off.");
      void qc.invalidateQueries({ queryKey: queryKeys.migrationCockpit(waveId) });
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (cockpit.isPending) return <Skeleton height={240} />;
  if (cockpit.isError)
    return <ErrorState message={apiErrorMessage(cockpit.error)} onRetry={() => void cockpit.refetch()} />;
  const c = cockpit.data;
  const w = c.wave;

  const downloads = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void downloadWaveReport(waveId, "pdf")}>Readiness report (PDF)</Button>
      <Button variant="secondary" onClick={() => void downloadWaveReport(waveId, "xlsx")}>Readiness report (Excel)</Button>
      {c.run_id ? (
        <>
          <Button variant="secondary" onClick={() => void downloadMigrationGaps(c.run_id ?? "", "xlsx")}>Gap list (Excel)</Button>
          <Button variant="secondary" onClick={() => void downloadMigrationExport(c.run_id ?? "", "xlsx")}>Load files (Excel)</Button>
          <Button variant="secondary" onClick={() => void downloadMigrationExport(c.run_id ?? "", "csv")}>Load files (CSV)</Button>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[20px] font-semibold" style={{ color: "var(--m-ink)" }}>{w.name}</p>
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
            {STAGE_LABEL[w.stage]} · target {w.target_date ? formatDate(w.target_date, "date") : "not set"} ·{" "}
            {w.signed_off_at ? `signed off ${formatDate(w.signed_off_at, "datetime", "SAST")}` : "not signed off"}
          </p>
        </div>
        {can("approve") && c.verdict === "go" && !w.signed_off_at ? (
          <Button disabled={signoff.isPending} onClick={() => signoff.mutate()}>Sign off</Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Verdict" value={<Pill tone={VERDICT_TONE[c.verdict]}>{VERDICT_LABEL[c.verdict]}</Pill>} />
        <Stat label="Readiness" value={pct(c.score)} delta={`minimum ${w.min_readiness}%`} />
        <Stat label="Records blocked" value={c.records_blocked.toLocaleString()}
              delta={`of ${c.records_total.toLocaleString()}`} />
        <Stat label="Trend" value={<Line data={c.trend.map((p) => ({ x: formatDate(p.completed_at, "date"), y: p.score }))} />} />
      </div>
      <Tabs
        defaultValue={searchParams.get("tab") ?? "objects"}
        onValueChange={(v) => router.replace(`/migration/${waveId}?tab=${v}`)}
        items={[
          { value: "objects", label: "Objects", content: c.objects.length ? (
              <DataTable columns={OBJECT_COLUMNS} data={c.objects} getRowId={(o) => o.module} />
            ) : <EmptyState title="Add modules to this wave to see its objects." /> },
          { value: "blockers", label: "Blockers", content: <BlockersTab waveId={waveId} runId={c.run_id} blockers={c.blockers} /> },
          { value: "mapping", label: "Mapping", content: (
              <MappingTab modules={w.modules} destType={c.dest_system_type} />) },
          { value: "s4", label: "S/4 areas", content: <S4Tab versionId={c.source_version_id} /> },
          { value: "downloads", label: "Downloads", content: downloads },
        ]}
      />
    </div>
  );
}
```

Importing `VERDICT_TONE` and `VERDICT_LABEL` from `../page` is fine for a client page. If Next's page-export lint rule complains about non-default exports from `page.tsx`, move both maps and `STAGE_LABEL` to `frontend/app/(app)/migration/_verdict.ts` and import them from there in both pages.

Create `frontend/app/(app)/migration/[waveId]/blockers-tab.tsx`:

```tsx
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Mono, Pill } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { createBlockerFixBatch, getMigrationFindings } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationGapFinding, WaveBlocker } from "@/types/api";

const GAP_COLUMNS: ColumnDef<MigrationGapFinding>[] = [
  { id: "key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key ?? "All records"}</Mono> },
  { id: "src", header: "Source value", cell: ({ row }) => row.original.source_value ?? "—" },
  { id: "detail", header: "Detail", cell: ({ row }) => row.original.detail ?? "—" },
];

export function BlockersTab({ waveId, runId, blockers }: { waveId: string; runId: string | null; blockers: WaveBlocker[] }) {
  const { can } = useRole();
  const [open, setOpen] = useState<WaveBlocker | null>(null);
  const filter = open ? { module: open.module, gap_type: open.gap_type, search: open.field ?? undefined } : {};
  const gaps = useQuery({
    queryKey: queryKeys.migrationGaps(runId ?? "", filter),
    queryFn: () => getMigrationFindings(runId ?? "", { ...filter, limit: 100 }),
    enabled: open !== null && runId !== null,
  });
  const fix = useMutation({
    mutationFn: (b: WaveBlocker) => createBlockerFixBatch(waveId, { module: b.module, gap_type: b.gap_type, field: b.field }),
    onSuccess: () => toast.success("Fix batch drafted. Review it under Cleaning."),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns: ColumnDef<WaveBlocker>[] = [
    { accessorKey: "label", header: "Object" },
    { id: "gap", header: "Gap", cell: ({ row }) => formatModuleName(row.original.gap_type) },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field ?? "—"}</Mono> },
    { id: "sev", header: "Severity", cell: ({ row }) => (
        <Pill tone={row.original.severity === "critical" ? "no-go" : "at-risk"}>{row.original.severity}</Pill>) },
    { id: "records", header: "Records", cell: ({ row }) => row.original.records.toLocaleString() },
    { id: "fix", header: "", cell: ({ row }) => can("apply") ? (
        <Button variant="secondary" disabled={fix.isPending}
                onClick={(e) => { e.stopPropagation(); fix.mutate(row.original); }}>Create fix batch</Button>
      ) : null },
  ];

  if (!runId) return <EmptyState title="Run this wave to see its blockers." />;
  if (!blockers.length) return <EmptyState title="The latest run found no critical or high gaps." />;
  return (
    <div className="flex flex-col gap-4">
      <DataTable columns={columns} data={blockers} getRowId={(b) => `${b.module}|${b.gap_type}|${b.field ?? ""}`}
                 onRowClick={setOpen} />
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold" style={{ color: "var(--m-ink)" }}>
            {open.label}: {formatModuleName(open.gap_type)} {open.field ?? ""}
          </p>
          <DataTable columns={GAP_COLUMNS} data={gaps.data?.items ?? []}
                     getRowId={(g) => `${g.record_key ?? ""}|${g.target_field ?? ""}|${g.source_value ?? ""}`} />
        </div>
      ) : null}
    </div>
  );
}
```

Create `frontend/app/(app)/migration/[waveId]/mapping-tab.tsx`. It has a field-map table per module, a confirm toggle and a value-map editor for the selected target field.

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Mono } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { getFieldMap, getValueMap, saveValueMap, updateFieldMap } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { TransferFieldMapping, TransferValueMapping } from "@/types/api";

export function MappingTab({ modules, destType }: { modules: string[]; destType: string }) {
  const [module, setModule] = useState(modules[0] ?? "");
  const [targetField, setTargetField] = useState<string | null>(null);
  if (!modules.length) return <EmptyState title="Add modules to this wave to edit their mapping." />;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
        Module
        <select className="rounded-md border px-2 py-1 text-[13px]" style={{ borderColor: "var(--m-line)" }}
                value={module} onChange={(e) => { setModule(e.target.value); setTargetField(null); }}>
          {modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
        </select>
      </label>
      <FieldMap module={module} destType={destType} onValueMap={setTargetField} />
      {targetField ? <ValueMap module={module} targetField={targetField} /> : null}
    </div>
  );
}

function FieldMap({ module, destType, onValueMap }: { module: string; destType: string; onValueMap: (f: string) => void }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const key = queryKeys.migrationFieldMap(module, destType);
  const map = useQuery({ queryKey: key, queryFn: () => getFieldMap(module, destType) });
  const confirm = useMutation({
    mutationFn: (m: TransferFieldMapping) => updateFieldMap(m.id, { is_confirmed: !m.is_confirmed }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const columns: ColumnDef<TransferFieldMapping>[] = [
    { id: "src", header: "Source field", cell: ({ row }) => <Mono>{row.original.source_field}</Mono> },
    { id: "dst", header: "Target field", cell: ({ row }) => (
        <Mono>{row.original.dest_table ? `${row.original.dest_table}.${row.original.dest_field ?? ""}` : "Not migrated"}</Mono>) },
    { id: "origin", header: "Origin", cell: ({ row }) => row.original.origin },
    { id: "confirmed", header: "Confirmed", cell: ({ row }) => (
        <input type="checkbox" aria-label={`Confirm ${row.original.source_field}`} checked={row.original.is_confirmed}
               disabled={!can("analyse") || confirm.isPending} onChange={() => confirm.mutate(row.original)} />) },
    { id: "vm", header: "", cell: ({ row }) => row.original.value_map && row.original.dest_table ? (
        <Button variant="secondary" onClick={() => onValueMap(`${row.original.dest_table}.${row.original.dest_field ?? ""}`)}>
          Value map
        </Button>) : null },
  ];
  if (map.isPending) return null;
  if (!map.data?.length) return <EmptyState title="No field map for this module yet. Run the wave to seed one." />;
  return <DataTable columns={columns} data={map.data} getRowId={(m) => m.id} />;
}

function ValueMap({ module, targetField }: { module: string; targetField: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const key = queryKeys.migrationValueMap(module);
  const entries = useQuery({ queryKey: key, queryFn: () => getValueMap(module, targetField) });
  const [src, setSrc] = useState("");
  const [dst, setDst] = useState("");
  const save = useMutation({
    mutationFn: () => saveValueMap({ module, target_field: targetField, entries: [{ source_value: src, target_value: dst }] }),
    onSuccess: () => { setSrc(""); setDst(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const columns: ColumnDef<TransferValueMapping>[] = [
    { id: "s", header: "Source value", cell: ({ row }) => <Mono>{row.original.source_value}</Mono> },
    { id: "t", header: "Target value", cell: ({ row }) => <Mono>{row.original.target_value}</Mono> },
  ];
  const rows = (entries.data ?? []).filter((e) => e.target_field === targetField);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold" style={{ color: "var(--m-ink)" }}>Value map for <Mono>{targetField}</Mono></p>
      <DataTable columns={columns} data={rows} getRowId={(e) => e.id} />
      {can("analyse") ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <input aria-label="Source value" className="rounded-md border px-2 py-1 text-[13px]"
                 style={{ borderColor: "var(--m-line)" }} value={src} onChange={(e) => setSrc(e.target.value)} />
          <input aria-label="Target value" className="rounded-md border px-2 py-1 text-[13px]"
                 style={{ borderColor: "var(--m-line)" }} value={dst} onChange={(e) => setDst(e.target.value)} />
          <Button type="submit" disabled={!src || !dst || save.isPending}>Add mapping</Button>
        </form>
      ) : null}
    </div>
  );
}
```

`MappingTab` takes no `runId` yet. Add it back when value candidates (`getValueCandidates(runId, field)`) land.

Create `frontend/app/(app)/migration/[waveId]/s4-tab.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Pill, type PillTone } from "@/design";
import { apiErrorMessage } from "@/lib/api/optional";
import { getS4Readiness, type S4Area } from "@/lib/api/migration";
import { queryKeys } from "@/lib/query-keys";

const TONE: Record<string, PillTone> = { green: "go", amber: "at-risk", red: "no-go" };

const COLUMNS: ColumnDef<S4Area>[] = [
  { accessorKey: "label", header: "Area" },
  { id: "status", header: "Status", cell: ({ row }) => <Pill tone={TONE[row.original.status] ?? "neutral"}>{row.original.status}</Pill> },
  { id: "rules", header: "Rules", cell: ({ row }) => row.original.rules },
  { id: "failing", header: "Failing rules", cell: ({ row }) => row.original.failing },
  { id: "blocking", header: "Blocking", cell: ({ row }) => row.original.blocking_failing },
  { id: "records", header: "Failing records", cell: ({ row }) => row.original.failing_records.toLocaleString() },
];

export function S4Tab({ versionId }: { versionId: string | null }) {
  const s4 = useQuery({
    queryKey: queryKeys.s4Readiness(versionId ?? ""),
    queryFn: () => getS4Readiness(versionId ?? ""),
    enabled: versionId !== null,
  });
  if (!versionId) return <EmptyState title="Run this wave to see S/4 simplification areas." />;
  if (s4.isError) return <ErrorState message={apiErrorMessage(s4.error)} onRetry={() => void s4.refetch()} />;
  return <DataTable columns={COLUMNS} data={s4.data?.areas ?? []} getRowId={(a) => a.area} />;
}
```

Check the status values that `api/services/s4_readiness.status_of` emits, and match `TONE`'s keys to them.

Add to `frontend/e2e/routes.json`:

```json
  { "name": "migration", "path": "/migration", "heading": "Migration" },
  { "name": "migration-wave", "path": "/migration/w1", "heading": "Migration" }
```

If the HAR has no wave `w1`, use the id that `npm run e2e:record` captures after seeding one wave on the recording stack.

Create `frontend/e2e/migration-cockpit.spec.ts`:

```ts
import { expect, test } from "./fixtures";

/** Migration lead journey: wave list -> wave cockpit -> blockers tab. */
test("a wave opens its cockpit and lists its blockers", async ({ app }) => {
  await app.goto("/migration", { waitUntil: "load" });
  const row = app.getByRole("row").nth(1);
  await expect(row).toBeVisible();
  await row.click();
  await expect(app).toHaveURL(/\/migration\/[^/]+$/);
  await expect(app.getByRole("tab", { name: "Objects" })).toBeVisible();
  await app.getByRole("tab", { name: "Blockers" }).click();
  await expect(app).toHaveURL(/tab=blockers/);
});
```

Re-record the HAR with `npm run e2e:record` against a stack seeded with one analysed wave, so the replay has `/api/v1/migration/waves` and `/cockpit` responses. Commit the HAR change with this task.

- [ ] **Step 4: Run the gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`. Expected: PASS.
Run: `cd frontend && npx playwright test e2e/migration-cockpit.spec.ts e2e/aurora-smoke.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api/migration.ts frontend/lib/query-keys.ts "frontend/app/(app)/migration" \
  frontend/e2e/migration-cockpit.spec.ts frontend/e2e/routes.json frontend/e2e/fixtures
git commit -m "feat(migration-ui): wave cockpit with objects, blockers, mapping, S/4 areas and downloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Self-review against spec section 2

| Spec item | Where | Status |
|---|---|---|
| Build 1: `migration_waves` (id, tenant_id, name, source and target system, modules[], target_date, stage, min_readiness 95, min_dqs, signed_off_by and signed_off_at) with RLS | Task 1 | Covered. Adds `target_release`, `created_at` and `updated_at`. |
| Build 1: `migration_runs.wave_id` | Task 1 | Covered (`ON DELETE SET NULL`). |
| Build 1: copy `readiness_waves` settings into rows | Task 1 | Covered and tested through downgrade and upgrade. |
| Build 2: group by wave, conditional as `at_risk`, `score` and `records_blocked` per cell | Task 2 | Covered. The 409 is removed (ruling 2). |
| Build 3: wave CRUD and POST run | Task 3 | Covered. |
| Build 3: cockpit (objects, verdict, trend, top 20 blockers, S/4 areas) | Tasks 4, 8 | Covered. S/4 areas reuse `/findings/s4-readiness` (correction 7). |
| Build 3: sign-off needs `approve` and writes the audit log | Task 4 | Covered. Explicit `audit_log` row with before and after. |
| Build 4: auto re-run from `run_checks` | Task 6 | Covered. Signed-off waves are frozen (ruling 9). |
| Build 5: module-to-business-object labels in `migration/__init__.py` | Task 3 | Covered. |
| Build 6: `/migration` list (verdict pill, readiness %, sparkline, run now, create) | Task 7 | Covered. |
| Build 6: `/migration/[waveId]` tabs (Objects, Blockers with drill and fix batch, Mapping, S/4 areas, Downloads) | Tasks 5, 8 | Covered. Fix batch is a new endpoint (ruling 10). |
| Build 6: nav "Migration" points to `/migration` | Task 7 | Covered (repointed, correction 5). |
| Build 7: pytest grid, cockpit SQL on pg, wave CRUD with RLS | Tasks 1-6 | Covered. |
| Build 7: vitest and e2e migration-cockpit | Tasks 7, 8 | Covered. |
| Global: Excel and branded PDF for reporting | Task 5 | Covered. |
| Global: SAST times | Tasks 5, 8 | Covered (`sast` filter, `formatDate(..., "SAST")`). |

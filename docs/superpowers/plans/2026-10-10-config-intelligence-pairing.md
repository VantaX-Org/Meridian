# Config Intelligence Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Read and store the configuration of every connected SAP system when it first connects.
- Pair each source system with a target system.
- Compare the source configuration with the target configuration, and send the proposed value matches to the steward queue.
- Use the confirmed matches and the target configuration in the S/4 dry run, the export and a branded realignment report.

**Architecture:**
- Data:
  - Migration 075 adds `sap_systems.role` and `sap_systems.target_system_id`.
  - It adds `source_system_id`, `target_system_id` and `status` to `transfer_value_mappings`, and replaces the table's unique key with a pair-scoped key (`NULLS NOT DISTINCT`).
  - There is no new table. Snapshots are `config_loads` and `config_items` (064). Drift goes to `config_drift_log` (028). Proposals are `transfer_value_mappings` rows with `status = 'proposed'`.
- Backend:
  - The new module `api/services/config_pairing.py` holds the deterministic matcher, the baseline fallback, target resolution, the drift writer, proposals, finding context, the realignment sheets and `enqueue_config_load`.
  - `ConnectivityManager.load_config` falls back to the baseline for types with no config API, deletes the load's items before it inserts them, and writes drift.
  - Register and the first successful test connection enqueue a config load. Extraction waits for a running load or proceeds with `config_basis: "baseline"`.
  - The gap engine and the export builder apply `'config'` value maps through the target field's `check_ref`. A check against a baseline target is `medium` and flagged, not blocking.
  - The new router `/api/v1/config-pairing` serves compare, propose and finding context. `/api/v1/migration/runs/{id}/realignment.{xlsx|pdf}` serves the report.
- Frontend:
  - The system edit drawer gains Role and Target selects. The system header and the systems list show the role.
  - The Health tab gains `ConfigComparePanel`, with per-object counts, the selected object's rows and a Propose button.
  - The rule page gains `FindingContextPanel`.

**Tech Stack:** FastAPI, SQLAlchemy `text()` SQL on Postgres 16 with RLS, Alembic, Celery, `difflib` (stdlib), Jinja + WeasyPrint (`api/services/pdf_reports.render`), pandas + openpyxl, Next.js App Router, React Query, `@/design`, vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-10-10-config-intelligence-pairing-design.md`.

**Global constraints:**
- No `any` in TypeScript and no `Any` in new Python signatures. Narrow API data with types. Do not use `as` casts on API data.
- Never add to the `lint:tokens` allowlist, and never touch `frontend/scripts/lint-tokens.allow.txt`. Use design tokens only: `var(--m-ink)`, `var(--m-ink-2)`, `var(--m-ink-3)`, `var(--m-line)`, `var(--m-pass)`, `var(--m-critical)`, `var(--m-accent)`, `var(--m-medium)`. Add no new hex value, gradient or blur.
- No customer names in code, tests, fixtures or commit messages. Use neutral names such as `PRD` and `S4D`.
- Rule IDs are append-only. This plan adds no rules.
- Migration 075 revises `"068"` and must downgrade cleanly. Migrations 069-074 live on other branches; whoever merges second re-chains them. This plan does not.
- There is no new table, so there is no new RLS policy or GRANT. Both altered tables already have tenant RLS.
- Times shown to users are in SAST with the zone label: `formatDate(iso, "datetime", "SAST")` in the frontend and the `sast` filter in PDFs.
- The eslint copy rules apply. Do not use "Cancel", "Submit", "OK", "Error", "Loading", "dashboard", "click here", "Oops" or "Sorry" in UI copy. Verdict sentences end with a full stop.
- The UI uses Aurora (`@/design`) only. Only `PageHeader` renders an `h1`.
- Reporting means both an Excel export and a branded PDF.
- Implementers do not run `npm run build`.
- Backend test command: `python3 -m pytest <file> -q -p no:cacheprovider`. Postgres tests skip unless `MERIDIAN_TEST_DB_URL` is set. Run them with `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test`.
- Frontend gate, for every frontend task: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`. Tests live in `__tests__/` next to the file under test and use `renderWithQuery` from `@/__tests__/render`.
- Celery tasks keep soft and hard time limits and must be idempotent. Do not use `acks_late` on heavy tasks.
- No eager full-dataset loads. Item reads are capped (`ITEM_CAP`), and report sheets are capped at 5,000 rows.
- The SAP connector stays READ-ONLY. Nothing in this plan writes to SAP.
- Type hints everywhere. Reuse existing tables.
- Matching is deterministic (no LLM). A steward confirms every proposal before it is used.
- Mark known ceilings with a `ponytail:` comment.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

**Spec corrections (verified against the code at bb0bd650):**
1. **Extraction already refreshes config tables.** `run_extraction.py:132-138` stores config-purpose tables in `config_snapshots` on every extraction. The audit said that extraction never reads config. That is true only of `sync_config` and of `config_loads`.
2. **The audit missed `config_loads` and `config_items` (064).** They are the versioned snapshot store. `run_load_config.py:45` hard-codes `role = 'source'`, and the connectivity routes filter on `role = 'source'` (the `list_config_status` lateral join, `get_config_load` and `get_config_load_items`). Task 5 and Task 6 remove both.
3. **S/4HANA Cloud, BTP and Ariba have no config API.** `_NO_CONFIG_API` (`sap/config_loader.py:142-160`) marks every object `NOT_AVAILABLE`, so their loads store no items. The baseline fallback (Task 5) fills them.
4. **The `connectivity_manager.py` line references were wrong.** `load_config` is at lines 710-758, and the baseline writer `_store_baseline_snapshot` is at about lines 852-870.
5. **The value-map unique key blocks pair scoping.** `uq_transfer_value_mappings (tenant_id, module, target_field, source_value)` allows one row per value. The PUT route's `ON CONFLICT (tenant_id, module, target_field, source_value)` must move to the new named constraint (Task 10).
6. **The name `config_intelligence` is taken.** `api/routes/config_intelligence.py` serves `/api/v1/config`. The new router is `api/routes/config_pairing.py` at `/api/v1/config-pairing`.
7. **The discovery guard rarely fires.** Register already enqueues discovery, so `test_connection`'s `not discovery_status` guard is almost always false. Config on connect uses its own existence check (`config_basis`), not that guard.

**Rulings (decisions this plan makes where the spec is silent):**
1. **Register takes the role only.** The target is assigned through the update route, because the target must already exist.
2. **A target has no target.** Setting a system's role to `target` also clears its own `target_system_id`.
3. **`config_basis`.** A completed load wins (`loaded`). A queued or running load counts only when it started less than 30 minutes ago (`loading`). Otherwise the basis is `none`.
4. **The default baseline target is `s4hana_cloud`.**
5. **Compared objects.** Only objects present in both the source load and the target are compared. The compare route returns rows only for the selected object.
6. **Steward PUTs are global and confirmed.** The value-map GET returns confirmed rows only.
7. **`acks_late`** is removed from `run_load_config` only.
8. **Enqueue order.** `start_job`, then `apply_async`, then insert the `config_loads` row with `status = 'running'` and `ON CONFLICT (id) DO NOTHING`, then commit. The task upserts the same row to `running`. Using `running` (not a new `queued` status) keeps the existing UI types valid.
9. **`hasNoConfig` is unchanged.** A baseline load is a completed load, and its objects carry the baseline detail.
10. **The TypeScript `role` and `target_system_id` fields are required** on `SAPSystemExtended`. The API always returns them.
11. **The role pill uses tone `neutral`.**
12. **Clearing the target.** The Target select's "None" option sends `target_system_id: ""`. The API reads `""` as NULL.
13. **Proposals with no assigned target** are scoped `(source, NULL)`.
14. **`FindingContextPanel` renders nothing** on an error or when there is no context.
15. **The new routes call sync helpers with `db.run_sync`.** This keeps RLS and the test `get_db` override on one connection.
16. **Finding context takes `fields`** (the rule's record field names) as a fallback when the rule has no applicability condition.
17. **`enqueue_config_load`** lives in `config_pairing`. With `force`, it skips the basis check and raises on failure. Without `force`, it logs the failure and returns None, so a failed enqueue never fails register or test connection.
18. **`wait_for_config`** lives in `run_extraction.py`. It runs at the top of the task, before the version id and job are created, so a retry does not create a second job.
19. **`load_target_config` falls back to the baseline** when the destination has no load and no live snapshot.
20. **`with_baseline` trigger.** It replaces a snapshot that has objects, no items, and every object `NOT_AVAILABLE`. This avoids importing the private `_NO_CONFIG_API`.
21. **A run's destination defaults to the assigned target** only when the mode is `source_to_destination` and no destination was given.

---

## File map

| File | Change | Task |
|---|---|---|
| `db/migrations/versions/075_config_pairing.py` | new: role, target, scoped value maps with status | 1 |
| `db/schema.py` | `SAPSystem.role`, `.target_system_id`; `TransferValueMapping` scope and status | 1 |
| `tests/test_config_pairing_pg.py` | new: Postgres tests for Tasks 1, 4, 5, 6, 7, 11, 12 | 1, 4, 5, 6, 7, 11, 12 |
| `sap/baseline_config.py` | `s4hana_cloud` and `btp` baselines | 2 |
| `tests/test_baseline_config.py` | new | 2 |
| `api/services/config_pairing.py` | new: matcher, baseline, target, drift, proposals, context, sheets, enqueue | 3, 4, 6, 12 |
| `tests/test_config_pairing.py` | new: pure-function tests | 3 |
| `api/services/connectivity_manager.py` | `load_config` baseline fallback, idempotent items, drift, origin | 5 |
| `workers/tasks/run_load_config.py` | role from the system; upsert; no `acks_late` | 5 |
| `api/routes/connectivity.py` | `start_config_load` uses `enqueue_config_load`; role filters removed | 6 |
| `api/routes/systems.py` | role on register; role and target on update; list fields; config on connect | 6, 7 |
| `workers/tasks/run_extraction.py` | `wait_for_config`; `config_basis` in the version metadata | 8 |
| `tests/test_wait_for_config.py` | new | 8 |
| `api/services/migration/engine.py` | `check_ref` value maps; baseline basis | 9 |
| `api/services/migration/export.py` | `target_dict` and `check_ref` value maps | 9 |
| `tests/test_migration_engine.py` | three new tests | 9 |
| `workers/tasks/run_migration.py` | scoped value maps; target config with basis | 10 |
| `api/routes/migration.py` | default destination; export maps; value-map GET and PUT; realignment report | 10, 12 |
| `api/routes/config_pairing.py` | new: compare, propose, finding context | 11 |
| `api/main.py` | include the config-pairing router | 11 |
| `api/routes/stewardship.py` | `config_value_match` approve and reject | 11 |
| `templates/config_realignment_report.html` | new | 12 |
| `frontend/lib/api/config-pairing.ts` | new | 13 |
| `frontend/lib/api/systems.ts` | `role`, `target_system_id` in the update body | 13 |
| `frontend/lib/query-keys.ts` | `configCompare`, `findingContext` | 13 |
| `frontend/types/api.ts` | `SAPSystemExtended.role`, `.target_system_id`; `config_value_match` | 13 |
| `frontend/app/(app)/home/__tests__/live.test.tsx` | fixture fields | 13 |
| `frontend/lib/api/__tests__/config-pairing.test.ts` | new | 13 |
| `frontend/app/(app)/systems/[systemId]/page.tsx` | role pill; Role and Target selects; compare panel | 14 |
| `frontend/app/(app)/systems/[systemId]/config-compare-panel.tsx` | new | 14 |
| `frontend/app/(app)/systems/page.tsx` | Role column | 14 |
| `frontend/app/(app)/objects/[object]/rules/[ruleId]/finding-context-panel.tsx` | new | 14 |
| `frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx` | render the context panel | 14 |
| `frontend/app/(app)/systems/[systemId]/__tests__/config-compare-panel.test.tsx` | new | 14 |
| `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/finding-context-panel.test.tsx` | new | 14 |
| `frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx` | mock `getConfigCompare`; fixture fields | 14 |

---

### Task 1: Migration 075: system role, target and scoped value maps

**Files:**
- Create: `db/migrations/versions/075_config_pairing.py`
- Modify: `db/schema.py`. Add two columns to `SAPSystem` after `last_snapshot_id` (line 676). Add three columns to `TransferValueMapping` (lines 1191-1208) and replace its `UniqueConstraint`.
- Test: `tests/test_config_pairing_pg.py` (new)

**Interfaces:**
- Consumes: `sap_systems`, `transfer_value_mappings` (048).
- Produces:
  - `sap_systems.role TEXT NOT NULL DEFAULT 'source'`, CHECK `ck_sap_systems_role`.
  - `sap_systems.target_system_id UUID NULL`, FK `fk_sap_systems_target` `ON DELETE SET NULL`, CHECK `ck_sap_systems_target_not_self`.
  - `transfer_value_mappings.source_system_id`, `.target_system_id` (FK `ON DELETE CASCADE`), `.status TEXT NOT NULL DEFAULT 'confirmed'`, CHECK `ck_transfer_value_mappings_status`.
  - Constraint `uq_transfer_value_mappings_scope UNIQUE NULLS NOT DISTINCT (tenant_id, module, target_field, source_value, source_system_id, target_system_id)`. `uq_transfer_value_mappings` is dropped.

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_pairing_pg.py`:

```python
"""Config pairing on Postgres: migration 075, SQL helpers, load_config, enqueue, routes and reports.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so tenant policies are really exercised.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_pairing_app"
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


def _tenant(owner) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"P-{tid[:8]}"})
    return tid


def _system(app, tid: str, name: str, system_type: str = "ecc", role: str = "source",
            target: str | None = None) -> str:
    from sqlalchemy import text

    sid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, role, target_system_id) "
                       "VALUES (:s, :t, :n, :st, :r, CAST(:tg AS uuid))"),
                  {"s": sid, "t": tid, "n": name, "st": system_type, "r": role, "tg": target})
    return sid


def _load(app, tid: str, sid: str, items: list[tuple[str, str, dict]], origin: str = "connection",
          status: str = "completed", minutes_ago: int = 0) -> str:
    """One config_loads row plus its items; finished_at orders loads oldest first by minutes_ago."""
    import json

    from sqlalchemy import text

    lid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO config_loads (id, tenant_id, system_id, system_type, origin, status, "
                       "created_at, finished_at) SELECT :l, :t, id, system_type, :o, :st, "
                       "now() - make_interval(mins => :m), "
                       "CASE WHEN :st = 'completed' THEN now() - make_interval(mins => :m) END "
                       "FROM sap_systems WHERE id = :s"),
                  {"l": lid, "t": tid, "s": sid, "o": origin, "st": status, "m": minutes_ago})
        for obj, key, vals in items:
            c.execute(text('INSERT INTO config_items (tenant_id, load_id, object, key, "values") '
                           "VALUES (:t, :l, :o, :k, CAST(:v AS jsonb))"),
                      {"t": tid, "l": lid, "o": obj, "k": key, "v": json.dumps(vals)})
    return lid


@pg
def test_system_role_defaults_to_source_and_is_checked(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, app = app_engine
    tid = _tenant(owner)
    sid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": tid})
        assert c.execute(text("SELECT role FROM sap_systems WHERE id = :s"), {"s": sid}).scalar() == "source"
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET role = 'archive' WHERE id = :s"), {"s": sid})
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET target_system_id = id WHERE id = :s"), {"s": sid})


@pg
def test_deleting_a_target_clears_the_source_pointer(app_engine):
    from sqlalchemy import text

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM sap_systems WHERE id = :s"), {"s": tgt})
        assert c.execute(text("SELECT target_system_id FROM sap_systems WHERE id = :s"), {"s": src}).scalar() is None


@pg
def test_value_map_scope_is_unique_with_null_scope(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    ins = ("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, "
           "source_system_id, status) VALUES (gen_random_uuid(), :t, 'config', 'T077K.KTOKK', 'LIEF', 'KRED', "
           "CAST(:s AS uuid), :st)")
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text(ins), {"t": tid, "s": None, "st": "confirmed"})
        c.execute(text(ins), {"t": tid, "s": src, "st": "proposed"})  # scoped row coexists with the global row
        assert c.execute(text("SELECT status FROM transfer_value_mappings WHERE source_system_id IS NULL")).scalar() \
            == "confirmed"
    with pytest.raises(IntegrityError):  # a second global row is a duplicate (NULLS NOT DISTINCT)
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text(ins), {"t": tid, "s": None, "st": "confirmed"})
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE transfer_value_mappings SET status = 'maybe'"))


@pg
def test_migration_075_downgrades_cleanly(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    _alembic("downgrade", "068")
    with owner.begin() as c:
        cols = {r[0] for r in c.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sap_systems'"))}
        assert "role" not in cols and "target_system_id" not in cols
        assert c.execute(text("SELECT 1 FROM pg_constraint WHERE conname = 'uq_transfer_value_mappings'")).scalar()
    _alembic("upgrade", "head")
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider`
Expected: FAIL. The `role` and `target_system_id` columns do not exist yet.

- [ ] **Step 3: Implement**

Create `db/migrations/versions/075_config_pairing.py`:

```python
"""Config pairing: sap_systems role and target; transfer_value_mappings pair scope and status.

Revision ID: 075
Revises: 068
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "075"
down_revision: Union[str, None] = "068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sap_systems", sa.Column("role", sa.Text(), nullable=False, server_default="source"))
    op.create_check_constraint("ck_sap_systems_role", "sap_systems", "role IN ('source','target')")
    op.add_column("sap_systems", sa.Column("target_system_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_sap_systems_target", "sap_systems", "sap_systems", ["target_system_id"], ["id"],
                          ondelete="SET NULL")
    op.create_check_constraint("ck_sap_systems_target_not_self", "sap_systems",
                               "target_system_id IS NULL OR target_system_id <> id")

    op.add_column("transfer_value_mappings", sa.Column("source_system_id", UUID(as_uuid=True), nullable=True))
    op.add_column("transfer_value_mappings", sa.Column("target_system_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_transfer_value_mappings_source", "transfer_value_mappings", "sap_systems",
                          ["source_system_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_transfer_value_mappings_target", "transfer_value_mappings", "sap_systems",
                          ["target_system_id"], ["id"], ondelete="CASCADE")
    op.add_column("transfer_value_mappings",
                  sa.Column("status", sa.Text(), nullable=False, server_default="confirmed"))
    op.create_check_constraint("ck_transfer_value_mappings_status", "transfer_value_mappings",
                               "status IN ('proposed','confirmed','rejected')")
    op.drop_constraint("uq_transfer_value_mappings", "transfer_value_mappings", type_="unique")
    op.execute("ALTER TABLE transfer_value_mappings ADD CONSTRAINT uq_transfer_value_mappings_scope "
               "UNIQUE NULLS NOT DISTINCT (tenant_id, module, target_field, source_value, "
               "source_system_id, target_system_id)")


def downgrade() -> None:
    # scoped and unconfirmed rows cannot live under the old one-row-per-value key
    op.execute("DELETE FROM transfer_value_mappings "
               "WHERE source_system_id IS NOT NULL OR target_system_id IS NOT NULL OR status <> 'confirmed'")
    op.drop_constraint("uq_transfer_value_mappings_scope", "transfer_value_mappings", type_="unique")
    op.create_unique_constraint("uq_transfer_value_mappings", "transfer_value_mappings",
                                ["tenant_id", "module", "target_field", "source_value"])
    op.drop_constraint("ck_transfer_value_mappings_status", "transfer_value_mappings", type_="check")
    op.drop_column("transfer_value_mappings", "status")
    op.drop_constraint("fk_transfer_value_mappings_target", "transfer_value_mappings", type_="foreignkey")
    op.drop_constraint("fk_transfer_value_mappings_source", "transfer_value_mappings", type_="foreignkey")
    op.drop_column("transfer_value_mappings", "target_system_id")
    op.drop_column("transfer_value_mappings", "source_system_id")

    op.drop_constraint("ck_sap_systems_target_not_self", "sap_systems", type_="check")
    op.drop_constraint("fk_sap_systems_target", "sap_systems", type_="foreignkey")
    op.drop_column("sap_systems", "target_system_id")
    op.drop_constraint("ck_sap_systems_role", "sap_systems", type_="check")
    op.drop_column("sap_systems", "role")
```

In `db/schema.py`, `SAPSystem`, after `last_snapshot_id = Column(UUID(as_uuid=True), nullable=True)`:

```python
    # Source/target pairing (migration 075)
    role = Column(Text, nullable=False, server_default="source")  # source | target
    target_system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="SET NULL"), nullable=True)
```

In `db/schema.py`, `TransferValueMapping`, after `updated_at`, and replacing `__table_args__`:

```python
    # Pair scope and steward status (migration 075); NULL scope = global
    source_system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=True)
    target_system_id = Column(UUID(as_uuid=True), ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=True)
    status = Column(Text, nullable=False, server_default="confirmed")  # proposed | confirmed | rejected

    __table_args__ = (
        UniqueConstraint("tenant_id", "module", "target_field", "source_value", "source_system_id",
                         "target_system_id", name="uq_transfer_value_mappings_scope",
                         postgresql_nulls_not_distinct=True),
    )
```

`SAPSystem` now has two foreign keys to `sap_systems`. If an existing relationship on `SAPSystem` becomes ambiguous, add `foreign_keys=` to that relationship; `credentials` and `sync_profiles` point at other tables and are not affected.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py tests/test_rls_conformance.py -q -p no:cacheprovider`
Expected: PASS (4 in the new file, plus the conformance tests).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/versions/075_config_pairing.py db/schema.py tests/test_config_pairing_pg.py
git commit -m "feat(db): system role and target, pair-scoped value maps with status (075)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 2: S/4HANA Cloud and BTP baselines

**Files:**
- Modify: `sap/baseline_config.py`. Add the `"s4hana_cloud"` key after `"ewms"`, and set `BASELINE_CONFIG["btp"]` after the dict.
- Test: `tests/test_baseline_config.py` (new)

**Interfaces:**
- Consumes: `api.services.connectivity_manager.baseline_key` (`s4hana_cloud` and `btp` map to themselves).
- Produces: `BASELINE_CONFIG["s4hana_cloud"]` with T001, T001W, T001L, T134, T006, T052, T077K and T077D. `BASELINE_CONFIG["btp"] is BASELINE_CONFIG["s4hana_cloud"]`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_baseline_config.py`:

```python
"""S/4HANA Cloud and BTP have an SAP standard baseline (no configuration API)."""

from sap.baseline_config import BASELINE_CONFIG

_KEYS = {"T001": "BUKRS", "T001W": "WERKS", "T001L": "LGORT", "T134": "MTART", "T006": "MSEHI",
         "T052": "ZTERM", "T077K": "KTOKK", "T077D": "KTOKD"}


def test_s4hana_cloud_baseline_covers_the_compared_objects():
    tables = {t: rows for module in BASELINE_CONFIG["s4hana_cloud"].values() for t, rows in module.items()}
    assert set(_KEYS) <= set(tables)
    for table, key in _KEYS.items():
        assert tables[table], table
        assert all(r.get(key) for r in tables[table]), table


def test_btp_shares_the_s4hana_cloud_baseline():
    assert BASELINE_CONFIG["btp"] is BASELINE_CONFIG["s4hana_cloud"]
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_baseline_config.py -q -p no:cacheprovider`
Expected: FAIL. `KeyError: 's4hana_cloud'`.

- [ ] **Step 3: Implement**

In `sap/baseline_config.py`, add this entry after the `"ewms"` entry, inside `BASELINE_CONFIG`:

```python
    # =========================================================================
    # S/4HANA Cloud (public edition) — SAP Best Practices standard values.
    # No configuration API: a load of an S/4HANA Cloud or BTP system stores this
    # baseline with origin best_practice (api/services/config_pairing.with_baseline).
    # =========================================================================
    "s4hana_cloud": {
        "finance": {
            "T001": [
                {"BUKRS": "1010", "BUTXT": "Company Code 1010", "LAND1": "DE", "WAERS": "EUR"},
                {"BUKRS": "1710", "BUTXT": "Company Code 1710", "LAND1": "US", "WAERS": "USD"},
            ],
            "T052": [
                {"ZTERM": "0001", "TEXT1": "Pay immediately w/o deduction", "ZTAG1": 0},
                {"ZTERM": "0002", "TEXT1": "Within 14 days 2% cash discount, 30 days net", "ZTAG1": 14},
                {"ZTERM": "0004", "TEXT1": "Net 30 days", "ZTAG1": 30},
                {"ZTERM": "0005", "TEXT1": "Net 45 days", "ZTAG1": 45},
            ],
        },
        "plant": {
            "T001W": [
                {"WERKS": "1010", "NAME1": "Plant 1 DE", "BWKEY": "1010"},
                {"WERKS": "1710", "NAME1": "Plant 1 US", "BWKEY": "1710"},
            ],
            "T001L": [
                {"WERKS": "1010", "LGORT": "101A", "LGOBE": "Standard storage 1"},
                {"WERKS": "1010", "LGORT": "101B", "LGOBE": "Standard storage 2"},
                {"WERKS": "1710", "LGORT": "171A", "LGOBE": "Standard storage 1"},
                {"WERKS": "1710", "LGORT": "171B", "LGOBE": "Standard storage 2"},
            ],
        },
        "material_master": {
            "T134": [
                {"MTART": "FERT", "MTBEZ": "Finished product"},
                {"MTART": "HALB", "MTBEZ": "Semi-finished product"},
                {"MTART": "ROH", "MTBEZ": "Raw material"},
                {"MTART": "HAWA", "MTBEZ": "Trading good"},
                {"MTART": "DIEN", "MTBEZ": "Service"},
                {"MTART": "NLAG", "MTBEZ": "Non-stock material"},
                {"MTART": "UNBW", "MTBEZ": "Non-valuated material"},
                {"MTART": "VERP", "MTBEZ": "Packaging material"},
                {"MTART": "ERSA", "MTBEZ": "Spare part"},
            ],
            "T006": [
                {"MSEHI": "EA", "MSEHL": "Each", "DIMID": "AAAADL"},
                {"MSEHI": "PC", "MSEHL": "Piece", "DIMID": "AAAADL"},
                {"MSEHI": "KG", "MSEHL": "Kilogram", "DIMID": "MASS"},
                {"MSEHI": "G", "MSEHL": "Gram", "DIMID": "MASS"},
                {"MSEHI": "TO", "MSEHL": "Metric ton", "DIMID": "MASS"},
                {"MSEHI": "L", "MSEHL": "Litre", "DIMID": "VOLUME"},
                {"MSEHI": "M", "MSEHL": "Metre", "DIMID": "LENGTH"},
                {"MSEHI": "H", "MSEHL": "Hour", "DIMID": "TIME"},
            ],
        },
        "accounts_payable": {
            "T077K": [
                {"KTOKK": "SUPL", "TXT30": "Supplier"},
                {"KTOKK": "CPDL", "TXT30": "One-time supplier"},
            ],
        },
        "accounts_receivable": {
            "T077D": [
                {"KTOKD": "CUST", "TXT30": "Customer"},
                {"KTOKD": "CPDA", "TXT30": "One-time customer"},
            ],
        },
    },
```

After the closing `}` of `BASELINE_CONFIG`:

```python
# BTP has no configuration API of its own; data loaded through BTP lands in an S/4HANA Cloud tenant.
BASELINE_CONFIG["btp"] = BASELINE_CONFIG["s4hana_cloud"]
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_baseline_config.py -q -p no:cacheprovider`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add sap/baseline_config.py tests/test_baseline_config.py
git commit -m "feat(config): S/4HANA Cloud and BTP standard baselines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 3: `config_pairing` pure functions: matcher, baseline and pair rules

**Files:**
- Create: `api/services/config_pairing.py`
- Test: `tests/test_config_pairing.py` (new)

**Interfaces:**
- Consumes: `sap.config_snapshot` (`ConfigItem`, `ConfigSnapshot`, `NOT_AVAILABLE`), `sap.baseline_config.BASELINE_CONFIG`, `sap.ddic.dictionary_for_system`, `api.services.connectivity_manager.baseline_key`.
- Produces:
  - Constants `BASELINE_DETAIL`, `BASELINE_LABEL`, `BASELINE_TYPE = "s4hana_cloud"`, `DESC_MATCH_MAX = 2000`, `DESC_CUTOFF = 0.85`, `STALE_MINUTES = 30`, `ITEM_CAP = 20000`, `STATUSES`.
  - `normalise(v) -> str`, `parse_key(key) -> dict[str, str]`, `normalise_key(key) -> str`.
  - `MatchRow` (dataclass with `proposable` and `as_dict()`).
  - `compare_object(obj, source, target) -> list[MatchRow]`.
  - `baseline_snapshot(system_type) -> ConfigSnapshot`, `with_baseline(snap, system_type) -> tuple[ConfigSnapshot, str]`.
  - `pair_error(source_role, target_role, same) -> Optional[str]`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_pairing.py`:

```python
"""Deterministic source/target config matching, the baseline fallback and the pair rules."""

from api.services.config_pairing import (
    BASELINE_DETAIL, DESC_MATCH_MAX, MatchRow, baseline_snapshot, compare_object, normalise, normalise_key,
    pair_error, parse_key, with_baseline,
)
from sap.config_snapshot import NOT_AVAILABLE, ConfigItem, ConfigSnapshot


def _i(obj: str, key: str, **vals: str) -> ConfigItem:
    return ConfigItem(obj, key, {**dict(p.split("=", 1) for p in key.split(",")), **vals})


def test_normalise_strips_case_and_leading_zeros():
    assert normalise(" 0001 ") == "1"
    assert normalise("000") == "0"
    assert normalise("kred") == "KRED"
    assert normalise("") == ""


def test_parse_and_normalise_key():
    assert parse_key("WERKS=0001,LGORT=a1") == {"WERKS": "0001", "LGORT": "a1"}
    assert normalise_key("WERKS=0001,LGORT=a1") == "WERKS=1,LGORT=A1"


def test_compare_object_classifies_in_order():
    source = [_i("T077K", "KTOKK=KRED", TXT30="Vendors general"),
              _i("T077K", "KTOKK=kred2", TXT30="Second group"),
              _i("T077K", "KTOKK=LIEF", TXT30="Supplier"),
              _i("T077K", "KTOKK=ZZZZ", TXT30="Nothing like it")]
    target = [_i("T077K", "KTOKK=KRED", TXT30="Vendors general"),
              _i("T077K", "KTOKK=KRED2", TXT30="Other"),
              _i("T077K", "KTOKK=SUPL", TXT30="Supplier")]
    rows = {r.source_key: r for r in compare_object("T077K", source, target)}
    assert rows["KTOKK=KRED"].status == "exists" and not rows["KTOKK=KRED"].proposable
    km = rows["KTOKK=kred2"]
    assert (km.status, km.target_key, km.score, km.field, km.source_value, km.target_value) == \
        ("key_match", "KTOKK=KRED2", 1.0, "KTOKK", "kred2", "KRED2")
    assert km.proposable
    dm = rows["KTOKK=LIEF"]
    assert (dm.status, dm.target_key, dm.field, dm.target_value, dm.score) == \
        ("desc_match", "KTOKK=SUPL", "KTOKK", "SUPL", 1.0)
    assert rows["KTOKK=ZZZZ"].status == "missing" and rows["KTOKK=ZZZZ"].target_key is None


def test_a_match_on_two_key_fields_is_not_proposable():
    source = [_i("T001L", "WERKS=A,LGORT=X", LGOBE="Main store")]
    target = [_i("T001L", "WERKS=B,LGORT=Y", LGOBE="Main store")]
    row = compare_object("T001L", source, target)[0]
    assert row.status == "desc_match" and row.field is None and not row.proposable


def test_description_matching_is_skipped_above_the_cap():
    target = [_i("T006", f"MSEHI=U{n}", MSEHL=f"Unit {n}") for n in range(DESC_MATCH_MAX + 1)]
    row = compare_object("T006", [_i("T006", "MSEHI=XX", MSEHL="Unit 1")], target)[0]
    assert row.status == "missing"


def test_match_row_as_dict_includes_proposable():
    d = MatchRow("T134", "MTART=FERT", "exists", "MTART=FERT", 1.0).as_dict()
    assert d["proposable"] is False and d["object"] == "T134"


def test_baseline_snapshot_and_with_baseline():
    b = baseline_snapshot("s4hana_cloud")
    assert b.origin == "best_practice"
    assert any(i.object == "T001" and i.key == "BUKRS=1010" for i in b.items)
    assert all(st.detail == BASELINE_DETAIL for st in b.objects.values())

    empty = ConfigSnapshot("btp", system_id="sys-1", role="target")
    empty.mark("T001", NOT_AVAILABLE, "no API")
    snap, origin = with_baseline(empty, "btp")
    assert origin == "best_practice" and snap.items and snap.system_id == "sys-1" and snap.role == "target"

    live = ConfigSnapshot("ecc")
    live.mark("T001", NOT_AVAILABLE, "no API")
    live.items.append(_i("T001", "BUKRS=1000"))
    assert with_baseline(live, "ecc") == (live, "connection")


def test_pair_error_messages():
    assert pair_error("source", "target", same=True) == "A system cannot be its own target."
    assert pair_error("source", "source", same=False) == "The assigned system must have the target role."
    assert pair_error("target", "target", same=False) == "A target system cannot have a target of its own."
    assert pair_error("source", "target", same=False) is None
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_config_pairing.py -q -p no:cacheprovider`
Expected: FAIL. `ModuleNotFoundError: No module named 'api.services.config_pairing'`.

- [ ] **Step 3: Implement**

Create `api/services/config_pairing.py`:

```python
"""Config intelligence: source/target pairing, deterministic config comparison and realignment.

Matching is deterministic (no LLM). Every proposal goes to the steward queue and is used only once confirmed.
Read only towards SAP: this module reads stored config_items and writes Meridian tables only.
"""

from __future__ import annotations

import difflib
from dataclasses import asdict, dataclass
from typing import Optional

import pandas as pd

from sap.config_snapshot import NOT_AVAILABLE, ConfigItem, ConfigSnapshot

DESC_FIELDS = ("TXT30", "TEXT1", "TXTMD", "BUTXT", "NAME1", "MTBEZ", "TEXT", "LTEXT", "MSEHT", "MSEHL",
               "LGOBE", "DESCRIPTION")
BASELINE_DETAIL = "SAP standard baseline; no configuration API"
BASELINE_LABEL = "baseline target"
BASELINE_TYPE = "s4hana_cloud"
DESC_MATCH_MAX = 2000
DESC_CUTOFF = 0.85
STALE_MINUTES = 30
ITEM_CAP = 20000
STATUSES = ("exists", "key_match", "desc_match", "missing")


def normalise(v: str) -> str:
    """Strip, upper-case and drop leading zeros ('0001' -> '1', '000' -> '0')."""
    s = v.strip().upper()
    return s.lstrip("0") or ("0" if s else "")


def parse_key(key: str) -> dict[str, str]:
    # ponytail: splits on ',' and '='; a key value containing a comma parses wrongly. Store keys as JSON if one does.
    return dict(p.partition("=")[::2] for p in key.split(",") if p)


def normalise_key(key: str) -> str:
    return ",".join(f"{f}={normalise(v)}" for f, v in parse_key(key).items())


def _desc(values: dict[str, object]) -> Optional[str]:
    for f in DESC_FIELDS:
        v = values.get(f)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _diff_field(a: str, b: str) -> Optional[tuple[str, str, str]]:
    """(field, a value, b value) when the two keys differ in exactly one field."""
    pa, pb = parse_key(a), parse_key(b)
    if pa.keys() != pb.keys():
        return None
    diffs = [f for f in pa if pa[f] != pb[f]]
    return (diffs[0], pa[diffs[0]], pb[diffs[0]]) if len(diffs) == 1 else None


@dataclass
class MatchRow:
    object: str
    source_key: str
    status: str  # exists | key_match | desc_match | missing
    target_key: Optional[str] = None
    score: Optional[float] = None
    field: Optional[str] = None
    source_value: Optional[str] = None
    target_value: Optional[str] = None
    description: Optional[str] = None

    @property
    def proposable(self) -> bool:
        return self.status in ("key_match", "desc_match") and self.field is not None

    def as_dict(self) -> dict[str, object]:
        return {**asdict(self), "proposable": self.proposable}


def compare_object(obj: str, source: list[ConfigItem], target: list[ConfigItem]) -> list[MatchRow]:
    """Classify each source key: exists, key_match (normalised key), desc_match (difflib), missing."""
    exact = {t.key for t in target}
    by_norm = {normalise_key(t.key): t.key for t in target}
    by_desc: dict[str, str] = {}
    # ponytail: description matching is O(n·m); skipped above DESC_MATCH_MAX target items. Index by token if needed.
    if len(target) <= DESC_MATCH_MAX:
        for t in target:
            d = _desc(t.values)
            if d:
                by_desc.setdefault(d.upper(), t.key)
    rows: list[MatchRow] = []
    for it in source:
        desc = _desc(it.values)
        if it.key in exact:
            rows.append(MatchRow(obj, it.key, "exists", it.key, 1.0, description=desc))
            continue
        tk, status, score = by_norm.get(normalise_key(it.key)), "key_match", 1.0
        if tk is None and by_desc and desc:
            hit = difflib.get_close_matches(desc.upper(), list(by_desc), n=1, cutoff=DESC_CUTOFF)
            if hit:
                tk, status = by_desc[hit[0]], "desc_match"
                score = round(difflib.SequenceMatcher(None, desc.upper(), hit[0]).ratio(), 3)
        if tk is None:
            rows.append(MatchRow(obj, it.key, "missing", description=desc))
            continue
        field, sv, tv = _diff_field(it.key, tk) or (None, None, None)
        rows.append(MatchRow(obj, it.key, status, tk, score, field, sv, tv, desc))
    return rows


def baseline_snapshot(system_type: str) -> ConfigSnapshot:
    """The SAP standard baseline of ``system_type`` as a best-practice snapshot."""
    from api.services.connectivity_manager import baseline_key
    from sap.baseline_config import BASELINE_CONFIG
    from sap.ddic import dictionary_for_system

    snap = ConfigSnapshot(system_type, origin="best_practice")
    ddic = dictionary_for_system(system_type)
    for tables in BASELINE_CONFIG.get(baseline_key(system_type), {}).values():
        for table, rows in tables.items():
            if table in snap.objects:
                continue
            snap.add_frame(table, pd.DataFrame(rows), ddic.keys(table))
    for st in snap.objects.values():
        st.detail = BASELINE_DETAIL
    return snap


def with_baseline(snap: ConfigSnapshot, system_type: str) -> tuple[ConfigSnapshot, str]:
    """Swap a no-API snapshot (no items, every object NOT_AVAILABLE) for the type's baseline."""
    if snap.items or not snap.objects or any(st.state != NOT_AVAILABLE for st in snap.objects.values()):
        return snap, snap.origin
    base = baseline_snapshot(system_type)
    if not base.items:
        return snap, snap.origin
    base.system_id, base.role = snap.system_id, snap.role
    return base, "best_practice"


def pair_error(source_role: str, target_role: str, same: bool) -> Optional[str]:
    if same:
        return "A system cannot be its own target."
    if source_role == "target":
        return "A target system cannot have a target of its own."
    if target_role != "target":
        return "The assigned system must have the target role."
    return None
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_config_pairing.py tests/test_baseline_config.py -q -p no:cacheprovider`
Expected: PASS (10).

- [ ] **Step 5: Commit**

```bash
git add api/services/config_pairing.py tests/test_config_pairing.py
git commit -m "feat(config): deterministic source/target config matcher and baseline fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 4: `config_pairing` SQL helpers: basis, target, compare, drift, proposals, finding context

**Files:**
- Modify: `api/services/config_pairing.py` (append)
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `config_loads`, `config_items`, `sap_systems.role`/`.target_system_id`, `config_drift_log`, `transfer_value_mappings`, `stewardship_queue`, `analysis_versions.metadata->>'system_id'`, `api.services.config_applicability.condition`, `api.services.source_design.dictionary_for`.
- Produces (all take a sync `Session` with `app.tenant_id` set):
  - `config_basis(s, sid) -> str` (`loaded` | `loading` | `none`).
  - `latest_completed_load(s, sid) -> Optional[tuple[str, str, str]]` (`id`, `origin`, `system_type`).
  - `load_items(s, load_id, obj=None) -> list[ConfigItem]`.
  - `Target` dataclass; `resolve_target(s, source_id) -> Target`; `target_items(s, t, obj=None) -> list[ConfigItem]`.
  - `compare(s, source_id, obj=None) -> dict` with `source_load_id`, `target`, `objects`, `rows`.
  - `write_drift(s, tid, sid, lid) -> int`.
  - `propose(s, tid, source_id) -> dict` with `proposed`, `skipped`, `target`.
  - `finding_context(s, rule_id, module, version_id, fields) -> dict`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
def _session(app, tid: str):
    from workers.db import tenant_session

    return tenant_session(app, tid)


@pg
def test_config_basis_reads_completed_then_fresh_running(app_engine):
    from api.services.config_pairing import config_basis

    owner, app = app_engine
    tid = _tenant(owner)
    a, b, c = (_system(app, tid, n) for n in ("PRD", "QAS", "DEV"))
    _load(app, tid, a, [], status="completed")
    _load(app, tid, b, [], status="running", minutes_ago=5)
    _load(app, tid, c, [], status="running", minutes_ago=45)  # stale
    with _session(app, tid) as s:
        assert [config_basis(s, x) for x in (a, b, c)] == ["loaded", "loading", "none"]


@pg
def test_resolve_target_prefers_a_completed_load_then_the_baseline(app_engine):
    from api.services.config_pairing import BASELINE_LABEL, resolve_target

    owner, app = app_engine
    tid = _tenant(owner)
    lone = _system(app, tid, "DEV")
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    with _session(app, tid) as s:
        t = resolve_target(s, lone)
        assert (t.system_id, t.baseline, t.label, t.system_type) == (None, True, BASELINE_LABEL, "s4hana_cloud")
        t = resolve_target(s, src)
        assert (t.system_id, t.baseline, t.label) == (tgt, True, f"S4D ({BASELINE_LABEL})")
    lid = _load(app, tid, tgt, [("T001", "BUKRS=1000", {"BUKRS": "1000"})])
    with _session(app, tid) as s:
        t = resolve_target(s, src)
        assert (t.load_id, t.baseline, t.label) == (lid, False, "S4D")


@pg
def test_compare_counts_objects_and_returns_rows_for_one_object(app_engine):
    from api.services.config_pairing import compare

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    _load(app, tid, src, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"}), ("T077K", "KTOKK=0001", {"KTOKK": "0001"}),
                          ("T001", "BUKRS=1000", {"BUKRS": "1000"}), ("TVAK", "AUART=ZOR", {"AUART": "ZOR"})])
    _load(app, tid, tgt, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"}), ("T077K", "KTOKK=1", {"KTOKK": "1"}),
                          ("T001", "BUKRS=2000", {"BUKRS": "2000"})])
    with _session(app, tid) as s:
        out = compare(s, src, "T077K")
    assert out["target"] == {"system_id": tgt, "label": "S4D", "baseline": False}
    assert [o["object"] for o in out["objects"]] == ["T001", "T077K"]  # TVAK is not in the target
    t077k = next(o for o in out["objects"] if o["object"] == "T077K")
    assert (t077k["exists"], t077k["key_match"], t077k["missing"], t077k["proposable"]) == (1, 1, 0, 1)
    assert {r["source_key"] for r in out["rows"]} == {"KTOKK=KRED", "KTOKK=0001"}


@pg
def test_compare_with_no_source_load_is_empty(app_engine):
    from api.services.config_pairing import compare

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    with _session(app, tid) as s:
        out = compare(s, src)
    assert out["source_load_id"] is None and out["objects"] == [] and out["target"]["baseline"] is True


@pg
def test_write_drift_diffs_against_the_previous_completed_load(app_engine):
    from sqlalchemy import text

    from api.services.config_pairing import write_drift

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "PRD")
    first = _load(app, tid, sid, [("T001", "BUKRS=1000", {"BUTXT": "A"}), ("T001", "BUKRS=2000", {"BUTXT": "B"})],
                  minutes_ago=10)
    with _session(app, tid) as s:
        assert write_drift(s, tid, sid, first) == 0  # first load: nothing to diff
        s.commit()
    second = _load(app, tid, sid, [("T001", "BUKRS=1000", {"BUTXT": "A2"}), ("T001", "BUKRS=3000", {"BUTXT": "C"})])
    with _session(app, tid) as s:
        assert write_drift(s, tid, sid, second) == 3
        assert write_drift(s, tid, sid, second) == 3  # idempotent per load
        s.commit()
        rows = s.execute(text("SELECT element_value, change_type FROM config_drift_log WHERE run_id = :l "
                              "ORDER BY element_value"), {"l": second}).fetchall()
    assert [tuple(r) for r in rows] == [("BUKRS=1000", "changed"), ("BUKRS=2000", "removed"),
                                        ("BUKRS=3000", "added")]


@pg
def test_propose_scopes_to_the_pair_and_queues_once(app_engine):
    from sqlalchemy import text

    from api.services.config_pairing import propose

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    _load(app, tid, src, [("T077K", "KTOKK=0001", {"KTOKK": "0001"})])
    _load(app, tid, tgt, [("T077K", "KTOKK=1", {"KTOKK": "1"})])
    with _session(app, tid) as s:
        assert propose(s, tid, src) == {"proposed": 1, "skipped": 0, "target": "S4D"}
        s.commit()
        assert propose(s, tid, src) == {"proposed": 0, "skipped": 1, "target": "S4D"}
        s.commit()
        m = s.execute(text("SELECT target_field, source_value, target_value, status, source_system_id::text, "
                           "target_system_id::text FROM transfer_value_mappings")).fetchone()
        q = s.execute(text("SELECT item_type, domain, ai_recommendation, ai_confidence FROM stewardship_queue")).fetchall()
    assert tuple(m) == ("T077K.KTOKK", "0001", "1", "proposed", src, tgt)
    assert [tuple(r) for r in q] == [("config_value_match", "config", "T077K.KTOKK: 0001 → 1 (key match)", 1.0)]


@pg
def test_finding_context_uses_the_rule_condition_object(app_engine, monkeypatch):
    import json

    from sqlalchemy import text

    from api.services import config_applicability
    from api.services.config_pairing import finding_context

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    _load(app, tid, src, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"}), ("T077K", "KTOKK=ZZZZ", {"KTOKK": "ZZZZ"})])
    vid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": src})})
    monkeypatch.setattr(config_applicability, "condition",
                        lambda module, check_id: {"requires": {"object": "T077K"}})
    with _session(app, tid) as s:
        ctx = finding_context(s, "AP-001", "accounts_payable", vid, [])
    assert ctx["object"] == "T077K" and ctx["system_id"] == src and ctx["baseline"] is True
    assert ctx["source"] == ["KTOKK=KRED", "KTOKK=ZZZZ"]
    assert "KTOKK=ZZZZ" in ctx["missing"] and ctx["missing_total"] == len(ctx["missing"])
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider`
Expected: FAIL. `ImportError: cannot import name 'config_basis' from 'api.services.config_pairing'`.

- [ ] **Step 3: Implement**

Append to `api/services/config_pairing.py` (add `from collections import Counter`, `from sqlalchemy import text` and `from sqlalchemy.orm import Session` to the imports at the top):

```python
BASIS_SQL = (
    "SELECT bool_or(status = 'completed'), "
    f"bool_or(status IN ('queued', 'running') AND created_at > now() - interval '{STALE_MINUTES} minutes') "
    "FROM config_loads WHERE system_id = CAST(:sid AS uuid)"
)


def config_basis(s: Session, sid: str) -> str:
    """'loaded' (a completed load), 'loading' (a load started in the last 30 minutes) or 'none'."""
    # ponytail: a running load older than STALE_MINUTES counts as stale; a heartbeat column would be exact.
    done, running = s.execute(text(BASIS_SQL), {"sid": sid}).one()
    return "loaded" if done else "loading" if running else "none"


def latest_completed_load(s: Session, sid: str) -> Optional[tuple[str, str, str]]:
    row = s.execute(text(
        "SELECT id::text, origin, system_type FROM config_loads "
        "WHERE system_id = CAST(:sid AS uuid) AND status = 'completed' "
        "ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT 1"), {"sid": sid}).fetchone()
    return (row[0], row[1], row[2]) if row else None


def load_items(s: Session, load_id: str, obj: Optional[str] = None) -> list[ConfigItem]:
    # ponytail: capped at ITEM_CAP items per read; page by object if a load is larger.
    rows = s.execute(text(
        'SELECT object, key, "values" FROM config_items WHERE load_id = CAST(:lid AS uuid) '
        "AND (CAST(:obj AS text) IS NULL OR object = :obj) ORDER BY object, key LIMIT :cap"),
        {"lid": load_id, "obj": obj, "cap": ITEM_CAP}).fetchall()
    return [ConfigItem(r[0], r[1], r[2] or {}) for r in rows]


@dataclass
class Target:
    system_id: Optional[str]
    system_type: str
    load_id: Optional[str]
    baseline: bool
    label: str


def resolve_target(s: Session, source_id: str) -> Target:
    """The source's assigned target: its latest completed load, else its type's baseline, else the S/4 baseline."""
    row = s.execute(text(
        "SELECT t.id::text, t.name, t.system_type FROM sap_systems s "
        "LEFT JOIN sap_systems t ON t.id = s.target_system_id WHERE s.id = CAST(:sid AS uuid)"),
        {"sid": source_id}).fetchone()
    if row is None or row[0] is None:
        return Target(None, BASELINE_TYPE, None, True, BASELINE_LABEL)
    tid_, name, stype = row
    load = latest_completed_load(s, tid_)
    if load and load[1] != "best_practice":
        return Target(tid_, stype, load[0], False, name)
    return Target(tid_, stype, load[0] if load else None, True, f"{name} ({BASELINE_LABEL})")


def target_items(s: Session, t: Target, obj: Optional[str] = None) -> list[ConfigItem]:
    if t.load_id:
        return load_items(s, t.load_id, obj)
    return [i for i in baseline_snapshot(t.system_type).items if obj is None or i.object == obj]


def _by_object(items: list[ConfigItem]) -> dict[str, list[ConfigItem]]:
    out: dict[str, list[ConfigItem]] = {}
    for i in items:
        out.setdefault(i.object, []).append(i)
    return out


def _compare_all(s: Session, source_id: str) -> tuple[Target, Optional[str], dict[str, list[MatchRow]]]:
    t = resolve_target(s, source_id)
    src = latest_completed_load(s, source_id)
    if src is None:
        return t, None, {}
    source, target = _by_object(load_items(s, src[0])), _by_object(target_items(s, t))
    return t, src[0], {o: compare_object(o, source[o], target[o]) for o in sorted(set(source) & set(target))}


def compare(s: Session, source_id: str, obj: Optional[str] = None) -> dict[str, object]:
    t, load_id, by_obj = _compare_all(s, source_id)
    objects: list[dict[str, object]] = []
    for o, rows in by_obj.items():
        counts = Counter(r.status for r in rows)
        objects.append({"object": o, **{k: counts.get(k, 0) for k in STATUSES},
                        "proposable": sum(r.proposable for r in rows)})
    return {"source_load_id": load_id,
            "target": {"system_id": t.system_id, "label": t.label, "baseline": t.baseline},
            "objects": objects,
            "rows": [r.as_dict() for r in by_obj.get(obj or "", [])]}


_DRIFT_SQL = """
WITH prev AS (
    SELECT id FROM config_loads
    WHERE system_id = CAST(:sid AS uuid) AND status = 'completed' AND id <> CAST(:lid AS uuid)
    ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT 1),
a AS (SELECT object, key, "values" FROM config_items WHERE load_id = (SELECT id FROM prev)),
b AS (SELECT object, key, "values" FROM config_items WHERE load_id = CAST(:lid AS uuid))
INSERT INTO config_drift_log (id, tenant_id, run_id, module, element_type, element_value, change_type,
                              previous_value, current_value)
SELECT gen_random_uuid(), CAST(:tid AS uuid), CAST(:lid AS uuid), 'config',
       LEFT(COALESCE(b.object, a.object), 80), LEFT(COALESCE(b.key, a.key), 500),
       CASE WHEN a.key IS NULL THEN 'added' WHEN b.key IS NULL THEN 'removed' ELSE 'changed' END,
       a."values"::text, b."values"::text
FROM a FULL OUTER JOIN b ON a.object = b.object AND a.key = b.key
WHERE EXISTS (SELECT 1 FROM prev) AND (a.key IS NULL OR b.key IS NULL OR a."values" <> b."values")
"""


def write_drift(s: Session, tid: str, sid: str, lid: str) -> int:
    """Diff load ``lid`` against the system's previous completed load into config_drift_log (run_id = lid)."""
    # ponytail: duplicate keys inside one load multiply drift rows; config_items has no unique key.
    s.execute(text("DELETE FROM config_drift_log WHERE run_id = CAST(:lid AS uuid)"), {"lid": lid})
    return s.execute(text(_DRIFT_SQL), {"tid": tid, "sid": sid, "lid": lid}).rowcount


def propose(s: Session, tid: str, source_id: str) -> dict[str, object]:
    """Insert each proposable match as a 'proposed' pair-scoped value map plus one steward queue item."""
    t, _, by_obj = _compare_all(s, source_id)
    proposed = skipped = 0
    for o, rows in by_obj.items():
        for r in rows:
            if not r.proposable:
                continue
            new_id = s.execute(text("""
                INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value,
                    note, source_system_id, target_system_id, status, updated_at)
                VALUES (gen_random_uuid(), CAST(:tid AS uuid), 'config', :tf, :sv, :tv, :note,
                        CAST(:src AS uuid), CAST(:tgt AS uuid), 'proposed', now())
                ON CONFLICT ON CONSTRAINT uq_transfer_value_mappings_scope DO NOTHING
                RETURNING id::text
            """), {"tid": tid, "tf": f"{o}.{r.field}", "sv": r.source_value, "tv": r.target_value,
                   "note": f"{r.status.replace('_', ' ')} {r.source_key} → {r.target_key}",
                   "src": source_id, "tgt": t.system_id}).scalar()
            if new_id is None:
                skipped += 1
                continue
            proposed += 1
            s.execute(text("""
                INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority, due_at, sla_hours,
                                               ai_recommendation, ai_confidence)
                VALUES (CAST(:tid AS uuid), 'config_value_match', CAST(:sid AS uuid), 'config', 3,
                        now() + interval '72 hours', 72, :rec, :conf)
                ON CONFLICT (source_id, item_type) DO NOTHING
            """), {"tid": tid, "sid": new_id, "conf": r.score,
                   "rec": f"{o}.{r.field}: {r.source_value} → {r.target_value} ({r.status.replace('_', ' ')})"})
    return {"proposed": proposed, "skipped": skipped, "target": t.label}


def finding_context(s: Session, rule_id: str, module: str, version_id: Optional[str],
                    fields: list[str]) -> dict[str, object]:
    """Source and target keys of the config object a rule depends on, and the source keys missing in the target."""
    from api.services.config_applicability import condition
    from api.services.source_design import dictionary_for

    sid = s.execute(text("SELECT metadata->>'system_id' FROM analysis_versions WHERE id = CAST(:v AS uuid)"),
                    {"v": version_id}).scalar() if version_id else None
    cond = condition(module, rule_id)
    obj: Optional[str] = cond["requires"]["object"] if cond else None
    if obj is None and sid:
        ddic = dictionary_for(s, sid)
        for f in fields:
            table, _, name = f.partition(".")
            fd = ddic.field(table, name) if name else None
            if fd is not None and fd.check_table:
                obj = fd.check_table
                break
    empty: dict[str, object] = {"object": obj, "system_id": sid, "target_label": BASELINE_LABEL, "baseline": True,
                                "source": [], "target": [], "missing": [], "missing_total": 0}
    if obj is None or sid is None:
        return empty
    t = resolve_target(s, sid)
    src = latest_completed_load(s, sid)
    source = load_items(s, src[0], obj) if src else []
    target = target_items(s, t, obj)
    missing = [r.source_key for r in compare_object(obj, source, target) if r.status == "missing"]
    return {"object": obj, "system_id": sid, "target_label": t.label, "baseline": t.baseline,
            "source": [i.key for i in source[:50]], "target": [i.key for i in target[:50]],
            "missing": missing[:50], "missing_total": len(missing)}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py tests/test_config_pairing.py -q -p no:cacheprovider`
Expected: PASS (11 in the PG file, 8 in the unit file).

- [ ] **Step 5: Commit**

```bash
git add api/services/config_pairing.py tests/test_config_pairing_pg.py
git commit -m "feat(config): target resolution, compare, drift log, steward proposals, finding context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 5: `load_config` baseline, drift and idempotency; `run_load_config` role

**Files:**
- Modify: `api/services/connectivity_manager.py` (`load_config`, lines 710-758)
- Modify: `workers/tasks/run_load_config.py`
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `with_baseline`, `write_drift` (Tasks 3 and 4), `sap_systems.role`.
- Produces:
  - `load_config` stores `origin` (`connection` or `best_practice`), replaces the load's items on a retry, writes drift and returns `origin`.
  - `run_load_config` stores the system's role, upserts its `config_loads` row, and no longer sets `acks_late` or `reject_on_worker_lost`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
class _NoApiConnector:
    def load_config(self, system_type, progress=None):
        from sap.config_snapshot import NOT_AVAILABLE, ConfigSnapshot

        snap = ConfigSnapshot(system_type)
        snap.mark("T001", NOT_AVAILABLE, "no configuration API")
        return snap

    def close(self) -> None:
        pass


@pg
def test_load_config_stores_the_baseline_once_per_load(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.connectivity_manager import ConnectivityManager

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4C", "s4hana_cloud", "target")
    lid = _load(app, tid, sid, [], status="running")
    for _ in range(2):  # a retried task reruns load_config on the same load id
        with Session(app) as s:
            m = ConnectivityManager(s, tid)
            m._load_system = lambda system_id: {}
            m._build_connection_params = lambda row: {"system_type": "s4hana_cloud"}
            m._get_connector = lambda system_type, params: _NoApiConnector()
            out = m.load_config(sid, lid)
    assert out["origin"] == "best_practice" and out["items"] > 0
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        n = c.execute(text("SELECT count(*) FROM config_items WHERE load_id = :l"), {"l": lid}).scalar()
        origin, objects = c.execute(text("SELECT origin, objects FROM config_loads WHERE id = :l"), {"l": lid}).one()
    assert n == out["items"] and origin == "best_practice"
    assert objects[0]["detail"] == "SAP standard baseline; no configuration API"


def test_run_load_config_is_not_acks_late():
    from workers.celery_app import celery_app
    from workers.tasks.run_load_config import run_load_config

    assert run_load_config.acks_late == bool(celery_app.conf.task_acks_late)
    assert not run_load_config.reject_on_worker_lost
    assert run_load_config.soft_time_limit == 1500
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider -k "load_config"`
Expected: FAIL. `KeyError: 'origin'`, and `run_load_config.acks_late` is True.

- [ ] **Step 3: Implement**

In `api/services/connectivity_manager.py`, `load_config`:

1. Right after the `finally: connector.close()` block, add:

```python
        from api.services.config_pairing import with_baseline, write_drift

        snap, origin = with_baseline(snap, system_type)  # no config API: store the SAP standard baseline
```

2. Replace the `UPDATE config_loads ...` statement and the insert loop up to the `return` with:

```python
        objects = [o.as_dict() for o in snap.objects.values()]
        self.session.execute(
            text("UPDATE config_loads SET status = 'completed', origin = :origin, objects = CAST(:o AS jsonb), "
                 "history = CAST(:h AS jsonb), derivation = CAST(:d AS jsonb), finished_at = now() "
                 "WHERE id = :lid AND tenant_id = :tid"),
            {"origin": origin, "o": json.dumps(objects), "h": json.dumps(history),
             "d": json.dumps(derivation) if derivation else None, "lid": load_id, "tid": self.tenant_id})
        # a retried task reruns this load: replace its items instead of doubling them
        self.session.execute(text("DELETE FROM config_items WHERE load_id = :lid"), {"lid": load_id})
        rows = [{"tid": self.tenant_id, "lid": load_id, "obj": i.object, "key": i.key,
                 "vals": json.dumps(i.values, default=str)} for i in snap.items]
        for n in range(0, len(rows), 2000):
            self.session.execute(
                text("INSERT INTO config_items (tenant_id, load_id, object, key, \"values\") "
                     "VALUES (:tid, :lid, :obj, :key, CAST(:vals AS jsonb))"), rows[n:n + 2000])
        write_drift(self.session, str(self.tenant_id), system_id, load_id)
        self.session.commit()
        return {"load_id": load_id, "system_type": system_type, "objects": snap.summary(), "items": len(rows),
                "origin": origin, "flows_derived": derivation is not None,
                "table_logging_off": bool(history.get("table_logging_off"))}
```

3. Update the docstring: "(role from the system, origin connection, or best_practice for a type with no config API)".

In `workers/tasks/run_load_config.py`:

1. Remove `acks_late=True,` and `reject_on_worker_lost=True,` from the `@celery_app.task(...)` decorator. Keep `bind`, `name`, `soft_time_limit=1500` and `time_limit=1560`.
2. Replace the `system_type = ...scalar()` statement and the `INSERT INTO config_loads` statement with:

```python
            system_type, role = session.execute(
                text("SELECT system_type, role FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
                {"sid": system_id, "tid": tenant_id}).fetchone() or (None, "source")
            # enqueue_config_load may have inserted this row already; a retry finds it too
            session.execute(
                text("INSERT INTO config_loads (id, tenant_id, system_id, system_type, role, origin, status) "
                     "VALUES (:lid, :tid, :sid, :st, :role, 'connection', 'running') "
                     "ON CONFLICT (id) DO UPDATE SET status = 'running', error = NULL, role = EXCLUDED.role"),
                {"lid": load_id, "tid": tenant_id, "sid": system_id, "st": system_type or "unknown", "role": role})
```

Leave the rest of the task unchanged.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py tests/test_config_load.py -q -p no:cacheprovider`
Expected: PASS (13 in the new file, plus the existing config-load tests if that file exists).

- [ ] **Step 5: Commit**

```bash
git add api/services/connectivity_manager.py workers/tasks/run_load_config.py tests/test_config_pairing_pg.py
git commit -m "feat(config): baseline fallback, drift and idempotent items on config load; real system role

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 6: Config on connect: `enqueue_config_load`

**Files:**
- Modify: `api/services/config_pairing.py` (append `enqueue_config_load`)
- Modify: `api/routes/connectivity.py` (`start_config_load`; the `role` filters)
- Modify: `api/routes/systems.py` (`register_system`, `test_connection`)
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `config_basis` (Task 4), `api.services.jobs.start_job`, `workers.tasks.run_load_config.run_load_config`.
- Produces:
  - `async enqueue_config_load(db, tid, sid, force=False) -> Optional[dict[str, str]]`. It returns `{"job_id", "load_id", "status": "queued", "system_type"}` or None.
  - Register and a successful test connection enqueue a load when the system has none.
  - `GET /connectivity/config-load/{system_id}` and `/items` take an optional `role` (default: any role). The status list no longer filters on role.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
@pg
def test_enqueue_config_load_once_unless_forced(app_engine, monkeypatch):
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.services import config_pairing, jobs
    from workers.tasks import run_load_config as task_mod

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4D", "s4hana_onprem", "target")
    sent: list[str] = []
    monkeypatch.setattr(jobs, "start_job", lambda *a, **k: None)
    monkeypatch.setattr(task_mod.run_load_config, "apply_async", lambda args, task_id: sent.append(task_id))

    async def main() -> tuple:
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(aeng, expire_on_commit=False)() as db:
                await db.execute(text(f"SET app.tenant_id = '{tid}'"))
                first = await config_pairing.enqueue_config_load(db, tid, sid)
                second = await config_pairing.enqueue_config_load(db, tid, sid)
                forced = await config_pairing.enqueue_config_load(db, tid, sid, force=True)
                role = (await db.execute(text("SELECT role FROM config_loads WHERE id = :l"),
                                         {"l": first["load_id"]})).scalar()
                return first, second, forced, role
        finally:
            await aeng.dispose()

    first, second, forced, role = asyncio.run(main())
    assert first["status"] == "queued" and first["system_type"] == "s4hana_onprem"
    assert second is None  # a fresh running load exists
    assert forced is not None and sent == [first["load_id"], forced["load_id"]]
    assert role == "target"
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider -k enqueue`
Expected: FAIL. `AttributeError: module 'api.services.config_pairing' has no attribute 'enqueue_config_load'`.

- [ ] **Step 3: Implement**

Append to `api/services/config_pairing.py` (add `import logging`, `import uuid` and `from sqlalchemy.ext.asyncio import AsyncSession` to the imports, and `logger = logging.getLogger(__name__)` below them):

```python
async def enqueue_config_load(db: AsyncSession, tid: str, sid: str, force: bool = False) -> Optional[dict[str, str]]:
    """Queue run_load_config for ``sid``. The caller has set app.tenant_id.

    Without ``force`` it runs only when the system has no completed or fresh load, and never raises
    (register and test connection must not fail on it). With ``force`` it always queues and raises on failure.
    """
    from api.services import jobs
    from workers.tasks.run_load_config import run_load_config

    try:
        st = (await db.execute(text("SELECT system_type FROM sap_systems WHERE id = CAST(:sid AS uuid)"),
                               {"sid": sid})).scalar()
        if st is None:
            return None
        if not force and await db.run_sync(lambda s: config_basis(s, sid)) != "none":
            return None
        load_id = str(uuid.uuid4())
        job_id = f"cfgload-{load_id}"
        jobs.start_job(tid, job_id, "config_load", f"Configuration load: {st}", status="queued",
                       system_id=sid, load_id=load_id)
        run_load_config.apply_async(args=(tid, sid, load_id, job_id), task_id=load_id)
        # the row makes config_basis see this load at once; the task upserts it
        await db.execute(text(
            "INSERT INTO config_loads (id, tenant_id, system_id, system_type, role, origin, status) "
            "SELECT CAST(:lid AS uuid), CAST(:tid AS uuid), id, system_type, role, 'connection', 'running' "
            "FROM sap_systems WHERE id = CAST(:sid AS uuid) ON CONFLICT (id) DO NOTHING"),
            {"lid": load_id, "tid": tid, "sid": sid})
        await db.commit()
        return {"job_id": job_id, "load_id": load_id, "status": "queued", "system_type": st}
    except Exception:
        if force:
            raise
        logger.exception("Config load could not be queued for system %s", sid)
        return None
```

In `api/routes/connectivity.py`:

1. Replace the body of `start_config_load` after the RLS `SET` with:

```python
    from api.services.config_pairing import enqueue_config_load

    out = await enqueue_config_load(db, str(tenant.id), body.system_id, force=True)
    if out is None:
        raise HTTPException(status_code=404, detail="System not found")
    return out
```

Remove the imports this leaves unused (`jobs`, `run_load_config`, `uuid4`) only if nothing else in the file uses them.

2. In `list_config_status`, remove `AND c.role = 'source'` from the lateral join.
3. In `get_config_load` and `get_config_load_items`, change the parameter to `role: Optional[str] = None` and the SQL condition from `AND role = :role` to `AND (CAST(:role AS text) IS NULL OR role = :role)`.

In `api/routes/systems.py`:

1. Add `from api.services.config_pairing import enqueue_config_load` to the imports.
2. In `register_system`, after `await db.commit()` and before `enqueue_discovery(...)`, add:

```python
    await enqueue_config_load(db, str(tenant.id), system_id)  # config on connect; never fails the register
```

3. At the end of `test_connection`, change:

```python
    if result.connected and not discovery_status:
        enqueue_discovery(...)
    return result
```

to:

```python
    if result.connected and not discovery_status:
        enqueue_discovery(...)
    if result.connected:
        await enqueue_config_load(db, str(tenant.id), system_id)  # no-op once a load exists
    return result
```

(Keep the existing `enqueue_discovery` arguments as they are.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py tests/test_connectivity_routes.py tests/test_systems_routes.py -q -p no:cacheprovider`
Expected: PASS (14 in the new file, plus the existing route tests that exist). If an existing systems route test now calls the real Celery task, monkeypatch `api.routes.systems.enqueue_config_load` to an async no-op in that test.

- [ ] **Step 5: Commit**

```bash
git add api/services/config_pairing.py api/routes/connectivity.py api/routes/systems.py tests/test_config_pairing_pg.py
git commit -m "feat(config): load configuration on connect for every system type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 7: Systems API: role and target

**Files:**
- Modify: `api/routes/systems.py` (`RegisterSystemRequest`, `SystemResponse`, `UpdateSystemRequest`, `register_system`, `update_system`, `list_systems`)
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `pair_error` (Task 3), `sap_systems.role`/`.target_system_id` (Task 1).
- Produces:
  - Register accepts `role` (`source` | `target`, default `source`).
  - `PUT /api/v1/systems/{id}` accepts `role` and `target_system_id` (`""` clears). A bad pair returns 400 with the `pair_error` message.
  - `SystemResponse` and the list rows carry `role` and `target_system_id`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
def _client_run(app, tid: str, router, calls):
    """Run ``calls(client)`` against a mini app with ``router``, as a steward with tenant ``tid``."""
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant

    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"

    async def main():
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        maker = async_sessionmaker(aeng, expire_on_commit=False)
        api = FastAPI()
        api.include_router(router)

        async def _db():
            async with maker() as s:
                yield s

        api.dependency_overrides[get_db] = _db
        api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T", [])
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t",
                                   headers={"X-User-Role": "admin"}) as client:
                return await calls(client)
        finally:
            await aeng.dispose()

    return asyncio.run(main())


@pg
def test_update_system_assigns_and_clears_a_target(app_engine):
    from api.routes.systems import router

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    other = _system(app, tid, "QAS")
    src = _system(app, tid, "PRD")

    async def calls(c):
        ok = await c.put(f"/api/v1/systems/{src}", json={"target_system_id": tgt})
        bad = await c.put(f"/api/v1/systems/{src}", json={"target_system_id": other})
        listed = await c.get("/api/v1/systems")
        cleared = await c.put(f"/api/v1/systems/{src}", json={"target_system_id": ""})
        flipped = await c.put(f"/api/v1/systems/{tgt}", json={"role": "source"})
        return ok, bad, listed, cleared, flipped

    ok, bad, listed, cleared, flipped = _client_run(app, tid, router, calls)
    assert ok.status_code == 200 and ok.json()["target_system_id"] == tgt
    assert bad.status_code == 400 and bad.json()["detail"] == "The assigned system must have the target role."
    row = next(s for s in listed.json() if s["id"] == src)
    assert row["role"] == "source" and row["target_system_id"] == tgt
    assert cleared.json()["target_system_id"] is None
    assert flipped.json()["role"] == "source"
```

If the systems list route returns `{"systems": [...]}` instead of a list, read `listed.json()["systems"]`; check `list_systems`' return type before writing the assertion.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider -k update_system`
Expected: FAIL. `KeyError: 'target_system_id'` (the response has no such field).

- [ ] **Step 3: Implement**

In `api/routes/systems.py`:

1. Add `from api.services.config_pairing import pair_error` to the imports.
2. `RegisterSystemRequest`: add `role: str = Field(default="source", pattern="^(source|target)$")`.
3. `SystemResponse`: add `role: str = "source"` and `target_system_id: Optional[str] = None`.
4. `UpdateSystemRequest`: add

```python
    role: Optional[str] = Field(default=None, pattern="^(source|target)$")
    target_system_id: Optional[str] = None  # "" clears the target
```

5. `register_system`: add `role` to the INSERT column list and `:role` to the VALUES, pass `"role": body.role`, and add `role=body.role` to the returned `SystemResponse(...)`.
6. `update_system`: after the existing `set_parts` are built and before the UPDATE runs, add:

```python
    if body.role is not None:
        set_parts.append("role = :role")
        params["role"] = body.role
        if body.role == "target":
            set_parts.append("target_system_id = NULL")  # a target has no target of its own
    if body.target_system_id is not None and body.role != "target":
        if body.target_system_id == "":
            set_parts.append("target_system_id = NULL")
        else:
            try:
                uuid.UUID(body.target_system_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="The assigned system must have the target role.")
            roles = (await db.execute(text(
                "SELECT (SELECT role FROM sap_systems WHERE id = CAST(:sid AS uuid)), "
                "(SELECT role FROM sap_systems WHERE id = CAST(:tgt AS uuid))"),
                {"sid": system_id, "tgt": body.target_system_id})).one()
            msg = pair_error(body.role or roles[0] or "source", roles[1] or "", body.target_system_id == system_id)
            if msg:
                raise HTTPException(status_code=400, detail=msg)
            set_parts.append("target_system_id = CAST(:tgt AS uuid)")
            params["tgt"] = body.target_system_id
```

Use the names the function already uses for its parameter dict and its system id (`params`, `system_id`); add `import uuid` if it is missing. In the re-select after the UPDATE, append `role, target_system_id::text` to the column list, and pass `role=row[15], target_system_id=row[16]` to `SystemResponse`.

7. `list_systems`: append `s.role, s.target_system_id::text` to the SELECT (they become `r[26]` and `r[27]`), and add `"role": r[26], "target_system_id": r[27]` to each row (or `role=r[26], target_system_id=r[27]` if the rows are `SystemResponse` objects).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider`
Expected: PASS (15).

- [ ] **Step 5: Commit**

```bash
git add api/routes/systems.py tests/test_config_pairing_pg.py
git commit -m "feat(systems): source/target role and target assignment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 8: Extraction waits for the config load

**Files:**
- Modify: `workers/tasks/run_extraction.py`
- Test: `tests/test_wait_for_config.py` (new)

**Interfaces:**
- Consumes: `config_basis` (Task 4).
- Produces:
  - `wait_for_config(task, session, system_id) -> str`. It returns `loaded` or `baseline`, or raises `task.retry(countdown=30, max_retries=50)` while a fresh load runs.
  - `analysis_versions.metadata.config_basis` (`loaded` | `baseline`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_wait_for_config.py`:

```python
"""Extraction waits for a running config load, then proceeds with a flagged baseline."""

from types import SimpleNamespace

import pytest
from celery.exceptions import Retry

from workers.tasks import run_extraction


def _task(retries: int) -> SimpleNamespace:
    return SimpleNamespace(request=SimpleNamespace(retries=retries),
                           retry=lambda countdown, max_retries: Retry(f"in {countdown}s"))


@pytest.mark.parametrize("basis,retries,expected", [
    ("loaded", 0, "loaded"), ("none", 0, "baseline"), ("loading", 50, "baseline"),
])
def test_wait_for_config_returns_the_basis(monkeypatch, basis, retries, expected):
    monkeypatch.setattr("api.services.config_pairing.config_basis", lambda s, sid: basis)
    assert run_extraction.wait_for_config(_task(retries), None, "sys-1") == expected


def test_wait_for_config_retries_while_a_load_runs(monkeypatch):
    monkeypatch.setattr("api.services.config_pairing.config_basis", lambda s, sid: "loading")
    with pytest.raises(Retry, match="in 30s"):
        run_extraction.wait_for_config(_task(3), None, "sys-1")
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_wait_for_config.py -q -p no:cacheprovider`
Expected: FAIL. `AttributeError: module 'workers.tasks.run_extraction' has no attribute 'wait_for_config'`.

- [ ] **Step 3: Implement**

In `workers/tasks/run_extraction.py`, above the `@celery_app.task(...)` decorator of `run_extraction`, add:

```python
CONFIG_WAIT_SECONDS, CONFIG_WAIT_RETRIES = 30, 50


def wait_for_config(task, session: Session, system_id: str) -> str:
    """'loaded' when the system has a completed config load; retry while a fresh load runs; else 'baseline'."""
    from api.services.config_pairing import config_basis

    basis = config_basis(session, system_id)
    if basis == "loading" and task.request.retries < CONFIG_WAIT_RETRIES:
        raise task.retry(countdown=CONFIG_WAIT_SECONDS, max_retries=CONFIG_WAIT_RETRIES)
    return "loaded" if basis == "loaded" else "baseline"
```

In `run_extraction`, as the first statements after `engine = get_sync_engine()` (before `version_id` is set, so a retry does not create a second job), add:

```python
    if sync_type != "config":
        with tenant_session(engine, tenant_id) as s:
            config_basis = wait_for_config(self, s, system_id)  # raises Retry outside the task's try block
    else:
        config_basis = "loaded"
```

In the `analysis_versions` INSERT metadata dict, add `"config_basis": config_basis,` after `"system_id": system_id,`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_wait_for_config.py tests/test_run_extraction.py -q -p no:cacheprovider`
Expected: PASS (4 new, plus the existing extraction tests if that file exists). If an existing extraction test runs the task body, monkeypatch `workers.tasks.run_extraction.wait_for_config` to return `"loaded"`.

- [ ] **Step 5: Commit**

```bash
git add workers/tasks/run_extraction.py tests/test_wait_for_config.py
git commit -m "feat(extraction): wait for a running config load, else flag a baseline basis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 9: Engine and export apply config maps through `check_ref`; baseline basis

**Files:**
- Modify: `api/services/migration/engine.py` (`analyze`, the mapping loop at lines 169-178, `_value_gaps` at line 230)
- Modify: `api/services/migration/export.py` (`build_load_tables`, line 21)
- Test: `tests/test_migration_engine.py` (append)

**Interfaces:**
- Consumes: `Field.check_ref` (`sap/ddic.py:78`), `Dictionary.field` (`sap/ddic.py:111`).
- Produces:
  - `analyze(..., target_connected=False, config_basis="live")`. A value map keyed by the target field's `check_ref` applies when the mapping has no `value_map`. When `config_basis == "baseline"`, a check-table miss is `medium` with provenance `target_baseline_config`.
  - `build_load_tables(..., target_dict=None)` applies the same `check_ref` maps.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_migration_engine.py`:

```python
def test_config_value_map_applies_through_the_check_table():
    vm = {"T077K.KTOKK": {"LIEF": "KRED"}}
    cfg = {"T077K.KTOKK": {"KRED"}, "TB001.BU_GROUP": {"BP01", "BP02"}}
    gaps, _ = _run(vm, cfg, connected=True)
    assert not [g for g in gaps if g.gap_type == "check_table_value" and g.target_field == "LFA1.KTOKK"]


def test_baseline_target_config_flags_without_blocking():
    frames = _frames()
    maps = seed_mappings({t: list(df.columns) for t, df in frames.frames.items()}, ECC, S4)
    cfg = {"T077K.KTOKK": {"KRED"}}
    gaps, _ = analyze("accounts_payable", frames, ["LFA1", "LFB1"], maps, S4, {}, cfg, None, True,
                      config_basis="baseline")
    hit = [g for g in gaps if g.gap_type == "check_table_value" and g.target_field == "LFA1.KTOKK"]
    assert [(g.source_value, g.severity, g.provenance) for g in hit] == [("LIEF", "medium", "target_baseline_config")]


def test_load_files_apply_config_maps_through_the_check_table():
    from api.services.migration.export import build_load_tables

    maps = [Mapping("LFA1.LIFNR", "LFA1.LIFNR"), Mapping("LFA1.KTOKK", "LFA1.KTOKK")]
    tables = build_load_tables(_frames(), {"accounts_payable": ["LFA1"]}, {"accounts_payable": maps},
                               {"accounts_payable": {"T077K.KTOKK": {"LIEF": "KRED"}}}, {}, target_dict=S4)
    assert list(tables["LFA1"]["KTOKK"]) == ["KRED"] * 3
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_migration_engine.py -q -p no:cacheprovider`
Expected: FAIL. The first test still finds a `check_table_value` gap for LIEF, and the other two raise `TypeError` on the new keyword arguments.

- [ ] **Step 3: Implement**

In `api/services/migration/engine.py`:

1. Add `config_basis: str = "live",` after `target_connected: bool = False,` in the `analyze` signature, and document it in the docstring: "`config_basis` is `baseline` when the target config is the SAP standard baseline; a check-table miss is then flagged, not blocking".
2. In the mapping loop, extend the `if m.value_map:` block with an `elif` branch, and pass the basis to `_value_gaps`:

```python
                if m.value_map:
                    ...  # unchanged
                elif tf.check_ref and tf.check_ref in value_maps:
                    # a confirmed config map (module 'config', target_field = the check table's CHECKTABLE.FIELD)
                    # ponytail: maps by one field; a compound-key config value maps only its differing field
                    vm = value_maps[tf.check_ref]
                    mapped = values.map(lambda v, vm=vm: vm.get(v, v) if isinstance(v, str) else v)
                target_values.setdefault((table, t_table), {})[t_name] = mapped.where(populated)
                _value_gaps(gaps, blocked[table], module, df, col, values, mapped, populated & mapped.notna(),
                            rk, table, m.target, tf, target_config, target_connected, config_basis)
```

3. Change the `_value_gaps` signature to end with `target_config, target_connected, config_basis: str = "live") -> None:`, and replace the `if allowed is not None:` block with:

```python
        if allowed is not None:
            bad = scope & ~v.isin(allowed)
            if config_basis == "baseline":
                _per_record(gaps, blocked, module, "check_table_value", "medium", bad, rk, df, col, values, mapped,
                            table, target, f"value not configured in the SAP standard baseline's {tf.check_table}",
                            "target_baseline_config")
            else:
                _per_record(gaps, blocked, module, "check_table_value", "high", bad, rk, df, col, values, mapped,
                            table, target, f"value not configured in the target's {tf.check_table}",
                            "target_live_config")
```

`medium` is not in `_BLOCKING`, so these records stay transfer-ready.

In `api/services/migration/export.py`:

1. Add `from typing import Optional` and `from sap.ddic import Dictionary` to the imports if they are missing.
2. Change the signature to `build_load_tables(frames, module_tables, mappings, value_maps, blocked, target_dict: Optional[Dictionary] = None)`.
3. Extend the value-map block:

```python
                if m.value_map:
                    vm = vms.get(m.target, {})
                    vals = vals.map(lambda v, vm=vm: vm.get(v) if isinstance(v, str) else v)
                elif target_dict is not None:
                    tf = target_dict.field(t_table, t_field)
                    if tf is not None and tf.check_ref in vms:
                        vm = vms[tf.check_ref]
                        vals = vals.map(lambda v, vm=vm: vm.get(v, v) if isinstance(v, str) else v)
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_migration_engine.py -q -p no:cacheprovider`
Expected: PASS (all existing tests plus 3).

- [ ] **Step 5: Commit**

```bash
git add api/services/migration/engine.py api/services/migration/export.py tests/test_migration_engine.py
git commit -m "feat(migration): apply confirmed config maps through check tables; flag baseline checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 10: Realign: scoped value maps, target config with basis, default destination, value-map routes

**Files:**
- Modify: `workers/tasks/run_migration.py` (`load_value_maps` line 76, `load_target_config` line 86, the call sites at lines 143 and 155)
- Modify: `api/routes/migration.py` (`_enqueue_run` line 186, `export_migration._build`, `get_value_map`, `upsert_value_map`)
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `latest_completed_load`, `load_items`, `baseline_snapshot`, `BASELINE_TYPE` (Tasks 3 and 4); `uq_transfer_value_mappings_scope` (Task 1); `analyze(..., config_basis=)` and `build_load_tables(..., target_dict=)` (Task 9).
- Produces:
  - `load_value_maps(session, module, source_system_id=None, target_system_id=None) -> dict[str, dict[str, str]]`: confirmed maps of the module plus `'config'`, global then pair-scoped (scoped rows win).
  - `load_target_config(session, dest_system_id) -> tuple[dict[str, set[str]], str]`.
  - `_enqueue_run` defaults `dest` to the source's `target_system_id` for `source_to_destination` runs.
  - The value-map GET returns confirmed rows only. The PUT upserts on the scope constraint and confirms.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
@pg
def test_load_value_maps_merges_module_config_and_pair_scope(app_engine):
    from sqlalchemy import text

    from workers.tasks.run_migration import load_value_maps

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    other = _system(app, tid, "QAS")
    ins = ("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, "
           "source_system_id, target_system_id, status) VALUES (gen_random_uuid(), :t, :m, :f, :sv, :tv, "
           "CAST(:s AS uuid), CAST(:g AS uuid), :st)")
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for m, f, sv, tv, s_, g, st in [
            ("accounts_payable", "BUT000.BU_GROUP", "KRED", "BP01", None, None, "confirmed"),
            ("config", "T077K.KTOKK", "LIEF", "GLOBAL", None, None, "confirmed"),
            ("config", "T077K.KTOKK", "LIEF", "KRED", src, tgt, "confirmed"),
            ("config", "T077K.KTOKK", "ZZZZ", "KRED", src, tgt, "proposed"),
            ("config", "T077K.KTOKK", "OTHR", "KRED", other, tgt, "confirmed"),
        ]:
            c.execute(text(ins), {"t": tid, "m": m, "f": f, "sv": sv, "tv": tv, "s": s_, "g": g, "st": st})
    with _session(app, tid) as s:
        scoped = load_value_maps(s, "accounts_payable", src, tgt)
        global_only = load_value_maps(s, "accounts_payable")
    assert scoped == {"BUT000.BU_GROUP": {"KRED": "BP01"}, "T077K.KTOKK": {"LIEF": "KRED"}}
    assert global_only["T077K.KTOKK"] == {"LIEF": "GLOBAL"}


@pg
def test_load_target_config_reports_its_basis(app_engine):
    from workers.tasks.run_migration import load_target_config

    owner, app = app_engine
    tid = _tenant(owner)
    live = _system(app, tid, "S4D", "s4hana_onprem", "target")
    base = _system(app, tid, "S4C", "s4hana_cloud", "target")
    _load(app, tid, live, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED", "TXT30": ""})])
    _load(app, tid, base, [("T077K", "KTOKK=SUPL", {"KTOKK": "SUPL"})], origin="best_practice")
    with _session(app, tid) as s:
        cfg, basis = load_target_config(s, live)
        assert (cfg["T077K.KTOKK"], basis) == ({"KRED"}, "live") and "T077K.TXT30" not in cfg
        assert load_target_config(s, base)[1] == "baseline"
        cfg, basis = load_target_config(s, None)
        assert basis == "baseline" and "SUPL" in cfg["T077K.KTOKK"]
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider -k "value_maps or target_config"`
Expected: FAIL. `TypeError: load_value_maps() takes 2 positional arguments but 4 were given`.

- [ ] **Step 3: Implement**

In `workers/tasks/run_migration.py`, replace `load_value_maps` and `load_target_config` with:

```python
def load_value_maps(session, module: str, source_system_id=None, target_system_id=None) -> dict[str, dict[str, str]]:
    """Confirmed value maps of ``module`` plus config maps: global rows, then the pair's rows (which win)."""
    out: dict[str, dict[str, str]] = {}
    for tf, sv, tv in session.execute(
        text("""
            SELECT target_field, source_value, target_value FROM transfer_value_mappings
            WHERE module IN (:m, 'config') AND status = 'confirmed'
              AND ((source_system_id IS NULL AND target_system_id IS NULL)
                   OR (source_system_id = CAST(:src AS uuid)
                       AND target_system_id IS NOT DISTINCT FROM CAST(:tgt AS uuid)))
            ORDER BY source_system_id NULLS FIRST
        """),
        {"m": module, "src": str(source_system_id) if source_system_id else None,
         "tgt": str(target_system_id) if target_system_id else None},
    ).fetchall():
        out.setdefault(tf, {})[sv] = tv
    return out


def _add_items(out: dict[str, set[str]], obj: str, values: dict) -> None:
    for col, val in (values or {}).items():
        if val not in (None, ""):
            out.setdefault(f"{obj}.{col}", set()).add(str(val).strip())


def load_target_config(session, dest_system_id) -> tuple[dict[str, set[str]], str]:
    """(allowed values by CHECKTABLE.FIELD, basis): the destination's latest config load, else its live
    config snapshots, else the S/4 standard baseline. The basis is 'baseline' for a best-practice source."""
    from api.services.config_pairing import BASELINE_TYPE, baseline_snapshot, latest_completed_load, load_items

    out: dict[str, set[str]] = {}
    if dest_system_id:
        load = latest_completed_load(session, str(dest_system_id))
        if load:
            for it in load_items(session, load[0]):
                _add_items(out, it.object, it.values)
            return out, "baseline" if load[1] == "best_practice" else "live"
        for table, data in session.execute(
            text("SELECT config_table, config_data FROM config_snapshots WHERE system_id = :sid AND source = 'live'"),
            {"sid": str(dest_system_id)},
        ).fetchall():
            for rec in data or []:
                _add_items(out, table, rec)
        if out:
            return out, "live"
    for it in baseline_snapshot(BASELINE_TYPE).items:
        _add_items(out, it.object, it.values)
    return out, "baseline"
```

In `run_migration`:

- Change line 143 to `target_config, config_basis = load_target_config(session, dest_system_id)`.
- Change the `analyze(...)` call at line 155 to:

```python
                gaps, res = analyze(module, frames, tables, mappings, target_dict,
                                    load_value_maps(session, module, source_system_id, dest_system_id),
                                    target_config, None, bool(dest_system_id), config_basis=config_basis)
```

In `api/routes/migration.py`:

1. In `_enqueue_run`, as the first statement:

```python
    if src and not dest and mode == "source_to_destination":
        dest = (await db.execute(text("SELECT target_system_id::text FROM sap_systems WHERE id = CAST(:s AS uuid)"),
                                 {"s": src})).scalar()  # default to the source's assigned target
```

2. In `export_migration._build()`, add `from sap.ddic import get_dictionary` to the local imports, and replace the `vms = ...` line and the return with:

```python
            vms = {m: load_value_maps(s, m, run.source_system_id, run.dest_system_id) for m in run.modules}
            target_dict = (dictionary_for(s, run.dest_system_id) if run.dest_system_id
                           else get_dictionary(target_type or "s4hana"))
        return build_load_tables(frames, mtables, maps, vms, blocked, target_dict=target_dict)
```

3. In `get_value_map`, change `where, params = "module = :m", {"m": module}` to `where, params = "module = :m AND status = 'confirmed'", {"m": module}`.
4. In `upsert_value_map`, replace the `ON CONFLICT` clause with:

```sql
                ON CONFLICT ON CONSTRAINT uq_transfer_value_mappings_scope
                DO UPDATE SET target_value = EXCLUDED.target_value, note = EXCLUDED.note,
                              updated_by = EXCLUDED.updated_by, updated_at = now(), status = 'confirmed'
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py tests/test_migration_engine.py tests/test_migration_routes.py -q -p no:cacheprovider`
Expected: PASS (17 in the new file, plus the existing migration tests). If an existing test calls `load_target_config` and expects a dict, update it to unpack `(config, basis)`.

- [ ] **Step 5: Commit**

```bash
git add workers/tasks/run_migration.py api/routes/migration.py tests/test_config_pairing_pg.py
git commit -m "feat(migration): realign with pair-scoped confirmed maps and the target's config basis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 11: Config-pairing routes and steward approval

**Files:**
- Create: `api/routes/config_pairing.py`
- Modify: `api/main.py` (import after line 55; `include_router` after line 319)
- Modify: `api/routes/stewardship.py` (`_apply_source_action`, after the `glossary_review` branch)
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `compare`, `propose`, `finding_context` (Task 4).
- Produces:
  - `GET /api/v1/config-pairing/compare/{system_id}?object=` (permission `view`). An unknown or invalid id returns 404 "System not found".
  - `POST /api/v1/config-pairing/propose/{system_id}` (permission `analyse`). It returns `{proposed, skipped, target}`.
  - `GET /api/v1/config-pairing/finding-context?rule_id=&module=&version_id=&fields=` (permission `view`).
  - Steward `approve` on a `config_value_match` item confirms the mapping; `reject` rejects it.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
@pg
def test_config_pairing_routes(app_engine):
    from api.routes.config_pairing import router

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    _load(app, tid, src, [("T077K", "KTOKK=0001", {"KTOKK": "0001"})])
    _load(app, tid, tgt, [("T077K", "KTOKK=1", {"KTOKK": "1"})])

    async def calls(c):
        cmp_ = await c.get(f"/api/v1/config-pairing/compare/{src}", params={"object": "T077K"})
        missing = await c.get("/api/v1/config-pairing/compare/not-a-uuid")
        prop = await c.post(f"/api/v1/config-pairing/propose/{src}")
        ctx = await c.get("/api/v1/config-pairing/finding-context",
                          params={"rule_id": "X-1", "module": "accounts_payable"})
        return cmp_, missing, prop, ctx

    cmp_, missing, prop, ctx = _client_run(app, tid, router, calls)
    assert cmp_.status_code == 200 and cmp_.json()["rows"][0]["status"] == "key_match"
    assert missing.status_code == 404 and missing.json()["detail"] == "System not found"
    assert prop.json() == {"proposed": 1, "skipped": 0, "target": "S4D"}
    assert ctx.status_code == 200 and ctx.json()["source"] == []


@pg
def test_steward_approve_confirms_a_config_match(app_engine):
    import asyncio
    from types import SimpleNamespace

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.routes.stewardship import _apply_source_action

    owner, app = app_engine
    tid = _tenant(owner)
    mid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, status) VALUES (:i, :t, 'config', 'T077K.KTOKK', 'LIEF', 'KRED', 'proposed')"),
                  {"i": mid, "t": tid})

    async def main() -> str:
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(aeng, expire_on_commit=False)() as db:
                await db.execute(text(f"SET app.tenant_id = '{tid}'"))
                item = SimpleNamespace(item_type="config_value_match", source_id=mid, tenant_id=tid)
                await _apply_source_action(db, item, "approve", None, None)
                await db.commit()
                return (await db.execute(text("SELECT status FROM transfer_value_mappings WHERE id = :i"),
                                         {"i": mid})).scalar()
        finally:
            await aeng.dispose()

    assert asyncio.run(main()) == "confirmed"
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider -k "routes or steward"`
Expected: FAIL. `ModuleNotFoundError: No module named 'api.routes.config_pairing'`.

- [ ] **Step 3: Implement**

Create `api/routes/config_pairing.py`:

```python
"""Source/target config pairing: compare a source's config with its target, propose matches, finding context."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import config_pairing as cp
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/config-pairing", tags=["config-pairing"])


async def _system(db: AsyncSession, tenant: Tenant, system_id: str) -> str:
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    try:
        uuid.UUID(system_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="System not found")
    if not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = CAST(:s AS uuid)"), {"s": system_id})).scalar():
        raise HTTPException(status_code=404, detail="System not found")
    return system_id


@router.get("/compare/{system_id}", dependencies=[Depends(require_permission("view"))])
async def compare_config(system_id: str, object: Optional[str] = None,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    sid = await _system(db, tenant, system_id)
    return await db.run_sync(lambda s: cp.compare(s, sid, object))


@router.post("/propose/{system_id}", dependencies=[Depends(require_permission("analyse"))])
async def propose_matches(system_id: str, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict:
    sid = await _system(db, tenant, system_id)
    out = await db.run_sync(lambda s: cp.propose(s, str(tenant.id), sid))
    await db.commit()
    return out


@router.get("/finding-context", dependencies=[Depends(require_permission("view"))])
async def get_finding_context(rule_id: str, module: str, version_id: Optional[str] = None,
                              fields: list[str] = Query(default_factory=list),
                              db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    if version_id:
        try:
            uuid.UUID(version_id)
        except ValueError:
            version_id = None
    return await db.run_sync(lambda s: cp.finding_context(s, rule_id, module, version_id, fields))
```

In `api/main.py`, after line 55 add `from api.routes.config_pairing import router as config_pairing_router`, and after line 319 add `app.include_router(config_pairing_router)`.

In `api/routes/stewardship.py`, `_apply_source_action`, after the last (`glossary_review`) branch add:

```python
    elif item.item_type == "config_value_match" and action in ("approve", "reject"):
        await db.execute(
            text("UPDATE transfer_value_mappings SET status = :st, updated_by = CAST(:uid AS uuid), "
                 "updated_at = now() WHERE id = :sid"),
            {"st": "confirmed" if action == "approve" else "rejected", "uid": user_id, "sid": item.source_id})
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py tests/test_stewardship.py -q -p no:cacheprovider`
Expected: PASS (19 in the new file, plus the existing stewardship tests).

- [ ] **Step 5: Commit**

```bash
git add api/routes/config_pairing.py api/main.py api/routes/stewardship.py tests/test_config_pairing_pg.py
git commit -m "feat(config): compare, propose and finding-context routes; steward approval of config matches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 12: Realignment report (Excel and branded PDF)

**Files:**
- Modify: `api/services/config_pairing.py` (append `realignment_sheets`, `realignment_context`)
- Modify: `api/routes/migration.py` (new route after `wave_report`)
- Create: `templates/config_realignment_report.html`
- Test: `tests/test_config_pairing_pg.py` (append)

**Interfaces:**
- Consumes: `migration_runs`, `migration_gap_findings` (`source_value`, `provenance`), `transfer_value_mappings`, `api.services.pdf_reports.render` and `fmt_sast`, `_stream` (`migration.py:729`).
- Produces:
  - `realignment_sheets(s, run_id) -> tuple[Optional[Row], pd.DataFrame, pd.DataFrame]`.
  - `realignment_context(run, unmapped, applied, tenant_name) -> dict`.
  - `GET /api/v1/migration/runs/{run_id}/realignment.{xlsx|pdf}` (permission `export`), with the sheets "Unmapped values" and "Applied mappings".

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_pairing_pg.py`:

```python
@pg
def test_realignment_report_sheets_and_formats(app_engine, monkeypatch):
    from sqlalchemy import text

    from api.routes.migration import router
    from api.services import pdf_reports
    from api.services.config_pairing import realignment_sheets

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    rid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, modules, "
                       "status) VALUES (:r, :t, 'source_to_destination', :s, :d, ARRAY['accounts_payable'], "
                       "'analysed')"), {"r": rid, "t": tid, "s": src, "d": tgt})
        for key in ("LIFNR=1", "LIFNR=2"):
            c.execute(text("INSERT INTO migration_gap_findings (id, tenant_id, run_id, module, record_key, field, "
                           "gap_type, severity, source_value, provenance) VALUES (gen_random_uuid(), :t, :r, "
                           "'accounts_payable', :k, 'LFA1.KTOKK', 'check_table_value', 'high', 'LIEF', "
                           "'target_live_config')"), {"t": tid, "r": rid, "k": key})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, source_system_id, target_system_id, status) VALUES (gen_random_uuid(), :t, "
                       "'config', 'T077K.KTOKK', 'ZZZZ', 'KRED', :s, :d, 'confirmed')"), {"t": tid, "s": src, "d": tgt})
    with _session(app, tid) as s:
        run, unmapped, applied = realignment_sheets(s, rid)
        assert run is not None and realignment_sheets(s, str(uuid.uuid4()))[0] is None
    assert list(unmapped["records"]) == [2] and list(unmapped["source_value"]) == ["LIEF"]
    assert list(applied["scope"]) == ["pair"] and list(applied["target_value"]) == ["KRED"]

    monkeypatch.setattr(pdf_reports, "render", lambda tpl, ctx: b"%PDF-" + tpl.encode())

    async def calls(c):
        return (await c.get(f"/api/v1/migration/runs/{rid}/realignment.xlsx"),
                await c.get(f"/api/v1/migration/runs/{rid}/realignment.pdf"),
                await c.get(f"/api/v1/migration/runs/{rid}/realignment.csv"))

    xlsx, pdf, bad = _client_run(app, tid, router, calls)
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"
    assert pdf.content == b"%PDF-config_realignment_report.html"
    assert bad.status_code == 404 and bad.json()["detail"] == "Unknown report format."


def test_realignment_template_renders():
    import pandas as pd

    from api.services.config_pairing import realignment_context
    from api.services.pdf_reports import render

    run = {"id": "r1", "modules": ["accounts_payable"], "status": "analysed", "source_name": "PRD",
           "dest_name": "S4D"}
    unmapped = pd.DataFrame([{"module": "accounts_payable", "field": "LFA1.KTOKK", "gap_type": "check_table_value",
                              "severity": "high", "provenance": "target_live_config", "source_value": "LIEF",
                              "records": 2}])
    applied = pd.DataFrame(columns=["module", "target_field", "source_value", "target_value", "scope"])
    pdf = render("config_realignment_report.html", realignment_context(run, unmapped, applied, "Tenant"))
    assert pdf[:5] == b"%PDF-"
```

If `migration_runs` or `migration_gap_findings` has a NOT NULL column without a default that the inserts above omit, add it with a neutral value.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider -k realignment`
Expected: FAIL. `ImportError: cannot import name 'realignment_sheets'`.

- [ ] **Step 3: Implement**

Append to `api/services/config_pairing.py`:

```python
REPORT_CAP = 5000


def realignment_sheets(s: Session, run_id: str):
    """(run row or None, unmapped values, applied mappings) for one migration run, each capped at REPORT_CAP rows."""
    run = s.execute(text(
        "SELECT r.id::text AS id, r.modules, r.status, r.source_system_id::text AS source_system_id, "
        "r.dest_system_id::text AS dest_system_id, src.name AS source_name, dst.name AS dest_name "
        "FROM migration_runs r LEFT JOIN sap_systems src ON src.id = r.source_system_id "
        "LEFT JOIN sap_systems dst ON dst.id = r.dest_system_id WHERE r.id = CAST(:r AS uuid)"),
        {"r": run_id}).mappings().fetchone()
    if run is None:
        return None, pd.DataFrame(), pd.DataFrame()
    # ponytail: counts are of stored findings, which MAX_FINDINGS_PER_GAP caps per gap
    unmapped = pd.DataFrame([dict(r) for r in s.execute(text(
        "SELECT module, field, gap_type, severity, provenance, source_value, count(*) AS records "
        "FROM migration_gap_findings WHERE run_id = CAST(:r AS uuid) "
        "AND gap_type IN ('check_table_value', 'value_unmapped') "
        "GROUP BY module, field, gap_type, severity, provenance, source_value "
        "ORDER BY records DESC, module, field LIMIT :cap"), {"r": run_id, "cap": REPORT_CAP}).mappings()],
        columns=["module", "field", "gap_type", "severity", "provenance", "source_value", "records"])
    applied = pd.DataFrame([dict(r) for r in s.execute(text(
        "SELECT module, target_field, source_value, target_value, "
        "CASE WHEN source_system_id IS NULL THEN 'global' ELSE 'pair' END AS scope "
        "FROM transfer_value_mappings WHERE status = 'confirmed' "
        "AND (module = ANY(:mods) OR module = 'config') "
        "AND ((source_system_id IS NULL AND target_system_id IS NULL) "
        "     OR (source_system_id = CAST(:src AS uuid) "
        "         AND target_system_id IS NOT DISTINCT FROM CAST(:tgt AS uuid))) "
        "ORDER BY module, target_field, source_value LIMIT :cap"),
        {"mods": list(run["modules"] or []), "src": run["source_system_id"], "tgt": run["dest_system_id"],
         "cap": REPORT_CAP}).mappings()],
        columns=["module", "target_field", "source_value", "target_value", "scope"])
    return run, unmapped, applied


def realignment_context(run, unmapped: pd.DataFrame, applied: pd.DataFrame, tenant_name: str) -> dict[str, object]:
    from datetime import datetime, timezone

    return {
        "title": f"Configuration realignment: {run['source_name'] or 'source'} to {run['dest_name'] or BASELINE_LABEL}",
        "eyebrow": "Migration",
        "scope_label": tenant_name,
        "generated_at": datetime.now(timezone.utc),
        "meta": [("Source", run["source_name"] or "Not set"), ("Target", run["dest_name"] or BASELINE_LABEL),
                 ("Objects", ", ".join(run["modules"] or [])), ("Unmapped values", str(len(unmapped))),
                 ("Applied mappings", str(len(applied)))],
        "unmapped": unmapped.to_dict("records"),
        "applied": applied.to_dict("records"),
    }
```

In `api/routes/migration.py`, after `wave_report`:

```python
@router.get("/runs/{run_id}/realignment.{fmt}")
async def realignment_report(
    run_id: uuid.UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    import asyncio

    import pandas as pd

    from api.services.config_pairing import realignment_context, realignment_sheets
    from api.services.pdf_reports import render

    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=404, detail="Unknown report format.")
    await _set_rls(db, tenant.id)
    run, unmapped, applied = await db.run_sync(lambda s: realignment_sheets(s, str(run_id)))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    name = f"config_realignment_{run_id}"
    if fmt == "pdf":
        pdf = await asyncio.to_thread(render, "config_realignment_report.html",
                                      realignment_context(run, unmapped, applied, tenant.name))
        return _stream(pdf, "application/pdf", f"{name}.pdf")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        unmapped.to_excel(xw, sheet_name="Unmapped values", index=False)
        applied.to_excel(xw, sheet_name="Applied mappings", index=False)
    return _stream(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx")
```

The test monkeypatches `api.services.pdf_reports.render`. The route imports `render` inside the function, so it picks up the patched function.

Create `templates/config_realignment_report.html`:

```html
{% extends "_base.html" %}
{% block body %}
<h2>Unmapped values</h2>
{% if unmapped %}
<table class="data">
<thead><tr><th>Object</th><th>Field</th><th>Gap</th><th>Severity</th><th>Source value</th><th>Basis</th><th class="r">Records</th></tr></thead>
<tbody>
{% for u in unmapped %}
<tr><td>{{ u.module | module }}</td><td class="mono">{{ u.field or "—" }}</td><td>{{ u.gap_type | module }}</td>
    <td><span class="st {{ u.severity | st }}">{{ u.severity | capitalize }}</span></td>
    <td class="mono">{{ u.source_value or "—" }}</td>
    <td>{{ "SAP standard baseline" if u.provenance == "target_baseline_config" else "Target configuration" }}</td>
    <td class="r">{{ u.records | n }}</td></tr>
{% endfor %}
</tbody>
</table>
{% else %}
<div class="empty">Every source value maps to a value configured in the target.</div>
{% endif %}

<h2>Applied mappings</h2>
{% if applied %}
<table class="data">
<thead><tr><th>Object</th><th>Target field</th><th>Source value</th><th>Target value</th><th>Scope</th></tr></thead>
<tbody>
{% for a in applied %}
<tr><td>{{ a.module | module }}</td><td class="mono">{{ a.target_field }}</td><td class="mono">{{ a.source_value }}</td>
    <td class="mono">{{ a.target_value }}</td><td>{{ "This source and target" if a.scope == "pair" else "All systems" }}</td></tr>
{% endfor %}
</tbody>
</table>
{% else %}
<div class="empty">No confirmed value mappings apply to this run.</div>
{% endif %}
{% endblock %}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_config_pairing_pg.py -q -p no:cacheprovider`
Expected: PASS (21).

- [ ] **Step 5: Commit**

```bash
git add api/services/config_pairing.py api/routes/migration.py templates/config_realignment_report.html tests/test_config_pairing_pg.py
git commit -m "feat(migration): configuration realignment report in Excel and branded PDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 13: Frontend API, types and query keys

**Files:**
- Create: `frontend/lib/api/config-pairing.ts`
- Modify: `frontend/lib/api/systems.ts` (the `updateSystem` body type)
- Modify: `frontend/lib/query-keys.ts` (after `configLoad`, line 104)
- Modify: `frontend/types/api.ts` (`SAPSystemExtended` at line 939; `StewardshipItemType` at line 818)
- Modify: `frontend/app/(app)/home/__tests__/live.test.tsx` (system fixture)
- Test: `frontend/lib/api/__tests__/config-pairing.test.ts` (new)

**Interfaces:**
- Consumes: the Task 7 and Task 11 routes.
- Produces:
  - Types `MatchStatus`, `MatchRow`, `CompareObject`, `ConfigCompare`, `ProposeResult`, `FindingContext`.
  - `getConfigCompare(systemId, object?)`, `proposeConfigMatches(systemId)`, `getFindingContext(params)`.
  - `queryKeys.configCompare(systemId, object?)`, `queryKeys.findingContext(ruleId, run)`.
  - `SAPSystemExtended.role: "source" | "target"`, `.target_system_id: string | null`. `StewardshipItemType` gains `"config_value_match"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/api/__tests__/config-pairing.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "../client";
import { getConfigCompare, getFindingContext, proposeConfigMatches } from "../config-pairing";

afterEach(() => vi.restoreAllMocks());

describe("config-pairing API", () => {
  it("passes the selected object to compare", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { source_load_id: null, target: { system_id: null, label: "baseline target", baseline: true }, objects: [], rows: [] } });
    await getConfigCompare("sys1", "T077K");
    expect(get).toHaveBeenCalledWith("/api/v1/config-pairing/compare/sys1", { params: { object: "T077K" } });
  });

  it("posts a proposal run", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { proposed: 2, skipped: 0, target: "S4D" } });
    expect(await proposeConfigMatches("sys1")).toEqual({ proposed: 2, skipped: 0, target: "S4D" });
    expect(post).toHaveBeenCalledWith("/api/v1/config-pairing/propose/sys1");
  });

  it("sends finding-context fields as repeated params", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: null });
    await getFindingContext({ ruleId: "AP-001", module: "accounts_payable", versionId: "v1", fields: ["LFA1.KTOKK"] });
    expect(get).toHaveBeenCalledWith("/api/v1/config-pairing/finding-context", {
      params: { rule_id: "AP-001", module: "accounts_payable", version_id: "v1", fields: ["LFA1.KTOKK"] },
      paramsSerializer: { indexes: null },
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run lib/api/__tests__/config-pairing.test.ts`
Expected: FAIL. `Failed to resolve import "../config-pairing"`.

- [ ] **Step 3: Implement**

Create `frontend/lib/api/config-pairing.ts`:

```ts
import apiClient from "./client";

export type MatchStatus = "exists" | "key_match" | "desc_match" | "missing";

export interface MatchRow {
  object: string;
  source_key: string;
  status: MatchStatus;
  target_key: string | null;
  score: number | null;
  field: string | null;
  source_value: string | null;
  target_value: string | null;
  description: string | null;
  proposable: boolean;
}

export interface CompareObject {
  object: string;
  exists: number;
  key_match: number;
  desc_match: number;
  missing: number;
  proposable: number;
}

export interface CompareTarget {
  system_id: string | null;
  label: string;
  baseline: boolean;
}

export interface ConfigCompare {
  source_load_id: string | null;
  target: CompareTarget;
  objects: CompareObject[];
  rows: MatchRow[];
}

export interface ProposeResult {
  proposed: number;
  skipped: number;
  target: string;
}

export interface FindingContext {
  object: string | null;
  system_id: string | null;
  target_label: string;
  baseline: boolean;
  source: string[];
  target: string[];
  missing: string[];
  missing_total: number;
}

export async function getConfigCompare(systemId: string, object?: string): Promise<ConfigCompare> {
  const { data } = await apiClient.get<ConfigCompare>(`/api/v1/config-pairing/compare/${systemId}`, {
    params: { object },
  });
  return data;
}

export async function proposeConfigMatches(systemId: string): Promise<ProposeResult> {
  const { data } = await apiClient.post<ProposeResult>(`/api/v1/config-pairing/propose/${systemId}`);
  return data;
}

export async function getFindingContext(p: {
  ruleId: string; module: string; versionId?: string; fields: string[];
}): Promise<FindingContext | null> {
  const { data } = await apiClient.get<FindingContext | null>("/api/v1/config-pairing/finding-context", {
    params: { rule_id: p.ruleId, module: p.module, version_id: p.versionId, fields: p.fields },
    paramsSerializer: { indexes: null },
  });
  return data;
}
```

In `frontend/lib/api/systems.ts`, add to the `updateSystem` body type:

```ts
  role?: "source" | "target";
  target_system_id?: string; // "" clears the target
```

In `frontend/lib/query-keys.ts`, after `configLoad`:

```ts
  configCompare: (systemId: string, object?: string) => ["config-compare", systemId, object ?? ""] as const,
  findingContext: (ruleId: string, run: string) => ["finding-context", ruleId, run] as const,
```

In `frontend/types/api.ts`:

- At the end of `SAPSystemExtended` (after `last_analysis_at`), add:

```ts
  role: "source" | "target";
  target_system_id: string | null;
```

- Add `| "config_value_match"` to `StewardshipItemType`.

In `frontend/app/(app)/home/__tests__/live.test.tsx`, add `role: "source", target_system_id: null,` to the system fixture. Run `npm run typecheck` and add the same two fields to any other `SAPSystemExtended` fixture it reports.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: PASS (3 new tests; the full suite is green).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api/config-pairing.ts frontend/lib/api/systems.ts frontend/lib/query-keys.ts frontend/types/api.ts "frontend/app/(app)/home/__tests__/live.test.tsx" frontend/lib/api/__tests__/config-pairing.test.ts
git commit -m "feat(frontend): config-pairing API client, system role and target types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 14: UI: role and target, config compare panel, finding context

**Files:**
- Create: `frontend/app/(app)/systems/[systemId]/config-compare-panel.tsx`
- Create: `frontend/app/(app)/objects/[object]/rules/[ruleId]/finding-context-panel.tsx`
- Modify: `frontend/app/(app)/systems/[systemId]/page.tsx` (header at line 140, the Drawer at line 210, Health at line 449, `EditForm` at lines 476-544)
- Modify: `frontend/app/(app)/systems/page.tsx` (columns at lines 122-123)
- Modify: `frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx` (the success branch)
- Test: `frontend/app/(app)/systems/[systemId]/__tests__/config-compare-panel.test.tsx` (new), `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/finding-context-panel.test.tsx` (new), `frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 13's API client, types and query keys; `updateSystem`.
- Produces:
  - `ConfigComparePanel({ systemId, canPropose })`.
  - `FindingContextPanel({ ruleId, run, module, fields })`.
  - The edit drawer's Role and Target selects, the header role pill and the systems list Role column.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(app)/systems/[systemId]/__tests__/config-compare-panel.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { ConfigComparePanel } from "../config-compare-panel";
import * as pairingApi from "@/lib/api/config-pairing";
import type { ConfigCompare } from "@/lib/api/config-pairing";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems/sys1",
  useSearchParams: () => new URLSearchParams(),
}));

const compare = (over: Partial<ConfigCompare> = {}): ConfigCompare => ({
  source_load_id: "l1",
  target: { system_id: null, label: "baseline target", baseline: true },
  objects: [{ object: "T077K", exists: 3, key_match: 1, desc_match: 0, missing: 2, proposable: 1 }],
  rows: [],
  ...over,
});

describe("ConfigComparePanel", () => {
  it("shows the baseline target and per-object counts", async () => {
    vi.spyOn(pairingApi, "getConfigCompare").mockResolvedValue(compare());
    renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose />);
    expect(await screen.findByText(/Compared with baseline target/)).toBeInTheDocument();
    expect(screen.getByText(/SAP standard baseline/)).toBeInTheDocument();
    expect(screen.getByText("T077K")).toBeInTheDocument();
  });

  it("proposes matches and reports the count", async () => {
    vi.spyOn(pairingApi, "getConfigCompare").mockResolvedValue(compare());
    const propose = vi.spyOn(pairingApi, "proposeConfigMatches").mockResolvedValue({ proposed: 1, skipped: 0, target: "S4D" });
    renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose />);
    fireEvent.click(await screen.findByRole("button", { name: "Propose matches" }));
    expect(propose).toHaveBeenCalledWith("sys1");
  });

  it("explains when the source has no configuration yet", async () => {
    vi.spyOn(pairingApi, "getConfigCompare").mockResolvedValue(compare({ source_load_id: null, objects: [] }));
    renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose={false} />);
    expect(await screen.findByText("Load this system's configuration to compare it with its target.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose matches" })).toBeNull();
  });
});
```

Create `frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/finding-context-panel.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { FindingContextPanel } from "../finding-context-panel";
import * as pairingApi from "@/lib/api/config-pairing";

describe("FindingContextPanel", () => {
  it("shows the object, the target and the missing keys", async () => {
    vi.spyOn(pairingApi, "getFindingContext").mockResolvedValue({
      object: "T077K", system_id: "s1", target_label: "S4D", baseline: false,
      source: ["KTOKK=KRED", "KTOKK=ZZZZ"], target: ["KTOKK=KRED"], missing: ["KTOKK=ZZZZ"], missing_total: 1,
    });
    renderWithQuery(<FindingContextPanel ruleId="AP-001" run="v1" module="accounts_payable" fields={[]} />);
    expect(await screen.findByText("T077K")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 source values are not configured in S4D\./)).toBeInTheDocument();
    expect(screen.getByText("KTOKK=ZZZZ")).toBeInTheDocument();
  });

  it("renders nothing without a config object", async () => {
    const spy = vi.spyOn(pairingApi, "getFindingContext").mockResolvedValue({
      object: null, system_id: null, target_label: "baseline target", baseline: true,
      source: [], target: [], missing: [], missing_total: 0,
    });
    const { container } = renderWithQuery(<FindingContextPanel ruleId="X" run="" module="m" fields={[]} />);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

If `renderWithQuery` does not return the Testing Library result, use `screen.queryByText("Configuration context")` being null instead of the `container` assertion.

In `frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx`:

- Add `import * as configPairingApi from "@/lib/api/config-pairing";`.
- Add `role: "source", target_system_id: null,` to the `SYSTEM` fixture.
- In `mockHappyPath`, add:

```tsx
  vi.spyOn(configPairingApi, "getConfigCompare").mockResolvedValue({
    source_load_id: null, target: { system_id: null, label: "baseline target", baseline: true }, objects: [], rows: [],
  });
```

- Add one test that the header shows the role:

```tsx
  it("shows the system role in the header", async () => {
    mockHappyPath();
    renderWithQuery(<SystemPage />);  // use the render call the other tests in this file use
    expect(await screen.findByText("Source system")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run "app/(app)/systems/[systemId]/__tests__" "app/(app)/objects/[object]/rules/[ruleId]/__tests__"`
Expected: FAIL. `Failed to resolve import "../config-compare-panel"` and `"../finding-context-panel"`, and the page test cannot find "Source system".

- [ ] **Step 3: Implement**

Create `frontend/app/(app)/systems/[systemId]/config-compare-panel.tsx`:

```tsx
"use client";

/**
 * Source/target configuration comparison for one system: per-object counts, the rows of the
 * selected object and a Propose button that sends key and description matches to the steward queue.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, EmptyState, ErrorState, Mono, Pill, Skeleton, type PillTone } from "@/design";
import { getConfigCompare, proposeConfigMatches, type MatchStatus } from "@/lib/api/config-pairing";
import { queryKeys } from "@/lib/query-keys";

const STATUS_LABEL: Record<MatchStatus, string> = {
  exists: "In target",
  key_match: "Key match",
  desc_match: "Description match",
  missing: "Missing",
};
const STATUS_TONE: Record<MatchStatus, PillTone> = {
  exists: "go",
  key_match: "at-risk",
  desc_match: "at-risk",
  missing: "no-go",
};

export function ConfigComparePanel({ systemId, canPropose }: { systemId: string; canPropose: boolean }) {
  const qc = useQueryClient();
  const [object, setObject] = useState<string | undefined>(undefined);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: queryKeys.configCompare(systemId, object),
    queryFn: () => getConfigCompare(systemId, object),
  });
  const propose = useMutation({
    mutationFn: () => proposeConfigMatches(systemId),
    onSuccess: (r) => {
      toast.success(r.proposed ? `${r.proposed} matches sent to the steward queue.` : "No new matches to propose.");
      void qc.invalidateQueries({ queryKey: ["config-compare", systemId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Matches were not proposed."),
  });

  let body;
  if (isPending) {
    body = <Skeleton className="h-24" />;
  } else if (error) {
    body = <ErrorState message={`The comparison could not be read. ${error.message}`} onRetry={() => void refetch()} />;
  } else if (!data.source_load_id) {
    body = <EmptyState title="Load this system's configuration to compare it with its target." />;
  } else if (data.objects.length === 0) {
    body = <EmptyState title="The source and the target share no configuration objects." />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <table className="w-full text-[13px]" style={{ color: "var(--m-ink)" }}>
          <thead>
            <tr style={{ color: "var(--m-ink-2)" }}>
              <th className="text-left font-medium">Object</th>
              <th className="text-right font-medium">In target</th>
              <th className="text-right font-medium">Key match</th>
              <th className="text-right font-medium">Description match</th>
              <th className="text-right font-medium">Missing</th>
            </tr>
          </thead>
          <tbody>
            {data.objects.map((o) => (
              <tr key={o.object} className="border-t" style={{ borderColor: "var(--m-line)" }}>
                <td>
                  <button type="button" className="underline" onClick={() => setObject(o.object)}>
                    <Mono>{o.object}</Mono>
                  </button>
                </td>
                <td className="text-right">{o.exists}</td>
                <td className="text-right">{o.key_match}</td>
                <td className="text-right">{o.desc_match}</td>
                <td className="text-right" style={{ color: o.missing ? "var(--m-critical)" : "var(--m-ink)" }}>{o.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {object && data.rows.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}><Mono>{object}</Mono> values</p>
            {data.rows.map((r) => (
              <div key={r.source_key} className="flex items-center justify-between gap-2 rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}>
                <span className="flex items-center gap-2">
                  <Mono>{r.source_key}</Mono>
                  {r.target_key && r.target_key !== r.source_key ? <span style={{ color: "var(--m-ink-2)" }}>to <Mono>{r.target_key}</Mono></span> : null}
                </span>
                <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>
            Compared with {data?.target.label ?? "the target"}
          </p>
          {data?.target.baseline ? (
            <p className="text-[12px]" style={{ color: "var(--m-medium)" }}>
              The target is the SAP standard baseline, so differences are flagged, not blocking.
            </p>
          ) : null}
        </div>
        {canPropose && data?.source_load_id ? (
          <Button variant="secondary" disabled={propose.isPending} onClick={() => propose.mutate()}>Propose matches</Button>
        ) : null}
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}
```

If `Skeleton` takes different props, match the usage elsewhere on the system page.

Create `frontend/app/(app)/objects/[object]/rules/[ruleId]/finding-context-panel.tsx`:

```tsx
"use client";

/** The source and target configuration behind a rule: the config object, the target and the source keys it lacks. */

import { useQuery } from "@tanstack/react-query";
import { Mono, Pill } from "@/design";
import { getFindingContext } from "@/lib/api/config-pairing";
import { queryKeys } from "@/lib/query-keys";

export function FindingContextPanel({ ruleId, run, module, fields }: {
  ruleId: string; run: string; module: string; fields: string[];
}) {
  const { data } = useQuery({
    queryKey: queryKeys.findingContext(ruleId, run),
    queryFn: () => getFindingContext({ ruleId, module, versionId: run || undefined, fields }),
  });
  if (!data || !data.object || data.source.length === 0) return null;
  return (
    <div className="rounded border p-3 text-[13px]" style={{ borderColor: "var(--m-line)", color: "var(--m-ink)" }}>
      <div className="flex items-center gap-2">
        <span className="font-medium">Configuration context</span>
        <Mono>{data.object}</Mono>
        {data.baseline ? <Pill tone="neutral">Baseline target</Pill> : null}
      </div>
      <p className="mt-1" style={{ color: "var(--m-ink-2)" }}>
        {data.missing_total} of {data.source.length} source values are not configured in {data.target_label}.
      </p>
      {data.missing.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.missing.map((k) => <Mono key={k}>{k}</Mono>)}
        </div>
      ) : null}
    </div>
  );
}
```

In `frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx`, import `FindingContextPanel` from `./finding-context-panel` and, in the success branch, insert it as the first child of `<div className="flex flex-col gap-4 p-6">`, before the `<p>`:

```tsx
      <FindingContextPanel
        ruleId={ruleId}
        run={run}
        module={data.records[0]?.module ?? ""}
        fields={Object.keys(data.records[0]?.field_values ?? {})}
      />
```

In `frontend/app/(app)/systems/[systemId]/page.tsx`:

1. Import `ConfigComparePanel` from `./config-compare-panel`.
2. In the header, change the subtitle line to start with the role:

```tsx
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
            <Pill tone="neutral">{system.role === "target" ? "Target system" : "Source system"}</Pill>{" "}
            {labelOf(system.system_type)}, {system.environment}.{" "}
            {system.last_sync_at ? `Last extraction ${relativeTime(system.last_sync_at)}.` : "Nothing extracted yet."}
          </p>
```

3. Pass the target candidates to the form:

```tsx
        <EditForm
          system={system}
          targets={(systemsQ.data ?? []).filter((s) => s.role === "target" && s.id !== system.id)}
          onDone={() => { setEditOpen(false); refresh(); }}
          onDeleted={() => { setEditOpen(false); refresh(); router.push("/systems"); }}
        />
```

4. In Health, after `<ConfigLoadPanel ... />`, add `<ConfigComparePanel systemId={id} canPropose={canSync} />`.
5. In `EditForm`:
   - Extend the props: `system: { id: string; name: string; environment: "PRD" | "QAS" | "DEV"; description: string | null; is_active: boolean; role: "source" | "target"; target_system_id: string | null };` and `targets: { id: string; name: string }[];`.
   - Add state:

```tsx
  const [role, setRole] = useState<"source" | "target">(system.role);
  const [target, setTarget] = useState<string>(system.target_system_id ?? "none");
```

   - Change the save call to:

```tsx
    mutationFn: () => updateSystem(system.id, {
      name: name.trim(), environment, description, is_active: active, role,
      ...(role === "source" ? { target_system_id: target === "none" ? "" : target } : {}),
    }),
```

   - After the Environment field, add:

```tsx
      <Field label="Role">
        <Select
          value={role}
          onValueChange={(v) => setRole(v === "target" ? "target" : "source")}
          options={[{ value: "source", label: "Source" }, { value: "target", label: "Target" }]}
        />
      </Field>
      {role === "source" ? (
        <Field label="Target">
          <Select
            value={target}
            onValueChange={setTarget}
            options={[{ value: "none", label: "None (SAP standard baseline)" }, ...targets.map((t) => ({ value: t.id, label: t.name }))]}
          />
        </Field>
      ) : null}
```

In `frontend/app/(app)/systems/page.tsx`, add this column after the Type column:

```tsx
    { accessorKey: "role", header: "Role", cell: ({ row }) => <Pill tone="neutral">{row.original.role === "target" ? "Target" : "Source"}</Pill> },
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: PASS (3 compare-panel tests, 2 context-panel tests, 1 new page test; the full suite is green).

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(app)/systems/[systemId]/config-compare-panel.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/finding-context-panel.tsx" "frontend/app/(app)/systems/[systemId]/page.tsx" "frontend/app/(app)/systems/page.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx" "frontend/app/(app)/systems/[systemId]/__tests__/config-compare-panel.test.tsx" "frontend/app/(app)/objects/[object]/rules/[ruleId]/__tests__/finding-context-panel.test.tsx" "frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx"
git commit -m "feat(frontend): source/target role and target, config comparison, finding context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

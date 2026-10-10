# Ownership and Rule Lineage Implementation Plan

> **Migration numbering (controller ruling):** this plan's migration is 074 (down_revision 073); read every 070 below as 074 and 069 as 073. It runs after the match pipeline plan. Run `alembic heads` before writing a migration and adjust if the head moved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every object, rule and system a named owner and steward. Route triage work to those owners before the tenant's fallback owner. Show a rule's lineage (fields, targets, tables, joins, glossary terms, owners) on the rule page. Delete the legacy record-lineage route that shadows the new one.

**Architecture:**
- Data:
  - Migration 070 adds `data_owners` (`kind` is `object`, `rule` or `system`; one row per tenant, kind and ref) with tenant RLS. Field ownership stays on `glossary_terms.data_steward_id`.
- Backend:
  - `api/routes/glossary.py` gains `GET /api/v1/owners` (view) and `PUT /api/v1/owners` (assign), plus a shared `owner_rows()` reader.
  - `api/services/triage.py`: after the assignment rules, `plan()` tries the item's owner candidates in order (rule steward, rule owner, object steward, object owner, glossary steward), then the fallback owner. The candidate SQL loads the candidates; the issue-event note says which path assigned the item.
  - `api/routes/lineage.py` gains `GET /api/v1/lineage/rule/{check_id}` over `raw_rules()`, `rule_columns()`, `target_columns()` and the `joins.yaml` edge graph.
  - The legacy `GET /api/v1/lineage/{object_type}/{record_key}` in `api/routes/contracts.py` and `api/services/lineage_service.py` are deleted, with their frontend client and types.
- Frontend:
  - `lib/api/owners.ts` and `components/owners/OwnerPicker.tsx` (read-only text when the viewer cannot list assignable users).
  - An owner picker on `objects/[object]`.
  - A "Lineage and ownership" section on `rules/[ruleId]`, which also fixes the check id passed to "Where it applies" and the drill link.
  - `/search` finds glossary terms.

**Tech Stack:** FastAPI, SQLAlchemy `text()` SQL on Postgres with RLS, Alembic, pytest, Next.js, React Query, `@/design`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-monitoring-migration-breadth-design.md`, section 3b only (lines 133-152).

**Depends on:** the match pipeline plan (`docs/superpowers/plans/2026-10-10-match-pipeline.md`) Task 2, which adds migration 069. Implement this plan after it.

**Global constraints:**
- No `any` in TypeScript and no `Any` in new Python signatures. Narrow API data with types; do not use `as` casts on API data.
- Never add to the `lint:tokens` allowlist. Use design tokens only: `var(--m-ink)`, `var(--m-ink-2)`, `var(--m-ink-3)`, `var(--m-line)`, `var(--m-pass)`, `var(--m-critical)`, `var(--m-accent)`.
- No customer names in code, tests, fixtures or commit messages. Use neutral names such as `PRD`, `S4D` and `Wave 1`.
- Rule IDs are append-only. This plan adds no rules.
- Migration 070 revises `"069"` and must downgrade cleanly.
- Every new table gets tenant RLS (`ENABLE` + `FORCE` + a `tenant_id = current_setting('app.tenant_id')::uuid` policy), and every tenant-scoped ORM model needs an RLS migration (`tests/test_rls_conformance.py`). The conformance test is static: the `DataOwner` model plus the literal `ALTER TABLE data_owners ENABLE ROW LEVEL SECURITY` in migration 070 covers the new table, so `tests/test_rls_conformance.py` needs no edit. Task 1 runs it.
- Times shown to users are in SAST with the zone label. This plan shows no times.
- The eslint copy rules apply. Do not use "Cancel", "Submit", "OK", "Error", "Loading", "dashboard", "click here", "Oops" or "Sorry" in UI copy. Verdict sentences end with a full stop.
- The UI uses Aurora (`@/design`) only. Import charts from `@/design`, never from `recharts`. Only `PageHeader` renders an `h1`.
- This spec section asks for no report, so this plan adds no Excel or PDF export.
- Implementers do not run `npm run build`.
- Backend test command: `python3 -m pytest <file> -q -p no:cacheprovider`. Postgres tests skip unless `MERIDIAN_TEST_DB_URL` is set. Run them with `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test`.
- Frontend gate, for every frontend task: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`. `npm test` runs `vitest run`.
- Frontend tests live in `__tests__/` next to the file under test. Component tests use `renderWithQuery` from `@/__tests__/render`.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

**Spec corrections (verified against the code at ab493477):**
1. **`/owners` path.** The glossary router has `prefix="/api/v1"` (`api/routes/glossary.py:25`), so the new endpoints are `GET` and `PUT /api/v1/owners`. The existing `GET /owners` at `api/routes/insights.py:133` is under `prefix="/api/v1/insights"` (`insights.py:21`). It serves the owner scorecards (`/api/v1/insights/owners`), so the paths do not collide and the scorecards are unchanged.
2. **The lineage route does not go in `glossary.py`.** The spec puts only `/owners` there. `GET /lineage/rule/{check_id}` goes in `api/routes/lineage.py` (`prefix="/api/v1/lineage"`, line 20) next to the other lineage routes.
3. **A legacy route shadows the new one.** `api/routes/contracts.py:280` registers `GET /api/v1/lineage/{object_type}/{record_key}`, and `api/main.py:301` mounts the contracts router before the lineage router (`main.py:325`). Starlette takes the first match, so today `/api/v1/lineage/rule/AP084` and also `/api/v1/lineage/impact/{version_id}` (`lineage.py:196`) reach the contracts route. This was verified with `route.matches()` against `api.main.app`. The spec lists `api/services/lineage_service.py` as a candidate deletion; Task 4 deletes it and the contracts route, which fixes both paths.
4. **The rule page passes the wrong id.** `frontend/app/(app)/rules/[ruleId]/page.tsx` passes `data.id` (the `rules` row UUID) to `WhereItApplies` (line 125) and to `DrillLink` (line 151). Both expect the check id (`getRuleApplicability(checkId, module)`; `buildDrillHref` builds `/objects/{object}/rules/{checkId}`, the route the object page links to with `row.check_id`). Rule names are `"{check id}: {message}"` (`api/routes/rules.py:637`, `:495`), so Task 6 takes the check id from the name prefix.
5. **`/search` covers rules but not glossary terms.** `frontend/app/(app)/search/page.tsx:29-33` queries `getRules({ search: q })`; there is no glossary query. Task 6 adds one.
6. **Spec line references.** `rule_columns` is at `checks/runner.py:195` and `target_columns` at `checks/runner.py:202`, as the spec says. The join graph is `checks/frames.py:_graph()` (line 50) over `sap/dictionaries/joins.yaml`; there is no public wrapper, so Task 4 imports `_graph` and `tables_of` (line 78).

**Rulings (decisions this plan makes where the spec is silent):**
1. **Assignment rules still win.** The owner order runs only when no assignment rule matches, or when the rule's target is inactive. A tenant that configured rules keeps its routing.
2. **Steward before owner.** Within each kind the steward is tried before the owner: the steward does the day-to-day fixing. An inactive or missing user falls through to the next candidate.
3. **The `system` kind is stored but not used by triage.** Work items carry no system id (`record_issues.scope` is a scope label, not a `sap_systems.id`). The API accepts `system` so a later system page can use it.
4. **Queue items use object owners only.** `stewardship_queue.item_type` is not a rule id, so only `kind = 'object'` with `ref = stewardship_queue.domain` applies, and there is no glossary step.
5. **Write access.** `PUT /api/v1/owners` needs the `assign` permission (admin, manager, steward; `api/services/rbac.py:42-57`). `GET` needs `view`. The picker lists users from `/api/v1/users/assignable`, which also needs `assign` (`api/routes/users.py:40`); when that call fails the picker shows read-only text.
6. **Clearing.** A `PUT` with both ids `null` keeps the row with no owner and no steward. Nothing deletes a `data_owners` row; the table is small.
7. **Validation.** Owner and steward must be active users of the caller's tenant, otherwise `422`. Refs are not validated against the rule catalogue or the module list: a mined rule id or a new module is a valid ref.
8. **Custom and mined rules have no lineage.** They are not in the shipped YAML that `raw_rules()` reads, so `GET /api/v1/lineage/rule/{check_id}` returns `404` for them. The rule page shows "Lineage is shown for built-in rules only." when `data.source !== "yaml"`, and the owner picker still shows.
9. **Assignment notes.** Issue events say "auto-assigned by rule: {name}", "auto-assigned to fallback owner" or, new, "auto-assigned to data owner".
10. **No Excel or PDF export.** The spec asks for no report.
11. **The insights scorecard `/owners` is unchanged** (see Spec correction 1). It ranks owners from findings and is not the `data_owners` table.

---

## File map

| File | Change | Task |
|---|---|---|
| `db/migrations/versions/070_data_owners.py` | new: `data_owners` with RLS | 1 |
| `db/schema.py` | `DataOwner` model after `GlossaryTermRule` | 1 |
| `tests/test_data_owners_pg.py` | new: constraints, RLS, downgrade; Task 2 appends the route test | 1, 2 |
| `api/routes/glossary.py` | `owner_rows()`, `OwnerUpdate`, `GET` and `PUT /owners` | 2 |
| `api/services/triage.py` | owner order in `plan()`, owner candidates in `_CANDIDATES`, notes, guard | 3 |
| `tests/test_triage_sla.py` | `test_plan_tries_owners_before_fallback` | 3 |
| `tests/test_triage_sla_pg.py` | `test_auto_assign_owner_order` | 3 |
| `api/routes/lineage.py` | `GET /rule/{check_id}` | 4 |
| `api/routes/contracts.py` | delete the legacy lineage route | 4 |
| `api/services/lineage_service.py` | delete | 4 |
| `frontend/lib/api/contracts.ts` | delete `getLineage` and the `LineageGraph` import | 4 |
| `frontend/types/api.ts` | delete the legacy Lineage block | 4 |
| `tests/test_lineage.py` | route registration, shadowing, rule lineage | 4 |
| `frontend/lib/api/owners.ts` | new: `OwnerKind`, `DataOwner`, `getOwners`, `putOwner` | 5 |
| `frontend/lib/query-keys.ts` | `owners`, `ruleLineage` | 5, 6 |
| `frontend/components/owners/OwnerPicker.tsx` | new | 5 |
| `frontend/components/owners/__tests__/OwnerPicker.test.tsx` | new | 5 |
| `frontend/app/(app)/objects/[object]/page.tsx` | owner picker above the report | 5 |
| `frontend/app/(app)/objects/[object]/__tests__/page.test.tsx` | owner picker test | 5 |
| `frontend/lib/api/lineage.ts` | `RuleLineage`, `getRuleLineage` | 6 |
| `frontend/app/(app)/rules/[ruleId]/page.tsx` | check id fix, "Lineage and ownership" section | 6 |
| `frontend/app/(app)/rules/[ruleId]/__tests__/page.test.tsx` | lineage tests | 6 |
| `frontend/lib/search.ts` | `glossary` result kind | 6 |
| `frontend/app/(app)/search/page.tsx` | glossary query | 6 |
| `frontend/app/(app)/search/__tests__/page.test.tsx` | glossary result test | 6 |

---

### Task 1: Migration 070: the `data_owners` table

**Files:**
- Create: `db/migrations/versions/070_data_owners.py`
- Modify: `db/schema.py`. Add `DataOwner` after `GlossaryTermRule` (ends at line 1674), before `StewardshipQueueItem` (line 1677).
- Test: `tests/test_data_owners_pg.py` (new)

**Interfaces:**
- Consumes: `tenants`, `users`.
- Produces: table `data_owners (id, tenant_id, kind, ref, owner_user_id, steward_user_id, created_at, updated_at)`, check `ck_data_owners_kind`, unique `uq_data_owners_kind_ref (tenant_id, kind, ref)`, policy `data_owners_rls`. ORM class `db.schema.DataOwner`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_data_owners_pg.py`:

```python
"""data_owners against a real Postgres: constraints, tenant RLS as a non-superuser role,
migration 070 downgrade, and the /api/v1/owners routes.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_owners_app"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    import subprocess

    r = subprocess.run(["alembic", *args], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def engines():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}'")).scalar():
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


def _tenant(owner, users: list[str], inactive: tuple[str, ...] = ()) -> tuple[str, dict[str, str]]:
    """Tenant + named users. Returns (tid, {name: user id})."""
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    ids = {n: str(uuid.uuid4()) for n in users}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Owners')"), {"t": tid})
        for n, i in ids.items():
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                           "VALUES (:i, :t, :e, :n, 'steward', :a)"),
                      {"i": i, "t": tid, "e": f"{n}-{i[:8]}@example.test", "n": n, "a": n not in inactive})
    return tid, ids


_INSERT = "INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) VALUES (:t, :k, 'AP001', :u)"


def test_data_owners_constraints_and_rls(engines):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError, IntegrityError

    owner, app = engines
    t1, u1 = _tenant(owner, ["ann"])
    t2, _ = _tenant(owner, ["bob"])

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
        c.execute(text(_INSERT), {"t": t1, "k": "rule", "u": u1["ann"]})
    with pytest.raises(IntegrityError):  # one row per (tenant, kind, ref)
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
            c.execute(text(_INSERT), {"t": t1, "k": "rule", "u": u1["ann"]})
    with pytest.raises(IntegrityError):  # field ownership stays in the glossary
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
            c.execute(text(_INSERT), {"t": t1, "k": "field", "u": u1["ann"]})

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t2})
        assert c.execute(text("SELECT COUNT(*) FROM data_owners")).scalar() == 0
    with pytest.raises(DBAPIError, match="row-level security"):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t2})
            c.execute(text(_INSERT), {"t": t1, "k": "object", "u": None})


def test_migration_070_downgrades_cleanly(engines):
    from sqlalchemy import text

    owner, _ = engines
    _alembic("downgrade", "069")
    with owner.connect() as c:
        assert c.execute(text("SELECT to_regclass('data_owners')")).scalar() is None
    _alembic("upgrade", "head")
    with owner.begin() as c:
        assert c.execute(text("SELECT relforcerowsecurity FROM pg_class WHERE relname = 'data_owners'")).scalar()
        # the table was recreated by the owner: give the app role access again for later tests
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_data_owners_pg.py -q -p no:cacheprovider`
Expected: FAIL. `relation "data_owners" does not exist` in `test_data_owners_constraints_and_rls`.

- [ ] **Step 3: Write the migration**

Create `db/migrations/versions/070_data_owners.py`:

```python
"""data owners

Revision ID: 070
Revises: 069
Create Date: 2026-10-10

A named owner and steward per object (module id), rule (check id) or system.
Triage auto-assign uses them before the tenant's fallback owner. Field ownership
stays on glossary_terms.data_steward_id.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "070"
down_revision: Union[str, None] = "069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_owners",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=False),
        sa.Column("owner_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("steward_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('object', 'rule', 'system')", name="ck_data_owners_kind"),
        sa.UniqueConstraint("tenant_id", "kind", "ref", name="uq_data_owners_kind_ref"),
    )
    op.execute("ALTER TABLE data_owners ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE data_owners FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS data_owners_rls ON data_owners")
    op.execute("CREATE POLICY data_owners_rls ON data_owners "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS data_owners_rls ON data_owners")
    op.drop_table("data_owners")
```

- [ ] **Step 4: Add the ORM model**

In `db/schema.py`, insert after the `GlossaryTermRule` class (after line 1674) and before `class StewardshipQueueItem` (`CheckConstraint`, `UniqueConstraint`, `text` and `UUID` are already imported, lines 15-31):

```python
class DataOwner(Base):
    """Owner and steward of an object (module id), a rule (check id) or a system.
    Field ownership stays on GlossaryTerm.data_steward_id."""
    __tablename__ = "data_owners"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    kind = Column(Text, nullable=False)
    ref = Column(Text, nullable=False)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    steward_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("kind IN ('object', 'rule', 'system')", name="ck_data_owners_kind"),
        UniqueConstraint("tenant_id", "kind", "ref", name="uq_data_owners_kind_ref"),
    )
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_data_owners_pg.py -q -p no:cacheprovider`
Expected: PASS (2).

Run: `python3 -m pytest tests/test_rls_conformance.py -q -p no:cacheprovider`
Expected: PASS. `data_owners` is covered by the model and the literal `ENABLE ROW LEVEL SECURITY`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/versions/070_data_owners.py db/schema.py tests/test_data_owners_pg.py
git commit -m "feat(db): data_owners table for object, rule and system owners

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 2: `GET` and `PUT /api/v1/owners`

**Files:**
- Modify: `api/routes/glossary.py` (docstring lines 1-9, imports lines 11-23, append after `batch_lookup`, which starts at line 571 and is the last route)
- Test: `tests/test_data_owners_pg.py` (append)

**Interfaces:**
- Consumes: `data_owners` (Task 1), `users`, `require_permission` (`api/services/rbac.py`).
- Produces:
  - `owner_rows(db, tid, where, params) -> list[dict]`: rows of `{kind, ref, owner_user_id, owner_name, steward_user_id, steward_name, updated_at}`, ordered by kind and ref. `where` is a trusted SQL fragment over alias `d`; values go in `params`. Task 4 reuses it.
  - `GET /api/v1/owners?kind=object|rule|system` (`view`): `{"owners": [row, ...]}`.
  - `PUT /api/v1/owners` (`assign`), body `{kind, ref, owner_user_id, steward_user_id}`: upserts one row and returns it. `422` for an unknown kind, a malformed id, or a user who is not an active user of the tenant.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_data_owners_pg.py`:

```python
def test_owner_routes(engines):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.glossary import router

    owner, app_eng = engines
    tid, u = _tenant(owner, ["ann", "bob", "gone"], inactive=("gone",))
    other, ou = _tenant(owner, ["xen"])

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    current = {"tid": tid}
    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(current["tid"]), "Owners", [])
    steward, analyst = {"X-User-Role": "steward"}, {"X-User-Role": "analyst"}
    url = "/api/v1/owners"

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as c:
            body = {"kind": "rule", "ref": "AP001", "owner_user_id": u["ann"], "steward_user_id": u["bob"]}
            assert (await c.put(url, json=body, headers=analyst)).status_code == 403

            r = await c.put(url, json=body, headers=steward)
            assert r.status_code == 200, r.text
            assert (r.json()["owner_name"], r.json()["steward_name"]) == ("ann", "bob")

            # a second PUT replaces the row
            r = await c.put(url, json={**body, "owner_user_id": u["bob"], "steward_user_id": None}, headers=steward)
            assert (r.json()["owner_name"], r.json()["steward_name"]) == ("bob", None)
            rows = (await c.get(url, params={"kind": "rule"}, headers=analyst)).json()["owners"]
            assert [(o["ref"], o["owner_user_id"], o["steward_user_id"]) for o in rows] == [("AP001", u["bob"], None)]
            assert (await c.get(url, params={"kind": "object"}, headers=analyst)).json()["owners"] == []

            assert (await c.get(url, params={"kind": "field"}, headers=analyst)).status_code == 422
            for bad in ({**body, "owner_user_id": "x"},            # not a uuid
                        {**body, "owner_user_id": u["gone"]},      # inactive
                        {**body, "owner_user_id": ou["xen"]}):     # another tenant's user
                assert (await c.put(url, json=bad, headers=steward)).status_code == 422

            current["tid"] = other
            assert (await c.get(url, headers=analyst)).json()["owners"] == []

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"
    try:
        asyncio.run(main())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_data_owners_pg.py -q -p no:cacheprovider -k routes`
Expected: FAIL. The analyst `PUT` returns `405` (no `/api/v1/owners` route), so `assert ... == 403` fails.

- [ ] **Step 3: Implement**

In `api/routes/glossary.py`, add to the docstring endpoint list (after the `batch-lookup` line):

```
  GET   /owners                    — data owners and stewards per object, rule or system
  PUT   /owners                    — set one owner and steward (assign permission)
```

Replace the imports `from typing import Optional` and `from pydantic import BaseModel` with:

```python
from typing import Literal, Optional
```

```python
from pydantic import BaseModel, Field
```

Append after `batch_lookup`:

```python
# ── Data owners (object / rule / system; field ownership stays on the terms) ──

OwnerKind = Literal["object", "rule", "system"]

_OWNER_SQL = """
    SELECT d.kind, d.ref, d.owner_user_id::text AS owner_user_id, o.name AS owner_name,
           d.steward_user_id::text AS steward_user_id, s.name AS steward_name, d.updated_at
      FROM data_owners d
      LEFT JOIN users o ON o.id = d.owner_user_id
      LEFT JOIN users s ON s.id = d.steward_user_id
     WHERE d.tenant_id = :tid AND ({where})
     ORDER BY d.kind, d.ref"""


async def owner_rows(db: AsyncSession, tid: str, where: str, params: dict[str, str]) -> list[dict]:
    """Owner rows of the tenant. ``where`` is a trusted fragment over alias ``d``; values go in params."""
    rows = (await db.execute(text(_OWNER_SQL.format(where=where)), {"tid": tid, **params})).mappings().all()
    return [{**r, "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None} for r in rows]


class OwnerUpdate(BaseModel):
    kind: OwnerKind
    ref: str = Field(min_length=1, max_length=200)
    owner_user_id: Optional[uuid.UUID] = None
    steward_user_id: Optional[uuid.UUID] = None


@router.get("/owners")
async def list_owners(
    kind: Optional[OwnerKind] = Query(None),
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    tid = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tid}'"))
    if kind:
        return {"owners": await owner_rows(db, tid, "d.kind = :kind", {"kind": kind})}
    return {"owners": await owner_rows(db, tid, "true", {})}


@router.put("/owners")
async def put_owner(
    body: OwnerUpdate,
    role: str = Depends(require_permission("assign")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    tid = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tid}'"))
    wanted = {u for u in (body.owner_user_id, body.steward_user_id) if u}
    if wanted:
        found = {r[0] for r in (await db.execute(
            text("SELECT id FROM users WHERE tenant_id = :tid AND is_active AND id = ANY(CAST(:ids AS uuid[]))"),
            {"tid": tid, "ids": list(wanted)})).all()}
        if found != wanted:
            raise HTTPException(status_code=422, detail="owner and steward must be active users of this tenant")
    await db.execute(text("""
        INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id, steward_user_id)
        VALUES (:tid, :kind, :ref, :owner, :steward)
        ON CONFLICT (tenant_id, kind, ref) DO UPDATE
           SET owner_user_id = EXCLUDED.owner_user_id, steward_user_id = EXCLUDED.steward_user_id,
               updated_at = now()"""),
        {"tid": tid, "kind": body.kind, "ref": body.ref,
         "owner": body.owner_user_id, "steward": body.steward_user_id})
    # Read before commit: after commit the pooled connection may no longer carry app.tenant_id.
    rows = await owner_rows(db, tid, "d.kind = :kind AND d.ref = :ref", {"kind": body.kind, "ref": body.ref})
    await db.commit()
    return rows[0]
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_data_owners_pg.py -q -p no:cacheprovider`
Expected: PASS (3).

Run: `python3 -m pytest tests -q -p no:cacheprovider -k glossary`
Expected: PASS. The existing glossary route tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add api/routes/glossary.py tests/test_data_owners_pg.py
git commit -m "feat(api): GET and PUT /api/v1/owners for object, rule and system owners

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 3: Triage routes work to owners before the fallback owner

**Files:**
- Modify: `api/services/triage.py`:
  - docstring lines 10-13;
  - `plan()` lines 199-220;
  - `_CANDIDATES` lines 250-266;
  - `write_assignments()` lines 295-326;
  - `auto_assign()` lines 329-356.
- Test: `tests/test_triage_sla.py` (append), `tests/test_triage_sla_pg.py` (append)

**Interfaces:**
- Consumes: `data_owners` (Task 1), `glossary_terms.data_steward_id`, `glossary_term_rules (term_id, rule_id)`.
- Produces:
  - Items passed to `plan()` may carry `owners: list[str]`, user ids in order of preference. `plan()` uses them after the assignment rules and before the fallback.
  - Issue candidate order: rule steward, rule owner, object steward, object owner, glossary steward (first term by business name). Queue candidate order: object steward, object owner.
  - `write_assignments(..., fallback: Optional[str] = None)`.
  - `auto_assign()` also runs for a tenant with no rules and no fallback when it has `data_owners` rows or glossary stewards.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_triage_sla.py` (after `test_plan_routes_rules_teams_and_fallback`, which ends at line 95):

```python
def test_plan_tries_owners_before_fallback():
    rules = [{"id": "r-user", "match": {"severity": ["critical"]}, "assign_user_id": U3}]
    items = [{"id": "a", "severity": "low", "owners": [U1, U2]},   # U1 inactive → next owner
             {"id": "b", "severity": "low", "owners": [U1]},       # no active owner → fallback
             {"id": "c", "severity": "low"},                       # no owners → fallback
             {"id": "d", "severity": "critical", "owners": [U2]},  # a rule still wins
             {"id": "e", "severity": "low", "owners": [U3, U2]}]   # first active owner
    out = plan(items, rules, {}, {U2, U3, FB}, {}, FB)
    assert out == [("a", U2, None, None), ("b", FB, None, None), ("c", FB, None, None),
                   ("d", U3, None, "r-user"), ("e", U3, None, None)]
```

Append to `tests/test_triage_sla_pg.py`:

```python
def test_auto_assign_owner_order(engines):
    from sqlalchemy import text

    from api.services import triage

    owner, app = engines
    tid, u, vid = _tenant(owner, ["rule_owner", "obj_steward", "gloss", "fb", "gone"], inactive=("gone",))
    with _session(app, tid) as s:
        for kind, ref, own, stw in (("rule", "AP-9", u["rule_owner"], None),
                                    ("object", "accounts_payable", None, u["obj_steward"]),
                                    ("object", "material_master", u["gone"], None)):
            s.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id, steward_user_id) "
                           "VALUES (:t, :k, :r, :o, :s)"), {"t": tid, "k": kind, "r": ref, "o": own, "s": stw})
        term = s.execute(text(
            "INSERT INTO glossary_terms (tenant_id, domain, sap_table, sap_field, technical_name, business_name, "
            "data_steward_id) VALUES (:t, 'fi_gl', 'SKA1', 'SAKNR', 'SKA1.SAKNR', 'G/L account', :g) RETURNING id"),
            {"t": tid, "g": u["gloss"]}).scalar()
        s.execute(text("INSERT INTO glossary_term_rules (tenant_id, term_id, rule_id, domain) "
                       "VALUES (:t, :term, 'GL-1', 'fi_gl')"), {"t": tid, "term": term})
        s.execute(text("INSERT INTO triage_settings (tenant_id, fallback_user_id) VALUES (:t, :f)"),
                  {"t": tid, "f": u["fb"]})
        for check, module in (("AP-9", "accounts_payable"), ("AP-8", "accounts_payable"),
                              ("GL-1", "fi_gl"), ("MM-1", "material_master")):
            _issue(s, tid, vid, check, f"KEY={check}", module=module)
        s.commit()

    with _session(app, tid) as s:
        assert triage.auto_assign(s, tid)["issue"] == 4
        s.commit()
    got = dict(_rows(app, tid, "SELECT check_id, assigned_to::text FROM record_issues "
                               "WHERE tenant_id = CAST(:t AS uuid)", t=tid))
    assert got == {"AP-9": u["rule_owner"],   # rule owner beats the object steward
                   "AP-8": u["obj_steward"],  # object steward
                   "GL-1": u["gloss"],        # glossary steward of the rule's term
                   "MM-1": u["fb"]}           # object owner inactive → fallback
    notes = sorted(r[0] for r in _rows(app, tid, "SELECT note FROM record_issue_events "
                                                 "WHERE tenant_id = CAST(:t AS uuid) AND action = 'assign'", t=tid))
    assert notes == ["auto-assigned to data owner"] * 3 + ["auto-assigned to fallback owner"]

    # A tenant with owners but no rules and no fallback is still routed.
    t2, u2, v2 = _tenant(owner, ["own"])
    with _session(app, t2) as s:
        s.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) "
                       "VALUES (:t, 'object', 'accounts_payable', :o)"), {"t": t2, "o": u2["own"]})
        _issue(s, t2, v2, "AP-2", "LIFNR=1")
        s.commit()
    with _session(app, t2) as s:
        assert triage.auto_assign(s, t2)["issue"] == 1
        s.commit()
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python3 -m pytest tests/test_triage_sla.py -q -p no:cacheprovider -k owners`
Expected: FAIL. Item `a` goes to `FB`, not `U2`.

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_triage_sla_pg.py -q -p no:cacheprovider -k owner_order`
Expected: FAIL. `AP-9` is assigned to `fb`.

- [ ] **Step 3: Implement**

In `api/services/triage.py`, replace docstring lines 10-13 (from "1. auto_assign" to "Idempotent: only rows with assigned_at NULL.") with:

```
  1. auto_assign      unassigned, never-assigned items go through the ordered assignment
                      rules (first match wins) to a user or a team (round_robin or
                      least_loaded inside the team); no match / inactive target goes to the
                      rule owner, the object owner, the glossary steward, then the tenant's
                      fallback owner (data_owners: steward before owner within each kind).
                      Idempotent: only rows with assigned_at NULL.
```

In `plan()`, replace:

```python
        if uid is None:
            uid, team_id = (fallback if fallback in active else None), None
```

with:

```python
        if uid is None:
            team_id = None
            uid = next((o for o in it.get("owners") or () if o in active), None)
        if uid is None:
            uid = fallback if fallback in active else None
```

Replace `_CANDIDATES` (lines 250-266) with:

```python
# Owner candidates, best first: rule before object, steward (1) before owner (2) within a kind.
_OWNERS = """ARRAY(SELECT v.u::text FROM data_owners d
                  CROSS JOIN LATERAL (VALUES (1, d.steward_user_id), (2, d.owner_user_id)) v(o, u)
                 WHERE d.tenant_id = {t}.tenant_id AND v.u IS NOT NULL AND ({match})
                 ORDER BY d.kind = 'rule' DESC, v.o)"""

_CANDIDATES = {
    "issue": f"""
        SELECT ri.id::text AS id, ri.module, ri.check_id, ri.severity, f.dimension, ri.record_key,
               {_OWNERS.format(t="ri", match="(d.kind = 'rule' AND d.ref = ri.check_id) "
                                             "OR (d.kind = 'object' AND d.ref = ri.module)")} AS owners,
               (SELECT gt.data_steward_id::text FROM glossary_term_rules gtr
                  JOIN glossary_terms gt ON gt.id = gtr.term_id
                 WHERE gtr.tenant_id = ri.tenant_id AND gtr.rule_id = ri.check_id
                   AND gt.data_steward_id IS NOT NULL
                 ORDER BY gt.business_name LIMIT 1) AS glossary_steward
          FROM record_issues ri
          LEFT JOIN LATERAL (SELECT f.dimension, f.affected_count FROM findings f WHERE f.version_id = ri.last_seen_version
                             AND f.check_id = ri.check_id AND f.tenant_id = ri.tenant_id LIMIT 1) f ON true
         WHERE ri.tenant_id = CAST(:tid AS uuid) AND ri.status NOT IN {_TERM_SQL}
           AND ri.assigned_at IS NULL AND ri.assigned_to IS NULL
         ORDER BY ri.severity = 'critical' DESC, ri.severity = 'high' DESC, ri.first_seen_at LIMIT :cap""",
    "queue": f"""
        SELECT sq.id::text AS id, sq.domain AS module, sq.item_type AS check_id, {_QUEUE_SEV} AS severity,
               NULL AS dimension, NULL AS record_key,
               {_OWNERS.format(t="sq", match="d.kind = 'object' AND d.ref = sq.domain")} AS owners,
               NULL AS glossary_steward
          FROM stewardship_queue sq
         WHERE sq.tenant_id = CAST(:tid AS uuid) AND sq.status NOT IN {_TERM_SQL}
           AND sq.assigned_at IS NULL AND sq.assigned_to IS NULL
         ORDER BY sq.priority, sq.created_at LIMIT :cap""",
}

_HAS_OWNERS = """
    SELECT EXISTS (SELECT 1 FROM data_owners WHERE tenant_id = CAST(:tid AS uuid))
        OR EXISTS (SELECT 1 FROM glossary_terms WHERE tenant_id = CAST(:tid AS uuid)
                    AND data_steward_id IS NOT NULL)"""
```

In `write_assignments()`, change the signature to:

```python
def write_assignments(session, tid: str, kind: str, rows: list[tuple], label: str = "system",
                      actor: Optional[str] = None, note: Optional[str] = None, only_unassigned: bool = True,
                      fallback: Optional[str] = None) -> int:
```

Replace the issue note expression:

```python
                   upd.uid::text, COALESCE(:note, CASE WHEN r.name IS NOT NULL THEN 'auto-assigned by rule: ' || r.name
                                                      ELSE 'auto-assigned to fallback owner' END)
```

with:

```python
                   upd.uid::text, COALESCE(:note, CASE WHEN r.name IS NOT NULL THEN 'auto-assigned by rule: ' || r.name
                                                      WHEN upd.uid = CAST(:fallback AS uuid)
                                                      THEN 'auto-assigned to fallback owner'
                                                      ELSE 'auto-assigned to data owner' END)
```

and add `"fallback": fallback` to the `p` dict:

```python
    p = {"tid": tid, "ids": [r[0] for r in rows], "users": [r[1] for r in rows], "teams": [r[2] for r in rows],
         "rules": [r[3] for r in rows], "label": label, "actor": actor, "note": note, "fallback": fallback}
```

The manual assign route (`api/routes/triage.py:648`) passes `note=`, so its events are unchanged.

In `auto_assign()`, replace the guard:

```python
    if not rules and not settings["fallback"]:
        return {"issue": 0, "queue": 0}
```

with:

```python
    if not rules and not settings["fallback"] and not session.execute(text(_HAS_OWNERS), {"tid": tid}).scalar():
        return {"issue": 0, "queue": 0}
```

Replace the candidate loop and the `write_assignments` call:

```python
        for r in session.execute(text(_CANDIDATES[kind]), {"tid": tid, "cap": BATCH}):
            it = dict(r._mapping)
            it.update(org_values(it.pop("record_key")))
            items.append(it)
        out[kind] = write_assignments(session, tid, kind, plan(items, rules, teams, active, load,
                                                               settings["fallback"]))
```

with:

```python
        for r in session.execute(text(_CANDIDATES[kind]), {"tid": tid, "cap": BATCH}):
            it = dict(r._mapping)
            it.update(org_values(it.pop("record_key")))
            it["owners"] = [o for o in (*(it.pop("owners") or ()), it.pop("glossary_steward")) if o]
            items.append(it)
        out[kind] = write_assignments(session, tid, kind, plan(items, rules, teams, active, load,
                                                               settings["fallback"]),
                                      fallback=settings["fallback"])
```

`owners` and `glossary_steward` are popped into one list, so rule matching (`rule_matches`) never sees them as match keys.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_triage_sla.py -q -p no:cacheprovider`
Expected: PASS. `test_plan_routes_rules_teams_and_fallback` passes unchanged: its items carry no owners.

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_triage_sla_pg.py -q -p no:cacheprovider`
Expected: PASS (3). `test_assign_sla_escalate_pause` passes unchanged: its tenant has no `data_owners` rows.

- [ ] **Step 5: Commit**

```bash
git add api/services/triage.py tests/test_triage_sla.py tests/test_triage_sla_pg.py
git commit -m "feat(triage): route work to rule, object and glossary owners before the fallback owner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 4: `GET /api/v1/lineage/rule/{check_id}`, and delete the legacy record lineage

**Files:**
- Modify: `api/routes/lineage.py` (imports lines 7-18; append after `get_guards`, the last route, at line 279)
- Modify: `api/routes/contracts.py`. Line 1 docstring; delete lines 277-299 (the "6. GET /api/v1/lineage/..." comment and `get_lineage_graph`). `Query` stays imported: line 249 uses it.
- Delete: `api/services/lineage_service.py` (its only importer is `contracts.py:290`)
- Modify: `frontend/lib/api/contracts.ts`. Delete `getLineage` (lines 69-79) and `LineageGraph,` from the type import (line 6).
- Modify: `frontend/types/api.ts`. Delete the `/* ─── Lineage ─── */` block (lines 415-433). Its only user is `contracts.ts`; the lineage explorer uses the types in `frontend/lib/api/lineage.ts`.
- Test: `tests/test_lineage.py`

**Interfaces:**
- Consumes: `raw_rules()` (`api/services/tenant_seed.py:29`), `rule_columns()` and `target_columns()` (`checks/runner.py:195`, `:202`), `_graph()` and `tables_of()` (`checks/frames.py:50`, `:78`), `owner_rows()` (Task 2), `glossary_term_rules`, `glossary_terms`.
- Produces: `GET /api/v1/lineage/rule/{check_id}` returning:
  ```
  {check_id, module, fields: [TABLE.FIELD], targets: [TABLE.FIELD], tables: [TABLE],
   joins: [{parent, child, on: [[parent_field, child_field]], cardinality}],
   glossary_terms: [{id, business_name, sap_table, sap_field}],
   owners: [owner row of the rule and of its object]}
  ```
  `404` when the check id is not a shipped YAML rule.

- [ ] **Step 1: Write the failing tests**

In `tests/test_lineage.py`, replace `test_lineage_routes_registered` (line 153) with:

```python
def test_lineage_routes_registered():
    from starlette.routing import Match

    from api.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    paths |= {x.path for r in app.routes if hasattr(r, "original_router") for x in r.original_router.routes}
    assert {"/api/v1/lineage/model", "/api/v1/lineage/graph", "/api/v1/lineage/impact/{version_id}",
            "/api/v1/lineage/blast-radius/{version_id}/{check_id}", "/api/v1/lineage/guards",
            "/api/v1/lineage/rule/{check_id}"} <= paths
    assert "/api/v1/lineage/{object_type}/{record_key}" not in paths  # legacy record lineage is gone

    # Nothing registered earlier shadows the lineage routes.
    for path, want in (("/api/v1/lineage/rule/AP084", "/api/v1/lineage/rule/{check_id}"),
                       ("/api/v1/lineage/impact/x", "/api/v1/lineage/impact/{version_id}")):
        scope = {"type": "http", "path": path, "method": "GET", "root_path": ""}
        hit = next(r for r in app.router.routes if r.matches(scope)[0] == Match.FULL)
        assert getattr(hit, "path", "") == want
```

Append after `test_impact_route_scopes_by_tenant`:

```python
def test_rule_lineage_route():
    import asyncio
    import uuid

    from fastapi import HTTPException

    from api.deps import Tenant
    from api.routes.lineage import get_rule_lineage

    tid = uuid.UUID("00000000-0000-0000-0000-0000000000ab")
    db = _FakeDB([])
    out = asyncio.run(get_rule_lineage("AP084", db=db, tenant=Tenant(tid, "t", [])))
    assert out["module"] == "accounts_payable"
    assert out["fields"] == ["LFB1.LNRZE"]
    assert out["targets"] == ["LFA1.LIFNR", "LFA1.LOEVM"]
    assert out["tables"] == ["LFB1", "LFA1"]
    assert out["joins"] == [{"parent": "LFA1", "child": "LFB1", "on": [["LIFNR", "LIFNR"]], "cardinality": "many"}]
    assert out["glossary_terms"] == [] and out["owners"] == []
    assert any(s.startswith(f"SET app.tenant_id = '{tid}'") for s, _ in db.sql)
    assert any("gtr.tenant_id = :tid" in s and p.get("cid") == "AP084" for s, p in db.sql)
    assert any("FROM data_owners d" in s and p.get("module") == "accounts_payable" for s, p in db.sql)

    try:
        asyncio.run(get_rule_lineage("NOPE999", db=_FakeDB([]), tenant=Tenant(tid, "t", [])))
        raise AssertionError("expected 404")
    except HTTPException as e:
        assert e.status_code == 404
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python3 -m pytest tests/test_lineage.py -q -p no:cacheprovider -k "registered or rule_lineage"`
Expected: FAIL (2). `ImportError: cannot import name 'get_rule_lineage'`, and the registration test fails because `/api/v1/lineage/rule/{check_id}` is missing.

- [ ] **Step 3: Implement the route**

In `api/routes/lineage.py`, add after `from api.services import lineage as svc` (line 18):

```python
from api.routes.glossary import owner_rows
from api.services.tenant_seed import raw_rules
from checks.frames import _graph, tables_of
from checks.runner import rule_columns, target_columns
```

Append after `get_guards`:

```python
@router.get("/rule/{check_id}")
async def get_rule_lineage(
    check_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """What a shipped rule reads (fields, lookup targets, tables, joins.yaml edges between
    them), its glossary terms and the owners of the rule and of its object."""
    hit = next(((m, r) for _, _, m, r in raw_rules() if r["id"] == check_id), None)
    if hit is None:
        raise HTTPException(status_code=404, detail="rule not found")
    module, rule = hit
    fields, targets = rule_columns(rule), target_columns(rule)
    tables = tables_of(fields + targets)
    joins = [{"parent": e.parent, "child": e.child, "on": [list(p) for p in e.on], "cardinality": e.cardinality}
             for e in _graph()[0] if e.parent in tables and e.child in tables]
    tid = await _tenant(db, tenant)
    terms = (await db.execute(text("""
        SELECT gt.id::text AS id, gt.business_name, gt.sap_table, gt.sap_field
          FROM glossary_term_rules gtr JOIN glossary_terms gt ON gt.id = gtr.term_id
         WHERE gtr.tenant_id = :tid AND gtr.rule_id = :cid
         ORDER BY gt.business_name"""), {"tid": tid, "cid": check_id})).mappings().all()
    owners = await owner_rows(db, tid, "(d.kind = 'rule' AND d.ref = :cid) OR (d.kind = 'object' AND d.ref = :module)",
                              {"cid": check_id, "module": module})
    return {"check_id": check_id, "module": module, "fields": fields, "targets": targets, "tables": tables,
            "joins": joins, "glossary_terms": [dict(t) for t in terms], "owners": owners}
```

- [ ] **Step 4: Delete the legacy record lineage**

In `api/routes/contracts.py`, change line 1 to:

```python
"""Data contracts API routes."""
```

and delete lines 277-299, from `# ── 6. GET /api/v1/lineage/{object_type}/{record_key} — data lineage ────────` to the end of `get_lineage_graph` (`return result`), with the blank lines before the comment.

Delete the file:

```bash
git rm api/services/lineage_service.py
```

In `frontend/lib/api/contracts.ts`, change the type import to:

```ts
import type {
  ContractListResponse,
  Contract,
  ComplianceHistoryResponse,
} from "@/types/api";
```

and delete the whole `getLineage` function (lines 69-79).

In `frontend/types/api.ts`, delete lines 415-433: the `/* ─── Lineage ─── */` comment and the `LineageNode`, `LineageEdge` and `LineageGraph` interfaces, keeping one blank line before `/* ─── Contracts ─── */`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_lineage.py -q -p no:cacheprovider`
Expected: PASS. `/api/v1/lineage/impact/x` now reaches the impact route.

Run: `grep -rn "lineage_service\|get_lineage_graph" api tests workers`
Expected: no output.

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: PASS. Nothing imports the deleted types or `contracts.getLineage`.

- [ ] **Step 6: Commit**

```bash
git add api/routes/lineage.py api/routes/contracts.py tests/test_lineage.py frontend/lib/api/contracts.ts frontend/types/api.ts
git commit -m "feat(lineage): rule lineage route; delete the record lineage that shadowed it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 5: Owner picker, on the object page

**Files:**
- Create: `frontend/lib/api/owners.ts`
- Modify: `frontend/lib/query-keys.ts` (add before `alertChannels`, line 140)
- Create: `frontend/components/owners/OwnerPicker.tsx`
- Test: `frontend/components/owners/__tests__/OwnerPicker.test.tsx` (new)
- Modify: `frontend/app/(app)/objects/[object]/page.tsx` (the returned `ReportPage`)
- Test: `frontend/app/(app)/objects/[object]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `GET` and `PUT /api/v1/owners` (Task 2); `getAssignableUsers()` (`frontend/lib/api/users.ts:35`); `queryKeys.usersAssignable()` (`query-keys.ts:113`); `Field`, `Select`, `Skeleton`, `ErrorState` from `@/design`.
- Produces:
  - `OwnerKind`, `DataOwner`, `getOwners(kind)`, `putOwner(body)` in `lib/api/owners.ts`.
  - `queryKeys.owners(kind)`.
  - `<OwnerPicker kind refId />`: two selects ("Owner", "Steward") when the viewer can list assignable users, otherwise the text "Owner: {name}. Steward: {name}." or "No owner set.".

- [ ] **Step 1: Write the failing tests**

Create `frontend/components/owners/__tests__/OwnerPicker.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as ownersApi from "@/lib/api/owners";
import type { DataOwner } from "@/lib/api/owners";
import * as usersApi from "@/lib/api/users";
import { OwnerPicker } from "../OwnerPicker";

const ROW: DataOwner = {
  kind: "rule", ref: "AP001", owner_user_id: "u1", owner_name: "Ann", steward_user_id: null,
  steward_name: null, updated_at: "2026-10-10T08:00:00+00:00",
};

describe("OwnerPicker", () => {
  it("shows the owner as text when the viewer cannot assign", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([ROW]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    renderWithQuery(<OwnerPicker kind="rule" refId="AP001" />);
    await waitFor(() => expect(screen.getByText("Owner: Ann. Steward: not set.")).toBeInTheDocument());
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says when no owner is set", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([{ ...ROW, ref: "AP002" }]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    renderWithQuery(<OwnerPicker kind="rule" refId="AP001" />);
    await waitFor(() => expect(screen.getByText("No owner set.")).toBeInTheDocument());
  });

  it("saves the picked owner", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([
      { id: "u1", name: "Ann", email: "ann@example.test", role: "steward" },
    ]);
    const put = vi.spyOn(ownersApi, "putOwner").mockResolvedValue(ROW);
    renderWithQuery(<OwnerPicker kind="rule" refId="AP001" />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Owner" }));
    const option = await screen.findByRole("option", { name: "Ann" });
    await waitFor(() => expect(option.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(option);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({ kind: "rule", ref: "AP001", owner_user_id: "u1", steward_user_id: null }),
    );
  });
});
```

In `frontend/app/(app)/objects/[object]/__tests__/page.test.tsx`, change the vitest import to:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
```

add after `import * as objectsApi from "@/lib/api/v1/objects";`:

```tsx
import * as ownersApi from "@/lib/api/owners";
import * as usersApi from "@/lib/api/users";
```

and add inside `describe("ObjectDetailPage", () => {`, before the first `it`:

```tsx
  beforeEach(() => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
  });

  it("shows the object's owner above the report", async () => {
    vi.spyOn(objectsApi, "getObject").mockResolvedValue({
      module: "material_master", label: "Material Master", composite_score: null, readiness: null,
      failing_checks: 0, affected_records: 0, dimension_scores: {}, rules: [],
    });
    renderWithQuery(<ObjectDetailPage />);
    await waitFor(() => expect(screen.getByText("No owner set.")).toBeInTheDocument());
    expect(ownersApi.getOwners).toHaveBeenCalledWith("object");
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run components/owners "app/(app)/objects/[object]"`
Expected: FAIL. `Failed to resolve import "@/lib/api/owners"`.

- [ ] **Step 3: Implement**

Create `frontend/lib/api/owners.ts`:

```ts
import apiClient from "./client";

export type OwnerKind = "object" | "rule" | "system";

export interface DataOwner {
  kind: OwnerKind;
  ref: string;
  owner_user_id: string | null;
  owner_name: string | null;
  steward_user_id: string | null;
  steward_name: string | null;
  updated_at: string | null;
}

export async function getOwners(kind: OwnerKind): Promise<DataOwner[]> {
  const { data } = await apiClient.get<{ owners: DataOwner[] }>("/api/v1/owners", { params: { kind } });
  return data.owners;
}

export async function putOwner(body: {
  kind: OwnerKind;
  ref: string;
  owner_user_id: string | null;
  steward_user_id: string | null;
}): Promise<DataOwner> {
  const { data } = await apiClient.put<DataOwner>("/api/v1/owners", body);
  return data;
}
```

In `frontend/lib/query-keys.ts`, add before `alertChannels: () => ["alert-channels"] as const,`:

```ts
  owners: (kind: string) => ["owners", kind] as const,
```

Create `frontend/components/owners/OwnerPicker.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState, Field, Select, Skeleton } from "@/design";
import { getOwners, putOwner, type OwnerKind } from "@/lib/api/owners";
import { getAssignableUsers } from "@/lib/api/users";
import { queryKeys } from "@/lib/query-keys";

// Base UI Select treats "" as no value, so "not set" is a sentinel.
const NONE = "none";

export function OwnerPicker({ kind, refId }: { kind: OwnerKind; refId: string }) {
  const qc = useQueryClient();
  const owners = useQuery({
    queryKey: queryKeys.owners(kind),
    queryFn: () => getOwners(kind),
    retry: false,
    meta: { ignoreError: true },
  });
  // Listing users needs the assign permission; without it the picker is read-only.
  const users = useQuery({
    queryKey: queryKeys.usersAssignable(),
    queryFn: getAssignableUsers,
    retry: false,
    meta: { ignoreError: true },
  });
  const row = owners.data?.find((o) => o.ref === refId);
  const save = useMutation({
    mutationFn: (patch: { owner_user_id?: string | null; steward_user_id?: string | null }) =>
      putOwner({
        kind,
        ref: refId,
        owner_user_id: row?.owner_user_id ?? null,
        steward_user_id: row?.steward_user_id ?? null,
        ...patch,
      }),
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: queryKeys.owners(kind) });
    },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });

  if (owners.isLoading || users.isLoading) return <Skeleton height={32} />;
  if (owners.isError) return <ErrorState message="Owners could not be read." onRetry={() => owners.refetch()} />;
  if (users.isError || !users.data) {
    return (
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        {row && (row.owner_name || row.steward_name)
          ? `Owner: ${row.owner_name ?? "not set"}. Steward: ${row.steward_name ?? "not set"}.`
          : "No owner set."}
      </p>
    );
  }
  const options = [{ value: NONE, label: "Not set" }, ...users.data.map((u) => ({ value: u.id, label: u.name }))];
  const picked = (v: string) => (v === NONE ? null : v);
  return (
    <div className="flex flex-wrap gap-4">
      <Field label="Owner">
        <Select
          value={row?.owner_user_id ?? NONE}
          onValueChange={(v) => save.mutate({ owner_user_id: picked(v) })}
          options={options}
        />
      </Field>
      <Field label="Steward">
        <Select
          value={row?.steward_user_id ?? NONE}
          onValueChange={(v) => save.mutate({ steward_user_id: picked(v) })}
          options={options}
        />
      </Field>
    </div>
  );
}
```

In `frontend/app/(app)/objects/[object]/page.tsx`, add after `import { getObject, type ObjectRule } from "@/lib/api/v1/objects";`:

```tsx
import { OwnerPicker } from "@/components/owners/OwnerPicker";
```

and wrap the returned `ReportPage` (the `ReportPage` narrative renders inside a `<p>`, so the picker cannot go there):

```tsx
  return (
    <div className="flex flex-col">
      <div className="px-6 pt-6">
        <OwnerPicker kind="object" refId={object} />
      </div>
      <ReportPage
        narrative={narrative}
        charts={<Bar data={dimensionPoints} />}
        tables={
          <DataTable
            columns={columns}
            data={rulesRanked}
            getRowId={(row) => row.check_id}
            onRowClick={(row) => router.push(`/objects/${object}/rules/${row.check_id}?run=${run}`)}
          />
        }
        state={state}
        emptyProps={emptyProps}
        errorProps={{
          message: `Couldn't load this object. ${error?.message ?? ""}`.trim(),
          onRetry: () => refetch(),
        }}
      />
    </div>
  );
```

- [ ] **Step 4: Run the gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: PASS. The three `OwnerPicker` tests and the four object page tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api/owners.ts frontend/lib/query-keys.ts frontend/components/owners "frontend/app/(app)/objects/[object]"
git commit -m "feat(ui): owner picker, shown on the object page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 6: "Lineage and ownership" on the rule page, and glossary terms in search

**Files:**
- Modify: `frontend/lib/api/lineage.ts` (append)
- Modify: `frontend/lib/query-keys.ts` (add before `alertChannels`)
- Modify: `frontend/app/(app)/rules/[ruleId]/page.tsx`
- Test: `frontend/app/(app)/rules/[ruleId]/__tests__/page.test.tsx`
- Modify: `frontend/lib/search.ts` (line 3)
- Modify: `frontend/app/(app)/search/page.tsx`
- Test: `frontend/app/(app)/search/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/lineage/rule/{check_id}` (Task 4), `OwnerPicker` and `DataOwner` (Task 5), `getGlossaryTerms` (`frontend/lib/api/glossary.ts:9`), `queryKeys.glossary` (`query-keys.ts:52`). The glossary term route `/mdm/glossary/[id]` exists.
- Produces: `RuleLineage`, `getRuleLineage(checkId)`, `queryKeys.ruleLineage(checkId)`; search result kind `"glossary"`.

- [ ] **Step 1: Write the failing tests**

In `frontend/app/(app)/rules/[ruleId]/__tests__/page.test.tsx`, change the vitest import to:

```tsx
import { vi, beforeEach, describe, it, expect } from "vitest";
```

add after `import type { RuleApplicability } from "@/lib/api/config-load";`:

```tsx
import * as lineageApi from "@/lib/api/lineage";
import type { RuleLineage } from "@/lib/api/lineage";
import * as ownersApi from "@/lib/api/owners";
import * as usersApi from "@/lib/api/users";
```

add after the `APPLICABILITY` constant:

```tsx
const LINEAGE: RuleLineage = {
  check_id: "AP001",
  module: "business_partner",
  fields: ["LFB1.LNRZE"],
  targets: ["LFA1.LIFNR"],
  tables: ["LFB1", "LFA1"],
  joins: [{ parent: "LFA1", child: "LFB1", on: [["LIFNR", "LIFNR"]], cardinality: "many" }],
  glossary_terms: [{ id: "g1", business_name: "Vendor number", sap_table: "LFA1", sap_field: "LIFNR" }],
  owners: [],
};
```

add inside `describe("rule detail page", () => {`, before the first `it`:

```tsx
  beforeEach(() => {
    vi.spyOn(lineageApi, "getRuleLineage").mockResolvedValue(LINEAGE);
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
  });
```

and append inside the `describe`:

```tsx
  it("shows lineage and ownership by check id", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("LFB1.LNRZE")).toBeInTheDocument());
    expect(configLoadApi.getRuleApplicability).toHaveBeenCalledWith("AP001", "business_partner");
    expect(lineageApi.getRuleLineage).toHaveBeenCalledWith("AP001");
    expect(screen.getByText("LFA1 → LFB1 on LIFNR")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vendor number" })).toHaveAttribute("href", "/mdm/glossary/g1");
    expect(screen.getByRole("link", { name: "See failing records" })).toHaveAttribute(
      "href", "/objects/business_partner/rules/AP001",
    );
    await waitFor(() => expect(screen.getByText("No owner set.")).toBeInTheDocument());
  });

  it("explains that custom rules have no lineage", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue({ ...RULE, source: "custom" });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("Lineage is shown for built-in rules only.")).toBeInTheDocument());
    expect(lineageApi.getRuleLineage).not.toHaveBeenCalled();
  });
```

In `frontend/app/(app)/search/__tests__/page.test.tsx`, change the vitest import to:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
```

add after `import * as versionsApi from "@/lib/api/versions";`:

```tsx
import * as glossaryApi from "@/lib/api/glossary";
```

add inside `describe("SearchPage", () => {`, before the first `it`:

```tsx
  beforeEach(() => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 20 });
  });
```

and append inside the `describe`:

```tsx
  it("finds glossary terms", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [], total: 0, limit: 100, offset: 0 });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(cleaningApi, "getCleaningQueue").mockResolvedValue({ items: [], total: 0, page: 1, per_page: 500 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "", objects: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({
      terms: [{
        id: "g1", sap_table: "BUT000", sap_field: "NAME_ORG1", technical_name: "BUT000.NAME_ORG1",
        business_name: "Business partner name", domain: "business_partner", mandatory_for_s4hana: true,
        status: "active", ai_drafted: false, last_reviewed_at: null, review_cycle_days: 90, linked_rules_count: 2,
      }],
      total: 1, page: 1, per_page: 20,
    });

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText("Business partner name")).toBeInTheDocument());
    expect(glossaryApi.getGlossaryTerms).toHaveBeenCalledWith({ search: "business" });
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run "app/(app)/rules/[ruleId]" "app/(app)/search"`
Expected: FAIL. `getRuleLineage` does not exist on `@/lib/api/lineage`, and "Business partner name" is not found.

- [ ] **Step 3: Implement the lineage client**

Append to `frontend/lib/api/lineage.ts`, and add `import type { DataOwner } from "./owners";` after `import apiClient from "./client";`:

```ts
export interface RuleLineage {
  check_id: string;
  module: string;
  fields: string[];
  targets: string[];
  tables: string[];
  joins: { parent: string; child: string; on: [string, string][]; cardinality: string }[];
  glossary_terms: { id: string; business_name: string; sap_table: string; sap_field: string }[];
  owners: DataOwner[];
}

export async function getRuleLineage(checkId: string): Promise<RuleLineage> {
  const { data } = await apiClient.get<RuleLineage>(`/api/v1/lineage/rule/${encodeURIComponent(checkId)}`);
  return data;
}
```

In `frontend/lib/query-keys.ts`, add before `alertChannels: () => ["alert-channels"] as const,`:

```ts
  ruleLineage: (checkId: string) => ["rule-lineage", checkId] as const,
```

- [ ] **Step 4: Implement the rule page section**

In `frontend/app/(app)/rules/[ruleId]/page.tsx`, replace the imports above `const APPLIES_TONE` with:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, EmptyState, ErrorState, Mono, Pill, Skeleton } from "@/design";
import { OwnerPicker } from "@/components/owners/OwnerPicker";
import { getRule, updateRule } from "@/lib/api/rules";
import { getRuleApplicability, type SystemApplicability } from "@/lib/api/config-load";
import { getRuleLineage } from "@/lib/api/lineage";
import { checkClassLabel, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
```

Add this component after `WhereItApplies` and before `export default function RulePage()`:

```tsx
function LineageRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt style={{ color: "var(--m-ink-3)" }}>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function columnList(cols: string[]): ReactNode {
  if (!cols.length) return "—";
  return cols.map((c, i) => (
    <span key={c}>
      {i ? ", " : ""}
      <Mono>{c}</Mono>
    </span>
  ));
}

function LineageAndOwnership({ checkId, builtIn }: { checkId: string; builtIn: boolean }) {
  const q = useQuery({
    queryKey: queryKeys.ruleLineage(checkId),
    queryFn: () => getRuleLineage(checkId),
    enabled: builtIn,
    retry: false,
    meta: { ignoreError: true },
  });
  const objectOwner = q.data?.owners.find((o) => o.kind === "object");

  let body: ReactNode;
  if (!builtIn) {
    body = <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Lineage is shown for built-in rules only.</p>;
  } else if (q.isLoading) {
    body = <Skeleton height={96} />;
  } else if (q.isError || !q.data) {
    body = <ErrorState message="Lineage for this rule could not be read." onRetry={() => q.refetch()} />;
  } else {
    const l = q.data;
    body = (
      <dl className="flex flex-col gap-1 text-[13px]">
        <LineageRow label="Fields">{columnList(l.fields)}</LineageRow>
        <LineageRow label="Targets">{columnList(l.targets)}</LineageRow>
        <LineageRow label="Tables">{columnList(l.tables)}</LineageRow>
        <LineageRow label="Joins">
          {l.joins.length
            ? l.joins.map((j) => `${j.parent} → ${j.child} on ${j.on.map(([a, b]) => (a === b ? a : `${a} = ${b}`)).join(", ")}`).join("; ")
            : "—"}
        </LineageRow>
        <LineageRow label="Glossary terms">
          {l.glossary_terms.length
            ? l.glossary_terms.map((t, i) => (
                <span key={t.id}>
                  {i ? ", " : ""}
                  <Link href={`/mdm/glossary/${t.id}`}>{t.business_name}</Link>
                </span>
              ))
            : "—"}
        </LineageRow>
        <LineageRow label="Object owner">
          {objectOwner?.owner_name ?? objectOwner?.steward_name ?? "not set"}
        </LineageRow>
      </dl>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold">Lineage and ownership</h2>
      {body}
      <OwnerPicker kind="rule" refId={checkId} />
    </section>
  );
}
```

In `RulePage`, add after the error guard (`if (isError || !data) return <ErrorState ... />;`):

```tsx
  // Rule names are "{check id}: {message}"; data.id is the rules row UUID, not the check id.
  const checkId = data.name.split(":")[0];
```

Replace:

```tsx
      <WhereItApplies checkId={data.id} module={data.module} />
```

with:

```tsx
      <WhereItApplies checkId={checkId} module={data.module} />

      <LineageAndOwnership checkId={checkId} builtIn={data.source === "yaml"} />
```

Replace:

```tsx
        <DrillLink object={data.module} ruleId={data.id}>See failing records</DrillLink>
```

with:

```tsx
        <DrillLink object={data.module} ruleId={checkId}>See failing records</DrillLink>
```

- [ ] **Step 5: Implement glossary search**

In `frontend/lib/search.ts`, change line 3 to:

```ts
  kind: "object" | "material" | "rule" | "batch" | "run" | "glossary";
```

In `frontend/app/(app)/search/page.tsx`:

Add after `import { getCleaningQueue } from "@/lib/api/cleaning";`:

```tsx
import { getGlossaryTerms } from "@/lib/api/glossary";
```

Add after the `rules` query:

```tsx
  const glossary = useQuery({
    queryKey: queryKeys.glossary("search", { search: q }),
    queryFn: () => getGlossaryTerms({ search: q }),
    enabled: !!q,
  });
```

In the `candidates` memo, add after the rules loop:

```tsx
    for (const t of glossary.data?.terms ?? []) {
      out.push({ kind: "glossary", id: t.id, label: t.business_name, href: `/mdm/glossary/${t.id}` });
    }
```

and change the memo dependencies to:

```tsx
  }, [rules.data, glossary.data, systems.data, batches.data, objects.data, runs.data, run]);
```

Replace the `loading`, `failedQuery` and `refetchAll` lines with:

```tsx
  const loading = rules.isLoading || glossary.isLoading || systems.isLoading || batches.isLoading || runs.isLoading
    || (!!run && objects.isLoading);
  const failedQuery = [rules, glossary, systems, batches, objects, runs].find((query) => query.isError);
  const refetchAll = () => {
    void rules.refetch();
    void glossary.refetch();
    void systems.refetch();
    void batches.refetch();
    if (run) void objects.refetch();
    void runs.refetch();
  };
```

Change the input placeholder to:

```tsx
              placeholder="Object, rule, glossary term, batch or run id"
```

and the empty title to:

```tsx
      emptyProps={{ title: "No matches. Try an object id, a rule id, a glossary term, a batch id or a run id." }}
```

- [ ] **Step 6: Run the gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`
Expected: PASS. The five rule page tests and the four search tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/lineage.ts frontend/lib/query-keys.ts "frontend/app/(app)/rules/[ruleId]" frontend/lib/search.ts "frontend/app/(app)/search"
git commit -m "feat(ui): rule lineage and ownership section; glossary terms in search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Self-review

**Spec coverage (section 3b):**

| Spec bullet | Task |
|---|---|
| New table `data_owners` (tenant_id, kind object/rule/system, ref, owner_user_id, steward_user_id) | 1 |
| Unique on (tenant_id, kind, ref) | 1 (`uq_data_owners_kind_ref`, duplicate test) |
| Field ownership stays in the glossary | 1 (check constraint rejects `field`), 3 (glossary steward step) |
| GET and PUT /owners in `api/routes/glossary.py` | 2 |
| Triage order: rule owner, object owner, glossary steward, fallback | 3 |
| GET /lineage/rule/{check_id}: fields, targets, tables, joins, glossary terms, owners | 4 |
| Fields and targets from `rule_columns` / `target_columns`; joins from `joins.yaml` | 4 |
| UI: Lineage and ownership section on `rules/[ruleId]` | 6 |
| UI: owner picker on `objects/[object]` | 5 |
| /search covers glossary terms and rules | 6 (glossary added; rules already covered) |
| Candidate deletion: `api/services/lineage_service.py`, used by `contracts.py` | 4 |

**Placeholder scan:** no "TBD", "TODO", "similar to Task N" or "add tests for" lines. Every code step has the full code.

**Type consistency:**
- `owner_rows()` returns keys `kind, ref, owner_user_id, owner_name, steward_user_id, steward_name, updated_at`. These match `DataOwner` in `frontend/lib/api/owners.ts` and `RuleLineage.owners`.
- `OwnerKind` is `"object" | "rule" | "system"` in Python (`Literal`), in the migration check constraint and in TypeScript.
- `PUT` body field names (`kind`, `ref`, `owner_user_id`, `steward_user_id`) match `putOwner`'s argument and the `OwnerPicker` test expectation.
- `plan()` items carry `owners: list[str]`; `auto_assign` builds it from the `owners` array and `glossary_steward` columns that both `_CANDIDATES` selects return.
- `write_assignments(..., fallback=...)` is keyword-only in use; the one other caller (`api/routes/triage.py:648`) passes `note=` and is unaffected.
- The rule lineage `joins[].on` is `list[list[str]]` in Python and `[string, string][]` in TypeScript; each `Edge.on` pair is a 2-tuple (`checks/frames.py:54`).
- `queryKeys.owners(kind)` and `queryKeys.ruleLineage(checkId)` are added once each (Tasks 5 and 6), before `alertChannels`.
- Migration chain: 068 (cockpit head) ← 069 (match pipeline) ← 070 (this plan). Task 1's downgrade test targets `"069"`.

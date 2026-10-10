# Continuous Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the monitoring pieces that already exist into continuous monitoring. Alerts are scoped per system. The stale nightly re-score is removed. DQS history is kept per system. The UI shows trends, alert channels and the next scheduled run.

**Architecture:**
- Scheduling already runs through `sync_profiles`: `sync_profile_scheduler` then `run_sync` then `run_checks`. This plan does not add a second scheduler.
- Backend:
  - Alert queries in `workers/tasks/send_notifications.py` get a required source scope (a system id, or `'upload'`).
  - The nightly `daily_analysis` keeps only AI scoring and the dashboard cache.
  - `dqs_history` gains a `system_id` column (migration 067). `run_checks` upserts into it per system.
  - One new API route sends a test alert.
- Frontend:
  - A trend panel on the system Overview tab, built on the existing `getTrends` client.
  - An alert-channels panel in admin settings.
  - "Next run" and a trend arrow on the systems list.

**Tech Stack:** Celery, SQLAlchemy `text()` SQL on Postgres with RLS, Alembic, FastAPI, Next.js App Router, React Query, `@/design`, recharts (`Sparkline`), vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-10-10-monitoring-migration-breadth-design.md`, section 1 only.

**Global constraints:**
- No `any` types in TypeScript. Narrow with type guards; do not use `as` casts on API data.
- Never add to the `lint:tokens` allowlist. Use design tokens only: `var(--m-ink)`, `var(--m-ink-2)`, `var(--m-ink-3)`, `var(--m-line)`, `var(--m-pass)`, `var(--m-critical)`, `var(--m-accent)`.
- No customer names in code, tests, fixtures or commit messages. Use neutral system names such as `PRD` and `QAS`.
- Rule IDs are append-only. This plan adds no rules. The sample alert uses the placeholder `SAMPLE-001`, which is not a rule ID.
- Implementers do not run `npm run build`.
- Backend test command: `python3 -m pytest <file> -q -p no:cacheprovider`. Postgres tests skip unless `MERIDIAN_TEST_DB_URL` is set. Run them against a scratch database when one is available.
- Frontend gate, for every frontend task: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`. `npm test` runs `vitest run`.
- Tests live in `__tests__/` next to the file under test. Component tests use `renderWithQuery` from `@/__tests__/render`.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

**Spec corrections (verified against the code at 0a42afb9):**
1. **Unique key cast.** The new `dqs_history` unique key must use `COALESCE(system_id::text, 'upload')`. Without the `::text` cast, `COALESCE(uuid, 'upload')` fails because `'upload'` is not a uuid.
2. **"Upsert" changes the conflict action.** `run_checks.py:665` is `ON CONFLICT ... DO NOTHING` today, so the first run of the day wins. "Upsert" means `DO UPDATE`, so the latest run of the day wins. The conflict target must also match the new index.
3. **Alert-channel route lines.** The alert-channel routes are at `api/routes/notifications.py:163-200`, not 163-185. Delete ends at line 200.
4. **Stale migration comments.** The section comment at `send_notifications.py:481` and the comment at line 567 both say "migration 054". `alert_channels` was created in 057, so the spec is right. Task 1 fixes both comments.
5. **`getTrends` location.** `getTrends` is at `frontend/lib/api/system-objects.ts:118-124`. The trend types are at lines 47-80. The frontend `TrendFlag` is missing `"incomplete_extract"`, which the API emits (`system_objects.py:225`). `TrendPoint` is missing the `incomplete` field. Task 5 adds both.
6. **The trends endpoint does not read `dqs_history`.** It reads `analysis_versions`, so the trend panel does not depend on migration 067.
7. **SLA breaches cannot be split per system.** The `exceptions` table has no system or version column. A per-system digest therefore carries `sla_breaches = 0`. Exception SLA breaches go out as one tenant-level alert with no `system_name`.
8. **`daily_analysis` keeps two steps.** Besides `run_checks.delay` and the `dqs_history` insert, it also runs AI quality scoring and the Redis dashboard cache. Both stay. The `parquet_path` guard existed only for the re-score, so it goes too.
9. **Known ceiling, not fixed here.** Other `dqs_history` readers will see one row per system per module per day once 067 lands: the `daily_digest` forecasts (`scheduler.py:551`) and report PDFs. They are not changed in this plan.

---

## File map

| File | Change | Task |
|---|---|---|
| `workers/tasks/send_notifications.py` | `_completed` takes a scope; `_system_name`; immediate alert and digest are per system; `alert_text` names the system | 1 |
| `tests/test_alert_digest_pg.py` | new: per-system digest and immediate alert on Postgres, plus a pure `alert_text` test | 1 |
| `workers/scheduler.py` | `daily_analysis` no longer re-runs checks or writes `dqs_history` | 2 |
| `tests/test_daily_analysis.py` | new: `daily_analysis` enqueues nothing and writes no `dqs_history` | 2 |
| `db/migrations/versions/067_dqs_history_system.py` | new: `system_id` column and a per-system daily unique index | 3 |
| `db/schema.py` | `DqsHistory.system_id` | 3 |
| `workers/tasks/run_checks.py` | `DQS_HISTORY_UPSERT` per system, `DO UPDATE` | 3 |
| `tests/test_dqs_history_pg.py` | new: upsert per system and day | 3 |
| `api/routes/notifications.py` | `POST /api/v1/alert-channels/{id}/test` | 4 |
| `tests/test_alert_channel_test_route.py` | new | 4 |
| `frontend/lib/api/system-objects.ts` | `TrendFlag` gains `incomplete_extract`; `TrendPoint.incomplete` | 5 |
| `frontend/lib/query-keys.ts` | `systemTrends`, `alertChannels` | 5, 6 |
| `frontend/app/(app)/systems/[systemId]/trend-panel.tsx` | new | 5 |
| `frontend/app/(app)/systems/[systemId]/page.tsx` | Overview renders `TrendPanel` | 5 |
| `frontend/app/(app)/systems/[systemId]/__tests__/trend-panel.test.tsx` | new | 5 |
| `frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx` | stub `getTrends` | 5 |
| `frontend/lib/api/notifications.ts` | alert-channel client | 6 |
| `frontend/app/(app)/admin/settings/alert-channels-panel.tsx` | new | 6 |
| `frontend/app/(app)/admin/settings/page.tsx` | renders the panel for `manage_settings` | 6 |
| `frontend/app/(app)/admin/settings/__tests__/alert-channels-panel.test.tsx` | new | 6 |
| `frontend/app/(app)/admin/settings/__tests__/page.test.tsx` | stub `getAlertChannels` | 6 |
| `frontend/app/(app)/systems/_health.ts` | `dqsTrend`, `nextRun` | 7 |
| `frontend/app/(app)/systems/page.tsx` | "Next run" column and trend arrow | 7 |
| `frontend/app/(app)/systems/__tests__/health.test.ts` | new | 7 |
| `frontend/app/(app)/systems/__tests__/page.test.tsx` | stub `getSyncProfiles`, assert the new column | 7 |

---

### Task 1: Per-system alert scoping

**Files:**
- Modify: `workers/tasks/send_notifications.py`
- Test: `tests/test_alert_digest_pg.py` (new)

**Interfaces:**
- Consumes: `analysis_versions.metadata->>'system_id'`, `sap_systems.name`, `alert_channels` (057).
- Produces:
  - `_completed(session, scope, before=None, skip=None)`. `scope` is now required.
  - `_system_name(session, scope) -> str`.
  - Alerts carry an optional `system_name` key. `build_alert` is unchanged; callers add the key afterwards.
  - The digest sends one alert per system with a run in the window, plus one tenant-level SLA alert when exception SLAs were breached.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_alert_digest_pg.py`:

```python
"""Alerts compare runs of the same system (workers/tasks/send_notifications.py).

The Postgres part runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py).
Seed: two systems, each with a baseline run two days ago and a fresh run today.
  PRD  DQS 90 -> 70, CHK-X newly failing  -> score_drop + new_critical
  QAS  DQS 80 -> 80, CHK-X newly failing  -> new_critical only
PRD's fresh run is the tenant's newest, so the old tenant-wide lookup compared
QAS with PRD and reported one mixed alert.
"""

from __future__ import annotations

import json
import os
import uuid

import pytest

from workers.tasks import send_notifications as sn

_ROLE = "meridian_digest_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


def test_alert_text_names_the_system():
    a = sn.build_alert("daily", "v", None, None, {"AP001"}, 0, 5, "https://app")
    assert sn.alert_text(a).startswith("Meridian daily alert — ")
    a["system_name"] = "PRD"
    assert sn.alert_text(a).startswith("Meridian daily alert for PRD — ")


@pytest.fixture(scope="module")
def app_engine():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
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


def _version(c, tid, sid, score, interval):
    from sqlalchemy import text

    vid = str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                   "(:v, :t, 'complete', now() - CAST(:i AS interval), CAST(:m AS jsonb), CAST(:q AS jsonb))"),
              {"v": vid, "t": tid, "i": interval, "m": json.dumps({"system_id": sid}),
               "q": json.dumps({"accounts_payable": {"composite_score": score}})})
    return vid


def _critical(c, tid, vid, check_id):
    from sqlalchemy import text

    c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                   "affected_count, total_count, details) VALUES (:v, :t, 'accounts_payable', :c, 'critical', "
                   "'validity', 3, 10, '{}'::jsonb)"), {"v": vid, "t": tid, "c": check_id})


@pg
def test_digest_and_immediate_alert_are_per_system(app_engine, monkeypatch):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    owner, app = app_engine
    tid, prd, qas = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-digest')"), {"t": tid})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:p, :t, 'PRD'), (:q, :t, 'QAS')"),
                  {"p": prd, "q": qas, "t": tid})
        _version(c, tid, prd, 90.0, "2 days")
        prd_cur = _version(c, tid, prd, 70.0, "1 hour")
        _version(c, tid, qas, 80.0, "2 days")
        qas_cur = _version(c, tid, qas, 80.0, "2 hours")
        _critical(c, tid, prd_cur, "CHK-X")
        _critical(c, tid, qas_cur, "CHK-X")
        c.execute(text("INSERT INTO alert_channels (tenant_id, kind, target, digest, immediate_critical) VALUES "
                       "(:t, 'slack', 'https://hooks.example/d', 'daily', false), "
                       "(:t, 'slack', 'https://hooks.example/i', 'off', true)"), {"t": tid})

    sent: list[dict] = []
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")
    monkeypatch.setattr(sn, "get_sync_engine", lambda: app)
    monkeypatch.setattr(sn, "deliver", lambda ch, alert: sent.append(alert) or True)

    sn.send_alert_digest("daily")
    mine = {a["system_name"]: a for a in sent if a["version_id"] in (prd_cur, qas_cur)}
    assert set(mine) == {"PRD", "QAS"}
    assert mine["PRD"]["triggers"] == ["score_drop", "new_critical"]
    assert mine["PRD"]["previous_score"] == 90.0 and mine["PRD"]["score"] == 70.0
    assert mine["QAS"]["triggers"] == ["new_critical"] and mine["QAS"]["new_critical_rules"] == ["CHK-X"]
    assert mine["QAS"]["previous_score"] == 80.0

    # immediate: QAS's run is compared with QAS's baseline, not with PRD's newer run
    sent.clear()
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        sn._send_immediate_critical(s, tid, qas_cur)
    assert [(a["system_name"], a["new_critical_rules"]) for a in sent] == [("QAS", ["CHK-X"])]
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python3 -m pytest tests/test_alert_digest_pg.py -q -p no:cacheprovider`

Expected:
- `test_alert_text_names_the_system` fails on the second assertion, because `alert_text` ignores `system_name`.
- With `MERIDIAN_TEST_DB_URL` set, the Postgres test fails with `KeyError: 'system_name'`.

- [ ] **Step 3: Implement**

In `workers/tasks/send_notifications.py`, fix the section comment at line 481:

```python
# ── Alert channels (alert_channels, migration 057) ───────────────────────────
```

In `_channels`, change the comment `# table absent before migration 054` to `# table absent before migration 057`.

Replace `alert_text` with:

```python
def alert_text(alert: dict) -> str:
    parts = []
    if "score_drop" in alert["triggers"]:
        parts.append(f"DQS fell {alert['score_drop']} points to {alert['score']}")
    if alert["new_critical_count"]:
        parts.append(f"{alert['new_critical_count']} new critical rule(s) failing: "
                     + ", ".join(alert["new_critical_rules"][:10]))
    if alert["sla_breaches"]:
        parts.append(f"{alert['sla_breaches']} exception SLA breach(es)")
    if alert.get("regressed_records"):
        parts.append(f"{alert['regressed_records']} record(s) failing again since the post-cleanup baseline "
                     f"({alert['links']['batches']})")
    where = f" for {alert['system_name']}" if alert.get("system_name") else ""
    return f"Meridian {alert['mode']} alert{where} — " + "; ".join(parts) + f". {alert['links']['findings']}"
```

Replace `_completed` (lines 598-606) with the following. The scope is required, so no tenant-wide comparison can come back by accident.

```python
_SCOPE = "COALESCE(metadata->>'system_id', 'upload')"


def _completed(session: Session, scope: str, before: datetime | None = None, skip: str | None = None):
    """Latest completed analysis version (id, run_at, dqs_summary) of one source — a system id,
    or 'upload' — optionally before a time / not `skip`. Runs of other systems never compare."""
    return session.execute(text(f"""
        SELECT id, run_at, dqs_summary FROM analysis_versions
         WHERE status IN ('complete', 'agents_complete') AND {_SCOPE} = :scope
           AND (CAST(:before AS timestamptz) IS NULL OR run_at < :before)
           AND (CAST(:skip AS uuid) IS NULL OR id <> CAST(:skip AS uuid))
         ORDER BY run_at DESC LIMIT 1
    """), {"scope": scope, "before": before, "skip": skip}).fetchone()


def _system_name(session: Session, scope: str) -> str:
    if scope == "upload":
        return "File uploads"
    row = session.execute(text("SELECT name FROM sap_systems WHERE id = CAST(:s AS uuid)"), {"s": scope}).fetchone()
    return row[0] if row else scope
```

Replace `_send_immediate_critical` with:

```python
def _send_immediate_critical(session: Session, tenant_id: str, version_id: str) -> None:
    channels = _channels(session, "immediate_critical")
    if not channels:
        return
    from workers.tasks.send_user_invitation import _resolve_app_base_url
    run = session.execute(text(f"SELECT run_at, {_SCOPE} FROM analysis_versions WHERE id = :v"),
                          {"v": str(version_id)}).fetchone()
    if not run:
        return
    prev = _completed(session, run[1], before=run[0], skip=version_id)
    new = _critical_rules(session, version_id) - (_critical_rules(session, prev[0]) if prev else set())
    alert = build_alert("immediate", version_id, None, None, new, 0, 0, _resolve_app_base_url())
    if alert:
        alert["system_name"] = _system_name(session, run[1])
    for ch in channels if alert else []:
        deliver(ch, alert)
```

Replace `send_alert_digest` with:

```python
@celery_app.task(name="workers.tasks.send_notifications.send_alert_digest",
                 soft_time_limit=600, time_limit=660)
def send_alert_digest(period: str) -> dict:
    """Daily / weekly digest per tenant: one alert per system (or file uploads) analysed in the
    window — score drop beyond the tenant's threshold against that system's last run before the
    window, critical rules newly failing, records regressed since its baseline — plus one
    tenant-level alert for exception SLAs breached (exceptions carry no system). Silent when
    nothing fired."""
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    since = datetime.now(timezone.utc) - DIGEST_WINDOW[period]
    base_url = _resolve_app_base_url()
    engine = get_sync_engine()
    sent = 0
    with Session(engine) as session:
        tenants = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
    for tid in tenants:
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": tid})
                channels = _channels(session, "digest = :p", {"p": period})
                if not channels:
                    continue
                drop_limit = _drop_threshold(session, tid)
                scopes = [r[0] for r in session.execute(text(f"""
                    SELECT DISTINCT {_SCOPE} FROM analysis_versions
                     WHERE status IN ('complete', 'agents_complete') AND run_at >= :since
                """), {"since": since}).fetchall()]
                alerts = []
                for scope in sorted(scopes):
                    cur = _completed(session, scope)
                    base = _completed(session, scope, before=since)
                    new = (_critical_rules(session, cur[0]) - _critical_rules(session, base[0])) if base else set()
                    # records failing again since this system's post-cleanup baseline (api/services/monitor.py)
                    regressed = session.execute(text(
                        "SELECT COALESCE((metadata->'monitor'->>'new_records')::int, 0) FROM analysis_versions "
                        "WHERE id = :v"), {"v": str(cur[0])}).scalar() or 0
                    alert = build_alert(period, str(cur[0]), _overall(cur[2]), _overall(base[2]) if base else None,
                                        new, 0, drop_limit, base_url, regressed_records=int(regressed))
                    if alert:
                        alerts.append({**alert, "system_name": _system_name(session, scope)})
                sla = session.execute(text("""
                    SELECT count(*) FROM exceptions WHERE status NOT IN ('resolved', 'closed')
                       AND sla_deadline > :since AND sla_deadline <= now()
                """), {"since": since}).scalar() or 0
                tenant_alert = build_alert(period, None, None, None, set(), int(sla), drop_limit, base_url)
                alerts += [tenant_alert] if tenant_alert else []
                for alert in alerts:
                    for ch in channels:
                        sent += deliver(ch, alert)
        except Exception as e:
            logger.error(f"alert digest failed for tenant {tid}: {type(e).__name__}: {e}")
    return {"period": period, "sent": sent}
```

Check that nothing else calls `_completed`. Run `grep -rn "_completed(" workers api`. Expect only the three call sites above.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_alert_digest_pg.py tests/test_rule_lifecycle_alerts.py tests/test_alert_thresholds.py -q -p no:cacheprovider`

Expected: all pass. The Postgres test is skipped when `MERIDIAN_TEST_DB_URL` is unset.

- [ ] **Step 5: Commit**

```bash
git add workers/tasks/send_notifications.py tests/test_alert_digest_pg.py
git commit -m "fix(alerts): compare runs of the same system in digest and immediate alerts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 2: Stop the nightly re-score of old data

**Files:**
- Modify: `workers/scheduler.py` (the `daily_analysis` body, lines 46-184)
- Test: `tests/test_daily_analysis.py` (new)

**Interfaces:**
- Consumes: none new.
- Produces: `daily_analysis` keeps two steps, AI quality scoring and the Redis dashboard cache, for each tenant's latest analysed run. It no longer enqueues `run_checks` and no longer writes `dqs_history`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_daily_analysis.py`:

```python
"""daily_analysis must not re-score old data: fresh runs come from sync_profiles
(sync_profile_scheduler -> run_sync -> run_checks), which also write dqs_history."""

from datetime import datetime, timezone

from workers import scheduler
from workers.tasks import run_checks as rc


class _Row:
    _mapping = {"id": "v1", "run_at": datetime(2020, 1, 1, tzinfo=timezone.utc),
                "dqs_summary": {"fi_gl": {"composite_score": 90.0}}, "parquet_path": "/data/v1.parquet"}


class _Result:
    def fetchone(self):
        return _Row()

    def fetchall(self):
        return []


class _Session:
    sql: list[str] = []

    def __init__(self, *_a, **_k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def execute(self, stmt, params=None):
        _Session.sql.append(str(stmt))
        return _Result()

    def commit(self):
        pass

    def rollback(self):
        pass


def test_daily_analysis_neither_reruns_checks_nor_writes_history(monkeypatch):
    queued = []
    _Session.sql.clear()
    monkeypatch.setattr(scheduler, "Session", _Session)
    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: None)
    monkeypatch.setattr(scheduler, "_get_tenants", lambda _s: [{"id": "t1"}])
    monkeypatch.setattr(scheduler, "_set_rls", lambda _s, _t: None)
    monkeypatch.setattr(scheduler, "_get_redis", lambda: None)  # cache failure is logged, not raised
    monkeypatch.setattr(rc.run_checks, "delay", lambda *a: queued.append(a))
    scheduler.daily_analysis()
    assert queued == []
    assert not any("dqs_history" in s for s in _Session.sql)
    assert any("FROM analysis_versions" in s for s in _Session.sql)
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_daily_analysis.py -q -p no:cacheprovider`

Expected: FAIL on `assert queued == []`, because `run_checks.delay` was called once.

- [ ] **Step 3: Implement**

In `workers/scheduler.py`, make three edits to `daily_analysis`:

1. Replace the docstring at line 47 with:

```python
    """AI quality score and dashboard cache for each tenant's latest analysed run.

    Does not re-run checks: fresh data arrives through sync_profiles
    (sync_profile_scheduler -> run_sync -> run_checks), and run_checks writes dqs_history.
    Re-scoring the last parquet here only re-measured old data under today's date."""
```

2. Make the version query select only the columns still used, and delete the `parquet_path` guard. Replace lines 59-81 (from `# Get latest complete version` through `continue` after the `parquet_path` warning) with:

```python
                # Get latest complete version
                row = session.execute(
                    text("""
                        SELECT id, run_at, dqs_summary
                        FROM analysis_versions
                        WHERE tenant_id = :tid AND status IN ('complete', 'agents_complete')
                        ORDER BY run_at DESC LIMIT 1
                    """),
                    {"tid": tid},
                ).fetchone()
                if not row:
                    logger.info(f"  tenant={tid}: no complete version, skipping")
                    continue

                version = dict(row._mapping)
                version_id = str(version["id"])
                dqs_summary = version.get("dqs_summary")
```

   Keep the `today` / `run_date` "already ran today" check that follows unchanged.

3. Delete the block from `# Enqueue run_checks` (line 136) through the `session.commit()` that closes the `dqs_history` loop (line 169). Leave the `# Cache dashboard summary in Redis` block unchanged. It reads `dqs_summary`, which step 2 now defines.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m pytest tests/test_daily_analysis.py -q -p no:cacheprovider`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/scheduler.py tests/test_daily_analysis.py
git commit -m "fix(scheduler): stop daily_analysis re-scoring old parquet and writing stale history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 3: Keep DQS history per system (migration 067 and the writer)

**Files:**
- Create: `db/migrations/versions/067_dqs_history_system.py`
- Modify: `db/schema.py:456-472` (`DqsHistory`), `workers/tasks/run_checks.py:656-692`
- Test: `tests/test_dqs_history_pg.py` (new)

**Interfaces:**
- Consumes: `metadata["system_id"]` in `run_checks`. The variable `metadata` is in scope from line 215.
- Produces:
  - Column `dqs_history.system_id uuid NULL`. NULL means a file upload. The column has no foreign key, because deleting a system must not drop or re-key history.
  - Unique index `uq_dqs_history_tenant_system_module_day`.
  - Constant `run_checks.DQS_HISTORY_UPSERT`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_dqs_history_pg.py`:

```python
"""dqs_history keeps one row per tenant, system (or upload), module and UTC day; the
latest run of the day wins (workers/tasks/run_checks.DQS_HISTORY_UPSERT, migration 067).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py); skipped otherwise."""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


def _row(tid, system_id, score):
    return {"tenant_id": tid, "system_id": system_id, "module_id": "accounts_payable", "dqs_score": score,
            "completeness": score, "accuracy": 0, "consistency": 0, "timeliness": 0, "uniqueness": 0,
            "validity": 0, "finding_count": 1}


def test_upsert_per_system_latest_of_day_wins():
    from sqlalchemy import create_engine, text

    from workers.tasks.run_checks import DQS_HISTORY_UPSERT

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    engine = create_engine(url)
    tid, prd, qas = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-history')"), {"t": tid})
            for row in (_row(tid, prd, 80.0), _row(tid, prd, 85.0), _row(tid, qas, 70.0),
                        _row(tid, None, 60.0), _row(tid, None, 61.0)):
                c.execute(DQS_HISTORY_UPSERT, row)
            got = c.execute(text("SELECT COALESCE(system_id::text, 'upload'), dqs_score, completeness "
                                 "FROM dqs_history WHERE tenant_id = :t ORDER BY 2"), {"t": tid}).fetchall()
        assert [(s, float(d), float(cp)) for s, d, cp in got] == [
            ("upload", 61.0, 61.0), (qas, 70.0, 70.0), (prd, 85.0, 85.0)]
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM dqs_history WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
        engine.dispose()
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_dqs_history_pg.py -q -p no:cacheprovider`

Expected: FAIL with `ImportError: cannot import name 'DQS_HISTORY_UPSERT'`. The test is skipped without `MERIDIAN_TEST_DB_URL`; in that case run the import check by hand: `python3 -c "from workers.tasks.run_checks import DQS_HISTORY_UPSERT"`.

- [ ] **Step 3: Implement**

Create `db/migrations/versions/067_dqs_history_system.py`:

```python
"""dqs_history per system

Revision ID: 067
Revises: 066
Create Date: 2026-10-10

dqs_history held one row per tenant, module and UTC day, so the second system
analysed on a day lost its score (ON CONFLICT DO NOTHING). Adds system_id
(NULL = file upload; no FK, history outlives a deleted system) and widens the
daily unique key to include it. The ::text cast is required: COALESCE(uuid,
'upload') does not type-check.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "067"
down_revision: Union[str, None] = "066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dqs_history", sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("DROP INDEX IF EXISTS uq_dqs_history_tenant_module_day")
    op.execute(
        "CREATE UNIQUE INDEX uq_dqs_history_tenant_system_module_day ON dqs_history "
        "(tenant_id, (COALESCE(system_id::text, 'upload')), module_id, ((recorded_at AT TIME ZONE 'UTC')::date))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_dqs_history_tenant_system_module_day")
    # the narrower key allows one row per tenant, module and day: keep the newest
    op.execute("""
        DELETE FROM dqs_history d USING dqs_history n
         WHERE d.tenant_id = n.tenant_id AND d.module_id = n.module_id
           AND (d.recorded_at AT TIME ZONE 'UTC')::date = (n.recorded_at AT TIME ZONE 'UTC')::date
           AND (d.recorded_at, d.id) < (n.recorded_at, n.id)
    """)
    op.execute(
        "CREATE UNIQUE INDEX uq_dqs_history_tenant_module_day "
        "ON dqs_history (tenant_id, module_id, ((recorded_at AT TIME ZONE 'UTC')::date))"
    )
    op.drop_column("dqs_history", "system_id")
```

In `db/schema.py`, add this to `DqsHistory` after `tenant_id`:

```python
    system_id = Column(UUID(as_uuid=True), nullable=True)  # NULL = file upload (migration 067)
```

In `workers/tasks/run_checks.py`, add this module-level constant after the imports. `text` is already imported at line 10.

```python
# One row per tenant, system (NULL = file upload), module and UTC day; the latest run of the
# day wins. Conflict target = uq_dqs_history_tenant_system_module_day (migration 067).
DQS_HISTORY_UPSERT = text("""
    INSERT INTO dqs_history (
        id, tenant_id, system_id, module_id, dqs_score,
        completeness, accuracy, consistency, timeliness, uniqueness, validity, finding_count
    ) VALUES (
        gen_random_uuid(), :tenant_id, CAST(:system_id AS uuid), :module_id, :dqs_score,
        :completeness, :accuracy, :consistency, :timeliness, :uniqueness, :validity, :finding_count
    )
    ON CONFLICT (tenant_id, (COALESCE(system_id::text, 'upload')), module_id,
                 ((recorded_at AT TIME ZONE 'UTC')::date))
    DO UPDATE SET dqs_score = EXCLUDED.dqs_score, completeness = EXCLUDED.completeness,
                  accuracy = EXCLUDED.accuracy, consistency = EXCLUDED.consistency,
                  timeliness = EXCLUDED.timeliness, uniqueness = EXCLUDED.uniqueness,
                  validity = EXCLUDED.validity, finding_count = EXCLUDED.finding_count,
                  recorded_at = EXCLUDED.recorded_at
""")
```

Replace the writer loop at lines 656-692 with:

```python
        # dqs_history: one row per system, module and day (latest run wins)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            for module_name in modules:
                mod_summary = dqs_summary.get(module_name, {})
                dims = mod_summary.get("dimension_scores", {})
                session.execute(DQS_HISTORY_UPSERT, {
                    "tenant_id": tenant_id,
                    "system_id": metadata.get("system_id"),
                    "module_id": module_name,
                    "dqs_score": mod_summary.get("composite_score", 0),
                    "completeness": dims.get("completeness", 0),
                    "accuracy": dims.get("accuracy", 0),
                    "consistency": dims.get("consistency", 0),
                    "timeliness": dims.get("timeliness", 0),
                    "uniqueness": dims.get("uniqueness", 0),
                    "validity": dims.get("validity", 0),
                    "finding_count": sum(1 for r in all_results if r.module == module_name),
                })
            session.commit()
        logger.info(f"Upserted dqs_history for {len(modules)} modules")
```

Run `grep -rn "INSERT INTO dqs_history" --include=*.py .`. Expect `run_checks.py` (the constant) and no other writer. The `scheduler.py` writer was removed in Task 2. If another writer appears, give it the same conflict target, or it will raise "no unique or exclusion constraint matching the ON CONFLICT specification".

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m pytest tests/test_dqs_history_pg.py -q -p no:cacheprovider && python3 -c "from workers.tasks.run_checks import DQS_HISTORY_UPSERT"`

Expected: PASS, or skipped without `MERIDIAN_TEST_DB_URL`. The import succeeds either way.

With a scratch database, also check the downgrade path: `DATABASE_URL_MIGRATE=$MERIDIAN_TEST_DB_URL alembic downgrade 066 && DATABASE_URL_MIGRATE=$MERIDIAN_TEST_DB_URL alembic upgrade head`.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/versions/067_dqs_history_system.py db/schema.py workers/tasks/run_checks.py tests/test_dqs_history_pg.py
git commit -m "feat(history): keep dqs_history per system; latest run of the day wins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 4: Send a test alert to a channel

**Files:**
- Modify: `api/routes/notifications.py`. Add the route after `delete_alert_channel` (ends at line 200) and add `import asyncio` to the imports.
- Test: `tests/test_alert_channel_test_route.py` (new)

**Interfaces:**
- Consumes: `workers.tasks.send_notifications.build_alert`, `deliver`, and `workers.tasks.send_user_invitation._resolve_app_base_url`. The API already imports from `workers` (see `api/routes/system_objects.py`).
- Produces: `POST /api/v1/alert-channels/{channel_id}/test`, permission `manage_settings`.
  - Returns `{"delivered": bool}`.
  - Returns 404 when the channel does not exist in the caller's tenant.
  - A delivery error returns `delivered: false`, not a 500. The reason stays in the log, and the URL or secret is never logged.

- [ ] **Step 1: Write the failing test**

Create `tests/test_alert_channel_test_route.py`:

```python
"""POST /api/v1/alert-channels/{id}/test — sends a sample alert through the real deliver()."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes.notifications import router
from workers.tasks import send_notifications as sn

CHANNEL = {"id": "c1", "kind": "slack", "target": "https://hooks.example/x", "secret": None}


class _Result:
    def __init__(self, row):
        self._row = row

    def mappings(self):
        return self

    def first(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row = row

    async def execute(self, _stmt, _params=None):
        return _Result(self.row)


def _client(row) -> TestClient:
    api = FastAPI()
    api.include_router(router)
    db = _DB(row)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")


def _post(client, role="admin"):
    return client.post(f"/api/v1/alert-channels/{uuid.uuid4()}/test", headers={"X-User-Role": role})


def test_sends_a_sample_alert(monkeypatch):
    calls = []
    monkeypatch.setattr(sn, "deliver", lambda ch, alert: calls.append((ch, alert)) or True)
    r = _post(_client(CHANNEL))
    assert r.status_code == 200 and r.json() == {"delivered": True}
    ch, alert = calls[0]
    assert ch["kind"] == "slack" and ch["target"] == CHANNEL["target"]
    assert alert["mode"] == "test" and alert["triggers"] == ["new_critical"]
    assert alert["links"]["findings"] == "https://app/findings"


def test_delivery_failure_is_reported_not_raised(monkeypatch):
    def boom(_ch, _alert):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(sn, "deliver", boom)
    assert _post(_client(CHANNEL)).json() == {"delivered": False}


def test_unknown_channel_is_404():
    assert _post(_client(None)).status_code == 404


def test_needs_manage_settings():
    assert _post(_client(CHANNEL), role="analyst").status_code == 403
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_alert_channel_test_route.py -q -p no:cacheprovider`

Expected: FAIL. The route does not exist yet, so the first three tests get 404 or 405 where they expect other results.

- [ ] **Step 3: Implement**

Add `import asyncio` at the top of `api/routes/notifications.py`, next to `import re`. Append after `delete_alert_channel`:

```python
@router.post("/alert-channels/{channel_id}/test", dependencies=[Depends(require_permission("manage_settings"))])
async def send_test_alert(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)):
    """Send a sample alert through the channel so an admin can confirm the target and secret.
    The payload has the real shape; the rule id is a placeholder, never a real finding."""
    from workers.tasks import send_notifications as sn
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    await _set_rls(db, tenant.id)
    row = (await db.execute(text("SELECT id, kind, target, secret FROM alert_channels WHERE id = :id"),
                            {"id": str(channel_id)})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert channel not found")
    alert = sn.build_alert("test", None, None, None, {"SAMPLE-001"}, 0, 0, _resolve_app_base_url())
    alert["system_name"] = "Sample system"
    try:
        delivered = await asyncio.to_thread(sn.deliver, dict(row), alert)
    except Exception:  # e.g. email backend not configured; deliver() never logs the target or secret
        delivered = False
    return {"delivered": bool(delivered)}
```

The function calls `sn.deliver` through the module, not through `from ... import deliver`, so the test's monkeypatch on the module takes effect.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `python3 -m pytest tests/test_alert_channel_test_route.py tests/test_route_shadowing.py -q -p no:cacheprovider`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/routes/notifications.py tests/test_alert_channel_test_route.py
git commit -m "feat(alerts): POST /alert-channels/{id}/test sends a sample alert

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 5: Trend panel on the system Overview

**Files:**
- Modify: `frontend/lib/api/system-objects.ts:47-67`, `frontend/lib/query-keys.ts` (next to `systemVersions`, line 78)
- Create: `frontend/app/(app)/systems/[systemId]/trend-panel.tsx`
- Modify: `frontend/app/(app)/systems/[systemId]/page.tsx`. Edit the `Overview` signature (line 221) and its call at line 180.
- Test: `frontend/app/(app)/systems/[systemId]/__tests__/trend-panel.test.tsx` (new). Also modify `frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx`.

**Interfaces:**
- Consumes: `getTrends(id, undefined, true)`, which returns `{ summary: TrendSummary[]; series: Record<string, TrendPoint[]> }`.
- Produces:
  - `TrendPanel({ systemId }: { systemId: string })`.
  - `queryKeys.systemTrends(systemId)`.
  - `TrendFlag` now includes `"incomplete_extract"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(app)/systems/[systemId]/__tests__/trend-panel.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemObjectsApi from "@/lib/api/system-objects";
import type { TrendPoint, TrendSummary } from "@/lib/api/system-objects";
import { TrendPanel } from "../trend-panel";

const point = (run_at: string, dqs: number): TrendPoint => ({
  version_id: run_at, run_at, label: null, baseline: false, dqs, dimensions: {}, records: 100,
  failing_records: 3, failing_checks: 1, issues_opened: 0, issues_resolved: 0,
  scope: { mode: "full" }, rule_set: null, comparable: true, flags: [],
});

const SUMMARY: TrendSummary = {
  object: "accounts_payable", points: 2, dqs: 82.5, dqs_delta: 2.5, failing_records: 3, failing_records_delta: -1,
  comparable: false, flags: ["rules_changed", "incomplete_extract"],
  vs_baseline: { version_id: "b", pinned: true, dqs_delta: -1.25, failing_records_delta: 0 },
};

describe("TrendPanel", () => {
  it("shows each object's score, change, baseline delta and flags", async () => {
    vi.spyOn(systemObjectsApi, "getTrends").mockResolvedValue({
      summary: [SUMMARY],
      series: { accounts_payable: [point("2026-10-01T00:00:00Z", 80), point("2026-10-08T00:00:00Z", 82.5)] },
    });
    renderWithQuery(<TrendPanel systemId="s1" />);
    await waitFor(() => expect(screen.getByText(/accounts payable/i)).toBeInTheDocument());
    expect(screen.getByText("82.5")).toBeInTheDocument();
    expect(screen.getByText("+2.5")).toBeInTheDocument();
    expect(screen.getByText("-1.3")).toBeInTheDocument();
    expect(screen.getByText("Rules changed")).toBeInTheDocument();
    expect(screen.getByText("Incomplete extract")).toBeInTheDocument();
    expect(systemObjectsApi.getTrends).toHaveBeenCalledWith("s1", undefined, true);
  });

  it("says so when nothing has been analysed", async () => {
    vi.spyOn(systemObjectsApi, "getTrends").mockResolvedValue({ summary: [], series: {} });
    renderWithQuery(<TrendPanel systemId="s1" />);
    await waitFor(() => expect(screen.getByText("No analysed run yet.")).toBeInTheDocument());
  });

  it("shows a retryable error", async () => {
    const spy = vi.spyOn(systemObjectsApi, "getTrends").mockRejectedValue(new Error("network down"));
    renderWithQuery(<TrendPanel systemId="s1" />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    spy.mockResolvedValue({ summary: [], series: {} });
    screen.getByRole("button", { name: /retry/i }).click();
    await waitFor(() => expect(screen.getByText("No analysed run yet.")).toBeInTheDocument());
  });
});
```

Before running, check `DownloadScope` in `system-objects.ts`. If `{ mode: "full" }` does not match its shape, use the smallest valid value of that type.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run "app/(app)/systems/[systemId]/__tests__/trend-panel.test.tsx"`

Expected: FAIL with `Failed to resolve import "../trend-panel"`.

- [ ] **Step 3: Implement**

In `frontend/lib/api/system-objects.ts`, make two edits.

Replace the `TrendFlag` line:

```ts
export type TrendFlag = "scope_changed" | "rules_changed" | "volume_shift" | "incomplete_extract";
```

Add this to `TrendPoint`, after `flags`:

```ts
  /** The extraction behind this point did not finish (metadata.extraction_complete === false). */
  incomplete?: boolean;
```

In `frontend/lib/query-keys.ts`, add this after `systemVersions`:

```ts
  systemTrends: (systemId: string) => ["system-trends", systemId] as const,
```

Create `frontend/app/(app)/systems/[systemId]/trend-panel.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Pill, Skeleton, Sparkline } from "@/design";
import { getTrends, type TrendFlag } from "@/lib/api/system-objects";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const th = "px-3 py-2 text-left font-medium";
const thStyle = { color: "var(--m-ink-3)" };
const td = "px-3 py-1.5 border-t";
const tdStyle = { borderColor: "var(--m-line)" };

const FLAG_LABEL: Record<TrendFlag, string> = {
  scope_changed: "Scope changed",
  rules_changed: "Rules changed",
  volume_shift: "Volume shifted",
  incomplete_extract: "Incomplete extract",
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const deltaColor = (n: number) => (n > 0 ? "var(--m-pass)" : n < 0 ? "var(--m-critical)" : "var(--m-ink-2)");

/** Score per object across this system's analysed runs. A change is only meaningful when the
 *  point is comparable (same scope, rule set and record volume); flags say why it is not. */
export function TrendPanel({ systemId }: { systemId: string }) {
  const q = useQuery({ queryKey: queryKeys.systemTrends(systemId), queryFn: () => getTrends(systemId, undefined, true) });
  if (q.isLoading) return <Skeleton height={96} />;
  if (q.isError) {
    return <ErrorState message={apiErrorMessage(q.error) || "Trends could not be read."} onRetry={() => q.refetch()} />;
  }
  const summary = q.data?.summary ?? [];
  const series = q.data?.series ?? {};
  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Trend per object</p>
      {!summary.length ? (
        <EmptyState title="No analysed run yet." />
      ) : (
        <table className="mt-2 w-full text-[13px]">
          <thead>
            <tr>
              <th className={th} style={thStyle}>Object</th><th className={th} style={thStyle}>DQS</th>
              <th className={th} style={thStyle}>Last change</th><th className={th} style={thStyle}>Trend</th>
              <th className={th} style={thStyle}>Since baseline</th><th className={th} style={thStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => {
              const pts = (series[s.object] ?? []).flatMap((p) => (p.dqs === null ? [] : [{ x: p.run_at, y: p.dqs }]));
              return (
                <tr key={s.object}>
                  <td className={td} style={tdStyle}>{formatModuleName(s.object)}</td>
                  <td className={td} style={tdStyle}>{s.dqs == null ? "—" : s.dqs.toFixed(1)}</td>
                  <td className={td} style={tdStyle}>
                    {s.dqs_delta == null ? "—" : <span style={{ color: deltaColor(s.dqs_delta) }}>{signed(s.dqs_delta)}</span>}
                  </td>
                  <td className={td} style={tdStyle}>{pts.length >= 2 ? <Sparkline data={pts} /> : "—"}</td>
                  <td className={td} style={tdStyle}>
                    {s.vs_baseline ? <span style={{ color: deltaColor(s.vs_baseline.dqs_delta) }}>{signed(s.vs_baseline.dqs_delta)}</span> : "—"}
                  </td>
                  <td className={td} style={tdStyle}>
                    <span className="flex flex-wrap gap-1">
                      {s.flags.map((f) => <Pill key={f} tone="at-risk">{FLAG_LABEL[f]}</Pill>)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

In `frontend/app/(app)/systems/[systemId]/page.tsx`, make three edits:

1. Add the import next to the other panel imports:
   ```tsx
   import { TrendPanel } from "./trend-panel";
   ```
2. Change the Overview tab item at line 180 to:
   ```tsx
   { value: "overview", label: "Overview", content: <Overview systemId={systemId} versions={versions} modules={modules} /> },
   ```
3. Change the `Overview` signature, and render the panel right after the two-column chart grid (before "Last 5 runs"):
   ```tsx
   function Overview({ systemId, modules, versions }: { systemId: string; modules: SystemModule[]; versions: SystemVersion[] }) {
   ```
   ```tsx
         <TrendPanel systemId={systemId} />
   ```

In `frontend/app/(app)/systems/[systemId]/__tests__/page.test.tsx`, add this to the shared setup next to the `getSystemVersions` spy at line 31:

```tsx
  vi.spyOn(systemObjectsApi, "getTrends").mockResolvedValue({ summary: [], series: {} });
```

- [ ] **Step 4: Run the gate and confirm it passes**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`

Expected: all green, including `trend-panel.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api/system-objects.ts frontend/lib/query-keys.ts "frontend/app/(app)/systems/[systemId]"
git commit -m "feat(systems): trend per object on the system overview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 6: Alert channels panel in admin settings

**Files:**
- Modify: `frontend/lib/api/notifications.ts`, `frontend/lib/query-keys.ts`
- Create: `frontend/app/(app)/admin/settings/alert-channels-panel.tsx`
- Modify: `frontend/app/(app)/admin/settings/page.tsx`
- Test: `frontend/app/(app)/admin/settings/__tests__/alert-channels-panel.test.tsx` (new). Also modify `frontend/app/(app)/admin/settings/__tests__/page.test.tsx`.

**Interfaces:**
- Consumes:
  - `GET /api/v1/alert-channels`, which returns `{channels}`. The target is redacted to the host, and the secret is never returned (only `has_secret`).
  - `POST /api/v1/alert-channels` (returns 201).
  - `DELETE /api/v1/alert-channels/{id}` (returns 204).
  - `POST /api/v1/alert-channels/{id}/test` (Task 4).
- Produces:
  - Types `AlertChannel`, `AlertChannelKind`, `AlertDigest`, `AlertChannelCreate`.
  - Functions `getAlertChannels`, `createAlertChannel`, `deleteAlertChannel`, `testAlertChannel`.
  - `queryKeys.alertChannels()`.
  - Component `AlertChannelsPanel`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(app)/admin/settings/__tests__/alert-channels-panel.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as notificationsApi from "@/lib/api/notifications";
import type { AlertChannel } from "@/lib/api/notifications";
import { AlertChannelsPanel } from "../alert-channels-panel";

const CHANNEL: AlertChannel = {
  id: "c1", kind: "slack", target: "hooks.example", digest: "daily", immediate_critical: true,
  enabled: true, created_at: "2026-10-01T00:00:00Z", has_secret: false,
};

describe("AlertChannelsPanel", () => {
  it("lists channels and sends a test alert", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    const test = vi.spyOn(notificationsApi, "testAlertChannel").mockResolvedValue({ delivered: true });
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("hooks.example")).toBeInTheDocument());
    expect(screen.getByText("Daily digest")).toBeInTheDocument();
    expect(screen.getByText("Immediate")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(test.mock.calls[0]?.[0]).toBe("c1"));
  });

  it("adds a channel with the defaults", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
    const create = vi.spyOn(notificationsApi, "createAlertChannel").mockResolvedValue(CHANNEL);
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("No alert channel yet.")).toBeInTheDocument());
    const add = screen.getByRole("button", { name: "Add channel" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: " https://hooks.example/abc " } });
    fireEvent.click(add);
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      kind: "slack", target: "https://hooks.example/abc", secret: undefined, digest: "daily", immediate_critical: false,
    }));
  });

  it("removes a channel", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    const del = vi.spyOn(notificationsApi, "deleteAlertChannel").mockResolvedValue();
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("hooks.example")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(del.mock.calls[0]?.[0]).toBe("c1"));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run "app/(app)/admin/settings/__tests__/alert-channels-panel.test.tsx"`

Expected: FAIL with `Failed to resolve import "../alert-channels-panel"`.

- [ ] **Step 3: Implement**

Append to `frontend/lib/api/notifications.ts`:

```ts
/* ─── Alert channels (outbound webhook / Slack / Teams / email) ─── */

export type AlertChannelKind = "webhook" | "slack" | "teams" | "email";
export type AlertDigest = "daily" | "weekly" | "off";

/** A channel as listed: webhook targets are redacted to the host; the secret is never returned. */
export interface AlertChannel {
  id: string;
  kind: AlertChannelKind;
  target: string;
  digest: AlertDigest;
  immediate_critical: boolean;
  enabled: boolean;
  created_at: string;
  has_secret: boolean;
}

export interface AlertChannelCreate {
  kind: AlertChannelKind;
  target: string;
  /** HMAC key for webhook signatures, 16-256 characters. */
  secret?: string;
  digest: AlertDigest;
  immediate_critical: boolean;
}

export async function getAlertChannels(): Promise<AlertChannel[]> {
  const { data } = await apiClient.get<{ channels: AlertChannel[] }>("/api/v1/alert-channels");
  return data.channels;
}

export async function createAlertChannel(body: AlertChannelCreate): Promise<AlertChannel> {
  const { data } = await apiClient.post<AlertChannel>("/api/v1/alert-channels", body);
  return data;
}

export async function deleteAlertChannel(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/alert-channels/${id}`);
}

export async function testAlertChannel(id: string): Promise<{ delivered: boolean }> {
  const { data } = await apiClient.post<{ delivered: boolean }>(`/api/v1/alert-channels/${id}/test`);
  return data;
}
```

In `frontend/lib/query-keys.ts`, add:

```ts
  alertChannels: () => ["alert-channels"] as const,
```

Create `frontend/app/(app)/admin/settings/alert-channels-panel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, EmptyState, ErrorState, Field, Pill, Select, Skeleton } from "@/design";
import {
  createAlertChannel, deleteAlertChannel, getAlertChannels, testAlertChannel,
  type AlertChannelKind, type AlertDigest,
} from "@/lib/api/notifications";
import { apiErrorMessage } from "@/lib/api/optional";
import { queryKeys } from "@/lib/query-keys";

const th = "px-3 py-2 text-left font-medium";
const thStyle = { color: "var(--m-ink-3)" };
const td = "px-3 py-1.5 border-t";
const tdStyle = { borderColor: "var(--m-line)" };

const KIND_LABEL: Record<AlertChannelKind, string> = {
  slack: "Slack", teams: "Microsoft Teams", webhook: "Webhook (signed)", email: "Email",
};
const DIGEST_LABEL: Record<AlertDigest, string> = { daily: "Daily digest", weekly: "Weekly digest", off: "No digest" };
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const DIGEST_OPTIONS = Object.entries(DIGEST_LABEL).map(([value, label]) => ({ value, label }));
const isKind = (v: string): v is AlertChannelKind => v in KIND_LABEL;
const isDigest = (v: string): v is AlertDigest => v in DIGEST_LABEL;

/** Where data-quality alerts go: per-system score drops, new critical rules, SLA breaches. */
export function AlertChannelsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.alertChannels(), queryFn: getAlertChannels });
  const [kind, setKind] = useState<AlertChannelKind>("slack");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const [immediate, setImmediate] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.alertChannels() });
  const fail = (fallback: string) => (e: Error) => toast.error(apiErrorMessage(e) || fallback);

  const create = useMutation({
    mutationFn: () => createAlertChannel({
      kind, target: target.trim(), secret: kind === "webhook" && secret ? secret : undefined,
      digest, immediate_critical: immediate,
    }),
    onSuccess: () => { setTarget(""); setSecret(""); toast("Channel added"); refresh(); },
    onError: fail("The channel could not be added."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAlertChannel(id),
    onSuccess: refresh,
    onError: fail("The channel could not be removed."),
  });
  const test = useMutation({
    mutationFn: (id: string) => testAlertChannel(id),
    onSuccess: (r) => (r.delivered
      ? toast("Test alert delivered")
      : toast.error("The test alert was not delivered. Check the target and secret.")),
    onError: fail("The test alert could not be sent."),
  });

  const secretTooShort = kind === "webhook" && secret.length > 0 && secret.length < 16;
  const neverFires = digest === "off" && !immediate;
  const canAdd = target.trim().length >= 3 && !secretTooShort && !neverFires && !create.isPending;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold">Alert channels</h2>
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Each system is compared with its own previous run. Alerts carry counts, rule ids and links, never record values.
      </p>
      {q.isLoading ? <Skeleton height={64} /> : q.isError ? (
        <ErrorState message={apiErrorMessage(q.error) || "Alert channels could not be read."} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No alert channel yet." />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={th} style={thStyle}>Kind</th><th className={th} style={thStyle}>Target</th>
              <th className={th} style={thStyle}>Digest</th><th className={th} style={thStyle}>Critical findings</th>
              <th className={th} style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {q.data.map((c) => (
              <tr key={c.id}>
                <td className={td} style={tdStyle}>{KIND_LABEL[c.kind]}</td>
                <td className={td} style={tdStyle}>{c.target}</td>
                <td className={td} style={tdStyle}>{DIGEST_LABEL[c.digest]}</td>
                <td className={td} style={tdStyle}>
                  {c.immediate_critical ? <Pill tone="go">Immediate</Pill> : <Pill tone="neutral">In digest</Pill>}
                </td>
                <td className={td} style={tdStyle}>
                  <span className="flex gap-2 justify-end">
                    <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(c.id)}>Send test</Button>
                    <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>Remove</Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="rounded border p-3 flex flex-wrap items-end gap-3" style={{ borderColor: "var(--m-line)" }}>
        <Field label="Kind">
          <Select options={KIND_OPTIONS} value={kind} onValueChange={(v) => { if (isKind(v)) setKind(v); }} />
        </Field>
        <Field label="Target" error={undefined}>
          <input className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
            placeholder={kind === "email" ? "team@example.com" : "https://"} value={target}
            onChange={(e) => setTarget(e.target.value)} />
        </Field>
        {kind === "webhook" ? (
          <Field label="Signing secret" error={secretTooShort ? "At least 16 characters" : undefined}>
            <input type="password" className="rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}
              value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Digest">
          <Select options={DIGEST_OPTIONS} value={digest} onValueChange={(v) => { if (isDigest(v)) setDigest(v); }} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
          Send new critical findings immediately
        </label>
        <Button disabled={!canAdd} onClick={() => create.mutate()}>Add channel</Button>
        {neverFires ? (
          <span className="text-[12px]" style={{ color: "var(--m-critical)" }}>Choose a digest or immediate delivery.</span>
        ) : null}
      </div>
    </section>
  );
}
```

`Field` wires `htmlFor` to a raw `<input>` child, so `getByLabelText("Target")` resolves. If `apiErrorMessage` is typed to take `unknown` and not `Error`, change `fail`'s parameter type to match. Do not use `any`.

In `frontend/app/(app)/admin/settings/page.tsx`, add the import:

```tsx
import { AlertChannelsPanel } from "./alert-channels-panel";
```

Then render this after the Deployment `</section>`, before the health-checks block:

```tsx
      {can("manage_settings") ? <AlertChannelsPanel /> : null}
```

In `frontend/app/(app)/admin/settings/__tests__/page.test.tsx`, add `import * as notificationsApi from "@/lib/api/notifications";`. Then add this as the first line of both `it` blocks:

```tsx
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
```

- [ ] **Step 4: Run the gate and confirm it passes**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api/notifications.ts frontend/lib/query-keys.ts "frontend/app/(app)/admin/settings"
git commit -m "feat(settings): manage and test alert channels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 7: Next run and trend arrow on the systems list

**Files:**
- Modify: `frontend/app/(app)/systems/_health.ts`, `frontend/app/(app)/systems/page.tsx`
- Test: `frontend/app/(app)/systems/__tests__/health.test.ts` (new). Also modify `frontend/app/(app)/systems/__tests__/page.test.tsx`.

**Interfaces:**
- Consumes: `getSyncProfiles(systemId): Promise<SyncProfile[]>` (`lib/api/systems.ts:107`) with `queryKeys.syncProfiles(id)`. This is the same cache entry that the schedules panel uses.
- Produces:
  - `dqsTrend(versions): number | null`, the newest analysed run's mean DQS minus the previous analysed run's.
  - `nextRun(profiles): string | null`, the earliest `next_run_at` among active profiles.
  - `latestDqs` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(app)/systems/__tests__/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SystemVersion } from "@/lib/api/system-objects";
import type { SyncProfile } from "@/types/api";
import { dqsTrend, latestDqs, nextRun } from "../_health";

const version = (run_at: string, dqs: Record<string, number | null>, analysed = true): SystemVersion => ({
  id: run_at, run_at, label: null, status: "complete", objects: [], scope: { mode: "full" }, records: {},
  analysed_at: analysed ? run_at : null, rule_set: null, baseline: false, analysable: true, dqs, field_status: [],
});
const profile = (next_run_at: string | null, active = true): SyncProfile => ({
  id: next_run_at ?? "none", system_id: "s1", domain: "fi_gl", tables: [], schedule_cron: "0 2 * * *",
  active, last_run_at: null, next_run_at,
});

describe("systems list helpers", () => {
  it("dqsTrend compares the two newest analysed runs", () => {
    const vs = [version("2026-10-01", { a: 80, b: 90 }), version("2026-10-08", { a: 70, b: 80 }),
                version("2026-10-09", { a: 99 }, false)];
    expect(dqsTrend(vs)).toBe(-10);
    expect(latestDqs(vs).dqs).toBe(75);
    expect(dqsTrend([version("2026-10-01", { a: 80 })])).toBeNull();
    expect(dqsTrend([version("2026-10-01", { a: 80 }), version("2026-10-02", { a: null })])).toBeNull();
  });

  it("nextRun picks the earliest active schedule", () => {
    expect(nextRun([profile("2026-10-11T02:00:00+02:00"), profile("2026-10-10T23:00:00Z"),
                    profile("2026-10-10T01:00:00Z", false), profile(null)])).toBe("2026-10-10T23:00:00Z");
    expect(nextRun([profile(null)])).toBeNull();
  });
});
```

Adjust `scope: { mode: "full" }` to the real `DownloadScope` shape if it differs, as in Task 5.

The first `nextRun` case is deliberate: `2026-10-11T02:00:00+02:00` is 00:00Z, which is later than 23:00Z. A plain string sort would return it first, so the case proves the helper compares instants.

In `frontend/app/(app)/systems/__tests__/page.test.tsx`, make two edits:
- Add `import * as systemsApi from "@/lib/api/systems";`.
- In the first `it`, mock the profiles and assert the new column:

```tsx
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([]);
```

```tsx
    await waitFor(() => expect(screen.getByText("Manual only")).toBeInTheDocument());
```

Also add the `getSyncProfiles` spy to the second `it`, before `retry.click()`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run "app/(app)/systems/__tests__"`

Expected: FAIL. `dqsTrend` and `nextRun` are not exported, and "Manual only" is not found.

- [ ] **Step 3: Implement**

Replace `latestDqs` in `frontend/app/(app)/systems/_health.ts`, and add the new helpers. Also change the type import to include `SyncProfile`:

```ts
import type { HealthStatus, SyncProfile } from "@/types/api";
```

```ts
const meanDqs = (v: SystemVersion): number | null => {
  const vals = Object.values(v.dqs ?? {}).filter((x): x is number => typeof x === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const analysedNewestFirst = (versions: SystemVersion[]) =>
  versions.filter((x) => x.analysed_at).sort((a, b) => b.run_at.localeCompare(a.run_at));

/** Mean DQS of the objects in the newest analysed run, or null before any analysis. */
export function latestDqs(versions: SystemVersion[]): { dqs: number | null; version: SystemVersion | null } {
  const v = analysedNewestFirst(versions)[0] ?? null;
  return { dqs: v ? meanDqs(v) : null, version: v };
}

/** Change in mean DQS from the previous analysed run to the newest; null until two runs are scored. */
export function dqsTrend(versions: SystemVersion[]): number | null {
  const [cur, prev] = analysedNewestFirst(versions).slice(0, 2).map(meanDqs);
  return cur == null || prev == null ? null : cur - prev;
}

/** Earliest upcoming run among a system's active schedules, or null when it runs manually only. */
export function nextRun(profiles: SyncProfile[]): string | null {
  const due = profiles.flatMap((p) => (p.active && p.next_run_at ? [p.next_run_at] : []));
  return due.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}
```

`dqsTrend` compares the two newest analysed runs and does not skip an unscored run between them. That means a null result when the latest run has no scores, which is honest.

In `frontend/app/(app)/systems/page.tsx`, make four edits:

1. Update the imports:
   ```tsx
   import { ArrowDown, ArrowUp } from "lucide-react";
   import { HEALTH_LABEL, dqsTrend, latestDqs, nextRun } from "./_health";
   import { getSyncProfiles } from "@/lib/api/systems";
   import { formatDate, relativeTime } from "@/lib/format";
   ```
2. Replace the `dqsById` map, and add the profile queries after `versionsQ`:
   ```tsx
   const dqsById = new Map(
     systems.map((s, i) => {
       const vs = versionsQ[i]?.data?.versions;
       return [s.id, vs ? { dqs: latestDqs(vs).dqs, trend: dqsTrend(vs) } : null];
     }),
   );
   const profilesQ = useQueries({
     queries: systems.map((s) => ({ queryKey: queryKeys.syncProfiles(s.id), queryFn: () => getSyncProfiles(s.id) })),
   });
   const nextRunById = new Map(systems.map((s, i) => [s.id, profilesQ[i]?.data ? nextRun(profilesQ[i]!.data!) : null]));
   ```
   If the `!` non-null assertions trip lint, use `const p = profilesQ[i]?.data; return [s.id, p ? nextRun(p) : null];`.
3. Replace the `dqs` column cell:
   ```tsx
   cell: ({ row }) => {
     const d = dqsById.get(row.original.id);
     if (!d || d.dqs == null) return "—";
     const t = d.trend;
     return (
       <span className="inline-flex items-center gap-1">
         {d.dqs.toFixed(1)}
         {t != null && Math.abs(t) >= 0.05 ? (
           <span className="inline-flex items-center text-[12px]"
             style={{ color: t > 0 ? "var(--m-pass)" : "var(--m-critical)" }}
             aria-label={`${t > 0 ? "Up" : "Down"} ${Math.abs(t).toFixed(1)} since the previous run`}>
             {t > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(t).toFixed(1)}
           </span>
         ) : null}
       </span>
     );
   },
   ```
4. Add this column after the `dqs` column:
   ```tsx
   {
     id: "next_run",
     header: "Next run",
     cell: ({ row }) => {
       const n = nextRunById.get(row.original.id);
       return n ? formatDate(n, "datetime") : "Manual only";
     },
   },
   ```

`relativeTime` only formats past times ("3h ago"), so the column uses `formatDate(…, "datetime")`, as the schedules panel does.

- [ ] **Step 4: Run the gate and confirm it passes**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(app)/systems/_health.ts" "frontend/app/(app)/systems/page.tsx" "frontend/app/(app)/systems/__tests__"
git commit -m "feat(systems): next scheduled run and DQS trend arrow on the systems list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Self-review against spec section 1

| Spec item | Task |
|---|---|
| Fix 1: `_completed` scope filter | 1 (required `scope` argument) |
| Fix 1: `_send_immediate_critical` compares the same system | 1 |
| Fix 1: `send_alert_digest` sends one alert per system with `system_name` | 1 (plus a tenant-level SLA alert, see correction 7) |
| Fix 2: `daily_analysis` drops `run_checks.delay` and the stale `dqs_history` insert | 2 |
| Fix 3: migration 067 `system_id`, unique key (tenant, COALESCE(system_id, 'upload'), module, day) | 3 (with `::text`, correction 1) |
| Fix 3: pass `system_id` from `run_checks.py:665` | 3 (with `DO UPDATE`, correction 2) |
| Fix 4 UI: `trend-panel.tsx` on `getTrends` | 5 |
| Fix 4 UI: alert channels panel and `POST /alert-channels/{id}/test` | 6, 4 |
| Fix 4 UI: `/systems` next run and trend arrow | 7 |
| Fix 5 tests: per-system digest | 1 |
| Fix 5 tests: `dqs_history` upsert on pg | 3 |
| Fix 5 tests: vitest for both panels | 5, 6 (plus 7) |

Scheduling (`sync_profiles`, `schedules-panel.tsx`) and the regression monitor already exist. The spec asks for no change to either, and this plan makes none.

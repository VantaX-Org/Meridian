# RLS hardening — non-superuser `meridian_app` role

This runbook explains how to harden an existing Meridian deployment so row-level security actually enforces tenant isolation in every code path.

## Background — why this matters

Meridian's schema has `ENABLE ROW LEVEL SECURITY` and a `tenant_isolation` policy on every tenant-scoped table. The policy reads `current_setting('app.tenant_id')` and only admits rows that match. Every request path calls `SET app.tenant_id` before running queries.

**The catch**: Postgres silently bypasses RLS in two cases:

1. The connecting role is a **superuser**.
2. The connecting role is the **table owner** and the table does not have `FORCE ROW LEVEL SECURITY`.

By default, Docker Compose's `POSTGRES_USER=meridian` is both a superuser and the owner of every table that Alembic creates. So up to and including migration 038, **RLS was effectively disabled in production** — a missing `SET` anywhere in the code path would have silently leaked data across tenants.

The fixes shipped in two parts:

- Migration **039** adds `FORCE ROW LEVEL SECURITY` to every enabled table — this catches the owner case for non-superusers.
- Migration **040** creates a non-superuser `meridian_app` role that the API and workers should connect as. This is the piece that closes the superuser loophole.

New deployments from `meridian-deploy.sh` get this split automatically. **Existing deployments need to opt in** by following the steps below.

## Opt-in steps (existing deployment)

You need access to the host running `docker compose` for your Meridian stack. Expect ~5 minutes of API downtime.

### 1. Stop the runtime services (keep the DB up)

```bash
cd /opt/meridian
docker compose -f docker/docker-compose.customer.yml stop api worker frontend beat
```

### 2. Add the new password to `.env`

Generate a strong password and append it to `/opt/meridian/.env`:

```bash
MERIDIAN_APP_PW=$(openssl rand -hex 16)
echo "MERIDIAN_APP_PASSWORD=${MERIDIAN_APP_PW}" >> .env
```

Keep `DB_PASSWORD` (the existing `meridian` owner password) unchanged.

### 3. Run migration 040

The migration reads `MERIDIAN_APP_PASSWORD` via the env you just added and creates the role.

```bash
docker compose -f docker/docker-compose.customer.yml run --rm -T api alembic upgrade head
```

Verify the role exists and is not a superuser:

```bash
docker compose -f docker/docker-compose.customer.yml exec -T db \
    psql -U meridian -d meridian -c \
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'meridian_app'"
```

Expected output: `rolsuper = f`, `rolbypassrls = f`.

### 4. Switch the runtime URLs in `.env`

Replace the existing `DATABASE_URL` + `DATABASE_URL_SYNC` lines so they use `meridian_app`, and add `DATABASE_URL_MIGRATE` so Alembic keeps using the owner:

```
DATABASE_URL=postgresql+asyncpg://meridian_app:<MERIDIAN_APP_PW>@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian_app:<MERIDIAN_APP_PW>@db:5432/meridian
DATABASE_URL_MIGRATE=postgresql://meridian:<DB_PASSWORD>@db:5432/meridian
```

Replace `<MERIDIAN_APP_PW>` and `<DB_PASSWORD>` with the literal values. **Do not** use shell variable substitution — Docker Compose reads `.env` verbatim.

### 5. Bring the stack back up

```bash
docker compose -f docker/docker-compose.customer.yml up -d
```

### 6. Verify

- Dashboard loads, you can log in, findings are visible.
- `/api/v1/admin/doctor` reports `postgres = ok`.
- Audit log still receives entries on mutations:
  ```bash
  docker compose -f docker/docker-compose.customer.yml exec -T db \
      psql -U meridian -d meridian -c "SELECT COUNT(*) FROM audit_log"
  ```

### 7. Rotation / rollback

**To rotate `MERIDIAN_APP_PASSWORD` later**:

```bash
NEW=$(openssl rand -hex 16)
docker compose -f docker/docker-compose.customer.yml exec -T db \
    psql -U meridian -d meridian -c "ALTER ROLE meridian_app WITH PASSWORD '${NEW}'"
# Update .env: MERIDIAN_APP_PASSWORD, DATABASE_URL, DATABASE_URL_SYNC
docker compose -f docker/docker-compose.customer.yml restart api worker
```

**To roll back** (not recommended — re-exposes the RLS gap):

1. In `.env`, replace `meridian_app` with `meridian` in `DATABASE_URL` + `DATABASE_URL_SYNC`, and use `DB_PASSWORD` as the password. Remove `DATABASE_URL_MIGRATE`.
2. `docker compose ... restart api worker beat`.

The `meridian_app` role can stay in place — it's harmless if nothing connects as it.

## New deployments

`scripts/meridian-deploy.sh` (since commit XXXX — the one introducing this runbook) writes all three URLs to `.env` by default. No opt-in needed. The post-install state is already hardened.

## Troubleshooting

**`permission denied for table <x>`** after switch: the migration's `GRANT` didn't cover a table that was created outside the normal migration path (hand-crafted by a script, or from an older migration). Fix: run the GRANT manually as the owner:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO meridian_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meridian_app;
```

**`role "meridian_app" does not exist`**: you ran `alembic upgrade head` without `MERIDIAN_APP_PASSWORD` in env AND the Postgres server hasn't run migration 040 yet. Re-run the migration step (step 3).

**`current setting of parameter "meridian.app_password" cannot be changed`**: your Postgres is older than 9.2 (very unlikely — we ship 16). If you see this, check the db container's Postgres version and upgrade.

**RLS test locally**: the `tests/test_rls_integration.py` suite creates its own non-superuser role on the fly — you can point it at any Postgres to verify end-to-end:

```bash
MERIDIAN_TEST_DB_URL=postgresql://meridian:<pw>@localhost:5433/meridian_rls_test \
    pytest tests/test_rls_integration.py -v
```

Four cases should pass: tenant isolation, cross-tenant UPDATE block, audit_log RLS, unset-tenant-returns-nothing.

-- D1 Migration 003: lockout + sessions + audit
--
-- Three features shipped together because they share the auth surface and
-- each is small on its own:
--
--   1. Account lockout on repeated failed admin logins (item 4).
--      Columns `failed_attempts`, `locked_until` on `admins`.
--
--   2. JWT revocation via jti (item 7).
--      Table `admin_sessions` (jti PK, admin_id, expires_at, revoked_at).
--      verifyJwt rejects a token whose jti is revoked or whose session
--      has been explicitly expired. POST /api/admin/logout revokes the
--      current session.
--
--   3. Admin audit log (item 6).
--      Table `admin_audit` captures every mutation on admin endpoints.
--      Similar shape to the customer-side audit_log (migration 038 in
--      the Postgres schema) but lives in D1.

-- ── 1. Lockout columns on admins ────────────────────────────────────────────
ALTER TABLE admins ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN locked_until TEXT; -- ISO timestamp, NULL = not locked

-- ── 2. admin_sessions (JWT revocation) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
    jti TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_seen_at TEXT,
    ip TEXT,
    user_agent TEXT,
    FOREIGN KEY (admin_id) REFERENCES admins(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- ── 3. admin_audit (mutation log) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit (
    id TEXT PRIMARY KEY,
    admin_id TEXT,             -- NULL for failed-auth paths
    admin_email TEXT,
    action TEXT NOT NULL,       -- verb derived from method+path tail
    entity_type TEXT,           -- e.g. 'tenant', 'rule'
    entity_id TEXT,             -- target id when present
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit(entity_type, entity_id);

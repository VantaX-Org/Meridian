-- D1 Migration 002: harden tenant_users password storage
--
-- Before this migration, tenant_users.password_hash held raw SHA-256 of the
-- password with no salt. That's trivially rainbow-tableable and (combined
-- with the `WHERE email = ? AND password_hash = ?` lookup in
-- handleTenantUserLogin) gave a timing oracle for email enumeration.
--
-- After: we support a per-row `password_scheme` so both legacy (sha256)
-- and new (pbkdf2) entries coexist during migration. New sign-ups always
-- use pbkdf2 with a random salt; logins dispatch on the scheme.

ALTER TABLE tenant_users ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_users ADD COLUMN password_scheme TEXT NOT NULL DEFAULT 'sha256'
    CHECK (password_scheme IN ('sha256', 'pbkdf2'));
ALTER TABLE tenant_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenant_users ADD COLUMN last_login_at TEXT;

-- Operators should rotate legacy sha256 users to pbkdf2 on first login
-- (the handler transparently upgrades when a successful legacy login
-- happens). Any remaining sha256 rows after a reasonable grace period
-- can be forced to re-register via `password_scheme = 'locked'`.

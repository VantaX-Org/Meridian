import { beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { hashPassword } from "../password-hash";

export const TEST_ADMIN_EMAIL = "test-admin@meridian.local";
export const TEST_ADMIN_PASSWORD = "test-admin-password-pbkdf2";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    licence_key_hash TEXT UNIQUE,
    licence_key_suffix TEXT,
    tier TEXT NOT NULL DEFAULT 'starter',
    status TEXT NOT NULL DEFAULT 'trial',
    expiry_date TEXT NOT NULL,
    enabled_modules TEXT NOT NULL DEFAULT '[]',
    enabled_menu_items TEXT NOT NULL DEFAULT '[]',
    features TEXT NOT NULL DEFAULT '{}',
    llm_config TEXT NOT NULL DEFAULT '{}',
    machine_fingerprint TEXT,
    last_ping TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    enabled INTEGER NOT NULL DEFAULT 1,
    conditions TEXT NOT NULL DEFAULT '[]',
    thresholds TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_mappings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    module TEXT NOT NULL,
    standard_field TEXT NOT NULL,
    standard_label TEXT,
    customer_field TEXT,
    customer_label TEXT,
    data_type TEXT NOT NULL DEFAULT 'string',
    is_mapped INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, module, standard_field)
);

CREATE TABLE IF NOT EXISTS tenant_users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL DEFAULT '',
    password_scheme TEXT NOT NULL DEFAULT 'sha256',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('admin', 'readonly')),
    created_at TEXT,
    updated_at TEXT,
    last_login_at TEXT,
    is_active INTEGER DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    jti TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_seen_at TEXT,
    ip TEXT,
    user_agent TEXT
);

CREATE TABLE IF NOT EXISTS admin_audit (
    id TEXT PRIMARY KEY,
    admin_id TEXT,
    admin_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_key_hash ON tenants(licence_key_hash);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_rules_module ON rules(module);
CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);
CREATE INDEX IF NOT EXISTS idx_field_mappings_tenant ON field_mappings(tenant_id, module);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON tenant_users(email);
`;

beforeAll(async () => {
  const db = env.DB as D1Database;
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }

  // Seed a PBKDF2-hashed admin for tests that need to go through the
  // real /api/admin/login + JWT flow (which every admin endpoint now
  // requires — the old X-Admin-Secret path has been gone for a while).
  const { hash, salt } = await hashPassword(TEST_ADMIN_PASSWORD);
  await db
    .prepare(
      "INSERT OR REPLACE INTO admins (id, email, password_hash, password_salt, role, is_active) " +
      "VALUES (?, ?, ?, ?, 'admin', 1)"
    )
    .bind("test-admin-id", TEST_ADMIN_EMAIL, hash, salt)
    .run();
});

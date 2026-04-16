import { beforeAll } from "vitest";
import { env } from "cloudflare:test";

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
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_tenants_key_hash ON tenants(licence_key_hash);
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
});

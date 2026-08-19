-- Meridian Licence Worker — Cloudflare D1 schema
-- Run: wrangler d1 execute meridian-licence --file=schema.sql

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    licence_key_hash TEXT UNIQUE,
    licence_key_suffix TEXT,   -- last 4 chars for masked display (e.g. "7F2A")
    tier TEXT NOT NULL DEFAULT 'starter',   -- starter | professional | enterprise
    status TEXT NOT NULL DEFAULT 'trial',   -- active | suspended | trial | expired
    expiry_date TEXT NOT NULL,              -- ISO date string (YYYY-MM-DD)
    enabled_modules TEXT NOT NULL DEFAULT '[]',       -- JSON array of module IDs
    enabled_menu_items TEXT NOT NULL DEFAULT '[]',    -- JSON array of menu item keys
    features TEXT NOT NULL DEFAULT '{}',              -- JSON object of feature flags
    llm_config TEXT NOT NULL DEFAULT '{}',            -- JSON: { tier, model, notes }
    machine_fingerprint TEXT,              -- last seen fingerprint
    last_ping TEXT,                        -- ISO timestamp of last validation
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    category TEXT NOT NULL,   -- ecc | successfactors | warehouse
    severity TEXT NOT NULL DEFAULT 'medium',  -- critical | high | medium | low | info
    enabled INTEGER NOT NULL DEFAULT 1,
    conditions TEXT NOT NULL DEFAULT '[]',    -- JSON array of condition objects
    thresholds TEXT NOT NULL DEFAULT '{}',    -- JSON object
    tags TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
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
    role TEXT NOT NULL DEFAULT 'admin',  -- admin | analyst | viewer
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, email)
);

-- Soft node-lock: distinct fingerprints seen per tenant (sharing-detection signal,
-- never an enforcement gate — the client fingerprint changes on container restart).
CREATE TABLE IF NOT EXISTS licence_nodes (
    tenant_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    ping_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, fingerprint)
);

-- Platform release metadata (singleton) — one global "latest version" row
-- for the whole product, published from the HQ portal's Releases admin page
-- and surfaced to every customer deployment via /api/licence/validate so it
-- can prompt an admin to trigger a one-click update.
CREATE TABLE IF NOT EXISTS platform_releases (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    latest_version TEXT NOT NULL DEFAULT '',
    release_notes TEXT NOT NULL DEFAULT '',
    released_at TEXT,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO platform_releases (id, latest_version, release_notes, updated_at)
VALUES (1, '', '', datetime('now'));

CREATE INDEX IF NOT EXISTS idx_licence_nodes_tenant ON licence_nodes(tenant_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_tenants_key_hash ON tenants(licence_key_hash);
CREATE INDEX IF NOT EXISTS idx_rules_module ON rules(module);
CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);
CREATE INDEX IF NOT EXISTS idx_field_mappings_tenant ON field_mappings(tenant_id, module);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON tenant_users(email);

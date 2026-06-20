-- 005 — soft node-lock fingerprint tracking.
-- Records each distinct client fingerprint seen per tenant. Used only as a
-- licence-sharing SIGNAL for admin (concurrent distinct nodes); never rejects.
-- The client fingerprint = sha256(hostname + MAC) changes on container restart,
-- so a hard lock would lock out legitimate customers — this is observe-only.
CREATE TABLE IF NOT EXISTS licence_nodes (
    tenant_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    ping_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_licence_nodes_tenant ON licence_nodes(tenant_id, last_seen);

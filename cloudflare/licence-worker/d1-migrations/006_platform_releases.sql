-- 006 — platform release metadata (singleton).
-- One global "latest platform version" row for the whole product, not
-- per-tenant. The customer-side update-notification feature polls the
-- existing /api/licence/validate response for latest_version/release_notes
-- and prompts the admin to trigger a one-click update when it differs from
-- the running version. Published from the HQ portal's Releases admin page.
CREATE TABLE IF NOT EXISTS platform_releases (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    latest_version TEXT NOT NULL DEFAULT '',
    release_notes TEXT NOT NULL DEFAULT '',
    released_at TEXT,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO platform_releases (id, latest_version, release_notes, updated_at)
VALUES (1, '', '', datetime('now'));

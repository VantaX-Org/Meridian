-- 007 — forced platform update.
-- min_version: deployments running an older version update themselves at the
-- next idle moment inside their update window ('' = no forced update).
-- force_now: security release — ignore the update window (still waits for
-- running jobs). Both are set by an admin only; the CI release token never
-- touches them.
ALTER TABLE platform_releases ADD COLUMN min_version TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_releases ADD COLUMN force_now INTEGER NOT NULL DEFAULT 0;

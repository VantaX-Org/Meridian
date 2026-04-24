-- D1 Migration 004: TOTP MFA for HQ admins
--
-- HQ portal admins have authority over every customer's tenant record,
-- licence keys, rules, and billing data. A single credential leak was
-- enough to compromise every customer — closed by adding TOTP.
--
-- Enrolment flow (see handleMfaEnroll / handleMfaVerify in the worker):
--   1. Admin calls POST /api/admin/mfa/enroll → server generates a
--      secret, stores it with mfa_enabled=0, returns otpauth:// URI
--      the admin scans into their authenticator.
--   2. Admin calls POST /api/admin/mfa/verify with a 6-digit code.
--      Server verifies the code against the pending secret and sets
--      mfa_enabled=1, mfa_enrolled_at=now().
--   3. Future /api/admin/login calls now require a `mfa_code` field
--      on the body (or return mfa_required=true and no token if the
--      code is absent/invalid).

ALTER TABLE admins ADD COLUMN mfa_secret TEXT;       -- base32, 20 bytes / 160 bits
ALTER TABLE admins ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN mfa_enrolled_at TEXT;
-- Single-use recovery code hash; if admin loses their device they can
-- redeem this once, which resets mfa_enabled and mfa_secret. Ops
-- reissues a new code after redemption.
ALTER TABLE admins ADD COLUMN mfa_recovery_hash TEXT;

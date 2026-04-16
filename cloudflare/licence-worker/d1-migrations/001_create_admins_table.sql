-- D1 Migration: Create admins table with PBKDF2 password hashing
-- Task 09: Replaces plaintext passwords with PBKDF2-SHA256 (100k iterations)

CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL,
    -- PBKDF2 hash (hex-encoded, 32 bytes = 64 hex chars)
    password_hash TEXT NOT NULL,
    -- Salt for the password (hex-encoded, 32 bytes = 64 hex chars)
    password_salt TEXT NOT NULL,
    -- Role: admin, readonly
    role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('admin', 'readonly')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    is_active BOOLEAN DEFAULT 1
);

-- Index for email lookups during auth
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_is_active ON admins(is_active);

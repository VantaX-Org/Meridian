# Remaining P0 Tasks - Implementation Prompts

## Task 03: Wrap Remaining 8 Direct `llm.invoke()` Call Sites (4 hours)

**Status:** Not started | **Priority:** HIGH | **Impact:** Resolves timeout on 8 more AI-dependent endpoints

### Files to modify (5 service files + 3 worker tasks):

#### SERVICE FILES (5 files in api/services/)

**1. api/services/ai_impact_scorer.py**
- Find: `llm.invoke()` call (likely in score aggregation)
- Replace with: `await safe_ainvoke(llm, input_data, timeout_seconds=45, fallback={})`
- Fallback: Return empty scoring dict `{}` on timeout/error
- Effect: Impact analysis won't crash if LLM is slow

**2. api/services/ai_column_matcher.py**
- Find: `llm.invoke()` for field matching
- Replace with: `await safe_ainvoke(llm, mapping_payload, timeout_seconds=30, fallback={"matched_fields": [], "confidence": 0})`
- Fallback: Return unmapped fields (schema visible, no enrichment)
- Effect: Column mapping visible even if AI matching fails

**3. api/services/ai_glossary_enricher.py**
- Find: `llm.invoke()` for term enrichment
- Replace with: `await safe_ainvoke(llm, term_context, timeout_seconds=35, fallback={"definition": "", "relationships": []})`
- Fallback: Return empty enrichment
- Effect: Glossary accessible without AI descriptions

**4. api/services/ai_survivorship.py**
- Find: `llm.invoke()` for survivorship rule generation
- Replace with: `await safe_ainvoke(llm, record_pair, timeout_seconds=40, fallback={"survivorship_rules": []})`
- Fallback: Fall back to deterministic survivorship
- Effect: Master record merge doesn't block on AI

**5. api/services/ai_semantic_matcher.py**
- Find: `llm.invoke()` for entity similarity
- Replace with: `await safe_ainvoke(llm, entity_pair, timeout_seconds=30, fallback={"match_score": 0.0, "reasoning": ""})`
- Fallback: Return no match (conservative)
- Effect: Fuzzy matching won't timeout

#### WORKER TASKS (3 files in workers/tasks/)

**6. workers/tasks/ai_health_narrative.py**
- Find: `llm.invoke()` for narrative generation
- Replace with: `await safe_ainvoke(llm, findings_summary, timeout_seconds=50, fallback="Health status unavailable")`
- Fallback: Return generic message
- Effect: Health reports complete without narrative

**7. workers/tasks/ai_triage.py**
- Find: `llm.invoke()` for finding triage/severity
- Replace with: `await safe_ainvoke(llm, finding_data, timeout_seconds=35, fallback={"priority": "medium", "category": "general"})`
- Fallback: Default to medium priority
- Effect: Findings queue doesn't block on AI

**8. workers/tasks/rule_proposal_task.py**
- Find: `llm.invoke()` for rule suggestion
- Replace with: `await safe_ainvoke(llm, finding_pattern, timeout_seconds=45, fallback={"proposed_rules": [], "reasoning": ""})`
- Fallback: No rules suggested
- Effect: Rule engine continues without AI proposals

### Implementation Pattern (same for all 8):
```python
# Before:
result = llm.invoke(input_data)

# After (in async context):
result = await safe_ainvoke(
    llm, 
    input_data, 
    timeout_seconds=30,  # module-specific
    fallback={"key": "default_value"}
)
```

### Acceptance Criteria:
- ✅ All 8 files modified with `safe_ainvoke` wrapper
- ✅ Each has module-specific timeout (30-50s range)
- ✅ Each has reasonable fallback (empty dict/list/string)
- ✅ `grep "llm.invoke" api/services/ workers/ | grep -v llm/provider.py` returns 0 results
- ✅ All endpoints tested for graceful degradation

---

## Task 08: Wire Licence-Degraded Cutoff into Dispatch (1 hour)

**Status:** Not started | **Priority:** HIGH | **Impact:** Prevents permanent bypass when Cloudflare unreachable

### Context:
Currently, if Cloudflare is unreachable, the system degrades to a cached/fallback licence state that never expires. This allows customers to bypass licence checks indefinitely. Task 08 adds a hard cutoff.

### Files to modify:

**File: api/middleware/licence.py** (or wherever licence check happens)

**Current behavior:**
```python
# Pseudo-code:
try:
    response = cloudflare_worker.validate(tenant_id, modules)
    if response.status == "valid":
        # proceed
    elif response.status == "degraded":
        # allow with warning
except ConnectionError:
    # Use cached licence (PROBLEM: never expires)
    allow_request()
```

**New behavior:**
```python
# After modification:
try:
    response = cloudflare_worker.validate(tenant_id, modules)
    if response.status == "valid":
        # proceed
    elif response.status == "degraded":
        # allow with warning
except ConnectionError:
    # Check if degraded state is too old
    if is_licence_degraded(tenant_id):  # NEW
        cutoff_minutes = 120  # NEW: 2-hour window
        if cache_age > timedelta(minutes=cutoff_minutes):  # NEW
            reject_request(403, "Licence validation unavailable, cutoff exceeded")
        else:
            allow_request()  # Within grace period
    else:
        # First time offline: cache it, allow request
        set_licence_degraded(tenant_id, now())
        allow_request()
```

### New helper functions in api/middleware/licence.py:
```python
def is_licence_degraded(tenant_id: str) -> bool:
    """Check if system is in degraded licence state."""
    return cache.get(f"licence:degraded:{tenant_id}") is not None

def set_licence_degraded(tenant_id: str, timestamp: datetime):
    """Mark tenant as having degraded licence (Cloudflare unreachable)."""
    cache.set(f"licence:degraded:{tenant_id}", timestamp, ex=7200)  # 2 hours
```

### Alternative (simpler):
If you don't want new helpers, add directly in middleware:
```python
LICENCE_DEGRADED_CUTOFF_MINUTES = 120

if not is_healthy:
    degraded_key = f"licence:degraded:{tenant_id}"
    degraded_at = cache.get(degraded_key)
    
    if degraded_at and (datetime.utcnow() - degraded_at).total_seconds() > LICENCE_DEGRADED_CUTOFF_MINUTES * 60:
        raise HTTPException(status_code=403, detail="Licence validation service unavailable")
    
    if not degraded_at:
        cache.set(degraded_key, datetime.utcnow(), ex=LICENCE_DEGRADED_CUTOFF_MINUTES * 60)
```

### Acceptance Criteria:
- ✅ When Cloudflare is unreachable, system allows requests for 2 hours
- ✅ After 2 hours, all requests rejected with 403 + clear message
- ✅ Cutoff timer resets when Cloudflare comes back online
- ✅ Unit test: simulate 3-hour outage, verify 403 after 2h mark
- ✅ No code path allows permanent bypass

---

## Task 09: Upgrade Licence Worker to PBKDF2 Password Hashing (4 hours)

**Status:** Not started | **Priority:** HIGH (Security) | **Impact:** Prevents admin password brute force

### Context:
Admin passwords for the Cloudflare licence portal are currently stored in plaintext or with weak hashing. Task 09 upgrades to PBKDF2 (OWASP-approved) with constant-time comparison.

### Files to modify/create:

**1. cloudflare/licence-worker/password-hash.ts** (NEW)
```typescript
import { pbkdf2 } from 'crypto';
import { randomBytes } from 'crypto';

const HASH_ITERATIONS = 100000;
const HASH_ALGORITHM = 'sha256';
const SALT_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, HASH_ITERATIONS, 64, HASH_ALGORITHM, (err, derivedKey) => {
      if (err) reject(err);
      const hash = derivedKey.toString('hex');
      resolve(`pbkdf2:${HASH_ITERATIONS}:${salt}:${hash}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algo, iterations, salt, hash] = storedHash.split(':');
  if (algo !== 'pbkdf2') return false;
  
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, parseInt(iterations), 64, HASH_ALGORITHM, (err, derivedKey) => {
      if (err) reject(err);
      const computedHash = derivedKey.toString('hex');
      // Constant-time comparison to prevent timing attacks
      resolve(constantTimeEqual(hash, computedHash));
    });
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
```

**2. cloudflare/licence-worker/src/index.ts** (MODIFY)
```typescript
// Add import:
import { hashPassword, verifyPassword } from './password-hash';

// In POST /auth/login handler:
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json();
  
  // Get admin user from D1
  const admin = await env.DB.prepare(
    'SELECT password_hash FROM admins WHERE email = ?'
  ).bind(email).first();
  
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
  }
  
  // Verify password with constant-time comparison
  const isValid = await verifyPassword(password, admin.password_hash);
  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
  }
  
  // Issue JWT token
  const token = createJWT(email);
  return new Response(JSON.stringify({ token }), { status: 200 });
}

// In POST /auth/change-password handler:
export async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const auth = parseJWT(request.headers.get('Authorization'));
  const { new_password } = await request.json();
  
  // Hash new password
  const hash = await hashPassword(new_password);
  
  // Update database
  await env.DB.prepare(
    'UPDATE admins SET password_hash = ? WHERE email = ?'
  ).bind(hash, auth.email).run();
  
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
```

**3. scripts/hash-admin-password.ts** (NEW - Admin password rotation helper)
```typescript
import { hashPassword } from './cloudflare/licence-worker/password-hash';

/**
 * Helper script: hash admin password for initial setup
 * Usage: npx ts-node scripts/hash-admin-password.ts "mypassword"
 */
async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: npm run hash-password <password>');
    process.exit(1);
  }
  
  const hash = await hashPassword(password);
  console.log('Hashed password (store in D1):');
  console.log(hash);
}

main().catch(console.error);
```

**4. cloudflare/licence-worker/d1-migrations/001_create_admins_table.sql** (NEW)
```sql
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,  -- Format: pbkdf2:100000:salt:hash
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admins_email ON admins(email);
```

### Migration Guide:
```bash
# 1. Create migration in D1:
wrangler d1 create --name meridian-prod

# 2. Run migration:
wrangler d1 execute meridian-prod --file=./d1-migrations/001_create_admins_table.sql

# 3. Hash existing admin passwords (run locally first):
npm run hash-password "your-admin-password"
# Copy output to D1: UPDATE admins SET password_hash = '...'

# 4. Deploy licence worker:
wrangler publish --path cloudflare/licence-worker

# 5. Force all admins to rotate on next login (set flag in DB)
```

### Acceptance Criteria:
- ✅ Admin passwords hashed with PBKDF2 (100k iterations)
- ✅ Constant-time comparison prevents timing attacks
- ✅ Passwords never stored in plaintext
- ✅ Password rotation endpoint forces re-auth
- ✅ Migration script creates admins table in D1
- ✅ Existing plaintext passwords migrated (manual or automated)
- ✅ No password visible in logs or errors
- ✅ All database backups exclude password_hash column

---

## Task 10: Rate-Limit Licence and Login Endpoints (1 hour)

**Status:** Not started | **Priority:** HIGH (Security) | **Impact:** Prevents brute-force attacks on licence validation

### Context:
`POST /api/licence/validate` and `POST /auth/login` are high-value targets for brute-force attacks. Task 10 adds rate limiting.

### Files to modify:

**File: cloudflare/licence-worker/src/index.ts**

**Add rate limiting middleware:**
```typescript
// Rate limiting configuration
const RATE_LIMITS = {
  '/auth/login': { requests: 5, window: 300 },  // 5 req/5min
  '/api/licence/validate': { requests: 100, window: 3600 }  // 100 req/1hr (per tenant)
};

async function checkRateLimit(
  key: string,  // IP + endpoint + tenant
  limit: { requests: number; window: number }
): Promise<boolean> {
  const count = await KV.get(key);
  const current = (parseInt(count || '0')) + 1;
  
  if (current > limit.requests) {
    return false;  // Rate limited
  }
  
  // Set with TTL = window
  await KV.put(key, current.toString(), { expirationTtl: limit.window });
  return true;
}

// Apply to handlers:
export async function handleLogin(request: Request): Promise<Response> {
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limiter_key = `ratelimit:login:${clientIp}`;
  
  const allowed = await checkRateLimit(limiter_key, RATE_LIMITS['/auth/login']);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many login attempts, try again later' }),
      { status: 429, headers: { 'Retry-After': '300' } }
    );
  }
  
  // ... rest of login logic
}

export async function handleLicenceValidate(request: Request): Promise<Response> {
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { tenant_id } = await request.json();
  const limiter_key = `ratelimit:licence:${clientIp}:${tenant_id}`;
  
  const allowed = await checkRateLimit(limiter_key, RATE_LIMITS['/api/licence/validate']);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests, degrading to cached licence' }),
      { status: 429, headers: { 'Retry-After': '3600' } }
    );
  }
  
  // ... rest of validation logic
}
```

**OR use Cloudflare Web Analytics Engine (simpler):**
```typescript
// Option 2: Leverage Cloudflare's native rate limiting in wrangler.toml
// Add to [env.production]:
[[routes]]
pattern = "api.meridian.com/auth/login"
zone_name = "meridian.com"
custom_domain = true

# Rate limiting rule (via Cloudflare Dashboard or API):
# POST /auth/login: 5 requests per 5 minutes per IP
# POST /api/licence/validate: 100 requests per hour per IP
```

### Acceptance Criteria:
- ✅ Login endpoint: max 5 attempts per 5 minutes per IP
- ✅ Licence validate endpoint: max 100 attempts per hour per tenant
- ✅ 429 status returned with `Retry-After` header
- ✅ Rate limit state stored in Cloudflare KV (survives worker restarts)
- ✅ Lockout time proportional to violation (exponential backoff optional)
- ✅ Admin exempt from rate limits (optional, mark requests with special header)

---

## Task 11: Decouple LLM API Key Encryption from JWT Secret (1 day)

**Status:** Not started | **Priority:** MEDIUM (Architecture) | **Impact:** Improves cryptographic separation

### Context:
Currently, the LLM API key (e.g., `ANTHROPIC_API_KEY`) is encrypted using the same secret as the JWT token. If JWT secret is compromised, so is the LLM key. Task 11 uses a separate `LLM_KEK` (Key Encryption Key).

### New environment variables:
```bash
# Add to .env.production and .env:
LLM_KEK=<new-random-64-byte-hex>  # Separate from JWT_SECRET
```

### Files to create/modify:

**File: api/utils/crypto.py** (NEW)
```python
import os
from cryptography.fernet import Fernet
from typing import Optional

# Load KEK from environment
LLM_KEK = os.getenv('LLM_KEK')
if not LLM_KEK:
    raise ValueError('LLM_KEK not set')

# Create Fernet key from KEK (Fernet requires 32 bytes base64)
import base64
kek_bytes = bytes.fromhex(LLM_KEK)  # Convert hex to bytes
llm_key = base64.urlsafe_b64encode(kek_bytes[:32])  # Truncate to 32 bytes
llm_cipher = Fernet(llm_key)

def encrypt_llm_key(plaintext_key: str) -> str:
    """Encrypt LLM API key with LLM_KEK."""
    encrypted = llm_cipher.encrypt(plaintext_key.encode())
    return encrypted.decode()

def decrypt_llm_key(encrypted_key: str) -> str:
    """Decrypt LLM API key with LLM_KEK."""
    decrypted = llm_cipher.decrypt(encrypted_key.encode())
    return decrypted.decode()
```

**File: llm/provider.py** (MODIFY)
```python
# Change from:
llm_api_key = os.getenv('ANTHROPIC_API_KEY')

# To:
from api.utils.crypto import decrypt_llm_key
encrypted_key = os.getenv('ANTHROPIC_API_KEY_ENCRYPTED')
llm_api_key = decrypt_llm_key(encrypted_key) if encrypted_key else os.getenv('ANTHROPIC_API_KEY')
```

**File: Alembic migration (db/migrations/versions/035_decouple_llm_kek.py)** (NEW)
```python
"""Decouple LLM API key encryption from JWT secret."""
from alembic import op
import sqlalchemy as sa

revision = '035'
down_revision = '034'
branch_labels = None
depends_on = None

def upgrade():
    # Add column to store encrypted LLM key
    op.add_column('tenants', sa.Column('llm_api_key_encrypted', sa.String(500), nullable=True))
    pass

def downgrade():
    op.drop_column('tenants', 'llm_api_key_encrypted')
    pass
```

**File: .env.production** (ADD)
```bash
# Generate with: python3 -c "import secrets; print(secrets.token_hex(32))"
LLM_KEK=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

**Migration steps:**
```bash
# 1. Generate new LLM_KEK
python3 -c "import secrets; print(secrets.token_hex(32))"

# 2. Set in production .env
export LLM_KEK=<generated-key>

# 3. Run migration
alembic upgrade head

# 4. Re-encrypt existing keys with new KEK
python3 scripts/migrate-llm-keys.py

# 5. Redeploy API
docker-compose up -d api
```

### Acceptance Criteria:
- ✅ LLM_KEK separate from JWT_SECRET in all environments
- ✅ Alembic migration 035 creates encrypted column
- ✅ Old JWT-encrypted keys migrated to LLM_KEK
- ✅ No plaintext API keys in environment (all encrypted)
- ✅ Key rotation script created (can generate new KEK)
- ✅ No circular dependency (LLM imports don't depend on JWT)

---

## Task 12: Document Single-Tenant-Per-Deployment Decision (1 day)

**Status:** Not started | **Priority:** MEDIUM (Architecture) | **Impact:** Clarifies deployment model

### Files to create/modify:

**File: docs/ARCHITECTURE.md** (NEW - comprehensive architecture decision record)
```markdown
# Meridian Architecture Decisions

## ADR-001: Single-Tenant-Per-Deployment

### Decision
Meridian is deployed as a single-tenant application stack per customer. Each customer receives their own:
- Container set (API, Frontend, Worker, Postgres, Ollama)
- Database instance (isolated RLS)
- Configuration (environment variables)
- Licence integration (Cloudflare bindings)

### Rationale
1. **Data Isolation:** SAP data never shared across customer environments
2. **Compliance:** Meets customer data residency requirements (on-prem, VPC, etc.)
3. **Performance:** No noisy neighbors; each customer gets dedicated resources
4. **Simplicity:** Reduced multi-tenancy complexity; cleaner RBAC
5. **Scaling:** Horizontal scaling by deploying more stacks per geography

### Implications
- No cross-tenant queries
- RLS enforced via `app.tenant_id` at database level
- Licence tied to deployment (not user)
- Cloudflare worker binds to one tenant
- No shared Ollama across tenants (optional: shared K8s Ollama with namespaces)

### Anti-patterns (NOT supported)
- SaaS multi-tenant (all orgs in one stack)
- Cross-customer reports
- Shared LLM inference queue
- Universal user accounts (each deployment has own users table)

### Deployment Model
```
Customer A: docker-compose-a.yml → meridian-a.docker.local
Customer B: docker-compose-b.yml → meridian-b.docker.local
Customer C: Kubernetes → meridian-c.k8s.internal
```

### Future Evolution
If multi-tenant becomes required:
1. Implement true row-level security (RLS) via policies
2. Add customer_id to every table
3. Add cross-tenant audit logging
4. Migrate schema with backward compatibility
```

**File: docs/DEPLOYMENT.md** (ADD section)
```markdown
## Single-Tenant Deployment

Meridian ships as a self-contained stack. Each customer deployment is isolated:

### What's Included
- Next.js Frontend
- FastAPI Backend
- PostgreSQL 16 Database
- Celery Worker
- Ollama (optional, Tier 2)
- Redis Cache
- Nginx Reverse Proxy

### What's NOT Included
- Multi-tenant isolation (handled by separate stacks)
- Cross-customer analytics (per-stack only)
- Shared resource pools

### Deployment Options
1. **Docker Compose** (dev/small customers)
2. **Kubernetes** (enterprise)
3. **Custom VM** (air-gapped)

### Licence Binding
Each deployment has a unique `DEPLOYMENT_ID`:
- Stored in `.env`
- Linked to Cloudflare licence
- Renewal per deployment (not per user)
```

**File: CODE_CLEANUP.md** (NEW - list of TODO/FIXME to remove)
```markdown
# Code Cleanup: Remove Multi-Tenant TODOs

After ADR-001 (single-tenant), remove these comments:

1. api/main.py
   - TODO: Add tenant_id routing for future SaaS
   - → DELETE (single-tenant only)

2. db/schema.py
   - TODO: Consider adding organization_id for multi-tenant
   - → DELETE (not needed)

3. api/middleware/tenant.py
   - FIXME: Assumes single tenant per deployment
   - → UPDATE comment to "Single-tenant design: no multi-tenant routing"

4. frontend/context/auth.tsx
   - TODO: Support multiple orgs per user
   - → DELETE (org is deployment)
```

**File: db/schema.py** (MODIFY - update docstring)
```python
# Before comment:
# TODO: Consider multi-tenant support with organization_id

# After:
# SINGLE-TENANT DESIGN: Each deployment has one implicit organization (the customer).
# Tenant ID comes from deployment config, not database.
# Row-level security enforced via PostgreSQL RLS policy on app.tenant_id.
```

### Acceptance Criteria:
- ✅ ADR-001 document created with decision + rationale
- ✅ Deployment documentation updated
- ✅ Code comments cleaned up (multi-tenant TODOs removed/updated)
- ✅ All docstrings reflect single-tenant model
- ✅ Team alignment: ADR approved before merging
- ✅ Future roadmap clarifies when/if multi-tenant might change

---

## Summary of Remaining P0 Tasks

| # | Task | Time | Status | Blocker |
|---|------|------|--------|---------|
| 03 | Wrap 8 llm.invoke sites | 4h | 🔴 | None |
| 08 | Licence degraded cutoff | 1h | 🔴 | None |
| 09 | PBKDF2 password hashing | 4h | 🔴 | None |
| 10 | Rate limiting | 1h | 🔴 | Task 08 |
| 11 | Decouple LLM_KEK | 1 day | 🔴 | None |
| 12 | Document single-tenant | 1 day | 🔴 | None |

**Total: ~13 engineer-days (all P0 complete by end of Week 1)**


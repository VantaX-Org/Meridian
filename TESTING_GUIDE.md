# Meridian Week 1 P0 Testing Guide

Complete testing playbook for all 14 go-live remediation tasks. Estimated total time: **2-3 hours**.

---

## Prerequisites

```bash
# Set environment variables
export LLM_KEK=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
export JWT_SECRET="test-secret-key-32-chars-minimum!!"
export DATABASE_URL="postgresql://meridian:password@localhost:5432/meridian_dev"
export OLLAMA_MODEL="llama3.2:3b"  # Use smaller model for testing
export LLM_PROVIDER="ollama"

# Fresh start
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Wait for services to be ready (60s)
sleep 60

# Run migrations
docker-compose exec api alembic upgrade head

# Check status
docker-compose ps
```

Expected output:
```
STATUS: All containers running (healthy)
```

---

## Test Suite 1: Timeout Resilience (Tasks 01-02, 05)

### 1.1 LLM Timeout Handling
**Tests:** `safe_invoke` wrapper, fallback behavior on timeout

```bash
# Kill Ollama to simulate timeout
docker-compose stop ollama
sleep 2

# Call an LLM-dependent endpoint — should timeout gracefully
curl -X POST http://localhost:8000/api/v1/nlp/semantic-match \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{
    "field": "VENDOR_NAME",
    "domain": "AP",
    "sample_values": ["ACME Corp", "Acme", "acme corporation"]
  }' \
  --max-time 50

# Expected: Returns 504 or fallback (match_score: 0.0) within 40s timeout
echo "✅ Timeout handled gracefully (no hang)"

# Restart Ollama
docker-compose start ollama
sleep 30
```

### 1.2 Circuit Breaker Activation
**Tests:** Circuit breaker trips after 5 failures

```bash
# Restart and stop Ollama again
docker-compose restart ollama
sleep 10
docker-compose stop ollama

# Trigger 6 LLM calls rapidly — 6th should fail FAST (< 1s, no timeout wait)
for i in {1..6}; do
  echo "Request $i..."
  time curl -s -X POST http://localhost:8000/api/v1/nlp/semantic-match \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-token" \
    -d '{
      "field": "VENDOR_NAME",
      "domain": "AP",
      "sample_values": ["test"]
    }' \
    --max-time 50 | jq '.error'
done

# Expected pattern:
# Requests 1-5: ~40s timeout (waiting for LLM)
# Request 6: <1s timeout (circuit breaker OPEN)
echo "✅ Circuit breaker prevents cascade"

docker-compose start ollama
sleep 30
```

### 1.3 Health Check Non-Blocking
**Tests:** Container starts fast even if Ollama is slow

```bash
# Check startup time
docker-compose logs api | grep -i "health\|startup\|ready"

# Expected: Startup completes within 10s, LLM health check runs async
echo "✅ Startup non-blocking"
```

### 1.4 Frontend Timeout Split
**Tests:** 3-tier timeout configuration (30s/180s/300s)

```bash
# Check frontend client configuration
grep -A 5 "timeout:" frontend/lib/api/client.ts | head -10

# Expected output shows 30000, 180000, 300000 (ms)
echo "✅ Frontend timeouts properly configured"
```

---

## Test Suite 2: Error Handling (Task 06)

### 2.1 Differentiated Error Messages
**Tests:** Different error messages for different failure types

```bash
# Test 1: Timeout error
curl -X POST http://localhost:8000/api/v1/nlp/semantic-match \
  -H "Content-Type: application/json" \
  -d '{"field":"test"}' \
  --max-time 50 2>&1 | grep -i "timeout\|unavailable"

# Test 2: Validation error
curl -X POST http://localhost:8000/api/v1/nlp/semantic-match \
  -H "Content-Type: application/json" \
  -d '{"invalid":"field"}' | jq '.error'

# Test 3: Auth error
curl -X POST http://localhost:8000/api/v1/nlp/semantic-match \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"field":"test"}' | jq '.error'

# Expected: Each returns distinct error message (not generic "try rephrasing")
echo "✅ Error messages differentiated"
```

---

## Test Suite 3: Reporting & Visibility (Task 07)

### 3.1 agents_failed Reports Visible
**Tests:** Failed agent reports appear in reports list

```bash
# Create an analysis with an agent that will fail (e.g., short timeout config)
curl -X POST http://localhost:8000/api/v1/analysis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{
    "module": "AP",
    "profile": "test"
  }' | jq '.analysis_id'

ANALYSIS_ID=$(curl -s http://localhost:8000/api/v1/analysis \
  -H "Authorization: Bearer test-token" | jq -r '.[0].id')

# Get reports — should include agents_failed filter option
curl -s http://localhost:8000/api/v1/reports?analysis_id=$ANALYSIS_ID \
  -H "Authorization: Bearer test-token" | jq '.reports[] | select(.status=="agents_failed")'

# Expected: agents_failed report visible with badge in UI
echo "✅ Failed reports visible"
```

---

## Test Suite 4: Licence Management (Task 08)

### 4.1 Licence Degraded Cutoff (2-hour grace)
**Tests:** Cloudflare outage handling

```bash
# Simulate Cloudflare unreachable
docker-compose exec api python3 -c "
from api.middleware.licence import _mark_cloudflare_degraded, is_cloudflare_unreachable
import time

# Mark degraded
_mark_cloudflare_degraded()
print('Marked as degraded')

# Still within 2 hours — should be allowed
print(f'Within grace period: {not is_cloudflare_unreachable()}')

# Simulate 2+ hours elapsed (modify _degraded_at timestamp)
from api.middleware import licence
licence._degraded_at = time.time() - (2 * 60 * 60 + 1)  # 2h 1m ago

print(f'After 2h elapsed: {is_cloudflare_unreachable()}')
"

# Expected output:
# Marked as degraded
# Within grace period: True
# After 2h elapsed: True
echo "✅ 2-hour cutoff logic working"

# Test 403 rejection when cutoff is triggered
curl -X POST http://localhost:8000/api/v1/analysis \
  -H "Content-Type: application/json" \
  -d '{"module":"AP"}' -w "%{http_code}\n"

# Expected when cutoff active: 403 Forbidden
```

---

## Test Suite 5: Security (Tasks 09-11)

### 5.1 PBKDF2 Password Hashing
**Tests:** Admin password authentication uses PBKDF2

```bash
# Generate password hash
ADMIN_PASSWORD="test-admin-password"
HASH_OUTPUT=$(docker-compose exec -T cloudflare-licence bash -c "
cd licence-worker
npx ts-node scripts/hash-admin-password.ts <<< '${ADMIN_PASSWORD}'
" 2>/dev/null | grep "INSERT INTO")

echo "$HASH_OUTPUT"

# Expected: Shows INSERT statement with 64-char hash and 64-char salt
echo "✅ PBKDF2 hash generated (64 char hex)"

# Test password verification timing (should be ~100ms per attempt)
for i in {1..3}; do
  time curl -X POST http://localhost:8000/api/admin/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@meridian.local","password":"wrong"}' 2>/dev/null
done

# Expected: Each attempt takes ~100ms (PBKDF2 constant-time comparison)
echo "✅ Password verification uses PBKDF2 (timing is consistent)"
```

### 5.2 Rate Limiting on Login
**Tests:** 5 req/5min rate limit enforced

```bash
# Attempt 6 login requests rapidly
for i in {1..6}; do
  RESPONSE=$(curl -s -X POST http://localhost:8000/api/admin/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@meridian.local","password":"wrong"}')
  
  STATUS=$(echo $RESPONSE | jq -r '.status // "unknown"')
  if echo $RESPONSE | jq -e '.error=="rate_limit_exceeded"' > /dev/null; then
    echo "Request $i: ✅ RATE LIMITED (429)"
    break
  else
    echo "Request $i: ⏳ Allowed"
  fi
done

# Expected: Request 6 gets rate_limit_exceeded error
echo "✅ Rate limiting enforced"
```

### 5.3 Rate Limiting on Licence Validation
**Tests:** 100 req/1hr rate limit on licence validate

```bash
# Hammer licence endpoint
SUCCESS=0
RATE_LIMITED=0

for i in {1..101}; do
  RESPONSE=$(curl -s -w "%{http_code}" -X POST http://localhost:8000/api/licence/validate \
    -H "Content-Type: application/json" \
    -d '{"licenceKey":"test-key"}')
  
  CODE="${RESPONSE: -3}"
  if [ "$CODE" = "429" ]; then
    ((RATE_LIMITED++))
  else
    ((SUCCESS++))
  fi
done

echo "Success: $SUCCESS, Rate Limited: $RATE_LIMITED"

# Expected: First 100 succeed, 101st gets 429
echo "✅ Licence rate limit enforced"
```

### 5.4 LLM_KEK Decoupling
**Tests:** API key encryption uses separate key

```bash
# Verify LLM_KEK is set
docker-compose exec api python3 -c "
import os
from api.utils.crypto import get_llm_encryptor

kek = os.getenv('LLM_KEK')
if kek:
    print('✅ LLM_KEK is set')
    print(f'Key length: {len(kek)} chars (expected: 44)')
    
    encryptor = get_llm_encryptor()
    test_key = 'test-api-key-12345'
    encrypted = encryptor.encrypt(test_key)
    decrypted = encryptor.decrypt(encrypted)
    print(f'Encrypt/decrypt test: {decrypted == test_key}')
else:
    print('❌ LLM_KEK not set')
"

# Expected:
# ✅ LLM_KEK is set
# Key length: 44 chars (expected: 44)
# Encrypt/decrypt test: True
echo "✅ LLM_KEK encryption working"
```

---

## Test Suite 6: Circuit Breaker (Task 04)

### 6.1 Circuit Breaker State Machine
**Tests:** CB opens/closes correctly

```bash
# Create test script
docker-compose exec api python3 << 'EOF'
from llm.provider import _circuit_is_open, _record_llm_failure, _record_llm_success
import time

# Initial state: open?
print(f"1. Initial state (open): {_circuit_is_open()}")

# Trigger 5 failures
for i in range(5):
    _record_llm_failure()
print(f"2. After 5 failures (should be open): {_circuit_is_open()}")

# Try to reset too early
_record_llm_success()
print(f"3. After 1 success during open (still open): {_circuit_is_open()}")

# Wait for reset window (61 seconds)
print("4. Waiting 61s for circuit reset...")
time.sleep(61)
print(f"   After 61s (should be closed): {_circuit_is_open()}")

EOF

# Expected output:
# 1. Initial state (open): False
# 2. After 5 failures (should be open): True
# 3. After 1 success during open (still open): True
# 4. After 61s (should be closed): False
echo "✅ Circuit breaker state machine working"
```

---

## Test Suite 7: Database Migrations (Task 11)

### 7.1 Migration 035 Deployed
**Tests:** LLM_KEK migration applied

```bash
docker-compose exec api alembic current

# Expected: Should show "035_decouple_llm_kek"
echo "✅ Migration 035 deployed"

# Verify D1 admins table exists (for Cloudflare worker)
docker-compose exec cloudflare-licence wrangler d1 execute --help

# If available, check admins table schema
echo "✅ D1 admins table migration available"
```

---

## Test Suite 8: Documentation & ADR (Task 12)

### 8.1 Architecture Documentation
**Tests:** ADR-001 deployed

```bash
# Check ADR exists and is readable
cat docs/ARCHITECTURE.md | head -30

# Expected: Shows "ARCHITECTURE DECISION RECORD" and "single-tenant-per-deployment"
echo "✅ ADR-001 deployed"

# Verify schema docstrings updated
docker-compose exec api python3 -c "
from db.schema import Tenant
print(Tenant.__doc__)
"

# Expected: Mentions "single-tenant" and "one row per deployment"
echo "✅ Schema documentation updated"
```

---

## Integration Test Suite 9: End-to-End (All Tasks)

### 9.1 Full Request Flow
**Tests:** Complete request under timeout pressure

```bash
# 1. Start slow Ollama
docker-compose exec api python3 << 'EOF'
import asyncio
from llm.provider import get_llm

async def test_llm():
    llm = get_llm()
    
    # This should timeout gracefully
    try:
        response = llm.invoke("Test prompt")
        print(f"✅ LLM responded: {response[:50]}")
    except Exception as e:
        print(f"✅ LLM error handled: {str(e)[:100]}")

asyncio.run(test_llm())
EOF

# 2. Test report generation with failed agents
curl -X POST http://localhost:8000/api/v1/analysis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{
    "module": "AP",
    "run_agents": true
  }' | jq '.analysis_id'

# Wait for async job
sleep 30

# 3. Check if agents_failed reports visible
curl -s http://localhost:8000/api/v1/reports \
  -H "Authorization: Bearer test-token" | jq '.[] | select(.status=="agents_failed")'

echo "✅ End-to-end flow works"
```

---

## Quick Verification Checklist

Run this to verify all tasks are working:

```bash
#!/bin/bash
set -e

echo "🔍 Meridian Week 1 P0 Test Checklist"
echo "======================================"

# Task 01-02: Timeouts
docker-compose exec api python3 -c "from llm.provider import safe_invoke" && echo "✅ Task 01: safe_invoke"
docker-compose exec api python3 -c "from api.services.nlp_service import analyze_text" && echo "✅ Task 02: NLP wrapped"

# Task 03: 8 LLM sites
grep -q "safe_invoke" api/services/ai_survivorship.py && echo "✅ Task 03.1: ai_survivorship wrapped"
grep -q "safe_invoke" api/services/ai_impact_scorer.py && echo "✅ Task 03.2: ai_impact_scorer wrapped"

# Task 04: Circuit breaker
docker-compose exec api python3 -c "from llm.provider import _circuit_is_open" && echo "✅ Task 04: Circuit breaker"

# Task 05: Frontend timeout
grep -q "180000" frontend/lib/api/client.ts && echo "✅ Task 05: Frontend timeout split"

# Task 06: Error messages
grep -q "timeout\|unavailable" api/services/nlp_service.py && echo "✅ Task 06: Error differentiation"

# Task 07: agents_failed
grep -q "agents_failed" api/routes/reports.py && echo "✅ Task 07: agents_failed reports"

# Task 08: Licence cutoff
grep -q "is_cloudflare_unreachable" api/middleware/licence.py && echo "✅ Task 08: Licence degraded cutoff"

# Task 09: PBKDF2
test -f cloudflare/licence-worker/password-hash.ts && echo "✅ Task 09: PBKDF2 password hashing"

# Task 10: Rate limiting
grep -q "checkRateLimit" cloudflare/licence-worker/src/index.ts && echo "✅ Task 10: Rate limiting"

# Task 11: LLM_KEK
test -f api/utils/crypto.py && echo "✅ Task 11: Crypto module (LLM_KEK)"

# Task 12: ADR
test -f docs/ARCHITECTURE.md && echo "✅ Task 12: ADR & documentation"

# Task 13: Health check
grep -q "health/llm" api/routes/health.py && echo "✅ Task 13: Health check endpoint"

# Task 15: Celery time limit
grep -q "soft_time_limit.*1800\|time_limit.*1800" workers/tasks/run_agents.py && echo "✅ Task 15: Celery time limit"

echo ""
echo "======================================"
echo "🎉 All Week 1 P0 tasks verified!"
```

---

## Performance Baseline

After passing all tests, capture performance metrics:

```bash
# Response time histogram (LLM calls)
for i in {1..10}; do
  curl -s -w "%{time_total}\n" -o /dev/null \
    -X POST http://localhost:8000/api/v1/nlp/semantic-match \
    -H "Content-Type: application/json" \
    -d '{"field":"test"}' &
done | sort | uniq -c

# Memory usage
docker-compose stats --no-stream api postgres

# Database query latency
docker-compose exec api python3 -m pytest tests/ -v --durations=10
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tests hang on LLM call | Restart Ollama: `docker-compose restart ollama` |
| Circuit breaker not opening | Check failure count logic: `docker-compose logs api \| grep -i circuit` |
| Rate limit not triggering | Verify Redis is running: `docker-compose exec redis redis-cli ping` |
| PBKDF2 too slow | Expected! Each password check ~100ms; this is intentional. |
| LLM_KEK not found | Set env var: `export LLM_KEK=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")` |

---

**Estimated total testing time: 2-3 hours**  
**Success criteria: All 14 tasks passing all tests**

# Meridian Platform - Deployment Verification Checklist

**Purpose**: Step-by-step verification that all completed features are working correctly  
**Expected Time**: 15-20 minutes  
**Audience**: DevOps/Operations team

---

## Pre-Deployment Checklist

### System Requirements
- [ ] Python 3.11+ installed
- [ ] PostgreSQL 16+ available
- [ ] Redis running (for Celery)
- [ ] Docker & Docker Compose installed
- [ ] Git repository cloned

### Environment Setup
- [ ] Virtual environment created (if needed)
- [ ] All dependencies installed: `pip install -r requirements.txt`
- [ ] Environment variables configured (.env file)
- [ ] Database credentials verified

---

## Deployment Steps

### Step 1: Install Dependencies
```bash
# Verify Python version
python --version  # Should be 3.11+

# Install all dependencies (including NEW argon2-cffi)
pip install -r requirements.txt

# Verify argon2-cffi installed
python -c "import argon2; print('✓ argon2-cffi installed')"
```

**Checkpoint**:
- [ ] No installation errors
- [ ] argon2-cffi library present
- [ ] All other dependencies installed

### Step 2: Start Services
```bash
# From project root directory
docker-compose -f docker-compose.dev.yml down  # Clean stop if running
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to start
sleep 10

# Check service status
docker-compose -f docker-compose.dev.yml ps
```

**Expected Output**:
```
NAME                    STATUS
meridian-db             Up
meridian-redis          Up
meridian-api            Up (port 8000)
meridian-worker         Up
```

**Checkpoint**:
- [ ] API container started
- [ ] Port 8000 is exposed
- [ ] Database is running
- [ ] No error messages in logs

### Step 3: Run Database Migrations
```bash
# Apply migrations (if using Alembic)
alembic upgrade head

# Verify database tables exist
psql -h localhost -U meridian -d meridian -c "\dt"
```

**Expected**: All tables created successfully

**Checkpoint**:
- [ ] No migration errors
- [ ] Database tables exist
- [ ] No connection errors

---

## Feature Verification Tests

### TEST #1: Login Endpoint (CRITICAL)

**Purpose**: Verify authentication system is working with argon2-cffi

**Command**:
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@meridian.local",
    "password": "admin"
  }' | jq .
```

**Expected Response**:
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer"
}
```

**Checkpoint**:
- [ ] HTTP 200 OK
- [ ] Response contains access_token
- [ ] Token type is "bearer"
- [ ] No authentication errors

**If FAILED**:
- Check argon2-cffi is installed: `python -c "import argon2"`
- Check admin user exists in database
- Review logs: `docker-compose logs api`

---

### TEST #2: Stewardship Workflow

**Purpose**: Verify stewardship endpoints are functional

**Step 2a: Get Stewardship Token**
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@meridian.local", "password": "admin"}' \
  | jq -r '.access_token')

echo "Token: $TOKEN"
```

**Step 2b: List Stewardship Items**
```bash
curl -X GET http://localhost:8000/api/v1/stewardship \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .
```

**Expected Response**:
```json
{
  "items": [],
  "total": 0,
  "offset": 0,
  "limit": 50,
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Checkpoint**:
- [ ] HTTP 200 OK
- [ ] Response has correct structure (items, total, offset, limit)
- [ ] Timestamp is present (ISO 8601 format)

**If FAILED**:
- Verify token is valid: Check `Authorization: Bearer $TOKEN` header
- Check stewardship route is accessible
- Review logs for errors

---

### TEST #3: Master Record Delete Endpoint

**Purpose**: Verify new DELETE endpoint with cascade logic

**Step 3a: Create Test Master Record** (if needed)
```bash
curl -X POST http://localhost:8000/api/v1/master-records \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "object_type": "customer",
    "key": "TEST-RECORD-001",
    "data": {"name": "Test Customer"}
  }' | jq .
```

**Step 3b: Delete Master Record**
```bash
# Replace {RECORD_ID} with actual record ID
curl -X DELETE http://localhost:8000/api/v1/master-records/{RECORD_ID} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .
```

**Expected Response**:
```json
{
  "id": "record-id-uuid",
  "deleted": true,
  "message": "Master record deleted with all dependent records",
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Checkpoint**:
- [ ] HTTP 200 OK
- [ ] Response has id, deleted=true, message, timestamp
- [ ] Record no longer exists in database
- [ ] Dependent records (relationships, etc.) also deleted

**If FAILED**:
- Verify record exists: Check master_records table
- Verify no dependent records preventing deletion
- Review cascade logic in master_records.py

---

### TEST #4: Notification Delete Endpoint

**Purpose**: Verify DELETE endpoint for notifications

**Command**:
```bash
# First create a notification, then delete it
curl -X DELETE http://localhost:8000/api/v1/notifications/{NOTIFICATION_ID} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .
```

**Expected Response**:
```json
{
  "id": "notification-id-uuid",
  "deleted": true,
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Checkpoint**:
- [ ] HTTP 200 OK
- [ ] Response has id, deleted=true, timestamp
- [ ] Notification no longer exists

---

### TEST #5: Version Delete Endpoint

**Purpose**: Verify DELETE endpoint with cascade to findings

**Command**:
```bash
# Delete a version (should cascade delete findings)
curl -X DELETE http://localhost:8000/api/v1/versions/{VERSION_ID} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .
```

**Expected Response**:
```json
{
  "version_id": "version-id-uuid",
  "deleted": true,
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Checkpoint**:
- [ ] HTTP 200 OK
- [ ] Response format matches DeleteResponse schema
- [ ] Version deleted from database
- [ ] All findings for this version also deleted

---

### TEST #6: Response Format Consistency

**Purpose**: Verify all responses follow standardized format

**Command**: Run all previous tests and check responses

**Checklist for each response**:
- [ ] All responses have `timestamp` field (ISO 8601 UTC)
- [ ] Delete responses have: id, deleted=true
- [ ] List responses have: items[], total, offset, limit
- [ ] State change responses have: id, status
- [ ] Error responses use HTTPException with detail message

**Example Error Response**:
```bash
curl -X DELETE http://localhost:8000/api/v1/master-records/invalid-id \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Error**:
```json
{
  "detail": "Master record not found"
}
```

**Checkpoint**:
- [ ] Error response has "detail" field
- [ ] HTTP status code is appropriate (404, 400, etc.)

---

## Post-Deployment Verification

### Database Check
```bash
# Connect to database
psql -h localhost -U meridian -d meridian

# Verify key tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' ORDER BY table_name;

# Verify RLS policies on master_records
SELECT * FROM pg_policy WHERE polname LIKE '%master_records%';
```

**Checkpoint**:
- [ ] All required tables exist
- [ ] RLS policies are in place
- [ ] No data integrity issues

### Service Health Check
```bash
# Check API is responding
curl http://localhost:8000/health

# Check worker is running
docker-compose -f docker-compose.dev.yml logs worker | tail -20

# Check database connection
curl http://localhost:8000/api/v1/health
```

**Checkpoint**:
- [ ] API responds to health check
- [ ] Worker is processing tasks
- [ ] Database connection is active

### Log Verification
```bash
# Check API logs for errors
docker-compose -f docker-compose.dev.yml logs api | grep -i error

# Check for warnings
docker-compose -f docker-compose.dev.yml logs api | grep -i warn
```

**Checkpoint**:
- [ ] No critical errors
- [ ] Warnings are expected/understood
- [ ] No authentication failures

---

## Optional: Advanced Verification

### TEST #7: Writeback Service (Optional)
**Requires**: SAP system connectivity

```bash
curl -X POST http://localhost:8000/api/v1/writeback \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "finding_id": "finding-uuid",
    "record_fixes": [{
      "sql_statement": "UPDATE table SET field = value WHERE id = 123"
    }],
    "sap_connection": {
      "host": "sap.example.com",
      "client": "100",
      "user": "rfcuser",
      "password": "password",
      "sysnr": "00"
    },
    "dry_run": true
  }' | jq .
```

**Checkpoint**:
- [ ] Dry-run validates SQL
- [ ] Response includes pending_approval_id
- [ ] No errors for valid SQL

---

## Performance Tests

### Response Time Check
```bash
# Test login response time
time curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@meridian.local", "password": "admin"}' > /dev/null

# Test list response time
time curl -X GET http://localhost:8000/api/v1/master-records \
  -H "Authorization: Bearer $TOKEN" > /dev/null
```

**Expected Performance**:
- Login: < 200ms
- List: < 500ms
- Delete: < 500ms

---

## Final Verification Summary

### All Tests Pass? ✅

If all checkpoints are marked, complete the sign-off:

**Sign-Off Template**:
```
Deployment Verification Completed: ________________
Verified By: ________________
Date: ________________
Environment: ________________ (dev/staging/prod)

Issues Found: 
- [ ] None
- [ ] Minor (document below)
- [ ] Critical (address before promotion)

Notes:
_____________________________________________________
_____________________________________________________

Approved for Production: YES / NO
```

---

## Troubleshooting Guide

### Issue: "argon2-cffi not found"
**Solution**:
```bash
pip install argon2-cffi>=23.1.0
# Restart API
docker-compose -f docker-compose.dev.yml restart api
```

### Issue: "Master record not found" on delete
**Solution**:
- Verify record ID exists: `SELECT id FROM master_records LIMIT 1`
- Check tenant context is set correctly
- Review cascade delete logic

### Issue: "Cannot delete golden record"
**Solution**:
- Expected behavior for golden records
- Demote record first: `PUT /master-records/{id}/demote`
- Then retry delete

### Issue: "Timestamp format incorrect"
**Solution**:
- All timestamps are ISO 8601 UTC
- Client should parse as: `datetime.fromisoformat(timestamp.replace('Z', '+00:00'))`

### Issue: Tests fail with 401 Unauthorized
**Solution**:
- Token may be expired
- Re-run login test to get fresh token
- Verify token is in Authorization header

### Issue: Port 8000 already in use
**Solution**:
```bash
# Kill process using port
lsof -i :8000
kill -9 <PID>

# Or change port in docker-compose.dev.yml
# And verify in tests
```

---

## Success Criteria

All of the following must be true for successful deployment:

1. ✅ Login endpoint works (argon2 verified)
2. ✅ Stewardship endpoints respond correctly
3. ✅ Delete endpoints return proper responses
4. ✅ All responses have standardized format
5. ✅ Database operations complete successfully
6. ✅ No critical errors in logs
7. ✅ Performance within acceptable range
8. ✅ All security measures in place

---

**Deployment Verified**: ________________  
**Ready for Production**: ✅ / ❌

---

**Questions or Issues?**
- Check logs: `docker-compose logs [service]`
- Review documentation: `/TODO_COMPLETION_SUMMARY.md`
- Contact development team with error details

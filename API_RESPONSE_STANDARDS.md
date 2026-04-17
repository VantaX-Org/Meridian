# API Response Standards Quick Reference

This guide helps developers use the standardized response schemas for consistent API contracts.

## Import Statement

```python
from api.schemas.responses import (
    DeleteResponse,
    StateChangeResponse,
    ListResponse,
    IdResponse,
    SuccessResponse,
    BulkOperationResponse,
    delete_response,
    state_response,
)
```

## Common Response Patterns

### 1. Delete Operations

**Response Format**:
```json
{
  "id": "resource-id",
  "deleted": true,
  "message": "Optional message",
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Implementation**:
```python
@router.delete("/items/{item_id}")
async def delete_item(item_id: str, db: AsyncSession, tenant: Tenant):
    # ... validation and deletion logic ...
    return delete_response(item_id, "Item successfully deleted")
```

### 2. State Change Operations (Approve, Assign, Resolve, etc.)

**Response Format**:
```json
{
  "id": "resource-id",
  "status": "approved",
  "timestamp": "2025-01-29T10:30:00Z",
  "details": {
    "approved_by": "user@example.com",
    "reason": "Looks good"
  }
}
```

**Implementation**:
```python
@router.put("/exceptions/{exception_id}/resolve")
async def resolve_exception(exception_id: str, body: ResolveBody, db: AsyncSession, tenant: Tenant):
    # ... resolution logic ...
    return state_response(
        exception_id,
        "resolved",
        {
            "resolution_type": body.resolution_type,
            "resolved_by": "user@example.com"
        }
    )
```

### 3. Create/Update Operations

**Response Format**:
```json
{
  "id": "new-resource-id",
  "status": "created",
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Implementation**:
```python
@router.post("/items")
async def create_item(body: CreateItemBody, db: AsyncSession, tenant: Tenant):
    # ... creation logic ...
    return {"id": str(new_id), "status": "created", "timestamp": datetime.utcnow().isoformat()}
```

### 4. List/Paginated Responses

**Response Format**:
```json
{
  "items": [
    {"id": "1", "name": "Item 1", "status": "active"},
    {"id": "2", "name": "Item 2", "status": "inactive"}
  ],
  "total": 42,
  "offset": 0,
  "limit": 20,
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Implementation**:
```python
@router.get("/items")
async def list_items(
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    # ... pagination logic ...
    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "timestamp": datetime.utcnow().isoformat()
    }
```

### 5. Bulk Operations

**Response Format**:
```json
{
  "total": 100,
  "succeeded": 95,
  "failed": 5,
  "errors": [
    {"id": "record-3", "reason": "Invalid data"},
    {"id": "record-7", "reason": "Duplicate key"}
  ],
  "timestamp": "2025-01-29T10:30:00Z"
}
```

**Implementation**:
```python
@router.post("/items/bulk-approve")
async def bulk_approve(body: BulkApproveBody, db: AsyncSession, tenant: Tenant):
    succeeded = 0
    failed = 0
    errors = []
    
    for item_id in body.item_ids:
        try:
            # ... approval logic ...
            succeeded += 1
        except Exception as e:
            failed += 1
            errors.append({"id": item_id, "reason": str(e)})
    
    return {
        "total": len(body.item_ids),
        "succeeded": succeeded,
        "failed": failed,
        "errors": errors if errors else None,
        "timestamp": datetime.utcnow().isoformat()
    }
```

## Error Handling (HTTPException)

Always use HTTPException for error responses. The status code is the HTTP status, detail is the error message.

```python
# Not found
raise HTTPException(status_code=404, detail="Item not found")

# Bad request
raise HTTPException(status_code=400, detail="Invalid item ID format")

# Conflict (e.g., golden record, wrong state)
raise HTTPException(status_code=409, detail="Cannot delete golden record. Demote first.")

# Forbidden
raise HTTPException(status_code=403, detail="User does not have permission")

# Server error
raise HTTPException(status_code=500, detail="Internal server error: [details]")
```

## FastAPI Automatic Handling

FastAPI automatically converts HTTPException to JSON error responses:

```json
{
  "detail": "Item not found"
}
```

For more detailed error responses, you can use:

```python
from api.schemas.responses import error_response

# Create detailed error
error = error_response(
    error="ValidationError",
    code="INVALID_REQUEST",
    details={"field": "email", "message": "Invalid email format"}
)

# But FastAPI's HTTPException is simpler for most cases
raise HTTPException(status_code=400, detail="Invalid email format")
```

## Special Cases

### Async Operations / Job Submission

```python
@router.post("/items/import")
async def import_items(file: UploadFile, db: AsyncSession, tenant: Tenant):
    job_id = str(uuid.uuid4())
    # Queue job asynchronously
    # ...
    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Import queued, check status with GET /jobs/{job_id}",
        "timestamp": datetime.utcnow().isoformat()
    }
```

### Warnings in Success Response

```python
@router.put("/items/{item_id}")
async def update_item(item_id: str, body: UpdateBody, db: AsyncSession, tenant: Tenant):
    # ... update logic ...
    
    warnings = []
    if body.name and len(body.name) > 100:
        warnings.append("Name is very long, may cause display issues")
    
    return {
        "id": item_id,
        "status": "updated",
        "warnings": warnings if warnings else None,
        "timestamp": datetime.utcnow().isoformat()
    }
```

## Testing Examples

### Testing Delete Endpoint

```python
def test_delete_returns_correct_format(client, auth_headers, sample_item):
    response = client.delete(f"/items/{sample_item.id}", headers=auth_headers)
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify format matches DeleteResponse schema
    assert "id" in data
    assert data["deleted"] is True
    assert "timestamp" in data
```

### Testing List Endpoint

```python
def test_list_returns_paginated_format(client, auth_headers):
    response = client.get("/items?limit=10&offset=0", headers=auth_headers)
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify format matches ListResponse schema
    assert "items" in data
    assert "total" in data
    assert "offset" in data
    assert "limit" in data
    assert "timestamp" in data
```

### Testing Error Response

```python
def test_not_found_error(client, auth_headers):
    response = client.delete("/items/non-existent-id", headers=auth_headers)
    
    assert response.status_code == 404
    data = response.json()
    assert "detail" in data
    assert "not found" in data["detail"].lower()
```

## Timestamp Handling

All responses include an ISO 8601 timestamp in UTC:

```python
from datetime import datetime
"timestamp": datetime.utcnow().isoformat()
# Output: "2025-01-29T10:30:45.123456Z"
```

Clients should:
1. Assume all timestamps are UTC
2. Convert to local timezone if needed
3. Use for audit trails and ordering

## Response Validation

In development, use Pydantic to validate responses:

```python
from api.schemas.responses import DeleteResponse

# After API call
response_data = response.json()

# Validate against schema
delete_resp = DeleteResponse(**response_data)
print(f"Deleted: {delete_resp.id}")
```

---

**Last Updated**: 2025-01-29  
**Version**: 1.0

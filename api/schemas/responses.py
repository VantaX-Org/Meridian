"""Standardized API response schemas for consistent contract across all endpoints."""

from datetime import datetime
from typing import Any, Optional, Union

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────────────
# Standard Success Response Patterns
# ─────────────────────────────────────────────────────────────────────────────


class SuccessResponse(BaseModel):
    """Generic success response with optional data payload."""

    status: str = "success"
    message: Optional[str] = None
    data: Optional[Any] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class IdResponse(BaseModel):
    """Standard response for create/update operations that return an ID."""

    id: str
    status: str = "created"  # or "updated"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DeleteResponse(BaseModel):
    """Standard response for delete operations."""

    id: str
    deleted: bool = True
    message: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class StateChangeResponse(BaseModel):
    """Standard response for operations that change resource state (approve, resolve, etc)."""

    id: str
    status: str  # e.g., "approved", "resolved", "in_progress"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    details: Optional[dict] = None


class ListResponse(BaseModel):
    """Standard paginated list response."""

    items: list[Any]
    total: int
    offset: int
    limit: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class BulkOperationResponse(BaseModel):
    """Standard response for bulk operations."""

    total: int
    succeeded: int
    failed: int
    errors: Optional[list[dict]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Error Response Patterns (used with HTTPException detail parameter)
# ─────────────────────────────────────────────────────────────────────────────


class ErrorDetail(BaseModel):
    """Standard error response structure."""

    error: str
    code: str  # e.g., "NOT_FOUND", "INVALID_REQUEST", "UNAUTHORIZED"
    details: Optional[dict] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Common Operation-Specific Responses
# ─────────────────────────────────────────────────────────────────────────────


class AssignResponse(BaseModel):
    """Response for assignment operations."""

    id: str
    status: str = "assigned"
    assigned_to: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ApprovalResponse(BaseModel):
    """Response for approval operations."""

    id: str
    status: str = "approved"
    approved_by: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ValidationResponse(BaseModel):
    """Response for validation operations."""

    valid: bool
    errors: list[str] = []
    warnings: list[str] = []
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class JobResponse(BaseModel):
    """Response for async job submissions."""

    job_id: str
    status: str = "queued"
    message: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Response Helper Functions
# ─────────────────────────────────────────────────────────────────────────────


def error_response(
    error: str,
    code: str,
    details: Optional[dict] = None,
) -> ErrorDetail:
    """Create a standardized error response."""
    return ErrorDetail(error=error, code=code, details=details)


def delete_response(
    resource_id: str,
    message: Optional[str] = None,
) -> dict:
    """Create a standardized delete response."""
    return {
        "id": resource_id,
        "deleted": True,
        "message": message,
        "timestamp": datetime.utcnow().isoformat(),
    }


def state_response(
    resource_id: str,
    new_status: str,
    details: Optional[dict] = None,
) -> dict:
    """Create a standardized state change response."""
    return {
        "id": resource_id,
        "status": new_status,
        "timestamp": datetime.utcnow().isoformat(),
        "details": details,
    }

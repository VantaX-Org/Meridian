"""Pydantic response models for the migration API.

Thin mirror of the engine dataclasses — the routes build these from the
``migration_*`` rows / engine results so the wire contract is explicit and the
frontend types stay in lockstep.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from api.services.migration.models import (
    ModuleGapScore,
    TransferGapResult,
)


class GapFindingOut(BaseModel):
    gap_type: str
    module: str
    record_key: str
    source_field: str
    severity: str
    reason: str
    object_type: Optional[str] = None
    target_ref: Optional[str] = None
    dest_table: Optional[str] = None
    severity_is_blocking: bool = False
    status_source: Optional[str] = None
    domain_provenance: Optional[str] = None
    account_group: Optional[str] = None
    is_grounded: bool = True
    transfer_ready: Optional[bool] = None


class ModuleScoreOut(BaseModel):
    module: str
    score: float
    status: str
    n_records: int
    n_fields_assessed: int
    blocking_count: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    capped: bool = False
    cap_reason: Optional[str] = None

    @classmethod
    def from_score(cls, s: ModuleGapScore) -> "ModuleScoreOut":
        return cls(
            module=s.module,
            score=s.score,
            status=s.status.value,
            n_records=s.n_records,
            n_fields_assessed=s.n_fields_assessed,
            blocking_count=s.blocking_count,
            critical_count=s.critical_count,
            high_count=s.high_count,
            medium_count=s.medium_count,
            low_count=s.low_count,
            capped=s.capped,
            cap_reason=s.cap_reason,
        )


class MigrationRunOut(BaseModel):
    id: str
    mode: str
    source_system_id: str
    dest_system_id: Optional[str] = None
    modules: list[str] = []
    status: str
    readiness_verdict: Optional[str] = None
    readiness_score: Optional[float] = None
    critical_count: int = 0
    task_id: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class MigrationRunDetailOut(MigrationRunOut):
    gap_summary: Optional[dict] = None
    by_module: list[ModuleScoreOut] = []
    findings: list[GapFindingOut] = []
    findings_total: int = 0
    transfer_ready_count: int = 0
    error_detail: Optional[str] = None


class FieldMappingOut(BaseModel):
    id: str
    module: str
    source_field: str
    source_data_type: Optional[str] = None
    dest_system_type: str
    dest_table: Optional[str] = None
    dest_field: Optional[str] = None
    transform_note: Optional[str] = None
    is_confirmed: bool = False


def gap_summary_from_result(result: TransferGapResult) -> dict:
    """Rollup-only summary for migration_runs.gap_summary — no raw SAP values."""
    s = result.score
    return {
        "module": result.module,
        "object_type": result.object_type,
        "score": s.score,
        "status": s.status.value,
        "n_records": s.n_records,
        "n_fields_assessed": s.n_fields_assessed,
        "blocking_count": s.blocking_count,
        "critical": s.critical_count,
        "high": s.high_count,
        "medium": s.medium_count,
        "low": s.low_count,
        "capped": s.capped,
        "cap_reason": s.cap_reason,
    }

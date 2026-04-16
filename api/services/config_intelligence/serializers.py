"""Dataclass-to-Pydantic serializers for Config Intelligence API responses."""

from __future__ import annotations

from api.models.config_intelligence import (
    AlignmentFinding,
    ConfigElement,
    ConfigHealthScore,
    ConfigIntelligenceResult,
    ProcessHealth,
    ProcessStep,
    RootCauseAnalysis,
)
from api.services.config_intelligence.drift_detector import DriftEntry


# --- Pydantic response models (inline, matching Meridian convention) ---

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class ConfigStatusEnum(str, Enum):
    active = "active"
    dormant = "dormant"
    ghost = "ghost"


class ProcessStatusEnum(str, Enum):
    active = "active"
    partial = "partial"
    inactive = "inactive"


class AlignmentCategoryEnum(str, Enum):
    ghost = "ghost"
    shadow = "shadow"
    drift = "drift"
    bottleneck = "bottleneck"
    licence_waste = "licence_waste"
    conflict = "conflict"
    org_gap = "org_gap"
    mismatch = "mismatch"
    number_range = "number_range"
    integration_gap = "integration_gap"


class SeverityEnum(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class RootCauseTypeEnum(str, Enum):
    bad_data = "bad_data"
    bad_config = "bad_config"
    bad_data_and_config = "bad_data_and_config"
    process_gap = "process_gap"


# --- Response models ---


class ConfigElementResponse(BaseModel):
    module: str
    element_type: str
    element_value: str
    transaction_count: int
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    status: ConfigStatusEnum
    sap_reference_table: str


class ProcessStepResponse(BaseModel):
    step_number: int
    step_name: str
    sap_table: str
    detected: bool
    volume: int
    exception_count: int = 0
    avg_days_to_next_step: Optional[float] = None


class ProcessHealthResponse(BaseModel):
    process_id: str
    process_name: str
    status: ProcessStatusEnum
    completeness_score: float
    steps: list[ProcessStepResponse]
    exception_rate: float = 0.0
    bottleneck_step: Optional[str] = None
    total_volume: int = 0
    avg_cycle_days: Optional[float] = None


class AlignmentFindingResponse(BaseModel):
    check_id: str
    module: str
    category: AlignmentCategoryEnum
    severity: SeverityEnum
    title: str
    description: str
    affected_elements: list[str] = []
    remediation: str = ""
    estimated_impact_zar: float = 0.0


class ConfigHealthScoreResponse(BaseModel):
    module: str
    chs: float
    critical_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0


class RootCauseResponse(BaseModel):
    finding_id: str
    root_cause_type: RootCauseTypeEnum
    data_issue: Optional[str] = None
    config_issue: Optional[str] = None
    process_issue: Optional[str] = None
    recommendation: str = ""


class DriftEntryResponse(BaseModel):
    module: str
    element_type: str
    element_value: str
    change_type: str
    previous_value: Optional[str] = None
    current_value: Optional[str] = None


class ConfigSummaryResponse(BaseModel):
    sap_version: str
    total_config_elements: int
    active_processes: int
    partial_processes: int
    inactive_processes: int
    total_findings: int
    critical_findings: int
    aggregate_chs: float
    estimated_total_impact_zar: float


class ConfigDiscoverRequest(BaseModel):
    """Request body for POST /config/discover."""
    records: list[dict] = Field(..., description="Parsed SAP transactional data records")


class ConfigDiscoverResponse(BaseModel):
    """Full response from POST /config/discover."""
    run_id: str
    summary: ConfigSummaryResponse
    config_inventory: list[ConfigElementResponse]
    processes: list[ProcessHealthResponse]
    alignment_findings: list[AlignmentFindingResponse]
    health_scores: list[ConfigHealthScoreResponse]


class ConfigInventoryListResponse(BaseModel):
    run_id: str
    module: Optional[str] = None
    total: int
    elements: list[ConfigElementResponse]


class ProcessListResponse(BaseModel):
    run_id: str
    processes: list[ProcessHealthResponse]


class AlignmentListResponse(BaseModel):
    run_id: str
    module: Optional[str] = None
    total: int
    findings: list[AlignmentFindingResponse]


class HealthScoreListResponse(BaseModel):
    run_id: str
    scores: list[ConfigHealthScoreResponse]


class LicenceUtilisationResponse(BaseModel):
    module: str
    total_config_elements: int
    total_transactions: int
    utilisation_pct: float
    status: str


class LicenceUtilisationListResponse(BaseModel):
    run_id: str
    modules: list[LicenceUtilisationResponse]


class DriftListResponse(BaseModel):
    current_run_id: str
    previous_run_id: str
    drift_entries: list[DriftEntryResponse]


# --- Converter functions ---


def config_element_to_response(e: ConfigElement) -> ConfigElementResponse:
    return ConfigElementResponse(
        module=e.module,
        element_type=e.element_type,
        element_value=e.element_value,
        transaction_count=e.transaction_count,
        first_seen=e.first_seen,
        last_seen=e.last_seen,
        status=e.status.value,
        sap_reference_table=e.sap_reference_table,
    )


def process_step_to_response(s: ProcessStep) -> ProcessStepResponse:
    return ProcessStepResponse(
        step_number=s.step_number,
        step_name=s.step_name,
        sap_table=s.sap_table,
        detected=s.detected,
        volume=s.volume,
        exception_count=s.exception_count,
        avg_days_to_next_step=s.avg_days_to_next_step,
    )


def process_health_to_response(p: ProcessHealth) -> ProcessHealthResponse:
    return ProcessHealthResponse(
        process_id=p.process_id,
        process_name=p.process_name,
        status=p.status.value,
        completeness_score=p.completeness_score,
        steps=[process_step_to_response(s) for s in p.steps],
        exception_rate=p.exception_rate,
        bottleneck_step=p.bottleneck_step,
        total_volume=p.total_volume,
        avg_cycle_days=p.avg_cycle_days,
    )


def finding_to_response(f: AlignmentFinding) -> AlignmentFindingResponse:
    return AlignmentFindingResponse(
        check_id=f.check_id,
        module=f.module,
        category=f.category.value,
        severity=f.severity.value,
        title=f.title,
        description=f.description,
        affected_elements=f.affected_elements,
        remediation=f.remediation,
        estimated_impact_zar=f.estimated_impact_zar,
    )


def health_score_to_response(h: ConfigHealthScore) -> ConfigHealthScoreResponse:
    return ConfigHealthScoreResponse(
        module=h.module,
        chs=h.chs,
        critical_count=h.critical_count,
        high_count=h.high_count,
        medium_count=h.medium_count,
        low_count=h.low_count,
    )


def root_cause_to_response(r: RootCauseAnalysis) -> RootCauseResponse:
    return RootCauseResponse(
        finding_id=r.finding_id,
        root_cause_type=r.root_cause_type.value,
        data_issue=r.data_issue,
        config_issue=r.config_issue,
        process_issue=r.process_issue,
        recommendation=r.recommendation,
    )


def drift_entry_to_response(d: DriftEntry) -> DriftEntryResponse:
    return DriftEntryResponse(
        module=d.module,
        element_type=d.element_type,
        element_value=d.element_value,
        change_type=d.change_type,
        previous_value=d.previous_value,
        current_value=d.current_value,
    )


def result_to_discover_response(
    run_id: str, result: ConfigIntelligenceResult
) -> ConfigDiscoverResponse:
    return ConfigDiscoverResponse(
        run_id=run_id,
        summary=ConfigSummaryResponse(
            sap_version=result.sap_version.value,
            total_config_elements=result.total_config_elements,
            active_processes=result.active_processes,
            partial_processes=result.partial_processes,
            inactive_processes=result.inactive_processes,
            total_findings=result.total_findings,
            critical_findings=result.critical_findings,
            aggregate_chs=result.aggregate_chs,
            estimated_total_impact_zar=result.estimated_total_impact_zar,
        ),
        config_inventory=[config_element_to_response(e) for e in result.config_inventory],
        processes=[process_health_to_response(p) for p in result.processes],
        alignment_findings=[finding_to_response(f) for f in result.alignment_findings],
        health_scores=[health_score_to_response(h) for h in result.health_scores],
    )

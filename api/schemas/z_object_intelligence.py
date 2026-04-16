"""Pydantic v2 schemas for Z-Object Intelligence API endpoints."""

from pydantic import BaseModel, Field
from typing import Optional


# --- Request Models ---


class ZDetectRequest(BaseModel):
    """Request body for POST /z-objects/detect."""
    records: list[dict] = Field(..., description="Parsed SAP transactional data records")


class ZRegistryUpdateRequest(BaseModel):
    """Request body for PUT /z-objects/registry/{z_id}."""
    description: Optional[str] = None
    owner: Optional[str] = None
    standard_equivalent: Optional[str] = None
    status: Optional[str] = None  # 'active', 'dormant', 'deprecated', 'under_review'
    notes: Optional[str] = None


class ZAnomalyFeedbackRequest(BaseModel):
    """Request body for POST /z-objects/anomalies/{anomaly_id}/feedback."""
    status: str = Field(..., description="'confirmed' or 'dismissed'")


class ZCustomRuleRequest(BaseModel):
    """Request body for POST /z-objects/rules."""
    z_object_id: Optional[str] = None
    rule_name: str
    custom_condition: str
    severity: str = "medium"


# --- Response Models ---


class ZDetectedObjectResponse(BaseModel):
    category: str
    module: str
    object_name: str
    source_field: str
    transaction_count: int
    detection_reason: str


class ZDetectionResultResponse(BaseModel):
    run_id: str
    total_z_objects: int
    modules_affected: list[str]
    z_config_values: list[ZDetectedObjectResponse]
    z_fields: list[ZDetectedObjectResponse]
    z_tables: list[ZDetectedObjectResponse]
    custom_number_ranges: list[ZDetectedObjectResponse]
    all_detected: list[ZDetectedObjectResponse]


class ZProfileResponse(BaseModel):
    object_name: str
    data_type: str
    cardinality: int
    null_rate: float
    value_distribution: dict[str, int]
    length_stats: dict[str, float]
    format_pattern: Optional[str] = None
    relationship_score: float = 0.0
    related_standard_field: Optional[str] = None
    standard_equivalent: Optional[str] = None
    transaction_count: int = 0
    user_count: int = 0
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    trend_direction: Optional[str] = None


class ZRegistryEntryResponse(BaseModel):
    id: str
    category: str
    module: str
    object_name: str
    standard_equivalent: Optional[str] = None
    description: Optional[str] = None
    owner: Optional[str] = None
    created_date: Optional[str] = None
    last_active_date: Optional[str] = None
    status: str
    transaction_count_total: int = 0
    profile_snapshot: Optional[dict] = None
    baseline_snapshot: Optional[dict] = None
    rules_applied: list[str] = []
    notes: Optional[str] = None


class ZRegistryListResponse(BaseModel):
    total: int
    entries: list[ZRegistryEntryResponse]


class ZAnomalyResponse(BaseModel):
    id: Optional[str] = None
    object_name: str
    anomaly_type: str
    severity: str
    description: str
    baseline_value: Optional[str] = None
    current_value: Optional[str] = None
    deviation_pct: float = 0.0
    status: str = "active"


class ZAnomalyListResponse(BaseModel):
    run_id: str
    total: int
    anomalies: list[ZAnomalyResponse]


class ZRuleFindingResponse(BaseModel):
    z_object_name: str
    rule_id: str
    rule_name: str
    severity: str
    title: str
    description: str
    affected_records: list[str] = []
    remediation: str = ""


class ZRuleTemplateResponse(BaseModel):
    template_id: str
    name: str
    description: str
    default_severity: str
    applicable_to: str


class ZRuleListResponse(BaseModel):
    templates: list[ZRuleTemplateResponse]
    custom_rules: list[dict] = []


class ZMappingResponse(BaseModel):
    object_name: str
    module: str
    standard_equivalent: Optional[str]
    confidence: float = 0.0
    mapping_source: str = "auto"  # 'auto' or 'manual'


class ZMappingListResponse(BaseModel):
    total: int
    mappings: list[ZMappingResponse]


class ZGhostResponse(BaseModel):
    object_name: str
    category: str
    module: str
    source_field: str
    last_active_date: Optional[str] = None
    status: str


class ZDormantResponse(BaseModel):
    object_name: str
    category: str
    module: str
    last_active_date: Optional[str] = None
    months_inactive: int = 0


class ZDriftResponse(BaseModel):
    object_name: str
    module: str
    source_field: str
    change_type: str  # 'new', 'disappeared'
    first_detected: Optional[str] = None


class ZFullAnalysisResponse(BaseModel):
    """Response from POST /z-objects/detect (full pipeline)."""
    run_id: str
    detection: ZDetectionResultResponse
    profiles: list[ZProfileResponse]
    anomalies: list[ZAnomalyResponse]
    rule_findings: list[ZRuleFindingResponse]
    total_z_objects: int
    total_anomalies: int
    total_rule_findings: int
    modules_affected: list[str]

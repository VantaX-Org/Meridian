"""Config Intelligence dataclass models.

In-memory analysis types used by the Config Intelligence engine.
These are NOT SQLAlchemy ORM models — they are plain dataclasses for
computation and serialisation within the discovery/analysis pipeline.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ConfigStatus(str, Enum):
    ACTIVE = "active"
    DORMANT = "dormant"
    GHOST = "ghost"


class ProcessStatus(str, Enum):
    ACTIVE = "active"
    PARTIAL = "partial"
    INACTIVE = "inactive"


class AlignmentCategory(str, Enum):
    GHOST = "ghost"
    SHADOW = "shadow"
    DRIFT = "drift"
    BOTTLENECK = "bottleneck"
    LICENCE_WASTE = "licence_waste"
    CONFLICT = "conflict"
    ORG_GAP = "org_gap"
    MISMATCH = "mismatch"
    NUMBER_RANGE = "number_range"
    INTEGRATION_GAP = "integration_gap"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class RootCauseType(str, Enum):
    BAD_DATA = "bad_data"
    BAD_CONFIG = "bad_config"
    BAD_DATA_AND_CONFIG = "bad_data_and_config"
    PROCESS_GAP = "process_gap"


class SAPVersion(str, Enum):
    S4HANA = "S4HANA"
    ECC = "ECC"
    UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ConfigElement:
    module: str                    # 'FI', 'MM', 'SD', 'PM', 'PP', 'INT', 'HR', 'SF', 'CONCUR', 'EWMS'
    element_type: str              # e.g. 'document_type', 'posting_key', 'company_code'
    element_value: str
    transaction_count: int
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    status: ConfigStatus = ConfigStatus.ACTIVE
    sap_reference_table: str = ""


@dataclass
class ProcessStep:
    step_number: int
    step_name: str
    sap_table: str
    detected: bool
    volume: int
    exception_count: int = 0
    avg_days_to_next_step: Optional[float] = None


@dataclass
class ProcessHealth:
    process_id: str                # 'OTC', 'PTP', 'RTR', 'PTP_MFG', 'MTO', 'HTR', 'STC'
    process_name: str
    status: ProcessStatus
    completeness_score: float      # 0-100
    steps: list[ProcessStep] = field(default_factory=list)
    exception_rate: float = 0.0
    bottleneck_step: Optional[str] = None
    total_volume: int = 0
    avg_cycle_days: Optional[float] = None


@dataclass
class AlignmentFinding:
    check_id: str
    module: str
    category: AlignmentCategory
    severity: Severity
    title: str
    description: str
    affected_elements: list[str] = field(default_factory=list)
    remediation: str = ""
    estimated_impact_zar: float = 0.0


@dataclass
class ConfigHealthScore:
    module: str
    chs: float                     # 0-100
    critical_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0


@dataclass
class RootCauseAnalysis:
    finding_id: str
    root_cause_type: RootCauseType
    data_issue: Optional[str] = None
    config_issue: Optional[str] = None
    process_issue: Optional[str] = None
    recommendation: str = ""


@dataclass
class ConfigIntelligenceResult:
    sap_version: SAPVersion
    config_inventory: list[ConfigElement]
    processes: list[ProcessHealth]
    alignment_findings: list[AlignmentFinding]
    health_scores: list[ConfigHealthScore]
    total_config_elements: int = 0
    active_processes: int = 0
    partial_processes: int = 0
    inactive_processes: int = 0
    total_findings: int = 0
    critical_findings: int = 0
    aggregate_chs: float = 100.0
    estimated_total_impact_zar: float = 0.0

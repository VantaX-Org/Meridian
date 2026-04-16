"""Z-Object Intelligence dataclass models.

In-memory analysis types used by the Z-Object Intelligence engine.
These are NOT SQLAlchemy ORM models — they are plain dataclasses for
computation and serialisation within the Z-detection/profiling pipeline.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ZObjectCategory(str, Enum):
    CONFIG_VALUE = "config_value"
    FIELD = "field"
    TABLE = "table"
    PROGRAM = "program"
    ENHANCEMENT = "enhancement"


class ZObjectStatus(str, Enum):
    ACTIVE = "active"
    DORMANT = "dormant"
    DEPRECATED = "deprecated"
    UNDER_REVIEW = "under_review"


class ZDataType(str, Enum):
    NUMERIC = "numeric"
    TEXT = "text"
    DATE = "date"
    BOOLEAN = "boolean"
    CODE = "code"           # short text, low cardinality, likely a code/enum
    REFERENCE = "reference"  # inferred FK to master data


class ZAnomalyType(str, Enum):
    VOLUME_SPIKE = "volume_spike"
    VOLUME_DROP = "volume_drop"
    NULL_RATE_CHANGE = "null_rate_change"
    CARDINALITY_EXPLOSION = "cardinality_explosion"
    NEW_VALUE = "new_value"
    VALUE_DISAPPEARED = "value_disappeared"
    FORMAT_VIOLATION = "format_violation"
    RELATIONSHIP_BREAK = "relationship_break"
    DISTRIBUTION_SHIFT = "distribution_shift"
    USER_CONCENTRATION = "user_concentration"


class ZAnomalyStatus(str, Enum):
    ACTIVE = "active"
    CONFIRMED = "confirmed"
    DISMISSED = "dismissed"


class TrendDirection(str, Enum):
    INCREASING = "increasing"
    STABLE = "stable"
    DECLINING = "declining"
    ABANDONED = "abandoned"


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ZDetectedObject:
    """Output of Z-Detector: a single detected Z/Y namespace object."""
    category: ZObjectCategory
    module: str
    object_name: str           # the Z value or field name
    source_field: str          # the SAP field where it was found
    transaction_count: int
    detection_reason: str      # e.g. 'Z-prefix config value', 'ZZ-prefix field name'


@dataclass
class ZObjectProfile:
    """Output of Z-Profiler: statistical profile of one Z object."""
    object_name: str
    data_type: ZDataType
    cardinality: int
    null_rate: float           # 0.0 to 100.0
    value_distribution: dict[str, int]  # top-N values -> counts
    length_stats: dict[str, float]      # min, max, avg, stddev
    format_pattern: Optional[str] = None  # detected regex
    relationship_score: float = 0.0       # 0.0 to 100.0
    related_standard_field: Optional[str] = None
    standard_equivalent: Optional[str] = None
    transaction_count: int = 0
    user_count: int = 0
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    trend_direction: Optional[TrendDirection] = None


@dataclass
class ZBaseline:
    """Learned baseline for a Z object."""
    object_name: str
    mean_volume: float = 0.0
    stddev_volume: float = 0.0
    expected_null_rate: float = 0.0
    expected_cardinality: int = 0
    format_pattern: Optional[str] = None
    distribution_hash: Optional[str] = None
    relationship_baseline: dict[str, float] = field(default_factory=dict)
    learning_count: int = 0


@dataclass
class ZAnomaly:
    """A detected anomaly against a Z object baseline."""
    object_name: str
    anomaly_type: ZAnomalyType
    severity: str              # 'critical', 'high', 'medium', 'low'
    description: str
    baseline_value: Optional[str] = None
    current_value: Optional[str] = None
    deviation_pct: float = 0.0


@dataclass
class ZRuleFinding:
    """A Z-rule violation finding."""
    z_object_name: str
    rule_id: str
    rule_name: str
    severity: str
    title: str
    description: str
    affected_records: list[str] = field(default_factory=list)
    remediation: str = ""


@dataclass
class ZDetectionResult:
    """Full output of Z-Detector run."""
    detected_objects: list[ZDetectedObject]
    z_config_values: list[ZDetectedObject]   # subset: config values (BLART=ZKR etc)
    z_fields: list[ZDetectedObject]          # subset: ZZ* field names
    z_tables: list[ZDetectedObject]          # subset: whole Z tables
    custom_number_ranges: list[ZDetectedObject]  # subset: custom number ranges
    total_z_objects: int = 0
    modules_affected: list[str] = field(default_factory=list)

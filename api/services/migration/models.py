"""Deterministic data model for source→destination transfer gap analysis.

Pure dataclasses + enums. No LLM, no Postgres, no SAP I/O — the analyzer
consumes already-extracted source records and a destination SPRO reader and
produces these structures. Every gap is target-confirmed against the live
destination; there is no baseline fallback (see CLAUDE.md: never guess).
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field


class GapType(str, enum.Enum):
    """Why a source record/field cannot load into the destination."""

    FIELD_MAPPING = "field_mapping"      # source field unmapped, or mapped to a non-existent dest field
    TARGET_MANDATORY = "target_mandatory"  # dest requires the field; source value is blank
    VALUE_DOMAIN = "value_domain"        # source value not in the dest's allowed domain
    TYPE_MISMATCH = "type_mismatch"      # clear category clash (string→numeric/date)


class GapSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Severity → gap weight for the readiness score (mirrors api/services/scoring.py).
SEVERITY_WEIGHT = {
    GapSeverity.CRITICAL: 3.0,
    GapSeverity.HIGH: 2.0,
    GapSeverity.MEDIUM: 1.0,
    GapSeverity.LOW: 0.5,
}


class DomainProvenance(str, enum.Enum):
    """Where the allowed-value domain came from — no BASELINE (live required)."""

    LIVE_SPRO = "live_spro"      # destination's live customizing
    DICTIONARY = "dictionary"    # shipped data-dictionary valid_values
    CUSTOM = "custom"            # Z/Y field — no domain, cannot validate
    UNAVAILABLE = "unavailable"  # governed field but no rows read — not verified


class VerdictStatus(str, enum.Enum):
    GO = "go"
    CONDITIONAL = "conditional"
    NO_GO = "no-go"


@dataclass(frozen=True)
class GapFinding:
    """One source-vs-destination gap for one record/field."""

    gap_type: GapType
    module: str
    record_key: str
    object_type: str
    severity: GapSeverity
    reason: str
    source_field: str | None = None
    dest_table: str | None = None
    dest_field: str | None = None
    status_source: str | None = None       # FieldStatusSource value, when relevant
    domain_provenance: str | None = None   # DomainProvenance value, when relevant
    is_grounded: bool = True               # rests on live config / observed evidence

    @property
    def transfer_ready(self) -> bool:
        """A finding never makes a record ready; presence == not ready for that record."""
        return False


@dataclass
class ModuleGapScore:
    """Per-module readiness, mirroring scoring.DQSResult shape."""

    module: str
    score: float
    status: str  # VerdictStatus value
    n_records: int
    n_fields_assessed: int
    blocking_count: int
    critical_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    capped: bool = False
    cap_reason: str | None = None


@dataclass
class TransferReadinessVerdict:
    """Aggregate verdict across modules — mirrors state.readiness_scores."""

    status: str  # VerdictStatus value
    score: float
    blocking_count: int
    critical_count: int
    by_module: dict[str, dict] = field(default_factory=dict)
    blockers: list[str] = field(default_factory=list)
    conditions: list[str] = field(default_factory=list)
    ungrounded_count: int = 0


@dataclass
class TransferGapResult:
    """Everything the analyzer produced for one module."""

    module: str
    object_type: str
    findings: list[GapFinding]
    module_score: ModuleGapScore
    ready_record_keys: list[str]   # records with zero findings — exportable
    total_records: int

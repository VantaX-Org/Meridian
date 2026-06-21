"""Frozen dataclasses + enums for the transfer gap engine.

Pure data — no Postgres, no LLM, no pandas. Mirrors the shapes of
``api/services/scoring.py:DQSResult`` and ``agents/state.py`` so the verdict
slots straight into the existing readiness vocabulary.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field as dataclass_field
from typing import Optional


class GapType(str, enum.Enum):
    FIELD_MAPPING = "field_mapping"  # source field has no (valid) destination field
    TARGET_MANDATORY = "target_mandatory"  # destination requires it, source blank
    VALUE_DOMAIN = "value_domain"  # value not in destination's allowed set
    TYPE_MISMATCH = "type_mismatch"  # clear category clash (string→numeric/date)


class GapSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class DomainProvenance(str, enum.Enum):
    """Where a value-domain decision came from. No BASELINE — live is required."""

    LIVE_SPRO = "live_spro"  # destination's live customizing
    DICTIONARY = "dictionary"  # data-dictionary enumerated values
    CUSTOM = "custom"  # Z/Y field, no governing domain — cannot validate
    UNAVAILABLE = "unavailable"  # governed field but no rows / not verifiable


class VerdictStatus(str, enum.Enum):
    GO = "go"
    CONDITIONAL = "conditional"
    NO_GO = "no-go"


@dataclass(frozen=True)
class GapFinding:
    gap_type: GapType
    module: str
    record_key: str
    source_field: str
    severity: GapSeverity
    reason: str  # sanitised, no raw SAP values
    object_type: Optional[str] = None
    target_ref: Optional[str] = None  # TABLE.FIELD on the destination
    dest_table: Optional[str] = None
    severity_is_blocking: bool = False  # critical ⇒ blocks transfer-readiness
    status_source: Optional[str] = None  # FieldStatusSource provenance
    domain_provenance: Optional[DomainProvenance] = None
    account_group: Optional[str] = None
    is_grounded: bool = True  # False ⇒ derived from a non-live/uncheckable source


@dataclass(frozen=True)
class ModuleGapScore:
    module: str
    score: float
    status: VerdictStatus
    n_records: int
    n_fields_assessed: int
    blocking_count: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    capped: bool = False
    cap_reason: Optional[str] = None


@dataclass(frozen=True)
class TransferReadinessVerdict:
    status: VerdictStatus
    score: float
    blocking_count: int
    by_module: dict[str, ModuleGapScore] = dataclass_field(default_factory=dict)
    blockers: list[str] = dataclass_field(default_factory=list)
    conditions: list[str] = dataclass_field(default_factory=list)
    ungrounded_count: int = 0


@dataclass(frozen=True)
class TransferGapResult:
    """Result for ONE module's analyze() call."""

    module: str
    object_type: Optional[str]
    findings: list[GapFinding]
    score: ModuleGapScore
    # record_key -> True when every finding for that record is non-blocking
    transfer_ready_by_record: dict[str, bool] = dataclass_field(default_factory=dict)

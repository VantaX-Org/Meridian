"""Response models of the config-aware score: configuration status per system, load areas, rule applicability."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel

Applicability = Literal["applies", "does_not_apply", "applies_by_default", "not_available"]
ConfigStatus = Literal["loaded", "with_gaps", "loading", "not_loaded", "failed", "not_available"]
AreaStatus = Literal["waiting", "running", "loaded", "failed", "not_available"]


class ConfiguredIn(BaseModel):
    object: Optional[str] = None
    kind: Literal["img", "admin"]
    path: str
    tcode: Optional[str] = None


class AreaObject(BaseModel):
    object: str
    label: Optional[str] = None
    state: str
    rows: int = 0
    detail: str = ""
    cause: Optional[Literal["auth", "timeout", "error", "not_in_release", "not_exposed"]] = None


class LoadArea(BaseModel):
    area: str
    label: str
    status: AreaStatus
    tables_total: int
    tables_done: int
    objects: list[AreaObject] = []


class SystemConfigStatus(BaseModel):
    system_id: str
    name: Optional[str] = None
    system_type: str
    status: ConfigStatus
    load_id: Optional[str] = None
    job_id: Optional[str] = None
    loaded_at: Optional[str] = None
    areas_loaded: int
    areas_total: int
    current_area: Optional[str] = None
    error: Optional[str] = None


class LandscapeConfigStatus(BaseModel):
    systems: list[SystemConfigStatus]
    counts: dict[str, int]
    loaded: int
    total: int


class NotApplicableRule(BaseModel):
    check_id: str
    module: str
    severity: Optional[str] = None
    title: Optional[str] = None
    reason: Optional[str] = None


class FailingRule(BaseModel):
    check_id: str
    module: str
    severity: Optional[str] = None
    title: Optional[str] = None
    affected_count: int


class ReasonCount(BaseModel):
    reason: Optional[str] = None
    count: int


class Tally(BaseModel):
    applicable: int
    not_applicable: int
    passes: int
    by_default: int
    score: Optional[float] = None
    not_applicable_reasons: list[ReasonCount]
    not_applicable_rules: list[NotApplicableRule]
    top_failing: list[FailingRule]


class L2Score(Tally):
    l2: str
    name: str
    configured_in: list[ConfiguredIn]


class L1Score(Tally):
    l1: str
    name: str
    l2: list[L2Score]


class ModuleScore(Tally):
    module: str


class RuleRow(BaseModel):
    check_id: str
    module: str
    severity: Optional[str] = None
    title: Optional[str] = None
    affected_count: int
    applicability: Applicability
    reason: Optional[str] = None
    object: Optional[str] = None


class ConfigLoadRef(BaseModel):
    load_id: str
    system_type: str
    loaded_at: Optional[str] = None


class ConfigAwareScore(BaseModel):
    version_id: str
    system_type: Optional[str] = None
    config_load: Optional[ConfigLoadRef] = None
    existing_dqs: Any = None
    config_aware: Tally
    processes: list[L1Score]
    unmapped: Optional[Tally] = None
    modules: list[ModuleScore]
    rules: list[RuleRow]


class SystemApplicability(BaseModel):
    system_id: str
    name: Optional[str] = None
    system_type: str
    applicability: Applicability
    reason: Optional[str] = None
    object: Optional[str] = None
    configured_in: list[ConfiguredIn]


class RuleApplicability(BaseModel):
    check_id: str
    module: str
    object: Optional[str] = None
    systems: list[SystemApplicability]

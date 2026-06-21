"""Migration mode — source→destination transfer gap analysis.

Deterministic, pure-Python gap engine: clean SOURCE master data, read a live
DESTINATION SAP system's own config + field rules, and gap-analyse whether the
cleaned source is loadable into that destination. No LLM anywhere.
"""

from api.services.migration.gap_analyzer import TransferGapAnalyzer
from api.services.migration.models import (
    DomainProvenance,
    GapFinding,
    GapSeverity,
    GapType,
    ModuleGapScore,
    TransferGapResult,
    TransferReadinessVerdict,
    VerdictStatus,
)
from api.services.migration.source_target_map import SourceTargetMap, TargetFieldRef

__all__ = [
    "TransferGapAnalyzer",
    "SourceTargetMap",
    "TargetFieldRef",
    "GapType",
    "GapSeverity",
    "DomainProvenance",
    "VerdictStatus",
    "GapFinding",
    "ModuleGapScore",
    "TransferReadinessVerdict",
    "TransferGapResult",
]

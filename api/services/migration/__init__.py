"""Source→destination transfer gap analysis (deterministic, no LLM).

Public surface:
  - TransferGapAnalyzer.analyze(module, records, field_map) -> TransferGapResult
  - aggregate_verdict(results) -> TransferReadinessVerdict
  - SourceTargetMap (loaded from transfer_field_mappings by the route)
"""

from __future__ import annotations

from agents.readiness import compute_readiness_status

from .gap_analyzer import TransferGapAnalyzer
from .models import (
    DomainProvenance,
    GapFinding,
    GapSeverity,
    GapType,
    ModuleGapScore,
    TransferGapResult,
    TransferReadinessVerdict,
    VerdictStatus,
)
from .source_target_map import SourceTargetMap, TargetFieldRef

__all__ = [
    "TransferGapAnalyzer",
    "SourceTargetMap",
    "TargetFieldRef",
    "GapFinding",
    "GapType",
    "GapSeverity",
    "DomainProvenance",
    "VerdictStatus",
    "ModuleGapScore",
    "TransferGapResult",
    "TransferReadinessVerdict",
    "aggregate_verdict",
]


def aggregate_verdict(results: list[TransferGapResult]) -> TransferReadinessVerdict:
    """Records-weighted roll-up of per-module scores into one transfer verdict (§3)."""
    if not results:
        return TransferReadinessVerdict(
            status=VerdictStatus.NO_GO.value, score=0.0, blocking_count=0, critical_count=0,
            blockers=["No modules analysed — nothing to assess."],
        )

    total_records = sum(r.total_records for r in results) or len(results)
    # records-weighted mean (modules with 0 records weight as 1 so they still count)
    weighted_sum = sum(r.module_score.score * max(r.total_records, 1) for r in results)
    weight = sum(max(r.total_records, 1) for r in results)
    score = round(weighted_sum / weight, 2)

    critical_count = sum(r.module_score.critical_count for r in results)
    blocking_count = sum(r.module_score.blocking_count for r in results)
    ungrounded = sum(1 for r in results for f in r.findings if not f.is_grounded)

    by_module: dict[str, dict] = {}
    blockers: list[str] = []
    conditions: list[str] = []
    for r in results:
        s = r.module_score
        by_module[r.module] = {
            "score": s.score, "status": s.status, "critical": s.critical_count,
            "high": s.high_count, "medium": s.medium_count, "low": s.low_count,
            "blocking": s.blocking_count, "records": s.n_records, "ready": len(r.ready_record_keys),
            "capped": s.capped, "cap_reason": s.cap_reason,
        }
        if s.critical_count:
            blockers.append(f"{r.module}: {s.critical_count} critical gap(s) block transfer.")
        elif s.status != VerdictStatus.GO.value:
            conditions.append(f"{r.module}: score {s.score} — remediate before transfer.")

    status = compute_readiness_status(score, critical_count)
    if status == VerdictStatus.GO.value and not blockers and not conditions:
        conditions.append("All modules transfer-ready against the destination's live config.")

    return TransferReadinessVerdict(
        status=status, score=score, blocking_count=blocking_count, critical_count=critical_count,
        by_module=by_module, blockers=blockers, conditions=conditions, ungrounded_count=ungrounded,
    )

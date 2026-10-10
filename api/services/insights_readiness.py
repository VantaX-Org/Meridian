"""Deterministic readiness grid for /insights/readiness and the migration cockpit (spec 2).

Rows are modules; columns are migration_waves rows. Engine verdicts (engine.py) are
go / conditional / no-go; grid verdicts are go / at_risk / no_go:
  no-go (or no result)  -> no_go
  conditional           -> at_risk
  go                    -> at_risk when score < min_readiness or DQS < min_dqs, else go
"""
from dataclasses import dataclass

_ENGINE = {"go": "go", "conditional": "at_risk", "no-go": "no_go"}
_RANK = {"go": 0, "at_risk": 1, "no_go": 2}
# gap types that never block a record on their own (engine.py)
_INFORMATIONAL = frozenset({"unmapped_field", "target_config_unverified"})


@dataclass
class ReadinessCell:
    module: str
    wave: str
    verdict: str
    blocker_count: int
    dqs: float | None
    score: float | None
    records_blocked: int


def cell_verdict(engine_verdict: str | None, score: float | None, dqs: float | None,
                 min_readiness: float, min_dqs: float | None) -> str:
    v = _ENGINE.get(engine_verdict or "", "no_go")
    if v != "go":
        return v
    if score is not None and score < min_readiness:
        return "at_risk"
    if dqs is not None and min_dqs is not None and dqs < min_dqs:
        return "at_risk"
    return "go"


def wave_verdict(cells: list[ReadinessCell]) -> str:
    if not cells:
        return "no_go"
    return max((c.verdict for c in cells), key=_RANK.__getitem__)


def blocking_gaps(gap_counts: dict[str, int]) -> int:
    return sum(n for t, n in gap_counts.items() if t not in _INFORMATIONAL)


def build_wave_cells(wave: str, modules: list[str], gap_summary: dict[str, dict], dqs_by_module: dict[str, float | None],
                     min_readiness: float, min_dqs: float | None) -> list[ReadinessCell]:
    cells: list[ReadinessCell] = []
    for module in modules:
        mr = gap_summary.get(module)
        dqs = dqs_by_module.get(module)
        if mr is None:
            cells.append(ReadinessCell(module, wave, "no_go", 0, dqs, None, 0))
            continue
        score = mr.get("score")
        cells.append(ReadinessCell(
            module, wave, cell_verdict(mr.get("verdict"), score, dqs, min_readiness, min_dqs),
            blocking_gaps(mr.get("gaps") or {}), dqs, score, int(mr.get("blocked_records") or 0)))
    return cells

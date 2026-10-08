"""Deterministic readiness-grid computation for /insights/readiness (spec 8.1).

Rows = S/4 objects (api.services.migration.engine.ModuleResult.module).
Columns = waves (tenant setting AlertThresholds.readiness_waves: wave name -> [module names]).
Cell verdict: "no_go" if the migration engine's own verdict for that module is not "go"
(i.e. there are blocking structural/critical gaps); else "at_risk" if the module's DQS is
below the tenant's readiness_dqs_threshold; else "go".

ModuleResult.verdict values confirmed in api/services/migration/engine.py (read in full
before editing this file): "go", "conditional", "no-go".
"""
from dataclasses import dataclass


@dataclass
class ReadinessCell:
    module: str
    wave: str
    verdict: str
    blocker_count: int
    dqs: float | None


def build_readiness_grid(
    module_results: dict,
    dqs_by_module: dict,
    waves: dict,
    dqs_threshold: float,
) -> list[ReadinessCell]:
    cells: list[ReadinessCell] = []
    for wave, modules in waves.items():
        for module in modules:
            mr = module_results.get(module)
            if mr is None:
                cells.append(ReadinessCell(module, wave, "no_go", 0, None))
                continue
            dqs = dqs_by_module.get(module)
            if mr.verdict != "go":
                verdict = "no_go"
            elif dqs is not None and dqs < dqs_threshold:
                verdict = "at_risk"
            else:
                verdict = "go"
            cells.append(ReadinessCell(module, wave, verdict, mr.blocked_records, dqs))
    return cells

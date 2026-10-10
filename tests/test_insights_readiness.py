from api.services.insights_readiness import (
    ReadinessCell,
    blocking_gaps,
    build_wave_cells,
    cell_verdict,
    wave_verdict,
)


def test_engine_verdicts_map_to_grid_verdicts():
    assert cell_verdict("no-go", 50.0, 90.0, 95, None) == "no_go"
    assert cell_verdict("conditional", 96.0, 90.0, 95, None) == "at_risk"
    assert cell_verdict("go", 100.0, 90.0, 95, None) == "go"
    assert cell_verdict(None, None, None, 95, None) == "no_go"


def test_go_drops_to_at_risk_below_a_threshold():
    assert cell_verdict("go", 94.9, None, 95, None) == "at_risk"
    assert cell_verdict("go", 100.0, 60.0, 95, 70) == "at_risk"
    assert cell_verdict("go", 100.0, 70.0, 95, 70) == "go"
    assert cell_verdict("go", 100.0, None, 95, 70) == "go"


def test_blocking_gaps_ignore_informational_types():
    assert blocking_gaps({"unmapped_field": 9, "target_config_unverified": 2, "value_unmapped": 3,
                          "key_missing": 1}) == 4
    assert blocking_gaps({"case_change": 5}) == 0
    assert blocking_gaps({}) == 0


def test_cells_carry_score_and_records_blocked():
    gap_summary = {"material_master": {"records": 100, "blocked_records": 4, "score": 96.0,
                                       "verdict": "conditional", "gaps": {"value_unmapped": 4, "unmapped_field": 2}}}
    cells = build_wave_cells("Wave 1", ["material_master", "asset_accounting"], gap_summary,
                             {"material_master": 88.0}, 95, None)
    assert cells == [
        ReadinessCell("material_master", "Wave 1", "at_risk", 4, 88.0, 96.0, 4),
        ReadinessCell("asset_accounting", "Wave 1", "no_go", 0, None, None, 0),
    ]


def test_wave_verdict_is_the_worst_cell():
    def c(v: str) -> ReadinessCell:
        return ReadinessCell("m", "W", v, 0, None, None, 0)

    assert wave_verdict([c("go"), c("go")]) == "go"
    assert wave_verdict([c("go"), c("at_risk")]) == "at_risk"
    assert wave_verdict([c("at_risk"), c("no_go")]) == "no_go"
    assert wave_verdict([]) == "no_go"

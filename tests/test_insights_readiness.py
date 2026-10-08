from dataclasses import dataclass

from api.services.insights_readiness import ReadinessCell, build_readiness_grid


@dataclass
class _MR:
    module: str
    blocked_records: int
    verdict: str


def test_no_go_when_engine_verdict_is_not_go():
    cells = build_readiness_grid(
        {"material_master": _MR("material_master", 12, "no-go")},
        {"material_master": 95.0},
        {"Wave 1": ["material_master"]},
        dqs_threshold=70,
    )
    assert cells == [ReadinessCell("material_master", "Wave 1", "no_go", 12, 95.0)]


def test_at_risk_when_dqs_below_threshold_but_engine_says_go():
    cells = build_readiness_grid(
        {"business_partner": _MR("business_partner", 0, "go")},
        {"business_partner": 60.0},
        {"Wave 1": ["business_partner"]},
        dqs_threshold=70,
    )
    assert cells[0].verdict == "at_risk"


def test_go_when_engine_go_and_dqs_at_or_above_threshold():
    cells = build_readiness_grid(
        {"business_partner": _MR("business_partner", 0, "go")},
        {"business_partner": 70.0},
        {"Wave 1": ["business_partner"]},
        dqs_threshold=70,
    )
    assert cells[0].verdict == "go"


def test_missing_module_result_is_no_go():
    cells = build_readiness_grid({}, {}, {"Wave 1": ["asset_accounting"]}, dqs_threshold=70)
    assert cells[0].verdict == "no_go"
    assert cells[0].dqs is None

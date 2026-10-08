"""Deterministic value-at-risk computation for /insights/impact (spec 8.2).

value_at_risk = value_per_record_per_feature (tenant setting, CostModel.features;
see api/routes/settings.py) x total_affected_records for that feature (the
config_impact_results columns api/routes/config_impact.py's existing
GET /api/v1/config-impact/{version_id} already reads).
"""


def value_at_risk(blocked_records: int, value_per_record: float) -> float:
    return round(blocked_records * value_per_record, 2)

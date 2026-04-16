"""Dataclass-to-Pydantic serializers for Z-Object Intelligence API responses."""

from __future__ import annotations

from api.models.z_object_intelligence import (
    ZAnomaly,
    ZDetectedObject,
    ZDetectionResult,
    ZObjectProfile,
    ZRuleFinding,
)
from api.schemas.z_object_intelligence import (
    ZAnomalyResponse,
    ZDetectedObjectResponse,
    ZDetectionResultResponse,
    ZProfileResponse,
    ZRuleFindingResponse,
)


def detected_to_response(d: ZDetectedObject) -> ZDetectedObjectResponse:
    return ZDetectedObjectResponse(
        category=d.category.value,
        module=d.module,
        object_name=d.object_name,
        source_field=d.source_field,
        transaction_count=d.transaction_count,
        detection_reason=d.detection_reason,
    )


def profile_to_response(p: ZObjectProfile) -> ZProfileResponse:
    return ZProfileResponse(
        object_name=p.object_name,
        data_type=p.data_type.value,
        cardinality=p.cardinality,
        null_rate=p.null_rate,
        value_distribution=p.value_distribution,
        length_stats=p.length_stats,
        format_pattern=p.format_pattern,
        relationship_score=p.relationship_score,
        related_standard_field=p.related_standard_field,
        standard_equivalent=p.standard_equivalent,
        transaction_count=p.transaction_count,
        user_count=p.user_count,
        first_seen=p.first_seen,
        last_seen=p.last_seen,
        trend_direction=p.trend_direction.value if p.trend_direction else None,
    )


def anomaly_to_response(a: ZAnomaly) -> ZAnomalyResponse:
    return ZAnomalyResponse(
        object_name=a.object_name,
        anomaly_type=a.anomaly_type.value if hasattr(a.anomaly_type, "value") else a.anomaly_type,
        severity=a.severity,
        description=a.description,
        baseline_value=a.baseline_value,
        current_value=a.current_value,
        deviation_pct=a.deviation_pct,
    )


def finding_to_response(f: ZRuleFinding) -> ZRuleFindingResponse:
    return ZRuleFindingResponse(
        z_object_name=f.z_object_name,
        rule_id=f.rule_id,
        rule_name=f.rule_name,
        severity=f.severity,
        title=f.title,
        description=f.description,
        affected_records=f.affected_records,
        remediation=f.remediation,
    )


def detection_to_response(run_id: str, d: ZDetectionResult) -> ZDetectionResultResponse:
    return ZDetectionResultResponse(
        run_id=run_id,
        total_z_objects=d.total_z_objects,
        modules_affected=d.modules_affected,
        z_config_values=[detected_to_response(o) for o in d.z_config_values],
        z_fields=[detected_to_response(o) for o in d.z_fields],
        z_tables=[detected_to_response(o) for o in d.z_tables],
        custom_number_ranges=[detected_to_response(o) for o in d.custom_number_ranges],
        all_detected=[detected_to_response(o) for o in d.detected_objects],
    )

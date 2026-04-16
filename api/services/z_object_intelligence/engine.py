"""Z-Object Intelligence Engine: orchestrates Detector -> Profiler -> Baseline -> Rules."""

from __future__ import annotations

from dataclasses import dataclass, field

from api.models.z_object_intelligence import (
    ZAnomaly,
    ZAnomalyType,
    ZBaseline,
    ZDetectionResult,
    ZObjectProfile,
    ZRuleFinding,
)
from api.services.z_object_intelligence.baseline import ZBaselineEngine
from api.services.z_object_intelligence.detector import ZDetector
from api.services.z_object_intelligence.profiler import ZProfiler
from api.services.z_object_intelligence.rule_builder import ZRuleBuilder


@dataclass
class ZObjectAnalysisResult:
    """Full output of Z-Object Intelligence analysis pipeline."""

    detection: ZDetectionResult
    profiles: list[ZObjectProfile]
    baselines: dict[str, ZBaseline]  # keyed by object_name
    anomalies: list[ZAnomaly]
    rule_findings: list[ZRuleFinding]
    total_z_objects: int = 0
    total_anomalies: int = 0
    total_rule_findings: int = 0
    modules_affected: list[str] = field(default_factory=list)


class ZObjectIntelligenceEngine:
    """Orchestrate Z-Detector -> Z-Profiler -> Z-Baseline -> Z-Rules."""

    def __init__(self) -> None:
        self.detector = ZDetector()
        self.profiler = ZProfiler()
        self.baseline_engine = ZBaselineEngine()
        self.rule_builder = ZRuleBuilder()

    def analyze(
        self,
        records: list[dict],
        existing_baselines: dict[str, ZBaseline] | None = None,
        registry_status: dict[str, dict] | None = None,
    ) -> ZObjectAnalysisResult:
        """Run full Z-Object Intelligence pipeline."""

        # 1. Detect
        detection = self.detector.detect(records)

        # 2. Profile
        profiles = self.profiler.profile_all(detection.detected_objects, records)

        # 3. Baseline (learn or compare)
        existing = existing_baselines or {}
        new_baselines: dict[str, ZBaseline] = {}
        all_anomalies: list[ZAnomaly] = []

        for profile in profiles:
            old_baseline = existing.get(profile.object_name)
            updated_baseline, anomalies = self.baseline_engine.learn_or_compare(
                profile, old_baseline
            )
            new_baselines[profile.object_name] = updated_baseline
            all_anomalies.extend(anomalies)

        # Detect new/disappeared Z config values across runs
        if existing:
            prev_config_names = set(existing.keys())
            curr_config_names = {d.object_name for d in detection.z_config_values}
            # Detect truly new config values not in previous baselines
            new_names = curr_config_names - prev_config_names
            for name in new_names:
                obj = next(
                    (d for d in detection.z_config_values if d.object_name == name),
                    None,
                )
                if obj:
                    all_anomalies.append(
                        ZAnomaly(
                            object_name=name,
                            anomaly_type=ZAnomalyType.NEW_VALUE,
                            severity="medium",
                            description=(
                                f"New Z config value '{name}' in {obj.source_field} "
                                f"({obj.module}) \u2014 first appearance"
                            ),
                            baseline_value="not present",
                            current_value=name,
                        )
                    )
            # Detect disappeared config values
            disappeared = prev_config_names - curr_config_names
            for name in disappeared:
                all_anomalies.append(
                    ZAnomaly(
                        object_name=name,
                        anomaly_type=ZAnomalyType.VALUE_DISAPPEARED,
                        severity="low",
                        description=(
                            f"Z config value '{name}' was in previous baseline "
                            f"but not detected in current data"
                        ),
                        baseline_value=name,
                        current_value="not present",
                        deviation_pct=-100,
                    )
                )

        # 4. Rules
        rule_findings = self.rule_builder.evaluate_all(
            detection.detected_objects,
            profiles,
            new_baselines,
            records,
            registry_status,
        )

        return ZObjectAnalysisResult(
            detection=detection,
            profiles=profiles,
            baselines=new_baselines,
            anomalies=all_anomalies,
            rule_findings=rule_findings,
            total_z_objects=detection.total_z_objects,
            total_anomalies=len(all_anomalies),
            total_rule_findings=len(rule_findings),
            modules_affected=detection.modules_affected,
        )

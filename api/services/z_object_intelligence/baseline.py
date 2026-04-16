"""Z-Baseline Engine: learns statistical baselines and detects anomalies."""

import hashlib

from api.models.z_object_intelligence import (
    ZAnomaly,
    ZAnomalyType,
    ZBaseline,
    ZObjectProfile,
)


class ZBaselineEngine:
    """Learn baselines and detect anomalies for Z objects."""

    # Exponential moving average decay factor (0.3 = new data weighted 30%, old 70%)
    EMA_ALPHA: float = 0.3
    # Dormancy threshold in periods (months)
    DORMANCY_PERIODS: int = 6
    # Auto-accept new values after this many consecutive periods
    AUTO_ACCEPT_PERIODS: int = 3

    def learn_or_compare(
        self,
        profile: ZObjectProfile,
        existing_baseline: ZBaseline | None,
    ) -> tuple[ZBaseline, list[ZAnomaly]]:
        """
        If no existing baseline: learn and return baseline with empty anomalies.
        If baseline exists: compare, detect anomalies, update baseline with EMA.
        """
        if existing_baseline is None or existing_baseline.learning_count == 0:
            baseline = self._create_initial_baseline(profile)
            return baseline, []

        anomalies = self._detect_anomalies(profile, existing_baseline)
        updated_baseline = self._update_baseline_ema(profile, existing_baseline)
        return updated_baseline, anomalies

    # ------------------------------------------------------------------
    # Baseline learning (first upload)
    # ------------------------------------------------------------------

    def _create_initial_baseline(self, profile: ZObjectProfile) -> ZBaseline:
        """Create initial baseline from first profile."""
        dist_hash = self._hash_distribution(profile.value_distribution)
        return ZBaseline(
            object_name=profile.object_name,
            mean_volume=float(profile.transaction_count),
            stddev_volume=0.0,  # can't calculate stddev from 1 sample
            expected_null_rate=profile.null_rate,
            expected_cardinality=profile.cardinality,
            format_pattern=profile.format_pattern,
            distribution_hash=dist_hash,
            relationship_baseline=(
                {profile.related_standard_field: profile.relationship_score}
                if profile.related_standard_field
                else {}
            ),
            learning_count=1,
        )

    # ------------------------------------------------------------------
    # Anomaly detection (subsequent uploads)
    # ------------------------------------------------------------------

    def _detect_anomalies(
        self, profile: ZObjectProfile, baseline: ZBaseline
    ) -> list[ZAnomaly]:
        """Compare current profile against baseline and detect anomalies."""
        anomalies: list[ZAnomaly] = []

        # 1. Volume Spike: > 2 standard deviations above mean
        if baseline.stddev_volume > 0:
            z_score = (
                profile.transaction_count - baseline.mean_volume
            ) / baseline.stddev_volume
            if z_score > 2.0:
                anomalies.append(
                    ZAnomaly(
                        object_name=profile.object_name,
                        anomaly_type=ZAnomalyType.VOLUME_SPIKE,
                        severity="high" if z_score > 3.0 else "medium",
                        description=(
                            f"Transaction volume {profile.transaction_count} is "
                            f"{z_score:.1f} standard deviations above baseline "
                            f"mean {baseline.mean_volume:.0f}"
                        ),
                        baseline_value=f"{baseline.mean_volume:.0f} (\u00b1{baseline.stddev_volume:.0f})",
                        current_value=str(profile.transaction_count),
                        deviation_pct=(
                            (profile.transaction_count - baseline.mean_volume)
                            / baseline.mean_volume
                            * 100
                        )
                        if baseline.mean_volume > 0
                        else 0,
                    )
                )

        # 2. Volume Drop: < 50% of baseline mean
        if (
            baseline.mean_volume > 0
            and profile.transaction_count < baseline.mean_volume * 0.5
        ):
            drop_pct = (1 - profile.transaction_count / baseline.mean_volume) * 100
            anomalies.append(
                ZAnomaly(
                    object_name=profile.object_name,
                    anomaly_type=ZAnomalyType.VOLUME_DROP,
                    severity="high" if profile.transaction_count == 0 else "medium",
                    description=(
                        f"Transaction volume dropped {drop_pct:.0f}% from baseline "
                        f"mean {baseline.mean_volume:.0f} to {profile.transaction_count}"
                    ),
                    baseline_value=f"{baseline.mean_volume:.0f}",
                    current_value=str(profile.transaction_count),
                    deviation_pct=-drop_pct,
                )
            )

        # 3. Null Rate Change: increased > 10 percentage points
        null_delta = profile.null_rate - baseline.expected_null_rate
        if null_delta > 10.0:
            anomalies.append(
                ZAnomaly(
                    object_name=profile.object_name,
                    anomaly_type=ZAnomalyType.NULL_RATE_CHANGE,
                    severity="high" if null_delta > 25 else "medium",
                    description=(
                        f"Null rate increased from {baseline.expected_null_rate:.1f}% "
                        f"to {profile.null_rate:.1f}% (+{null_delta:.1f} pp)"
                    ),
                    baseline_value=f"{baseline.expected_null_rate:.1f}%",
                    current_value=f"{profile.null_rate:.1f}%",
                    deviation_pct=null_delta,
                )
            )

        # 4. Cardinality Explosion: distinct values > 3x baseline
        if (
            baseline.expected_cardinality > 0
            and profile.cardinality > baseline.expected_cardinality * 3
        ):
            ratio = profile.cardinality / baseline.expected_cardinality
            anomalies.append(
                ZAnomaly(
                    object_name=profile.object_name,
                    anomaly_type=ZAnomalyType.CARDINALITY_EXPLOSION,
                    severity="high" if ratio > 5 else "medium",
                    description=(
                        f"Distinct value count exploded from "
                        f"{baseline.expected_cardinality} to {profile.cardinality} "
                        f"({ratio:.1f}x increase)"
                    ),
                    baseline_value=str(baseline.expected_cardinality),
                    current_value=str(profile.cardinality),
                    deviation_pct=(ratio - 1) * 100,
                )
            )

        # 5. Format Violation: pattern changed from baseline
        if baseline.format_pattern and profile.format_pattern:
            if baseline.format_pattern != profile.format_pattern:
                anomalies.append(
                    ZAnomaly(
                        object_name=profile.object_name,
                        anomaly_type=ZAnomalyType.FORMAT_VIOLATION,
                        severity="medium",
                        description=(
                            f"Format pattern changed from '{baseline.format_pattern}' "
                            f"to '{profile.format_pattern}'"
                        ),
                        baseline_value=baseline.format_pattern,
                        current_value=profile.format_pattern,
                        deviation_pct=0,
                    )
                )

        # 6. Relationship Break: FK match dropped significantly
        if (
            profile.related_standard_field
            and profile.related_standard_field in baseline.relationship_baseline
        ):
            baseline_score = baseline.relationship_baseline[
                profile.related_standard_field
            ]
            if (
                baseline_score > 80
                and profile.relationship_score < baseline_score - 20
            ):
                anomalies.append(
                    ZAnomaly(
                        object_name=profile.object_name,
                        anomaly_type=ZAnomalyType.RELATIONSHIP_BREAK,
                        severity=(
                            "critical"
                            if profile.relationship_score < 50
                            else "high"
                        ),
                        description=(
                            f"FK relationship to {profile.related_standard_field} "
                            f"degraded from {baseline_score:.0f}% to "
                            f"{profile.relationship_score:.0f}% match"
                        ),
                        baseline_value=f"{baseline_score:.0f}%",
                        current_value=f"{profile.relationship_score:.0f}%",
                        deviation_pct=profile.relationship_score - baseline_score,
                    )
                )

        # 7. Distribution Shift: hash of value distribution changed
        current_dist_hash = self._hash_distribution(profile.value_distribution)
        if baseline.distribution_hash and current_dist_hash != baseline.distribution_hash:
            anomalies.append(
                ZAnomaly(
                    object_name=profile.object_name,
                    anomaly_type=ZAnomalyType.DISTRIBUTION_SHIFT,
                    severity="low",
                    description="Value distribution has changed since baseline was established",
                    baseline_value=baseline.distribution_hash,
                    current_value=current_dist_hash,
                    deviation_pct=0,
                )
            )

        return anomalies

    # ------------------------------------------------------------------
    # New / disappeared value detection
    # ------------------------------------------------------------------

    def detect_value_changes(
        self,
        previous_values: set[str],
        current_values: set[str],
        module: str,
        source_field: str,
    ) -> list[ZAnomaly]:
        """Detect new and disappeared Z config values between runs."""
        anomalies: list[ZAnomaly] = []

        for v in current_values - previous_values:
            anomalies.append(
                ZAnomaly(
                    object_name=v,
                    anomaly_type=ZAnomalyType.NEW_VALUE,
                    severity="medium",
                    description=(
                        f"New Z config value '{v}' appeared in {source_field} "
                        f"({module}) \u2014 not seen in previous baseline"
                    ),
                    baseline_value="not present",
                    current_value=v,
                    deviation_pct=0,
                )
            )

        for v in previous_values - current_values:
            anomalies.append(
                ZAnomaly(
                    object_name=v,
                    anomaly_type=ZAnomalyType.VALUE_DISAPPEARED,
                    severity="low",
                    description=(
                        f"Z config value '{v}' in {source_field} ({module}) had "
                        f"zero transactions this period \u2014 previously active in baseline"
                    ),
                    baseline_value=v,
                    current_value="not present",
                    deviation_pct=-100,
                )
            )

        return anomalies

    # ------------------------------------------------------------------
    # Baseline update with EMA
    # ------------------------------------------------------------------

    def _update_baseline_ema(
        self, profile: ZObjectProfile, baseline: ZBaseline
    ) -> ZBaseline:
        """Update baseline using exponential moving average."""
        alpha = self.EMA_ALPHA
        new_mean = alpha * profile.transaction_count + (1 - alpha) * baseline.mean_volume

        # Running stddev approximation
        deviation = abs(profile.transaction_count - baseline.mean_volume)
        new_stddev = alpha * deviation + (1 - alpha) * baseline.stddev_volume

        new_null = alpha * profile.null_rate + (1 - alpha) * baseline.expected_null_rate
        new_card = int(
            alpha * profile.cardinality + (1 - alpha) * baseline.expected_cardinality
        )
        new_dist_hash = self._hash_distribution(profile.value_distribution)

        new_rel = dict(baseline.relationship_baseline)
        if profile.related_standard_field:
            old_score = new_rel.get(
                profile.related_standard_field, profile.relationship_score
            )
            new_rel[profile.related_standard_field] = (
                alpha * profile.relationship_score + (1 - alpha) * old_score
            )

        return ZBaseline(
            object_name=profile.object_name,
            mean_volume=new_mean,
            stddev_volume=new_stddev,
            expected_null_rate=new_null,
            expected_cardinality=new_card,
            format_pattern=profile.format_pattern or baseline.format_pattern,
            distribution_hash=new_dist_hash,
            relationship_baseline=new_rel,
            learning_count=baseline.learning_count + 1,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _hash_distribution(dist: dict[str, int]) -> str:
        """Hash value distribution for change detection."""
        sorted_items = sorted(dist.items())
        raw = "|".join(f"{k}:{v}" for k, v in sorted_items)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

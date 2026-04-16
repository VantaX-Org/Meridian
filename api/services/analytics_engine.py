"""Phase C analytics engine — predictive, prescriptive, impact, operational."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from math import ceil
from typing import Any

import numpy as np
from sklearn.linear_model import LinearRegression

logger = logging.getLogger("meridian.analytics")


# ── Predictive Analytics ─────────────────────────────────────────────────────


class PredictiveAnalytics:
    """DQS forecasting and early-warning signals."""

    def forecast_dqs(self, dqs_history: list[dict]) -> list[dict]:
        """Group by module_id, run linear regression, project future scores."""
        modules: dict[str, list[dict]] = {}
        for entry in dqs_history:
            modules.setdefault(entry["module_id"], []).append(entry)

        forecasts: list[dict] = []
        for module_id, history in modules.items():
            history.sort(key=lambda h: h.get("recorded_at", ""))

            if len(history) < 3:
                logger.warning(
                    "Module %s has only %d data points — skipping forecast (need >= 3)",
                    module_id,
                    len(history),
                )
                continue

            scores = [float(h["dqs_score"]) for h in history]
            X = np.arange(len(scores)).reshape(-1, 1)
            y = np.array(scores)

            model = LinearRegression()
            model.fit(X, y)
            slope = float(model.coef_[0])

            current_score = scores[-1]
            next_idx = len(scores)
            forecast_7d = float(np.clip(model.predict([[next_idx + 7]])[0], 0, 100))
            forecast_30d = float(np.clip(model.predict([[next_idx + 30]])[0], 0, 100))
            forecast_90d = float(np.clip(model.predict([[next_idx + 90]])[0], 0, 100))

            if slope > 0.1:
                trend = "improving"
            elif slope < -0.3:
                trend = "critical"
            elif slope < -0.1:
                trend = "declining"
            else:
                trend = "stable"

            confidence = min(95, 50 + len(history) * 2)

            # Identify contributing factors from dimension trends
            contributing_factors = self._identify_factors(history)

            forecasts.append(
                {
                    "module_id": module_id,
                    "current_score": current_score,
                    "forecast_7d": round(forecast_7d, 1),
                    "forecast_30d": round(forecast_30d, 1),
                    "forecast_90d": round(forecast_90d, 1),
                    "trend": trend,
                    "confidence": confidence,
                    "contributing_factors": contributing_factors,
                }
            )

        return forecasts

    def _identify_factors(self, history: list[dict]) -> list[str]:
        """Identify which dimensions are driving score changes."""
        if len(history) < 2:
            return []
        dimensions = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"]
        factors: list[str] = []
        latest = history[-1]
        previous = history[-2]
        for dim in dimensions:
            current_val = float(latest.get(dim, 0) or 0)
            prev_val = float(previous.get(dim, 0) or 0)
            delta = current_val - prev_val
            if delta < -2:
                factors.append(f"{dim} declined by {abs(delta):.1f}")
            elif delta > 2:
                factors.append(f"{dim} improved by {delta:.1f}")
        return factors

    def forecast_mdm_health(self, mdm_history: list[dict]) -> dict | None:
        """Run linear regression on mdm_health_score. Returns forecast dict or None if < 3 points."""
        if len(mdm_history) < 3:
            return None
        scores = [float(h['mdm_health_score']) for h in mdm_history
                  if h.get('mdm_health_score') is not None]
        if len(scores) < 3:
            return None
        X = np.arange(len(scores)).reshape(-1, 1)
        y = np.array(scores)
        model = LinearRegression()
        model.fit(X, y)
        slope = float(model.coef_[0])
        next_idx = len(scores)
        return {
            'current':  round(scores[-1], 1),
            'day_28':   round(float(np.clip(model.predict([[next_idx + 28]])[0], 0, 100)), 1),
            'trend':    'improving' if slope > 0.1 else 'declining' if slope < -0.1 else 'stable',
            'data_points': len(scores),
        }

    def generate_early_warnings(
        self, forecasts: list[dict], thresholds: dict | None = None
    ) -> list[dict]:
        """Compare current and forecast scores against per-module thresholds."""
        default_threshold = 90
        warnings: list[dict] = []

        for fc in forecasts:
            module_id = fc["module_id"]
            threshold = (thresholds or {}).get(module_id, default_threshold)
            current = fc["current_score"]
            f7 = fc["forecast_7d"]
            f30 = fc["forecast_30d"]

            if current < threshold or f7 < threshold:
                signal = "red"
                message = f"{module_id} DQS is below threshold ({threshold})"
                action = "Immediate remediation required — review critical findings"
            elif f30 < threshold:
                signal = "amber"
                message = f"{module_id} DQS projected to drop below {threshold} within 30 days"
                action = "Schedule data quality review within the next sprint"
            else:
                signal = "green"
                message = f"{module_id} DQS is healthy and stable"
                action = "Continue monitoring — no action needed"

            warnings.append(
                {
                    "module_id": module_id,
                    "signal": signal,
                    "message": message,
                    "recommended_action": action,
                }
            )

        return warnings


# ── Prescriptive Analytics ───────────────────────────────────────────────────


SEVERITY_WEIGHTS = {"critical": 40, "high": 30, "medium": 20, "low": 10}


class PrescriptiveAnalytics:
    """Next-best-action ranking and sprint planning."""

    def generate_next_best_actions(
        self,
        findings: list[dict],
        cleaning_queue: list[dict],
        exceptions: list[dict],
    ) -> list[dict]:
        """Score and rank actionable items by ROI per hour."""
        items: list[dict] = []

        for f in findings:
            severity = f.get("severity", "medium")
            affected = f.get("affected_count", 0)
            total = f.get("total_count", 1)
            estimated_impact = float(f.get("estimated_impact_zar", affected * 5000))
            effort = max(0.5, affected / max(1, total) * 8)

            sev_score = SEVERITY_WEIGHTS.get(severity, 10)
            impact_score = min(30, estimated_impact / 10000 * 30)
            effort_score = max(0, 30 - effort * 5)
            priority_score = sev_score + impact_score + effort_score
            roi_per_hour = (sev_score + impact_score) / max(1, effort)

            items.append(
                {
                    "type": "finding",
                    "id": f.get("id", ""),
                    "title": f.get("check_id", "") + ": " + f.get("module", ""),
                    "priority_score": round(priority_score, 1),
                    "estimated_impact_zar": round(estimated_impact, 2),
                    "effort_hours": round(effort, 1),
                    "roi_per_hour": round(roi_per_hour, 1),
                    "recommended_steward": f.get("assigned_to"),
                    "affected_count": affected,
                    "total_count": total,
                }
            )

        for q in cleaning_queue:
            effort = 0.5
            impact = 2000.0
            sev_score = 20
            impact_score = min(30, impact / 10000 * 30)
            effort_score = max(0, 30 - effort * 5)
            priority_score = sev_score + impact_score + effort_score
            roi_per_hour = (sev_score + impact_score) / max(1, effort)

            items.append(
                {
                    "type": "cleaning",
                    "id": str(q.get("id", "")),
                    "title": f"Clean: {q.get('object_type', '')} — {q.get('record_key', '')}",
                    "priority_score": round(priority_score, 1),
                    "estimated_impact_zar": impact,
                    "effort_hours": effort,
                    "roi_per_hour": round(roi_per_hour, 1),
                    "recommended_steward": q.get("assigned_to"),
                    "affected_count": 1,
                    "total_count": 1,
                }
            )

        for ex in exceptions:
            severity = ex.get("severity", "medium")
            impact = float(ex.get("estimated_impact_zar", 5000) or 5000)
            effort = 2.0
            sev_score = SEVERITY_WEIGHTS.get(severity, 10)
            impact_score = min(30, impact / 10000 * 30)
            effort_score = max(0, 30 - effort * 5)
            priority_score = sev_score + impact_score + effort_score
            roi_per_hour = (sev_score + impact_score) / max(1, effort)

            items.append(
                {
                    "type": "exception",
                    "id": str(ex.get("id", "")),
                    "title": ex.get("title", "Exception"),
                    "priority_score": round(priority_score, 1),
                    "estimated_impact_zar": round(impact, 2),
                    "effort_hours": effort,
                    "roi_per_hour": round(roi_per_hour, 1),
                    "recommended_steward": ex.get("assigned_to"),
                    "affected_count": 1,
                    "total_count": 1,
                }
            )

        items.sort(key=lambda x: x["roi_per_hour"], reverse=True)
        return items[:20]

    def generate_sprints(
        self, actions: list[dict], max_hours_per_sprint: int = 40
    ) -> list[dict]:
        """Group actions into sprint buckets, highest ROI first."""
        sorted_actions = sorted(actions, key=lambda a: a["roi_per_hour"], reverse=True)
        sprints: list[dict] = []
        current_sprint: list[dict] = []
        current_hours = 0.0
        sprint_number = 1

        for action in sorted_actions:
            effort = action.get("effort_hours", 0)
            if current_hours + effort > max_hours_per_sprint and current_sprint:
                sprints.append(self._build_sprint(sprint_number, current_sprint, current_hours))
                sprint_number += 1
                current_sprint = []
                current_hours = 0.0
            current_sprint.append(action)
            current_hours += effort

        if current_sprint:
            sprints.append(self._build_sprint(sprint_number, current_sprint, current_hours))

        return sprints

    def _build_sprint(
        self, number: int, actions: list[dict], total_hours: float
    ) -> dict:
        total_impact = sum(a.get("estimated_impact_zar", 0) for a in actions)
        dqs_improvement = sum(
            (a.get("affected_count", 0) / max(1, a.get("total_count", 1))) * 100 * 0.1
            for a in actions
        )
        return {
            "sprint_number": number,
            "name": f"Sprint {number}",
            "actions": actions,
            "total_effort_hours": round(total_hours, 1),
            "total_impact_zar": round(total_impact, 2),
            "projected_dqs_improvement": round(dqs_improvement, 1),
        }


# ── Business Impact Analytics ────────────────────────────────────────────────


class BusinessImpactAnalytics:
    """Rand risk quantification across 8 impact categories."""

    def quantify_impact(
        self, findings: list[dict], exceptions: list[dict]
    ) -> list[dict]:
        """Categorise findings/exceptions into 8 impact buckets with ZAR values."""
        buckets: dict[str, dict[str, Any]] = {
            "duplicate_payment": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "affected_count × R8,500 × 2.3% × 12"},
            "warranty_miss": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "affected_count × R35,000"},
            "compliance_penalty": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "affected_count × R25,000"},
            "blocked_invoice": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "count × R12,000 × 12"},
            "failed_posting": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "count × R5,000 × 12"},
            "inventory_write_off": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "affected_count × R8,000"},
            "labour_displacement": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "count × 0.25h × R450 × 12"},
            "contract_violation": {"annual_risk_zar": 0, "mitigated_zar": 0, "finding_count": 0, "method": "count × R15,000"},
        }

        for f in findings:
            dimension = f.get("dimension", "")
            affected = f.get("affected_count", 0)
            module = f.get("module", "")
            check_id = f.get("check_id", "")

            # duplicate_payment — uniqueness dimension findings
            if dimension == "uniqueness":
                risk = affected * 8500 * 0.023 * 12
                buckets["duplicate_payment"]["annual_risk_zar"] += risk
                buckets["duplicate_payment"]["mitigated_zar"] += risk * 0.7
                buckets["duplicate_payment"]["finding_count"] += 1

            # warranty_miss — completeness findings on warranty/expiry fields
            if dimension == "completeness" and any(
                kw in (check_id + module).lower()
                for kw in ["warranty", "expiry", "expiration", "valid_to", "end_date"]
            ):
                risk = affected * 35000
                buckets["warranty_miss"]["annual_risk_zar"] += risk
                buckets["warranty_miss"]["mitigated_zar"] += risk * 0.6
                buckets["warranty_miss"]["finding_count"] += 1

            # compliance_penalty — tax/bbee/regulatory findings
            if any(
                kw in (check_id + module + f.get("message", "")).lower()
                for kw in ["tax", "bbee", "regulatory", "compliance", "vat", "legal"]
            ):
                risk = affected * 25000
                buckets["compliance_penalty"]["annual_risk_zar"] += risk
                buckets["compliance_penalty"]["mitigated_zar"] += risk * 0.8
                buckets["compliance_penalty"]["finding_count"] += 1

            # inventory_write_off — material master completeness findings
            if dimension == "completeness" and "material" in module.lower():
                risk = affected * 8000
                buckets["inventory_write_off"]["annual_risk_zar"] += risk
                buckets["inventory_write_off"]["mitigated_zar"] += risk * 0.5
                buckets["inventory_write_off"]["finding_count"] += 1

        for ex in exceptions:
            ex_type = ex.get("type", "")
            ex_category = ex.get("category", "")
            count = 1

            if ex_type == "blocked_invoice" or ex_category == "blocked_invoice":
                risk = count * 12000 * 12
                buckets["blocked_invoice"]["annual_risk_zar"] += risk
                buckets["blocked_invoice"]["mitigated_zar"] += risk * 0.9
                buckets["blocked_invoice"]["finding_count"] += 1

            if ex_type == "failed_posting" or ex_category == "failed_posting":
                risk = count * 5000 * 12
                buckets["failed_posting"]["annual_risk_zar"] += risk
                buckets["failed_posting"]["mitigated_zar"] += risk * 0.85
                buckets["failed_posting"]["finding_count"] += 1

            if ex_type == "contract_violation" or ex_category == "contract_violation":
                risk = count * 15000
                buckets["contract_violation"]["annual_risk_zar"] += risk
                buckets["contract_violation"]["mitigated_zar"] += risk * 0.7
                buckets["contract_violation"]["finding_count"] += 1

        # labour_displacement — auto-resolved cleaning items (from cleaning queue context)
        # Calculated from cleaning queue items that were auto-approved
        # This is handled when cleaning_queue data is passed as part of exceptions
        for ex in exceptions:
            if ex.get("type") == "auto_resolved" or ex.get("category") == "labour_displacement":
                count = 1
                risk = count * 0.25 * 450 * 12
                buckets["labour_displacement"]["annual_risk_zar"] += risk
                buckets["labour_displacement"]["mitigated_zar"] += risk
                buckets["labour_displacement"]["finding_count"] += 1

        results: list[dict] = []
        for category, data in buckets.items():
            results.append(
                {
                    "category": category,
                    "annual_risk_zar": round(data["annual_risk_zar"], 2),
                    "mitigated_zar": round(data["mitigated_zar"], 2),
                    "finding_count": data["finding_count"],
                    "calculation_method": data["method"],
                }
            )

        return results

    def calculate_roi(
        self, impacts: list[dict], monthly_subscription_zar: float
    ) -> dict:
        """Calculate ROI from impact data vs subscription cost."""
        annual_sub = monthly_subscription_zar * 12
        total_mitigated = sum(i.get("mitigated_zar", 0) for i in impacts)

        if annual_sub <= 0:
            return {
                "subscription_annual": 0,
                "risk_mitigated": round(total_mitigated, 2),
                "roi_multiple": 0,
                "payback_months": 0,
            }

        roi_multiple = total_mitigated / annual_sub
        payback_months = (annual_sub / total_mitigated) * 12 if total_mitigated > 0 else 0

        return {
            "subscription_annual": round(annual_sub, 2),
            "risk_mitigated": round(total_mitigated, 2),
            "roi_multiple": round(roi_multiple, 1),
            "payback_months": round(payback_months, 1),
        }


# ── Operational Analytics ────────────────────────────────────────────────────


class OperationalAnalytics:
    """Team KPIs, bottleneck detection, capacity planning."""

    def calculate_kpis(
        self, cleaning_metrics: list[dict], steward_metrics: list[dict]
    ) -> dict:
        """Compute 12 operational KPIs from cleaning and steward data."""
        total_applied = sum(m.get("applied", 0) for m in cleaning_metrics)
        total_detected = sum(m.get("detected", 0) for m in cleaning_metrics)
        total_auto = sum(m.get("auto_approved", 0) for m in cleaning_metrics)
        total_approved = sum(m.get("approved", 0) for m in cleaning_metrics)
        total_rejected = sum(m.get("rejected", 0) for m in cleaning_metrics)
        total_rolled_back = sum(m.get("rolled_back", 0) for m in cleaning_metrics)
        total_recommended = sum(m.get("recommended", 0) for m in cleaning_metrics)
        total_verified = sum(m.get("verified", 0) for m in cleaning_metrics)

        # Period days (count unique periods)
        periods = set(m.get("period", "") for m in cleaning_metrics)
        period_days = max(1, len(periods))

        throughput = total_applied / period_days
        automation_rate = (total_auto / max(1, total_detected)) * 100

        # MTTR from steward metrics
        review_hours_list = [
            float(m.get("avg_review_hours", 0) or 0)
            for m in cleaning_metrics
            if m.get("avg_review_hours")
        ]
        mttr_hours = sum(review_hours_list) / max(1, len(review_hours_list))

        # SLA compliance
        total_steward_processed = sum(m.get("items_processed", 0) for m in steward_metrics)
        total_steward_applied = sum(m.get("items_applied", 0) for m in steward_metrics)
        sla_compliance_pct = (
            (total_steward_applied / max(1, total_steward_processed)) * 100
            if steward_metrics
            else 100
        )

        rejection_rate = (total_rejected / max(1, total_approved + total_rejected)) * 100
        rollback_rate = (total_rolled_back / max(1, total_applied)) * 100
        items_in_flight = total_detected + total_recommended + total_approved - total_applied - total_rejected

        steward_hours = [float(m.get("total_review_hours", 0) or 0) for m in steward_metrics]
        avg_queue_age_hours = sum(steward_hours) / max(1, len(steward_hours)) if steward_hours else 0

        # Top rule by volume — aggregate by object_type
        object_volumes: dict[str, int] = {}
        for m in cleaning_metrics:
            ot = m.get("object_type", "unknown")
            object_volumes[ot] = object_volumes.get(ot, 0) + m.get("detected", 0)
        top_rule_by_volume = max(object_volumes, key=object_volumes.get, default="N/A") if object_volumes else "N/A"
        top_object_type = top_rule_by_volume

        return {
            "throughput": round(throughput, 1),
            "automation_rate": round(automation_rate, 1),
            "mttr_hours": round(mttr_hours, 1),
            "sla_compliance_pct": round(sla_compliance_pct, 1),
            "rejection_rate": round(rejection_rate, 1),
            "rollback_rate": round(rollback_rate, 1),
            "items_in_flight": max(0, items_in_flight),
            "avg_queue_age_hours": round(avg_queue_age_hours, 1),
            "top_rule_by_volume": top_rule_by_volume,
            "top_object_type": top_object_type,
            "total_processed": total_applied,
            "total_detected": total_detected,
        }

    def identify_bottlenecks(self, queue_items: list[dict]) -> list[dict]:
        """Find pipeline stages with items count > 50 or avg_age_hours > 72."""
        stages: dict[str, dict] = {}
        for item in queue_items:
            stage = item.get("status", "unknown")
            if stage not in stages:
                stages[stage] = {"count": 0, "total_age": 0.0}
            stages[stage]["count"] += 1
            stages[stage]["total_age"] += float(item.get("age_hours", 0) or 0)

        bottlenecks: list[dict] = []
        for stage, data in stages.items():
            count = data["count"]
            avg_age = data["total_age"] / max(1, count)
            if count > 50 or avg_age > 72:
                if count > 50 and avg_age > 72:
                    recommendation = f"Critical bottleneck: {count} items averaging {avg_age:.0f}h. Add stewards and review automation rules."
                elif count > 50:
                    recommendation = f"High volume at {stage} stage. Consider batch processing or additional automation."
                else:
                    recommendation = f"Items aging at {stage} stage ({avg_age:.0f}h avg). Review SLA and escalation rules."

                bottlenecks.append(
                    {
                        "stage": stage,
                        "count": count,
                        "avg_age_hours": round(avg_age, 1),
                        "recommendation": recommendation,
                    }
                )

        return bottlenecks

    def capacity_planning(
        self,
        daily_inflow: float,
        avg_items_per_steward: float,
        current_stewards: int,
    ) -> dict:
        """Calculate steward capacity requirements."""
        stewards_needed = ceil(daily_inflow / max(1, avg_items_per_steward))
        surplus_deficit = current_stewards - stewards_needed

        if surplus_deficit > 2:
            recommendation = "Team is over-capacity. Consider reassigning stewards to other projects."
        elif surplus_deficit >= 0:
            recommendation = "Team capacity is balanced. Monitor for seasonal spikes."
        elif surplus_deficit >= -2:
            recommendation = "Slight under-capacity. Consider cross-training additional team members."
        else:
            recommendation = f"Significant under-capacity ({abs(surplus_deficit)} stewards short). Hire or reassign urgently."

        return {
            "needed": stewards_needed,
            "current": current_stewards,
            "surplus_deficit": surplus_deficit,
            "recommendation": recommendation,
        }

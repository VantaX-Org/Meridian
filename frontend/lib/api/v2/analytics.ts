/**
 * Forecast client: one module's least-squares DQS line with 95% prediction intervals.
 *
 * Endpoint (api/routes/analytics.py, api/services/analytics_engine.py forecast_dqs):
 *   GET /analytics/forecast/{module_id}
 */
import { v2Get } from "./client";

export interface DqsForecast {
  module_id: string;
  current_score: number;
  forecast_7d: number | null;
  forecast_7d_low: number | null;
  forecast_7d_high: number | null;
  forecast_30d: number | null;
  forecast_30d_low: number | null;
  forecast_30d_high: number | null;
  forecast_90d: number | null;
  forecast_90d_low: number | null;
  forecast_90d_high: number | null;
  trend: "improving" | "stable" | "declining" | "critical";
  /** 100 minus the width of the 7-day interval in score points; not a probability. */
  confidence: number | null;
  points: number;
  span_days: number;
  /** Fitted points, day 0 the latest, negative earlier. */
  history: { day: number; score: number }[];
  contributing_factors: string[];
}

export interface ModuleForecast {
  module_id: string;
  /** Null below three daily scores; `message` says how many there are. */
  forecast: DqsForecast | null;
  message?: string;
}

export const getForecast = (module: string): Promise<ModuleForecast> => v2Get(`/analytics/forecast/${encodeURIComponent(module)}`);

/*
 * Forecast and plan (the same router):
 *   GET /analytics/predictive    (every object's forecast, and a warning against its score floor)
 *   GET /analytics/prescriptive  (open work ranked by severity-weighted records per hour, filled into sprints)
 *   GET /analytics/bottlenecks   (queue stages holding more than 50 items or averaging over 72 hours)
 *   GET /analytics/capacity      (stewards needed for the recorded inflow; empty without inflow or stewards)
 */

export interface EarlyWarning {
  module_id: string;
  signal: "red" | "amber" | "green";
  reason: "below_threshold" | "projected_below_threshold" | "healthy";
  threshold: number;
}

export interface Predictive {
  forecasts: DqsForecast[];
  early_warnings: EarlyWarning[];
  reason?: "no_history" | "needs_three_days";
  runs_seen: number;
  days_seen: number;
}

export interface PlanAction {
  type: "finding" | "cleaning" | "exception";
  id: string;
  title: string;
  severity: string;
  affected_count: number;
  total_count: number;
  effort_hours: number;
  value_per_hour: number;
  estimated_cost: number | null;
  currency: string;
  recommended_steward: string | null;
  module?: string | null;
  check_id?: string | null;
}

export interface Sprint {
  sprint_number: number;
  actions: PlanAction[];
  total_effort_hours: number;
  records_fixed: number;
  critical_cleared: number;
  estimated_cost: number | null;
  currency: string;
  dqs_now: number | null;
  dqs_projected: number | null;
}

export interface Prescriptive {
  actions: PlanAction[];
  sprints: Sprint[];
  assumptions: { minutes_per_record: number; investigation_hours: number; sprint_hours: number; cost_per_record: number | null; currency: string };
  basis: { version_id: string | null; findings: number; cleaning_items: number; exceptions: number };
}

export interface Bottleneck { stage: string; count: number; avg_age_hours: number }

export interface Capacity {
  needed: number | null;
  current: number;
  surplus_deficit: number | null;
  daily_inflow: number | null;
  per_steward: number | null;
  reason?: "no_inflow" | "no_stewards";
}

export const getPredictive = (): Promise<Predictive> => v2Get("/analytics/predictive");
export const getPrescriptive = (): Promise<Prescriptive> => v2Get("/analytics/prescriptive", { limit: 50 });
export const getBottlenecks = (): Promise<{ bottlenecks: Bottleneck[]; total_queue_size: number }> => v2Get("/analytics/bottlenecks");
export const getCapacity = (): Promise<Capacity> => v2Get("/analytics/capacity");

/*
 * Value delivered (GET /analytics/roi): the latest finished run priced live into eight impact categories from the
 * tenant cost model, the ROI against the subscription, and the monthly cost avoidance the monthly job records.
 * The `_zar` names are historical; amounts are in `currency`.
 */
export interface ImpactCategory {
  category: string;
  annual_risk: number;
  mitigated: number;
  finding_count: number;
  calculation_method: string;
  currency: string;
}

export interface Roi {
  /** Null with no subscription set in the cost model, as are the multiple and payback. */
  subscription_annual: number | null;
  risk_mitigated: number;
  roi_multiple: number | null;
  payback_months: number | null;
  currency: string;
}

export interface CostAvoidanceMonth {
  period: string;
  subscription_cost_zar: number;
  risk_mitigated_zar: number;
  cumulative_roi_multiple: number | null;
}

export interface Value {
  roi: Roi;
  impacts: ImpactCategory[];
  version_id?: string | null;
  cost_avoidance_history: CostAvoidanceMonth[];
}

export const getValue = (): Promise<Value> => v2Get("/analytics/roi");

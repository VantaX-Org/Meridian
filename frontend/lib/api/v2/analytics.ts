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

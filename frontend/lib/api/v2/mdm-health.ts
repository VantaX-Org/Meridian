/**
 * MDM health client: the daily snapshot of how well master data is governed (api/routes/mdm_metrics.py).
 *
 *   GET /mdm-metrics                 (the latest snapshot, the last 28 days and the active systems)
 *   GET /mdm-metrics/history?days=   (the daily snapshots over 7 to 365 days)
 *
 * The shares are fractions from 0 to 1 and the health score runs from 0 to 100. Viewers and process analysts get an
 * empty answer; roles that may not review AI rules get the AI fields as null.
 */
import { v2Get } from "./client";

export interface MdmSnapshot {
  snapshot_date: string;
  domain?: string | null;
  golden_record_count: number;
  golden_record_coverage_pct: number;
  avg_match_confidence: number;
  steward_sla_compliance_pct: number;
  source_consistency_pct: number;
  mdm_health_score: number;
  backlog_count: number;
  sync_coverage_pct: number;
  ai_narrative?: string | null;
  ai_projected_score?: number | null;
  ai_risk_flags?: string[] | null;
}

export interface MdmDashboard {
  latest: MdmSnapshot | null;
  trend: MdmSnapshot[];
  active_systems_count: number;
}

export const getMdmHealth = () => v2Get<MdmDashboard>("/mdm-metrics");
export const getMdmHistory = (days: number) => v2Get<{ history: MdmSnapshot[] }>("/mdm-metrics/history", { days });

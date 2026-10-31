/**
 * Score lens client (api/routes/findings.py).
 *
 *   GET /scores/history                (composite per run, as scored then and re-weighted under today's config)
 *   GET /findings/config-aware-score   (passes over applicable rules, judged from the loaded configuration)
 *   GET /insights/heatmap              (each module scored on the six dimensions for the latest run)
 */
import type { ConfigAwareScore } from "@/lib/api/config-load";
import type { ModuleScoreHistoryEntry, ScoreHistoryEntry } from "@/lib/api/findings";
import { v2Get } from "./client";

export type { ConfigAwareScore, ModuleScoreHistoryEntry, ScoreHistoryEntry };

export interface ScoreHistory {
  history: ScoreHistoryEntry[];
  modules: Record<string, ModuleScoreHistoryEntry[]>;
}

export const getScoreHistory = () => v2Get<ScoreHistory>("/scores/history", { limit: 50 });
export const getConfigAwareScore = () => v2Get<ConfigAwareScore>("/findings/config-aware-score");

/** Module by DAMA dimension for one run (api/routes/insights.py /insights/heatmap); tier comes from the scoring thresholds. */
export type HeatTier = "pass" | "warn" | "fail" | null;
export interface HeatRow {
  module: string;
  group: string;
  scores: Record<string, number | null>;
  tier: Record<string, HeatTier>;
  critical: number;
  cap_reason: string | null;
}
export interface Heatmap {
  version_id: string;
  dimensions: string[];
  rows: HeatRow[];
}

export const getHeatmap = () => v2Get<Heatmap>("/insights/heatmap");

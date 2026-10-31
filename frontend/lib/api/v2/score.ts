/**
 * Score lens client (api/routes/findings.py).
 *
 *   GET /scores/history                (composite per run, as scored then and re-weighted under today's config)
 *   GET /findings/config-aware-score   (passes over applicable rules, judged from the loaded configuration)
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

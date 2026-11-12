import type { QualityBands, QualityThresholds } from "@/lib/api/v2/admin";
import type { Verdict } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";

/** The band of a score, as api/services/scoring.py band(): pass at or above target, warn at or above warning, fail at or above critical, critical below. */
export type Band = "pass" | "warn" | "fail" | "critical";

export function bandOf(score: number | null | undefined, b: QualityBands | null | undefined): Band | null {
  if (score == null || !b) return null;
  if (score >= b.target) return "pass";
  return score >= b.warning ? "warn" : score >= b.critical ? "fail" : "critical";
}

/** The bands a module's dimension is held to: its own override, else the tenant default, else the composite bands. */
export function bandsFor(q: QualityThresholds | undefined, module: string, dimension: string): QualityBands | null {
  if (!q) return null;
  return q.modules[module]?.[dimension] ?? q.tenant[dimension] ?? q.fallback;
}

export const BAND_VERDICT: Record<Band, Verdict> = { pass: "go", warn: "at-risk", fail: "no-go", critical: "no-go" };
export const bandWord = (b: Band): string => ({ pass: t("On target"), warn: t("Warning"), fail: t("Below warning"), critical: t("Critical") })[b];

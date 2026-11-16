import { systemSlug } from "@/lib/v2/score";
import type { CycleStep, PortfolioRow } from "@/lib/api/next/portfolio";
import { actionOf } from "@/lib/api/next/portfolio";
import { t } from "@/lib/v2/i18n";

/** The object screen of one portfolio row; the system's name is the slug. */
export function objectPath(row: Pick<PortfolioRow, "module" | "system_id">, systems: readonly { id: string; name: string }[]): string {
  const sys = systems.find((s) => s.id === row.system_id);
  return `/n/o/${sys ? systemSlug(sys.name) : row.system_id ?? "unknown"}/${row.module.replace(/_/g, "-")}`;
}

export const STEPS: CycleStep[] = ["pull", "clean", "upload", "score", "compare"];

export const stepLabel = (s: CycleStep | "ready" | null): string =>
  s === "pull" ? t("Pull") : s === "clean" ? t("Clean") : s === "upload" ? t("Upload") : s === "score" ? t("Score") : s === "compare" ? t("Compare") : s === "ready" ? t("Ready to load") : t("Not started");

export const readinessLabel = (r: PortfolioRow["readiness"]): string => (r === "pass" ? t("Ready") : r === "warn" ? t("Close") : r === "fail" ? t("Not ready") : t("n/a"));

export const actionLabel = (row: PortfolioRow): string => stepLabel(actionOf(row));

export const sevOfScore = (n: number | null): "critical" | "high" | "medium" | "low" => (n === null ? "low" : n < 60 ? "critical" : n < 70 ? "high" : n < 85 ? "medium" : "low");

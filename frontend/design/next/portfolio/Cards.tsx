"use client";

import { t } from "@/lib/v2/i18n";
import { actionOf, type CycleStep, type PortfolioRow } from "@/lib/api/next/portfolio";
import type { StepItem } from "../kit";
import { StoryCard } from "../feed/StoryCard";
import type { PortfolioActions } from "./BulkBar";

const STEPS = ["pull", "clean", "upload", "score", "compare", "load"] as const;

export const stepLabel = (s: CycleStep | "load" | "ready" | null): string =>
  ({ pull: t("Pull"), clean: t("Clean"), upload: t("Upload"), score: t("Score"), compare: t("Compare"), load: t("Load"), ready: t("Load") })[s ?? "pull"];

/** The six steps of the cycle with the object's place on it: scoring shows as running. */
export function cycleSteps(row: PortfolioRow): StepItem[] {
  const at = actionOf(row);
  const here = at === "ready" ? 5 : STEPS.indexOf(at);
  return STEPS.map((id, i) => ({
    id,
    label: stepLabel(id),
    state: i < here ? "done" : i > here ? "future" : at === "score" ? "running" : "current",
  }));
}

/** Cards of the Home feed; the card itself lives in feed/StoryCard. */
export function Cards({ rows, act, selected, onToggle }: { rows: PortfolioRow[]; act: PortfolioActions; selected: Set<string>; onToggle: (row: PortfolioRow) => void }) {
  return (
    <div className="nx-pf-grid">
      {rows.map((r) => <StoryCard key={r.version_id} row={r} act={act} selected={selected.has(r.version_id)} onSelect={() => onToggle(r)} />)}
    </div>
  );
}

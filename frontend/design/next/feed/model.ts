import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { formatInt } from "@/lib/format";
import { actionOf, type PortfolioRow } from "@/lib/api/next/portfolio";
import type { V2Persona } from "@/lib/v2/hooks";

/** A card needs you when the score fell, issues are new, a rule failed readiness or a cycle step waits on a person. */
export function needsYou(r: PortfolioRow): boolean {
  const at = actionOf(r);
  return r.regressed > 0 || r.new_issues > 0 || r.readiness === "fail" || r.freshness === "stale" || at === "clean" || at === "upload";
}

export const deltaOf = (r: PortfolioRow): number | null => (r.composite_score != null && r.previous_score != null ? r.composite_score - r.previous_score : null);

const urgency = (r: PortfolioRow, p: V2Persona): number => {
  const at = actionOf(r);
  const base = r.regressed * 3 + r.new_issues + (r.readiness === "fail" ? 20 : 0) + ((deltaOf(r) ?? 0) < 0 ? 5 : 0);
  // ponytail: persona only nudges the order; a steward sees waiting steps first, a lead sees load readiness first.
  if (p === "steward") return base + (at === "clean" || at === "upload" ? 30 : 0);
  if (p === "lead") return base + (at === "ready" || r.readiness === "pass" ? 30 : 0);
  if (p === "admin") return base + (r.freshness === "stale" ? 30 : 0);
  return base;
};

/** The feed in order: cards that need you, most urgent first (then lowest score), then the quiet ones by name. */
export function orderFeed(rows: readonly PortfolioRow[], persona: V2Persona): { needs: PortfolioRow[]; quiet: PortfolioRow[] } {
  const needs = rows.filter(needsYou).sort((a, b) => urgency(b, persona) - urgency(a, persona) || (a.composite_score ?? 101) - (b.composite_score ?? 101));
  const quiet = rows.filter((r) => !needsYou(r)).sort((a, b) => a.label.localeCompare(b.label));
  return { needs, quiet };
}

/** The change since the last run, always with a direction word. */
export function deltaSentence(r: PortfolioRow): string {
  const d = deltaOf(r);
  if (d == null) return t("First run");
  if (Math.abs(d) < 0.05) return t("No change since the last run");
  return d > 0 ? t("Up {n} since the last run", { n: f1(d) }) : t("Down {n} since the last run", { n: f1(-d) });
}

export function greetingWord(hour: number): string {
  return hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
}

/** One sentence from the same facts the cards show. */
export function lede(needs: number, running: number): string {
  const a = needs === 0 ? t("Nothing needs you today.") : needs === 1 ? t("1 object needs you today.") : t("{n} objects need you today.", { n: formatInt(needs) });
  if (!running) return a;
  return `${a} ${running === 1 ? t("One run is in progress.") : t("{n} runs are in progress.", { n: formatInt(running) })}`;
}

export const runningNow = (r: PortfolioRow): boolean => !!r.cycle?.parent_run;

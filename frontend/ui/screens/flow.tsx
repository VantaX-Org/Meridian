"use client";

import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { CycleStepper, Stepper, type Crumb } from "@/ui/kit";
import { CYCLE_STEPS } from "@/ui/kit";

export type Place = "status" | "work" | "load" | "runs" | "monitor" | "rules" | "insights" | "mdm" | "admin" | "people" | "requests" | "reports" | "systems";
const PLACE: Record<Place, { label: () => string; href: string }> = {
  status: { label: () => t("Status"), href: "/status" },
  work: { label: () => t("Clean"), href: "/work" },
  load: { label: () => t("Load"), href: "/load" },
  runs: { label: () => t("Runs"), href: "/runs" },
  monitor: { label: () => t("Monitor"), href: "/monitor" },
  rules: { label: () => t("Rules"), href: "/rules" },
  insights: { label: () => t("Insights"), href: "/insights" },
  mdm: { label: () => t("Master data"), href: "/mdm" },
  admin: { label: () => t("Admin"), href: "/admin" },
  people: { label: () => t("People"), href: "/people" },
  requests: { label: () => t("Requests"), href: "/requests" },
  reports: { label: () => t("Reports"), href: "/reports" },
  systems: { label: () => t("Systems"), href: "/systems" },
};

/** Breadcrumbs for a screen: Home, its place, then the page. `page` is the current screen and has no link. */
export function useCrumbs() {
  const fx = useFixture();
  return (place: Place, page?: string, ...mid: Crumb[]): Crumb[] => {
    const p = PLACE[place];
    return [{ label: t("Home"), href: withFixture("/", fx) }, page ? { label: p.label(), href: withFixture(p.href, fx) } : { label: p.label() }, ...mid, ...(page ? [{ label: page }] : [])];
  };
}

/** A process stepper from plain labels. `at` is the index of the current step; `states` can mark a step blocked or failed, and `hints` gives the reason shown under it. */
export function Flow({ label, steps, at, states, hints }: { label: string; steps: string[]; at: number; states?: Record<number, "blocked" | "error" | "done">; hints?: Record<number, string> }) {
  return <Stepper label={label} current={at} steps={steps.map((s, i) => ({ id: String(i), label: s, state: states?.[i], hint: hints?.[i] }))} />;
}

/** The clean cycle at a fixed step, for screens that sit inside it. */
export function Cycle({ at }: { at: (typeof CYCLE_STEPS)[number] }) {
  return <CycleStepper label={t("Clean cycle")} step={at} labels={{ pull: t("Pull"), clean: t("Clean"), upload: t("Upload"), score: t("Score"), compare: t("Compare") }} />;
}

/** The load journey; each screen of it marks its own place. */
export const LOAD_STEPS = () => [t("Overview"), t("Load order"), t("Field maps"), t("S/4 readiness"), t("Go-live")];

/** The master data journey; each screen of it marks its own place. */
export const MDM_STEPS = () => [t("Match review"), t("Cluster"), t("Survivorship"), t("Golden record")];

/** The rule change journey from reading a rule to promoting it. */
export const RULE_STEPS = () => [t("Rule"), t("Fix"), t("Try a change"), t("Promotion")];

/** The data request journey. */
export const REQUEST_STEPS = () => [t("Fill in"), t("Check"), t("Submit"), t("Approve"), t("Create in SAP")];

/** Where a request stands, from its status. A rejected, failed or cancelled request marks the step it stopped at. */
export function requestFlow(status: string, reason: string): { at: number; states: Record<number, "blocked" | "error" | "done">; hints: Record<number, string> } {
  const at: Record<string, number> = { draft: 1, submitted: 2, in_approval: 3, approved: 4, creating: 4, created: 4, rejected: 3, failed: 4, cancelled: 2 };
  const i = at[status] ?? 0;
  if (status === "created") return { at: i, states: { 4: "done" }, hints: {} };
  if (status === "rejected" || status === "failed") return { at: i, states: { [i]: "error" }, hints: { [i]: reason } };
  if (status === "cancelled") return { at: i, states: { [i]: "blocked" }, hints: { [i]: reason } };
  return { at: i, states: {}, hints: {} };
}

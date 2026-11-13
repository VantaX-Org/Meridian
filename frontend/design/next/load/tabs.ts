import { t } from "@/lib/v2/i18n";

export const LOAD_TABS = ["prepare", "analysis", "compare", "plan", "s4", "go-live", "waves", "history"] as const;
export type LoadTab = (typeof LOAD_TABS)[number];
export const isLoadTab = (v: string | undefined): v is LoadTab => !!v && (LOAD_TABS as readonly string[]).includes(v);

export function loadTabLabel(id: LoadTab): string {
  switch (id) {
    case "prepare": return t("Prepare");
    case "analysis": return t("Analysis");
    case "compare": return t("Compare systems");
    case "plan": return t("Load plan");
    case "s4": return t("S/4 readiness");
    case "go-live": return t("Go-live");
    case "waves": return t("Waves");
    case "history": return t("History");
  }
}

export type TargetId = "s4" | "sf" | "ecc" | "workbook";
export const TARGETS: TargetId[] = ["s4", "sf", "ecc", "workbook"];
export const isTarget = (v: string | null): v is TargetId => !!v && (TARGETS as string[]).includes(v);

export type Step = "target" | "validate" | "files";
export const STEPS: Step[] = ["target", "validate", "files"];
export const isStep = (v: string | null): v is Step => !!v && (STEPS as string[]).includes(v);

/** The run's score in a run option: "Run mig-0002, 2 objects, DQS 87.4". */
export const runOption = (r: { id: string; modules: string[]; readiness_score: number | null }) =>
  t("Run {id}, {n, plural, one {# object} other {# objects}}, DQS {dqs}", { id: r.id, n: r.modules.length, dqs: r.readiness_score === null ? t("not scored") : r.readiness_score.toFixed(1) });

"use client";

/**
 * The tab registry of the object page. Cycle and Runs are new; every other tab is the v2 tab, mounted unchanged (it
 * reads the system and object from the address). Trend gains the stacked new and resolved bars above it.
 */
import type { ReactNode } from "react";
import { ObjectOverviewRoute, ObjectRulesRoute, ObjectTabRoute } from "@/design/v2/screens/routes";
import { t } from "@/lib/v2/i18n";
import { CycleTab } from "./CycleTab";
import { RunsTab } from "./RunsTab";
import { TrendStack } from "./TrendStack";
import { PairedScores } from "./PairedScores";
import type { ObjectRun } from "./useObjectRun";

export const TAB_IDS = ["cycle", "runs", "overview", "rules", "records", "fixes", "trend", "readiness", "processes", "lineage", "profile", "glossary", "golden"] as const;
export type TabId = (typeof TAB_IDS)[number];
/** Shown as tabs at every width; the rest go into the "More tabs" list under 1100 px. */
export const PRIMARY: readonly TabId[] = ["cycle", "runs", "overview", "rules", "records", "fixes"];

export const isTab = (s: string | undefined): s is TabId => !!s && (TAB_IDS as readonly string[]).includes(s);

export function tabLabel(id: TabId): string {
  switch (id) {
    case "cycle": return t("Cycle");
    case "runs": return t("Runs");
    case "overview": return t("Overview");
    case "rules": return t("Rules");
    case "records": return t("Records");
    case "fixes": return t("Fixes");
    case "trend": return t("Trend");
    case "readiness": return t("Readiness");
    case "processes": return t("Processes");
    case "lineage": return t("Lineage");
    case "profile": return t("Profile");
    case "glossary": return t("Glossary");
    case "golden": return t("Golden records");
  }
}

export function renderTab(id: TabId, o: ObjectRun, go: (tab: TabId) => void): ReactNode {
  switch (id) {
    case "cycle": return <CycleTab o={o} />;
    case "runs": return <RunsTab o={o} onOpen={(run) => { o.setRun(run); go("overview"); }} />;
    case "overview": return <><PairedScores o={o} /><ObjectOverviewRoute /></>;
    case "rules": return <ObjectRulesRoute />;
    case "trend": return <><TrendStack o={o} /><ObjectTabRoute tab="trend" /></>;
    default: return <ObjectTabRoute tab={id} />;
  }
}

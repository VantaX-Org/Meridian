"use client";

/**
 * The segments of the object page. Overview tells the story (why, what to fix), the other segments are the v2 tabs
 * mounted unchanged. Golden records, Glossary, Lineage and Profile sit in the More menu. `cycle` and `trend` are old
 * addresses: cycle opens the cycle sheet over Overview, trend is the hero's trend.
 */
import type { ReactNode } from "react";
import { ObjectOverviewRoute, ObjectRulesRoute, ObjectTabRoute } from "@/design/v2/screens/routes";
import { t } from "@/lib/v2/i18n";
import { RunsTab } from "./RunsTab";
import { WhySection } from "./WhySection";
import { FixSection } from "./FixSection";
import { FailingRecords } from "../report/FailingRecords";
import { SteeringReport } from "../report/SteeringReport";
import { LoadFilesPanel } from "../load/LoadFilesPanel";
import type { ObjectRun } from "./useObjectRun";

export const TAB_IDS = ["overview", "why", "fix", "records", "failing", "rules", "fixes", "report", "runs", "readiness", "processes", "golden", "glossary", "lineage", "profile", "cycle", "trend"] as const;
export type TabId = (typeof TAB_IDS)[number];
/** The segment row, in order. */
export const SEGMENTS: readonly TabId[] = ["overview", "why", "fix", "records", "failing", "rules", "fixes", "report", "runs", "readiness", "processes"];
/** Behind the More segment. */
export const MORE: readonly TabId[] = ["golden", "glossary", "lineage", "profile"];

export const isTab = (s: string | undefined): s is TabId => !!s && (TAB_IDS as readonly string[]).includes(s);

export function tabLabel(id: TabId): string {
  switch (id) {
    case "overview": return t("Overview");
    case "why": return t("Why");
    case "fix": return t("What to fix");
    case "records": return t("Records");
    case "rules": return t("Rules");
    case "failing": return t("Failing records");
    case "fixes": return t("Fixes");
    case "report": return t("Report");
    case "runs": return t("Runs");
    case "readiness": return t("Readiness");
    case "processes": return t("Processes");
    case "golden": return t("Golden records");
    case "glossary": return t("Glossary");
    case "lineage": return t("Lineage");
    case "profile": return t("Profile");
    case "cycle": return t("Cycle");
    case "trend": return t("Trend");
  }
}

export function renderTab(id: TabId, o: ObjectRun, go: (tab: TabId) => void): ReactNode {
  switch (id) {
    case "overview":
    case "cycle":
      return <><WhySection o={o} limit={5} /><FixSection o={o} /><ObjectOverviewRoute /></>;
    case "why": return <WhySection o={o} />;
    case "fix": return <FixSection o={o} />;
    case "runs": return <RunsTab o={o} onOpen={(run) => { o.setRun(run); go("overview"); }} />;
    case "rules": return <ObjectRulesRoute />;
    case "failing": return <FailingRecords o={o} />;
    case "report": return <><SteeringReport o={o} /><LoadFilesPanel module={o.module} /></>;
    default: return <ObjectTabRoute tab={id} />;
  }
}

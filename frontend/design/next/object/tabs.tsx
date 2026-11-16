"use client";

/**
 * The segments of the object page. Overview tells the story (why, what to fix, score over runs); Rules, Records and
 * Fixes are native. The remaining segments still mount the v2 tab inside a LegacyScope until they are ported. Failing records, Report, Golden records, Glossary, Lineage and Profile sit in the More menu. `cycle` and `trend` are old
 * addresses: cycle opens the cycle sheet over Overview, trend is the hero's trend.
 */
import type { ReactNode } from "react";
import { ObjectTabRoute } from "@/design/v2/screens/routes";
import { t } from "@/lib/v2/i18n";
import { RunsTab } from "./RunsTab";
import { WhySection } from "./WhySection";
import { ReasonPanel } from "../runs/ReasonPanel";
import { FixSection } from "./FixSection";
import { FailingRecords } from "../report/FailingRecords";
import { SteeringReport } from "../report/SteeringReport";
import { LoadFilesPanel } from "../load/LoadFilesPanel";
import type { ObjectRun } from "./useObjectRun";
import { LegacyScope } from "../shell/LegacyMount";
import { OverviewExtras } from "./tabs/OverviewExtras";
import { RulesTab } from "./tabs/RulesTab";
import { RecordsTab } from "./tabs/RecordsTab";
import { FixesTab } from "./tabs/FixesTab";

export const TAB_IDS = ["overview", "why", "fix", "records", "rules", "fixes", "runs", "readiness", "processes", "failing", "report", "golden", "glossary", "lineage", "profile", "cycle", "trend"] as const;
export type TabId = (typeof TAB_IDS)[number];
/** The segment row, in order. */
export const SEGMENTS: readonly TabId[] = ["overview", "why", "fix", "records", "rules", "fixes", "runs", "readiness", "processes"];
/** Behind the More segment. */
export const MORE: readonly TabId[] = ["failing", "report", "golden", "glossary", "lineage", "profile"];

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
    case "runs": return t("Runs");
    case "report": return t("Report");
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
      return <><WhySection o={o} limit={5} /><ReasonPanel versionId={o.runId ?? undefined} systemId={o.systemId} /><FixSection o={o} /><OverviewExtras o={o} /></>;
    case "why": return <WhySection o={o} />;
    case "fix": return <FixSection o={o} />;
    case "runs": return <RunsTab o={o} onOpen={(run) => { o.setRun(run); go("overview"); }} />;
    case "rules": return <RulesTab o={o} />;
    case "records": return <RecordsTab o={o} />;
    case "fixes": return <FixesTab o={o} />;
    case "failing": return <FailingRecords o={o} />;
    case "report": return <><SteeringReport o={o} /><LoadFilesPanel module={o.module} /></>;
    default: return <LegacyScope><ObjectTabRoute tab={id} /></LegacyScope>;
  }
}


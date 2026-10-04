"use client";

/**
 * Tab body for each workspace tab, keyed by the tab's route. Bodies are the
 * existing pages, loaded on demand; a tab is replaced by an Aurora surface by
 * swapping its entry here.
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const loading = () => <Skeleton className="h-64 w-full rounded-xl" />;
const page = (load: () => Promise<{ default: ComponentType }>) => dynamic(load, { ssr: false, loading });
const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, key: K) =>
  dynamic(() => load().then((m) => ({ default: m[key] })), { ssr: false, loading });

/** Tabs whose body is an Aurora surface — rendered on the canvas, not in the light sheet. */
export const AURORA_TABS: ReadonlySet<string> = new Set(["/", "/executive-report", "/sync", "/issues", "/match-rules", "/business-process", "/settings/scoring", "/settings/field-mapping",
  "/systems", "/upload", "/versions", "/admin", "/findings", "/cleaning", "/exceptions", "/dedup", "/remediation", "/workbench", "/stewardship", "/stewardship/metrics", "/golden-records", "/glossary", "/reports", "/notifications",
  "/process", "/config-impact", "/relationships", "/connectivity"]);

export const TAB_BODIES: Readonly<Record<string, ComponentType>> = {
  "/": named(() => import("@/components/command-centre/overview"), "CommandCentreOverview"),
  "/executive-report": named(() => import("@/components/command-centre/executive-report"), "ExecutiveReport"),
  "/command-centre": named(() => import("@/app/(dashboard)/command-centre/live"), "LiveOperationsPage"),
  "/analytics": page(() => import("@/app/(dashboard)/analytics/page")),
  "/findings": named(() => import("@/components/command-centre/findings"), "FindingsSurface"),
  "/issues": page(() => import("@/app/(dashboard)/issues/page")),
  "/notifications": named(() => import("@/components/command-centre/notifications"), "NotificationsSurface"),

  "/systems": named(() => import("@/components/data/systems"), "SystemsSurface"),
  "/sync": named(() => import("@/components/data/runs"), "RunsSurface"),
  "/upload": named(() => import("@/components/data/import"), "ImportSurface"),
  "/versions": named(() => import("@/components/data/analyses"), "AnalysesSurface"),
  "/connectivity": page(() => import("@/app/(dashboard)/connectivity/page")),
  "/run-sync": page(() => import("@/app/(dashboard)/run-sync/page")),
  "/migration": page(() => import("@/app/(dashboard)/migration/page")),

  "/workbench": named(() => import("@/app/(dashboard)/workbench/queue"), "MyQueuePage"),
  "/stewardship": named(() => import("@/components/workbench/team-workload"), "TeamWorkloadSurface"),
  "/stewardship/metrics": named(() => import("@/components/workbench/steward-metrics"), "StewardMetricsSurface"),
  "/cleaning": named(() => import("@/components/workbench/cleaning"), "CleaningSurface"),
  "/exceptions": named(() => import("@/components/workbench/exceptions"), "ExceptionsSurface"),
  "/dedup": named(() => import("@/components/workbench/dedup"), "DedupSurface"),
  "/remediation": named(() => import("@/components/workbench/remediation"), "RemediationSurface"),
  "/ai/rules": page(() => import("@/app/(dashboard)/ai/rules/page")),
  "/golden-records": named(() => import("@/components/workbench/golden-records"), "GoldenRecordsSurface"),
  "/match-rules": named(() => import("@/components/workbench/match-rules"), "MatchRulesSurface"),
  "/glossary": named(() => import("@/components/workbench/glossary"), "GlossarySurface"),
  "/reports": named(() => import("@/components/workbench/reports"), "ReportsSurface"),

  "/process": named(() => import("@/app/(dashboard)/process/map"), "ProcessMapPage"),
  "/business-process": named(() => import("@/components/process/readiness"), "ProcessReadiness"),
  "/config-impact": page(() => import("@/app/(dashboard)/config-impact/page")),
  "/mining": page(() => import("@/app/(dashboard)/mining/page")),
  "/relationships": page(() => import("@/app/(dashboard)/relationships/page")),

  "/admin": named(() => import("@/components/admin/users"), "UsersSurface"),
  "/settings": page(() => import("@/app/(dashboard)/settings/page")),
  "/settings/rules": page(() => import("@/app/(dashboard)/settings/rules/page")),
  "/settings/scoring": named(() => import("@/components/admin/scoring"), "ScoringSettings"),
  "/settings/field-mapping": named(() => import("@/components/admin/field-mapping"), "FieldMappingSettings"),
  "/settings/ai": page(() => import("@/app/(dashboard)/settings/ai/page")),
  "/settings/licence": page(() => import("@/app/(dashboard)/settings/licence/page")),
  "/contracts": page(() => import("@/app/(dashboard)/contracts/page")),
};

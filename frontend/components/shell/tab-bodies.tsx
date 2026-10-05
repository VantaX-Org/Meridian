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
export const AURORA_TABS: ReadonlySet<string> = new Set(["/", "/command-centre", "/executive-report", "/sync", "/issues", "/match-rules", "/match-rules/tuning", "/match-rules/constraints", "/business-process", "/settings/scoring", "/workbench/triage", "/workbench/progress", "/admin/triage", "/settings/field-mapping", "/exceptions/rules", "/settings/exception-billing",
  "/systems", "/upload", "/versions", "/admin", "/findings", "/cleaning", "/exceptions", "/dedup", "/golden-records", "/glossary", "/reports", "/notifications", "/settings", "/settings/rules", "/settings/ai", "/settings/licence", "/contracts",
  "/relationships", "/mining", "/ai/rules", "/workbench", "/process", "/config-impact"]);

export const TAB_BODIES: Readonly<Record<string, ComponentType>> = {
  "/": named(() => import("@/components/command-centre/overview"), "CommandCentreOverview"),
  "/executive-report": named(() => import("@/components/command-centre/executive-report"), "ExecutiveReport"),
  "/command-centre": named(() => import("@/components/command-centre/live"), "LiveOperationsPage"),
  "/findings": named(() => import("@/components/command-centre/findings"), "FindingsSurface"),
  "/issues": named(() => import("@/components/analyse/records"), "RecordsSurface"),
  "/workbench/progress": named(() => import("@/components/workbench/progress"), "ProgressSurface"),
  "/notifications": named(() => import("@/components/command-centre/notifications"), "NotificationsSurface"),

  "/systems": named(() => import("@/components/data/systems"), "SystemsSurface"),
  "/sync": named(() => import("@/components/data/runs"), "RunsSurface"),
  "/upload": named(() => import("@/components/data/import"), "ImportSurface"),
  "/versions": named(() => import("@/components/data/analyses"), "AnalysesSurface"),
  "/migration": page(() => import("@/app/(dashboard)/migration/page")),

  "/workbench": named(() => import("@/components/workbench/inbox"), "StewardInboxSurface"),
  "/cleaning": named(() => import("@/components/workbench/cleaning"), "CleaningSurface"),
  "/exceptions": named(() => import("@/components/workbench/exceptions"), "ExceptionsSurface"),
  "/exceptions/rules": named(() => import("@/components/workbench/exception-rules"), "ExceptionRulesSurface"),
  "/dedup": named(() => import("@/components/workbench/dedup"), "DedupSurface"),
  "/ai/rules": named(() => import("@/components/workbench/ai-rules"), "AiRulesSurface"),
  "/golden-records": named(() => import("@/components/workbench/golden-records"), "GoldenRecordsSurface"),
  "/match-rules": named(() => import("@/components/workbench/match-rules"), "MatchRulesSurface"),
  "/match-rules/tuning": named(() => import("@/components/workbench/match-tuning"), "MatchTuningSurface"),
  "/match-rules/constraints": named(() => import("@/components/workbench/match-tuning"), "PairConstraintsSurface"),
  "/glossary": named(() => import("@/components/workbench/glossary"), "GlossarySurface"),
  "/reports": named(() => import("@/components/workbench/reports"), "ReportsSurface"),

  "/process": named(() => import("@/app/(dashboard)/process/map"), "ProcessMapPage"),
  "/business-process": named(() => import("@/components/process/readiness"), "ProcessReadiness"),
  "/config-impact": page(() => import("@/app/(dashboard)/config-impact/page")),
  "/mining": named(() => import("@/components/process/graph"), "GraphSurface"),
  "/relationships": named(() => import("@/components/process/graph"), "GraphSurface"),

  "/admin": named(() => import("@/components/admin/users"), "UsersSurface"),
  "/settings": named(() => import("@/components/admin/settings"), "SettingsSurface"),
  "/settings/rules": named(() => import("@/components/admin/rules"), "RulesSurface"),
  "/settings/scoring": named(() => import("@/components/admin/scoring"), "ScoringSettings"),
  "/workbench/triage": named(() => import("@/components/workbench/triage-queue"), "TriageQueueSurface"),
  "/admin/triage": named(() => import("@/components/admin/triage"), "TriageAdminSurface"),
  "/settings/field-mapping": named(() => import("@/components/admin/field-mapping"), "FieldMappingSettings"),
  "/settings/ai": named(() => import("@/components/admin/ai"), "AISurface"),
  "/settings/licence": named(() => import("@/components/admin/licence"), "LicenceSurface"),
  "/settings/exception-billing": named(() => import("@/components/admin/exception-billing"), "ExceptionBillingSurface"),
  "/contracts": named(() => import("@/components/admin/contracts"), "ContractsSurface"),
};

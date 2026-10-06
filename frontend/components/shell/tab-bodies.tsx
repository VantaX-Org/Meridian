"use client";

/**
 * Tab body for each workspace tab, keyed by the tab's route. Bodies are the
 * existing pages, loaded on demand; a tab is replaced by an Aurora surface by
 * swapping its entry here.
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { TableSkeleton } from "@/components/ui-core";

const loading = () => <TableSkeleton rows={6} label="Loading table" />;
const page = (load: () => Promise<{ default: ComponentType }>) => dynamic(load, { ssr: false, loading });
const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, key: K) =>
  dynamic(() => load().then((m) => ({ default: m[key] })), { ssr: false, loading });

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
  "/migration": named(() => import("@/components/data/migration"), "MigrationSurface"),

  "/workbench": named(() => import("@/components/workbench/inbox"), "StewardInboxSurface"),
  "/cleaning": named(() => import("@/components/workbench/cleaning"), "CleaningSurface"),
  "/exceptions": named(() => import("@/components/workbench/exceptions"), "ExceptionsSurface"),
  "/exceptions/rules": named(() => import("@/components/workbench/exception-rules"), "ExceptionRulesSurface"),
  "/dedup": named(() => import("@/components/workbench/dedup"), "DedupSurface"),
  "/ai/rules": named(() => import("@/components/workbench/ai-rules"), "AiRulesSurface"),
  "/golden-records": named(() => import("@/components/workbench/golden-records"), "GoldenRecordsSurface"),
  "/match-rules": named(() => import("@/components/workbench/match-rules"), "MatchRulesSurface"),
  "/glossary": named(() => import("@/components/workbench/glossary"), "GlossarySurface"),
  "/reports": named(() => import("@/components/workbench/reports"), "ReportsSurface"),

  "/process": named(() => import("@/app/(dashboard)/process/map"), "ProcessMapPage"),
  "/business-process": named(() => import("@/components/process/readiness"), "ProcessReadiness"),
  "/lineage": named(() => import("@/components/process/lineage"), "LineageSurface"),
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

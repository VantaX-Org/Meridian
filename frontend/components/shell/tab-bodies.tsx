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

export const TAB_BODIES: Readonly<Record<string, ComponentType>> = {
  "/": named(() => import("@/app/(dashboard)/command-centre/overview"), "OverviewPage"),
  "/command-centre": named(() => import("@/app/(dashboard)/command-centre/live"), "LiveOperationsPage"),
  "/analytics": page(() => import("@/app/(dashboard)/analytics/page")),
  "/findings": page(() => import("@/app/(dashboard)/findings/page")),
  "/issues": page(() => import("@/app/(dashboard)/issues/page")),
  "/notifications": page(() => import("@/app/(dashboard)/notifications/page")),

  "/systems": page(() => import("@/app/(dashboard)/systems/page")),
  "/sync": page(() => import("@/app/(dashboard)/sync/page")),
  "/upload": page(() => import("@/app/(dashboard)/upload/page")),
  "/versions": page(() => import("@/app/(dashboard)/versions/page")),
  "/connectivity": page(() => import("@/app/(dashboard)/connectivity/page")),
  "/run-sync": page(() => import("@/app/(dashboard)/run-sync/page")),
  "/migration": page(() => import("@/app/(dashboard)/migration/page")),

  "/workbench": named(() => import("@/app/(dashboard)/workbench/queue"), "MyQueuePage"),
  "/stewardship": page(() => import("@/app/(dashboard)/stewardship/page")),
  "/stewardship/metrics": page(() => import("@/app/(dashboard)/stewardship/metrics/page")),
  "/cleaning": page(() => import("@/app/(dashboard)/cleaning/page")),
  "/exceptions": page(() => import("@/app/(dashboard)/exceptions/page")),
  "/dedup": page(() => import("@/app/(dashboard)/dedup/page")),
  "/ai/rules": page(() => import("@/app/(dashboard)/ai/rules/page")),
  "/golden-records": page(() => import("@/app/(dashboard)/golden-records/page")),
  "/glossary": page(() => import("@/app/(dashboard)/glossary/page")),
  "/reports": page(() => import("@/app/(dashboard)/reports/page")),

  "/process": named(() => import("@/app/(dashboard)/process/map"), "ProcessMapPage"),
  "/business-process": page(() => import("@/app/(dashboard)/business-process/page")),
  "/config-impact": page(() => import("@/app/(dashboard)/config-impact/page")),
  "/mining": page(() => import("@/app/(dashboard)/mining/page")),
  "/relationships": page(() => import("@/app/(dashboard)/relationships/page")),

  "/admin": named(() => import("@/app/(dashboard)/admin/users"), "UsersAuditPage"),
  "/settings": page(() => import("@/app/(dashboard)/settings/page")),
  "/settings/rules": page(() => import("@/app/(dashboard)/settings/rules/page")),
  "/settings/field-mapping": page(() => import("@/app/(dashboard)/settings/field-mapping/page")),
  "/settings/ai": page(() => import("@/app/(dashboard)/settings/ai/page")),
  "/settings/licence": page(() => import("@/app/(dashboard)/settings/licence/page")),
  "/contracts": page(() => import("@/app/(dashboard)/contracts/page")),
};

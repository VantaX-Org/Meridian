"use client";

import { useQuery } from "@tanstack/react-query";
import { getSystems } from "@/lib/api/connectivity";
import { getConfigLandscape } from "@/lib/api/config-load";
import { getVersions } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "./use-role";

export type DayOneStep =
  | { key: "connect"; href: "/systems"; label: "Connect a system"; detail: string }
  | { key: "import"; href: "/import"; label: "Import a file"; detail: string }
  | { key: "config"; href: `/systems/${string}`; label: "Load configuration"; detail: string }
  | { key: "extract"; href: `/systems/${string}`; label: "Run an extraction"; detail: string }
  | { key: "running"; href: `/runs/${string}`; label: "Analysis is running"; detail: string }
  | { key: "failed"; href: `/runs/${string}`; label: "The last run failed"; detail: string };

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);
const FAILED = new Set(["failed", "agents_failed"]);

/**
 * Single source for "what should the tenant do next", derived from live
 * systems/config/versions state (spec section 4). Used by Home's no-data
 * layout, the top bar's run-selector slot, and every "no run yet" empty
 * state's action link — so the journey is always the same journey.
 */
export function useDayOne(): { status: "loading" | "error" | "ready"; step: DayOneStep | null } {
  const { can } = useRole();
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const landscapeQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });
  const versionsQ = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });

  if (systemsQ.isLoading || landscapeQ.isLoading || versionsQ.isLoading) {
    return { status: "loading", step: null };
  }
  if (systemsQ.isError || landscapeQ.isError || versionsQ.isError) {
    return { status: "error", step: null };
  }

  const systems = systemsQ.data ?? [];
  const landscape = landscapeQ.data;
  const versions = versionsQ.data?.versions ?? [];
  const canManage = can("manage_system");

  const gate = (step: DayOneStep): DayOneStep =>
    step.key === "import" && !can("upload")
      ? { ...step, label: "Ask an administrator to import a file." as never, href: step.href }
      : !canManage && step.key !== "running" && step.key !== "failed"
        ? { ...step, label: `Ask an administrator to ${step.label.toLowerCase()}.` as never }
        : step;

  if (versions.some((v) => FINISHED.has(v.status))) {
    return { status: "ready", step: null };
  }

  const running = versions.filter((v) => !FINISHED.has(v.status) && !FAILED.has(v.status));
  const newestRunning = running[0];
  if (versions.some((v) => FAILED.has(v.status)) && running.length === 0) {
    const failed = versions.find((v) => FAILED.has(v.status))!;
    return {
      status: "ready",
      step: gate({ key: "failed", href: `/runs/${failed.id}`, label: "The last run failed", detail: "Open the run to see which step failed." }),
    };
  }
  if (versions.length > 0 && newestRunning) {
    return {
      status: "ready",
      step: gate({ key: "running", href: `/runs/${newestRunning.id}`, label: "Analysis is running", detail: "Objects, findings and insights appear when it finishes." }),
    };
  }
  if (systems.length === 0) {
    return {
      status: "ready",
      step: gate({ key: "connect", href: "/systems", label: "Connect a system", detail: "Add an SAP system, or import a file if you have an export." }),
    };
  }
  const first = systems[0]!;
  if (landscape && landscape.loaded === 0 && (first.config_sync_status === "not_loaded" || first.config_sync_status === "failed")) {
    return {
      status: "ready",
      step: gate({ key: "config", href: `/systems/${first.id}`, label: "Load configuration", detail: "Configuration tells rules which checks apply to this system." }),
    };
  }
  return {
    status: "ready",
    step: gate({ key: "extract", href: `/systems/${first.id}`, label: "Run an extraction", detail: "Extraction creates the first run and starts analysis." }),
  };
}

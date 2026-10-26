"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { getConfigLandscape } from "@/lib/api/config-load";
import { runListQuery } from "@/hooks/use-run-list";
import { isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "./use-role";

interface StepBase {
  label: string;
  detail: string;
  actionable: boolean;
  /** The button's text when it differs from the label ("Open the failed run"). */
  actionLabel?: string;
  /** A second, lesser way to do the step ("Import a file" beside "Connect a system"). */
  secondary?: { label: string; href: "/import" };
}
export type DayOneStep =
  | ({ key: "connect"; href: "/systems" | "/systems?connect=1" | null } & StepBase)
  | ({ key: "import"; href: "/import" | null } & StepBase)
  | ({ key: "config"; href: `/systems/${string}` | null } & StepBase)
  | ({ key: "extract"; href: `/systems/${string}` | null } & StepBase)
  | ({ key: "running"; href: `/runs/${string}` } & StepBase)
  | ({ key: "failed"; href: `/runs/${string}` } & StepBase);

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);
const FAILED = new Set(["failed", "agents_failed"]);
const CONFIG_MISSING = new Set(["not_loaded", "failed"]);

/** The permission each step needs: connecting and configuring a system, extracting from it, importing a file. */
const NEEDS: Record<DayOneStep["key"], string | null> = {
  connect: "manage_systems", config: "manage_systems", extract: "trigger_sync", import: "upload", running: null, failed: null,
};

/**
 * Single source for "what should the tenant do next", derived from live
 * systems/config/versions state (spec section 4). Used by Home's no-data
 * layout and every "no run yet" empty
 * state's action link — so the journey is always the same journey.
 */
export interface DayOne {
  /** "error" when the run list, the systems or the configuration landscape could not be read. */
  status: "loading" | "error" | "ready";
  step: DayOneStep | null;
  /** The failed request when `status` is "error" (for `apiErrorState`), else null. */
  error: unknown;
  /** Reads the three sources again: the Retry of an error state built on this hook. */
  refetch: () => void;
}

export function useDayOne(): DayOne {
  const { can } = useRole();
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const landscapeQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });
  const versionsQ = useQuery(runListQuery());
  const refetch = () => { void versionsQ.refetch(); void systemsQ.refetch(); void landscapeQ.refetch(); };
  const done = (status: DayOne["status"], step: DayOneStep | null): DayOne => ({ status, step, error: null, refetch });

  if (systemsQ.isLoading || landscapeQ.isLoading || versionsQ.isLoading) {
    return done("loading", null);
  }
  const failed = [versionsQ, systemsQ, landscapeQ].find((q) => isListFailure(q));
  if (failed) {
    return { status: "error", step: null, error: failed.error, refetch };
  }

  const systems = systemsQ.data ?? [];
  const landscape = landscapeQ.data;
  const versions = versionsQ.data?.versions ?? [];

  const gate = (step: DayOneStep): DayOneStep => {
    const needs = NEEDS[step.key];
    if (!needs || can(needs)) return step;
    return { ...step, actionable: false, href: null, actionLabel: undefined, label: `Ask an administrator to ${step.label.toLowerCase()}.` } as DayOneStep;
  };

  if (versions.some((v) => FINISHED.has(v.status))) {
    return done("ready", null);
  }

  const running = versions
    .filter((v) => !FINISHED.has(v.status) && !FAILED.has(v.status))
    .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
  const newestRunning = running[0];
  if (versions.some((v) => FAILED.has(v.status)) && running.length === 0) {
    const failed = versions.find((v) => FAILED.has(v.status))!;
    return {
      status: "ready", error: null, refetch,
      step: gate({ key: "failed", href: `/runs/${failed.id}`, label: "The last run failed", detail: "Open the run to see which step failed.", actionable: true, actionLabel: "Open the failed run" }),
    };
  }
  if (versions.length > 0 && newestRunning) {
    return {
      status: "ready", error: null, refetch,
      step: gate({ key: "running", href: `/runs/${newestRunning.id}`, label: "Analysis is running", detail: "Objects, findings and insights appear when it finishes.", actionable: true, actionLabel: "Open the job" }),
    };
  }
  if (systems.length === 0) {
    if (!can("manage_systems") && can("upload")) {
      // Connecting needs an administrator, but an import gets this user to a first score on their own.
      return {
        status: "ready", error: null, refetch,
        step: { key: "import", href: "/import", label: "Import a file", detail: "Import an SAP export to get a first score. Connecting a live system needs an administrator.", actionable: true },
      };
    }
    return {
      status: "ready", error: null, refetch,
      step: gate({
        key: "connect", href: "/systems?connect=1", label: "Connect a system", detail: "Add an SAP system, or import a file if you have an export.", actionable: true,
        secondary: can("upload") ? { label: "Import a file", href: "/import" } : undefined,
      }),
    };
  }
  // The first system still missing the step, so the button opens the system that needs the work.
  const unconfigured = systems.find((s) => CONFIG_MISSING.has(s.config_sync_status ?? ""));
  if (landscape && landscape.loaded === 0 && unconfigured) {
    return {
      status: "ready", error: null, refetch,
      step: gate({ key: "config", href: `/systems/${unconfigured.id}?tab=health&part=config`, label: "Load configuration", detail: `${unconfigured.name} has no configuration loaded yet. Configuration tells rules which checks apply to this system.`, actionable: true }),
    };
  }
  const unextracted = systems.find((s) => !s.last_sync_at) ?? systems[0]!;
  return {
    status: "ready", error: null, refetch,
    step: gate({ key: "extract", href: `/systems/${unextracted.id}?extract=1`, label: "Run an extraction", detail: `Nothing has been extracted from ${unextracted.name} yet. Extraction creates the first run and starts analysis.`, actionable: true }),
  };
}

/**
 * Renders a day-one step as a link, or as plain text with no action when
 * the step is gated (`actionable: false`/`href: null`) — spec 4's no-link
 * rule for users who lack the permission the step requires.
 */
export function DayOneAction({ step, fallbackHref, fallbackLabel }: { step: DayOneStep | null; fallbackHref: string; fallbackLabel: string }) {
  if (step && (!step.actionable || !step.href)) {
    return <span style={{ color: "var(--m-ink-3)" }}>{step.label}</span>;
  }
  const primary = <Button render={<Link href={step?.href ?? fallbackHref}>{step?.actionLabel ?? step?.label ?? fallbackLabel}</Link>} />;
  if (!step?.secondary) return primary;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {primary}
      <Button variant="secondary" render={<Link href={step.secondary.href}>{step.secondary.label}</Link>} />
    </span>
  );
}

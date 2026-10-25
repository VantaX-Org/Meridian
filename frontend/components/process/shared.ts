import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import type { Verdict } from "@/design";
import { getBusinessProcess } from "@/lib/api/connectivity";
import { useRunListWith } from "@/hooks/use-run-list";
import { isFinished } from "@/lib/runs";
import { queryKeys } from "@/lib/query-keys";
import type { BusinessProcessL1, BusinessProcessL4, BusinessProcessL5Field, Version } from "@/types/api";

export const isCompleteVersion = (v: Version) => isFinished(v) && !!v.dqs_summary;

/** Objects with an L1 to L5 definition (sap/process_definitions.py: procure to pay and order to cash). */
export const PROCESS_MODULES: ReadonlySet<string> = new Set([
  "accounts_payable", "fi_gl", "material_master", "mm_purchasing", "accounts_receivable", "sd_customer_master", "sd_sales_orders",
]);

/**
 * The run the topbar selected (`?run=`) when it is finished, else the latest finished analysis. Reads the shared
 * run list, and a `?run=` older than the list by id, so a selected run is never swapped for the newest one.
 */
export function useLatestVersion() {
  const run = useSearchParams().get("run");
  const { list: q, versions: vs, fetchingRun } = useRunListWith(run);
  const latest = useMemo(
    () => (fetchingRun ? undefined : vs.find((v) => v.id === run && isCompleteVersion(v)) ?? vs.find(isCompleteVersion)),
    [vs, run, fetchingRun],
  );
  return { latest, isLoading: q.isLoading || fetchingRun, error: q.error as Error | null, refetch: q.refetch };
}

/** The records a rule fails in a run: the object's rules tab filtered to that check. */
export const ruleRecordsHref = (module: string, checkId: string, versionId?: string) => {
  const p = new URLSearchParams();
  if (versionId) p.set("run", versionId);
  p.set("tab", "rules");
  p.set("check", checkId);
  return `/objects/${module}?${p}`;
};

/** Link from a check in a version to its failing records. The process APIs name checks, not findings. */
export function useFindingHref(versionId: string | undefined) {
  return useCallback((module: string, checkId: string) => ruleRecordsHref(module, checkId, versionId), [versionId]);
}

/* ---------- field scoring: the readiness page and the process home read the same numbers ---------- */

export const l4Fields = (l4: BusinessProcessL4): BusinessProcessL5Field[] => l4.activities.flatMap((a) => a.fields);
export const l1Fields = (l1: BusinessProcessL1): BusinessProcessL5Field[] =>
  l1.l2_groups.flatMap((l2) => l2.l3_processes.flatMap((l3) => l3.l4_subprocesses.flatMap(l4Fields)));
/** Share of fields passing, 0 to 100; null when no field is mapped, so there is nothing to score. */
export const score = (fs: BusinessProcessL5Field[]): number | null =>
  fs.length ? Math.round((fs.filter((f) => f.dq_status === "green").length / fs.length) * 100) : null;
export const red = (fs: BusinessProcessL5Field[]) => fs.filter((f) => f.dq_status === "red").length;
export const sev = (f: BusinessProcessL5Field): "critical" | "high" | "medium" =>
  f.mandatory ? "critical" : (f.pass_rate ?? 100) < 50 ? "high" : "medium";
/** A step or process verdict: a red field is no-go, 90% or more passing is go, else at risk. */
export const verdictOf = (blocking: number, pct: number | null): Verdict =>
  blocking ? "no-go" : pct == null || pct >= 90 ? "go" : "at-risk";

export interface L1Readiness {
  l1: BusinessProcessL1;
  module: string;
  verdict: Verdict;
  pct: number | null;
  /** The red field failing the most records. */
  worst: BusinessProcessL5Field | null;
  failing: number;
}

export function l1Readiness(l1: BusinessProcessL1, module: string): L1Readiness {
  const fs = l1Fields(l1);
  const reds = fs.filter((f) => f.dq_status === "red").sort((a, b) => b.affected_count - a.affected_count);
  const pct = score(fs);
  return { l1, module, pct, verdict: verdictOf(reds.length, pct), worst: reds[0] ?? null, failing: reds.reduce((a, f) => a + f.affected_count, 0) };
}

/**
 * Readiness of every L1 the latest finished run can score, keyed by L1 id (PTP, OTC): one business process read
 * per process object in the run. The first read of an L1 wins, since every read carries the whole run's findings.
 */
export function useProcessReadiness() {
  const { latest, isLoading, error } = useLatestVersion();
  const modules = useMemo(() => Object.keys(latest?.dqs_summary ?? {}).filter((m) => PROCESS_MODULES.has(m)), [latest]);
  const reads = useQueries({
    queries: modules.map((m) => ({
      queryKey: queryKeys.businessProcess(latest?.id, m), queryFn: () => getBusinessProcess(latest!.id, m),
      enabled: !!latest, retry: false, meta: { ignoreError: true },
    })),
  });
  const byL1 = new Map<string, L1Readiness>();
  reads.forEach((r, i) => { for (const l1 of r.data ?? []) if (!byL1.has(l1.l1_id)) byL1.set(l1.l1_id, l1Readiness(l1, modules[i])); });
  return { latest, byL1, isLoading: isLoading || reads.some((r) => r.isLoading), error };
}

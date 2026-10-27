import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { buildDrillHref, type Verdict } from "@/design";
import { getBusinessProcess } from "@/lib/api/connectivity";
import { getFindings } from "@/lib/api/findings";
import { useRunListWith } from "@/hooks/use-run-list";
import { plural } from "@/lib/format";
import { isFinished } from "@/lib/runs";
import { queryKeys } from "@/lib/query-keys";
import type { BusinessProcessL1, BusinessProcessL4, BusinessProcessL5Field, Version } from "@/types/api";

export const isCompleteVersion = (v: Version) => isFinished(v) && !!v.dqs_summary;

/** Objects with an L1 to L5 definition (sap/process_definitions.py: procure to pay and order to cash). */
export const PROCESS_MODULES: ReadonlySet<string> = new Set([
  "accounts_payable", "fi_gl", "material_master", "mm_purchasing", "accounts_receivable", "sd_customer_master", "sd_sales_orders",
]);

/**
 * The objects each L1 with a readiness definition covers (sap/process_definitions.py `modules`), the general ledger
 * last since both processes post to it. The readiness API reads one object at a time, so a link to one L1 names an
 * object of that L1.
 */
export const PROCESS_L1_MODULES: Readonly<Record<string, readonly string[]>> = {
  PTP: ["accounts_payable", "mm_purchasing", "material_master", "fi_gl"],
  OTC: ["accounts_receivable", "sd_customer_master", "sd_sales_orders", "fi_gl"],
};

/** The process objects in definition order (procure to pay, then order to cash), each once. */
const PROCESS_ORDER: readonly string[] = [...new Set(Object.values(PROCESS_L1_MODULES).flat())];

/**
 * The process objects of the current state, in definition order, each with the run it is read from (its own latest
 * run). Objects without an L1 to L5 definition are left out: the current state never offers an object it cannot
 * score.
 */
export function currentProcessObjects<T extends { module: string }>(objects: readonly T[]): T[] {
  return PROCESS_ORDER.map((m) => objects.find((o) => o.module === m)).filter((o): o is T => !!o);
}

/**
 * The object the current state opens on: the first process object whose own run has a process document, so the page
 * never opens on an empty object while another has readiness. Undefined while a read that comes first is pending;
 * the first object when none has a document.
 */
export function firstWithProcesses(modules: readonly string[], reads: readonly { data?: readonly unknown[]; isLoading: boolean }[]): string | undefined {
  for (let i = 0; i < modules.length; i++) {
    if (reads[i]?.isLoading) return undefined;
    if (reads[i]?.data?.length) return modules[i];
  }
  return modules[0];
}

/** The objects of `modules` that carry `l1`'s definition, in definition order; empty for an L1 without one. */
export const modulesOfL1 = (l1: string, modules: readonly string[]): string[] =>
  (PROCESS_L1_MODULES[l1] ?? []).filter((m) => modules.includes(m));

/**
 * The readiness page for one L1, over one object of it and one run, so it never opens another L1 of the run. `object`
 * defaults to the L1's first object; the page moves to an object of that L1 the run covers when this one is absent.
 * Undefined for an L1 with no readiness definition.
 */
export function readinessHref({ l1, object, run }: { l1: string; object?: string; run?: string | null }): string | undefined {
  const own = PROCESS_L1_MODULES[l1];
  if (!own) return undefined;
  const p = new URLSearchParams({ l1, object: object && own.includes(object) ? object : own[0] });
  if (run) p.set("run", run);
  return `/insights/process?${p}`;
}

/** The as-is flow of an L1, mined by process discovery (`/process/<l1>`), on the system when it is known. */
export const asIsHref = (l1: string, systemId?: string | null): string =>
  `/process/${encodeURIComponent(l1)}${systemId ? `?${new URLSearchParams({ system: systemId })}` : ""}`;

/**
 * Where a process step a rule gates opens. An L1 with a readiness definition opens its readiness over the rule's
 * object when that object belongs to the L1 (in `run`, the newest run that evaluated the rule), else over the L1's
 * first object in the latest run; any other L1 opens the step in its reference model on the process page.
 */
export function processStepHref({ l1, l4, module, run }: { l1: string; l4: string; module: string; run: string | undefined }): string {
  const own = PROCESS_L1_MODULES[l1]?.includes(module) ?? false;
  return readinessHref({ l1, object: own ? module : undefined, run: own ? run : undefined })
    ?? `/process/${encodeURIComponent(l1)}?${new URLSearchParams({ tab: "reference", node: l4 })}`;
}

/** The system a run read its data from; undefined for uploads. */
export const systemOfVersion = (v: Version): string | undefined => v.metadata?.system_id ?? undefined;

/**
 * The run the topbar selected (`?run=`) when it is finished, else the latest finished analysis. Reads the shared
 * run list, and a `?run=` older than the list by id, so a selected run is never swapped for the newest one.
 * `systemId` keeps both to that system's runs (a `?run=` of another system is passed over); `null` means the system
 * is not known yet, so nothing is chosen.
 */
export function useLatestVersion(systemId?: string | null) {
  const run = useSearchParams().get("run");
  const { list: q, versions: all, fetchingRun } = useRunListWith(run);
  const latest = useMemo(() => {
    if (fetchingRun || systemId === null) return undefined;
    const vs = systemId === undefined ? all : all.filter((v) => systemOfVersion(v) === systemId);
    return vs.find((v) => v.id === run && isCompleteVersion(v)) ?? vs.find(isCompleteVersion);
  }, [all, run, fetchingRun, systemId]);
  return { latest, isLoading: q.isLoading || fetchingRun, error: q.error as Error | null, refetch: q.refetch };
}

/**
 * Link for a check of a version that failed on that object: the object's records tab filtered to that check, in that
 * run; undefined when the run's findings (worst first, 200 rows) do not hold the check on that object, so a caller
 * that tries several objects lands on the one where it failed. The process APIs name checks, not findings, and the old
 * `/analyse/finding/<id>` link only redirected to the objects list, so the rule's records were lost on the way.
 */
export function useFindingHref(versionId: string | undefined) {
  const q = useQuery({
    queryKey: ["findings.by-check", versionId], enabled: !!versionId, retry: false, meta: { ignoreError: true },
    queryFn: () => getFindings({ version_id: versionId, sort: "impact", limit: 200 }),
  });
  const failed = useMemo(() => new Set((q.data?.findings ?? []).map((f) => `${f.module}:${f.check_id}`)), [q.data]);
  return useCallback(
    (module: string, checkId: string): string | undefined =>
      failed.has(`${module}:${checkId}`) ? buildDrillHref({ object: module, ruleId: checkId, run: versionId }) : undefined,
    [failed, versionId],
  );
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

/**
 * The red fields once each. One field (with the rule failing it) is written by several steps, so the step-by-step
 * list repeats it: AP016 on vendor onboarding, invoice verification and the payment run is one field failing one
 * record, never "3 blocking fields fail on 3 records".
 */
export function distinctReds(fs: BusinessProcessL5Field[]): BusinessProcessL5Field[] {
  const byKey = new Map<string, BusinessProcessL5Field>();
  for (const f of fs) {
    if (f.dq_status !== "red") continue;
    const key = `${f.check_id ?? ""}|${f.field}`;
    const seen = byKey.get(key);
    if (!seen || f.affected_count > seen.affected_count) byKey.set(key, f);
  }
  return [...byKey.values()].sort((a, b) => b.affected_count - a.affected_count);
}

/**
 * The blocking fields in words (lib/help/glossary.ts): with one failing rule, its failing records; with several,
 * their rule failures, since a record can fail more than one of them. Null when nothing blocks.
 */
export function blockingSentence(fs: BusinessProcessL5Field[]): string | null {
  const reds = distinctReds(fs);
  if (!reds.length) return null;
  const fields = plural(reds.length, "blocking field fails", "blocking fields fail");
  const rules = new Set(reds.map((f) => f.check_id ?? f.field));
  if (rules.size === 1) return `${fields} on ${plural(Math.max(...reds.map((f) => f.affected_count)), "record")}.`;
  return `${fields}: ${plural(reds.reduce((a, f) => a + f.affected_count, 0), "rule failure")} between them.`;
}

export interface L1Readiness {
  l1: BusinessProcessL1;
  module: string;
  verdict: Verdict;
  pct: number | null;
  /** The red field failing the most records. */
  worst: BusinessProcessL5Field | null;
  /** Rule failures of the distinct red fields (a field several steps write counts once). */
  failing: number;
}

export function l1Readiness(l1: BusinessProcessL1, module: string): L1Readiness {
  const fs = l1Fields(l1);
  // Each red field once (a field several steps write is one field): its rule failures summed over distinct rules.
  const reds = distinctReds(fs);
  const pct = score(fs);
  return { l1, module, pct, verdict: verdictOf(reds.length, pct), worst: reds[0] ?? null, failing: reds.reduce((a, f) => a + f.affected_count, 0) };
}

/**
 * Readiness of every L1 the latest finished run can score, keyed by L1 id (PTP, OTC): one business process read
 * per process object in the run. The first read of an L1 wins, since every read carries the whole run's findings.
 * `systemId` scores from that system's newest finished run only (see `useLatestVersion`).
 */
export function useProcessReadiness(systemId?: string | null) {
  const { latest, isLoading, error } = useLatestVersion(systemId);
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

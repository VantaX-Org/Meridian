"use client";

/**
 * Reads of the Load area: the runs to load from, what the target would take, the order to load in, and the files
 * already handed over. Thin typed wrappers over /migration/*; fixture mode answers through v2Get.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { v2Get } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { getFieldMap, getMigrationRuns, getTemplateFields, getTemplates, type LoadHistoryPage, type MigrationRun } from "@/lib/api/v2/migration";
import { getLoadSimulation } from "@/lib/api/v2/load-simulation";
import { getLoadPlan } from "@/lib/api/v2/load-plan";

export const loadKeys = {
  runs: (fx: boolean) => ["next", "load", "runs", fx] as const,
  sim: (fx: boolean, run: string | null) => ["next", "load", "sim", fx, run] as const,
  plan: (fx: boolean, modules: string) => ["next", "load", "plan", fx, modules] as const,
  history: (fx: boolean, limit: number, offset: number) => ["next", "load", "history", fx, limit, offset] as const,
  fields: (fx: boolean, modules: string, release: string) => ["next", "load", "fields", fx, modules, release] as const,
  all: ["next", "load"] as const,
};

/** One page of the files handed over, newest first, paged on the server. */
export const getLoadHistoryPage = (limit: number, offset: number) =>
  v2Get<LoadHistoryPage>("/migration/load-history", { limit, offset });

export function useLoadRuns() {
  const fx = useFixture();
  return useQuery({ queryKey: loadKeys.runs(fx), queryFn: async (): Promise<MigrationRun[]> => (await getMigrationRuns()).runs });
}

export function useLoadSimulation(runId: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: loadKeys.sim(fx, runId), queryFn: () => getLoadSimulation(runId as string), enabled: !!runId });
}

export function useLoadOrder(modules: string[]) {
  const fx = useFixture();
  const key = modules.join(",");
  return useQuery({ queryKey: loadKeys.plan(fx, key), queryFn: () => getLoadPlan(modules), enabled: modules.length > 0 });
}

export function useLoadHistory(limit: number, offset: number) {
  const fx = useFixture();
  return useQuery({ queryKey: loadKeys.history(fx, limit, offset), queryFn: () => getLoadHistoryPage(limit, offset), placeholderData: keepPreviousData });
}

/** How many of the run's fields the field map has confirmed, over all the chosen objects. */
export function useFieldCoverage(modules: string[], release: string) {
  const fx = useFixture();
  return useQuery({
    queryKey: loadKeys.fields(fx, modules.join(","), release),
    queryFn: async () => {
      const sets = await Promise.all(modules.map((m) => getFieldMap(m, release)));
      const all = sets.flatMap((s) => s.mappings);
      return { total: all.length, confirmed: all.filter((m) => m.is_confirmed).length };
    },
    enabled: modules.length > 0,
  });
}

/** One person's approval: who, and when. */
export interface Approval { id: string; name: string; at: string }
/**
 * The four-eyes state of one load. The backend has no load-approval endpoint yet, so the state is kept in this browser
 * (localStorage, per run); the shape matches what an endpoint would return, so only `readApproval` and `writeApproval` change.
 */
export interface ApprovalState {
  preparer: { id: string; name: string };
  first?: Approval;
  second?: Approval;
  rejected?: Approval & { comment: string };
}

const approvalKey = (runId: string) => `mn_next_load_approval_${runId}`;
export function readApproval(runId: string): ApprovalState | null {
  try {
    const raw = window.localStorage.getItem(approvalKey(runId));
    return raw ? (JSON.parse(raw) as ApprovalState) : null;
  } catch {
    return null;
  }
}
export function writeApproval(runId: string, s: ApprovalState | null): void {
  try {
    if (s) window.localStorage.setItem(approvalKey(runId), JSON.stringify(s));
    else window.localStorage.removeItem(approvalKey(runId));
  } catch {
    // Storage blocked: the approval lasts for this screen only.
  }
}

/** The kept target templates of one object (the workbooks the new system gave). */
export function useTemplates(module: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: [...loadKeys.all, "templates", fx, module] as const, queryFn: () => getTemplates(module as string), enabled: !!module });
}
export function useTemplateFields(module: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: [...loadKeys.all, "template-fields", fx, module] as const, queryFn: () => getTemplateFields(module as string), enabled: !!module });
}

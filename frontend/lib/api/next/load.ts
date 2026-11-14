"use client";

/**
 * Reads of the Load area: the runs to load from, what the target would take, the order to load in, and the files
 * already handed over. Thin typed wrappers over /migration/*; fixture mode answers through v2Get.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v2Get } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { decideLoad, getFieldMap, getLoadApproval, getMigrationRuns, getTemplateFields, getTemplates, type LoadApproval, type LoadHistoryPage, type MigrationRun } from "@/lib/api/v2/migration";
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
 * The four-eyes state of one load, read from the server. The user who prepared the run is the first approval (they
 * prepared it); the second is the server-held decision of someone else. The server refuses the preparer and a second
 * decision, so nothing here can be bypassed from the browser.
 */
export interface ApprovalState {
  preparer: { id: string; name: string };
  first?: Approval;
  second?: Approval;
  rejected?: Approval & { comment: string };
}

export function approvalState(a: LoadApproval): ApprovalState {
  const preparer = { id: a.prepared_by ?? "", name: a.prepared_by_label ?? "" };
  const by = { id: a.decided_by ?? "", name: a.decided_by_label ?? "", at: a.decided_at ?? "" };
  return {
    preparer,
    first: { ...preparer, at: a.prepared_at ?? "" },
    second: a.decision === "approved" ? by : undefined,
    rejected: a.decision === "rejected" ? { ...by, comment: a.comment ?? "" } : undefined,
  };
}

export function useLoadApproval(runId: string | null) {
  const fx = useFixture();
  return useQuery({
    queryKey: [...loadKeys.all, "approval", fx, runId] as const,
    queryFn: () => getLoadApproval(runId as string),
    select: approvalState,
    enabled: !!runId,
  });
}

/** Give the second approval or reject the load. The server answers 403 to the preparer and 409 to a second decision. */
export function useDecideLoad(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { decision: "approved" | "rejected"; comment?: string }) => decideLoad(runId, v.decision, v.comment),
    onSettled: () => qc.invalidateQueries({ queryKey: [...loadKeys.all, "approval"] }),
  });
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

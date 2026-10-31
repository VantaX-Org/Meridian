"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getChangedChecks,
  getCompareSummary,
  getConfigImpact,
  getDraftsFor,
  getExplain,
  getLearnedFor,
  getReadiness,
  getRuleFailuresBy,
  getRuleHistory,
  getRuleReconcile,
  getRuleScope,
  getStewards,
  getTimeline,
  getWorkGroupsFor,
  type ExplainArgs,
  type ExplainMetric,
} from "@/lib/api/v2/object";

/** Query keys of the Object tabs and the rule screens. The fixture flag is part of every key. */
export const objKeys = {
  explain: (f: boolean, metric: string, a: ExplainArgs) => ["v2", "explain", f, metric, a.module ?? "", a.run ?? "", a.dimension ?? "", a.checkId ?? ""] as const,
  scope: (f: boolean, id: string, module: string) => ["v2", "rule-scope", f, id, module] as const,
  history: (f: boolean, id: string) => ["v2", "rule-history", f, id] as const,
  failuresBy: (f: boolean, id: string) => ["v2", "rule-failures-by", f, id] as const,
  reconcile: (f: boolean, id: string, run: string) => ["v2", "rule-reconcile", f, id, run] as const,
  timeline: (f: boolean, system: string) => ["v2", "timeline", f, system] as const,
  compare: (f: boolean, a: string, b: string) => ["v2", "compare", f, a, b] as const,
  changed: (f: boolean, a: string, b: string, module: string) => ["v2", "changed-checks", f, a, b, module] as const,
  readiness: (f: boolean) => ["v2", "readiness", f] as const,
  impact: (f: boolean, run: string) => ["v2", "config-impact", f, run] as const,
  groups: (f: boolean, module: string, run: string) => ["v2", "work-groups", f, module, run] as const,
  learned: (f: boolean, module: string) => ["v2", "learned", f, module] as const,
  drafts: (f: boolean, module: string) => ["v2", "drafts", f, module] as const,
  stewards: (f: boolean) => ["v2", "stewards", f] as const,
};

const STALE = 30_000;

/** The explanation behind one number. Reads only when `enabled`, so a popover costs nothing until it is opened. */
export function useExplain(metric: ExplainMetric, args: ExplainArgs, enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.explain(f, metric, args), queryFn: () => getExplain(metric, args), staleTime: 5 * 60_000, retry: false, enabled });
}

export function useRuleScope(id: string, module?: string | null) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.scope(f, id, module ?? ""), queryFn: () => getRuleScope(id, module), staleTime: STALE, retry: false });
}

export function useRuleHistory(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.history(f, id), queryFn: () => getRuleHistory(id), staleTime: STALE, retry: false });
}

export function useRuleFailuresBy(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.failuresBy(f, id), queryFn: () => getRuleFailuresBy(id), staleTime: STALE, retry: false });
}

/** The reconciliation pack of a rule in one run; reads only once a run is known. */
export function useRuleReconcile(id: string, run: string | null | undefined) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.reconcile(f, id, run ?? ""), queryFn: () => getRuleReconcile(id, run ?? ""), staleTime: STALE, retry: false, enabled: Boolean(run) });
}

export function useTimeline(systemId: string | null | undefined) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.timeline(f, systemId ?? ""), queryFn: () => getTimeline(systemId, 8), staleTime: STALE, enabled: Boolean(systemId) });
}

export function useCompare(a: string | null, b: string | null) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.compare(f, a ?? "", b ?? ""), queryFn: () => getCompareSummary(a as string, b as string), staleTime: STALE, retry: false, enabled: Boolean(a && b && a !== b) });
}

export function useChangedChecks(a: string | null, b: string | null, module: string) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.changed(f, a ?? "", b ?? "", module), queryFn: () => getChangedChecks(a as string, b as string, module), staleTime: STALE, retry: false, enabled: Boolean(a && b && a !== b) });
}

export function useReadiness() {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.readiness(f), queryFn: getReadiness, staleTime: STALE, retry: false });
}

export function useConfigImpact(run: string | null | undefined) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.impact(f, run ?? ""), queryFn: () => getConfigImpact(run as string), staleTime: STALE, retry: false, enabled: Boolean(run) });
}

export function useWorkGroups(module: string, run: string | null | undefined, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.groups(f, module, run ?? ""), queryFn: () => getWorkGroupsFor(module, run), staleTime: STALE, retry: false, enabled });
}

export function useLearned(module: string, enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.learned(f, module), queryFn: () => getLearnedFor(module), staleTime: STALE, retry: false, enabled });
}

export function useDrafts(module: string, enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.drafts(f, module), queryFn: () => getDraftsFor(module), staleTime: STALE, retry: false, enabled });
}

export function useStewards(enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: objKeys.stewards(f), queryFn: getStewards, staleTime: 5 * 60_000, retry: false, enabled });
}

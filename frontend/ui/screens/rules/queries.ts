"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { useToast } from "@/ui/kit";
import { getRuleList, getModuleRules, getSuppressions, getAllDrafts, getMigrationScenarios, getRuleVersionDiff } from "@/lib/api/v2/rulelib";
import { getRuleAccuracy, getRuleTuning } from "@/lib/api/v2/pilot";
import { getLearnedFor } from "@/lib/api/v2/object";
import { getFixCoverage, getFixDrafts } from "@/lib/api/v2/fix-drafts";
import { listPolicyPacks } from "@/lib/api/v2/step10";
import { listProposedRules, PROPOSED_KEY } from "@/lib/api/v2/match-rules";
import { getRuleFeedback } from "@/lib/api/v2/work-analytics";
import { getRuleReads } from "@/lib/api/v2/lineage";
import { getPromotionModules, getPromotionPreview } from "@/lib/api/v2/rule-promotion";

const STALE = 30_000;
const opts = { staleTime: STALE, retry: false } as const;
const key = (name: string, fx: boolean, ...rest: unknown[]) => ["v2", "rules-b6", name, fx, ...rest] as const;

export function useRuleLibrary() { const fx = useFixture(); return useQuery({ queryKey: key("library", fx), queryFn: getRuleList, ...opts }); }
export function useSuppressions() { const fx = useFixture(); return useQuery({ queryKey: key("suppressions", fx), queryFn: getSuppressions, ...opts }); }
export function useAllDrafts() { const fx = useFixture(); return useQuery({ queryKey: key("drafts", fx), queryFn: getAllDrafts, ...opts }); }
export function useAccuracy() { const fx = useFixture(); return useQuery({ queryKey: key("accuracy", fx), queryFn: getRuleAccuracy, ...opts }); }
export function useScenarios(scenario?: Parameters<typeof getMigrationScenarios>[0]) {
  const fx = useFixture();
  return useQuery({ queryKey: key("scenarios", fx, scenario ?? ""), queryFn: () => getMigrationScenarios(scenario, scenario ? "required" : undefined), ...opts });
}
export function usePacks() { const fx = useFixture(); return useQuery({ queryKey: key("packs", fx), queryFn: listPolicyPacks, ...opts }); }
export function useProposed() { const fx = useFixture(); return useQuery({ queryKey: [...PROPOSED_KEY, fx], queryFn: listProposedRules, ...opts }); }
export function useFixDrafts() { const fx = useFixture(); return useQuery({ queryKey: key("fix-drafts", fx), queryFn: getFixDrafts, ...opts }); }
export function useFixCoverage() { const fx = useFixture(); return useQuery({ queryKey: key("fix-coverage", fx), queryFn: getFixCoverage, ...opts }); }
export function useTuning() { const fx = useFixture(); return useQuery({ queryKey: key("tuning", fx), queryFn: getRuleTuning, ...opts }); }
export function useFeedback(id?: string) { const fx = useFixture(); return useQuery({ queryKey: key("feedback", fx, id ?? ""), queryFn: () => getRuleFeedback(id), ...opts }); }
export function useRuleReads(id: string) { const fx = useFixture(); return useQuery({ queryKey: key("reads", fx, id), queryFn: () => getRuleReads(id), ...opts }); }
export function useVersionDiff(id: string, version: number | null) {
  const fx = useFixture();
  return useQuery({ queryKey: key("diff", fx, id, version), queryFn: () => getRuleVersionDiff(id, version ?? 0), enabled: version !== null, ...opts });
}
export function usePromotionModules() { const fx = useFixture(); return useQuery({ queryKey: key("promotion", fx), queryFn: getPromotionModules, ...opts }); }
export function usePromotionPreview(module: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: key("promotion-preview", fx, module), queryFn: () => getPromotionPreview(module ?? ""), enabled: Boolean(module), ...opts });
}

/** Coverage of every module in the list, one read each. */
export function useCoverage(modules: string[]) {
  const fx = useFixture();
  return useQueries({ queries: modules.map((m) => ({ queryKey: key("coverage", fx, m), queryFn: () => getModuleRules(m), ...opts })) });
}

/** Learned proposals of every module in the list, one read each. */
export function useLearnedAll(modules: string[]) {
  const fx = useFixture();
  return useQueries({ queries: modules.map((m) => ({ queryKey: key("learned", fx, m), queryFn: () => getLearnedFor(m), ...opts })) });
}

/** A write that refreshes every screen read and tells the person what happened. */
export function useAct<A>(fn: (a: A) => Promise<unknown>, done: () => string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries(); toast(done(), "good"); },
    onError: (e) => toast(e instanceof Error ? e.message : t("The change did not go through"), "bad"),
  });
}

"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import * as s10 from "@/lib/api/v2/step10";

/** Query keys of the step 10 reads. The fixture flag is in every key, so fixture and live answers never mix. */
export const s10Keys = {
  all: ["v2", "s10"] as const,
  packs: (f: boolean) => ["v2", "s10", "packs", f] as const,
  evidence: (f: boolean, id: string, run: string | null) => ["v2", "s10", "evidence", f, id, run] as const,
  digests: (f: boolean) => ["v2", "s10", "digests", f] as const,
  deliveries: (f: boolean, id: string) => ["v2", "s10", "digest-deliveries", f, id] as const,
  numbers: (f: boolean, id: string) => ["v2", "s10", "digest-numbers", f, id] as const,
  html: (f: boolean, id: string) => ["v2", "s10", "digest-html", f, id] as const,
  sandbox: (f: boolean) => ["v2", "s10", "sandbox", f] as const,
  history: (f: boolean, module: string, key: string) => ["v2", "s10", "history", f, module, key] as const,
  asOf: (f: boolean, module: string, run: string) => ["v2", "s10", "as-of", f, module, run] as const,
  predict: (f: boolean, system: string | null, modules: string, delta: boolean) => ["v2", "s10", "predict", f, system, modules, delta] as const,
  nl: (f: boolean, q: string) => ["v2", "command", "nl", f, q] as const,
};

export function usePolicyPacks(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.packs(f), queryFn: s10.listPolicyPacks, staleTime: 30_000, enabled });
}

export function usePolicyEvidence(id: string, run: string | null, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.evidence(f, id, run), queryFn: () => s10.getPolicyEvidence(id, run), staleTime: 30_000, retry: false, enabled: enabled && Boolean(id) });
}

export function useDigests(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.digests(f), queryFn: s10.listDigests, staleTime: 15_000, enabled });
}

export function useDigestDeliveries(id: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.deliveries(f, id), queryFn: () => s10.listDigestDeliveries(id), staleTime: 10_000, enabled: enabled && Boolean(id) });
}

export function useDigestNumbers(id: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.numbers(f, id), queryFn: () => s10.getDigestNumbers(id), staleTime: 30_000, retry: false, enabled: enabled && Boolean(id) });
}

export function useDigestHtml(id: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.html(f, id), queryFn: () => s10.getDigestHtml(id), staleTime: 30_000, retry: false, enabled: enabled && Boolean(id) });
}

export function useSandbox(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.sandbox(f), queryFn: s10.getSandbox, staleTime: 30_000, retry: false, enabled });
}

export function useRecordHistory(module: string, key: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.history(f, module, key), queryFn: () => s10.getRecordHistory(module, key), staleTime: 30_000, retry: false, enabled: enabled && Boolean(module && key) });
}

export function useObjectAsOf(module: string, run: string | null) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.asOf(f, module, run ?? ""), queryFn: () => s10.getObjectAsOf(module, run ?? ""), staleTime: 300_000, retry: false, enabled: Boolean(module && run) });
}

export function useRunPrediction(q: { system_id: string | null; modules: readonly string[]; delta: boolean }, enabled = true) {
  const f = useFixture();
  const mods = [...q.modules].sort().join(",");
  return useQuery({ queryKey: s10Keys.predict(f, q.system_id, mods, q.delta), queryFn: () => s10.getRunPrediction({ system_id: q.system_id, modules: q.modules, delta: q.delta }), staleTime: 30_000, retry: false, enabled });
}

export function useNl(q: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s10Keys.nl(f, q), queryFn: () => s10.getNl(q), staleTime: 30_000, retry: false, enabled: enabled && q.trim().length > 0 });
}

/** After a step 10 write: its own reads, and the landscape, receipts and ledger that show policy marks and the sandbox. */
export function refreshStep10(qc: QueryClient, part?: "packs" | "digests" | "sandbox"): Promise<void> {
  if (part === "digests") return qc.invalidateQueries({ queryKey: ["v2", "s10"], predicate: (q) => String(q.queryKey[2]).startsWith("digest") });
  return qc.invalidateQueries({ queryKey: ["v2"] });
}

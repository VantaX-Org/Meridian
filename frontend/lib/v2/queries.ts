"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getCounts, getLandscape, getObjectRules, getReceipt, getRunList, getStatus, getTopWork } from "@/lib/api/v2/landscape";

/** Query keys for the v2 reads. The fixture flag is part of every key, so fixture and live answers never mix. */
export const v2Keys = {
  all: ["v2"] as const,
  landscape: (fixture: boolean, run: string | null) => ["v2", "landscape", fixture, run] as const,
  status: (fixture: boolean) => ["v2", "status", fixture] as const,
  receiptRoot: ["v2", "receipt"] as const,
  receipt: (fixture: boolean, module: string, run: string | null) => ["v2", "receipt", fixture, module, run] as const,
  runs: (fixture: boolean) => ["v2", "runs", fixture] as const,
  counts: (fixture: boolean) => ["v2", "counts", fixture] as const,
  topWork: (fixture: boolean, limit: number) => ["v2", "top-work", fixture, limit] as const,
  rules: (fixture: boolean, module: string, run: string | null, rows: number) => ["v2", "rules", fixture, module, run, rows] as const,
};

const STALE = 30_000;

export function useLandscape(run: string | null) {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.landscape(fixture, run), queryFn: () => getLandscape(run), staleTime: STALE });
}

export function useStatus() {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.status(fixture), queryFn: getStatus, staleTime: STALE });
}

export function useReceipt(module: string, run: string | null, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.receipt(fixture, module, run), queryFn: () => getReceipt(module, run), staleTime: STALE, retry: false, enabled });
}

export function useRunList() {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.runs(fixture), queryFn: () => getRunList(8), staleTime: 60_000 });
}

export function useCounts() {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.counts(fixture), queryFn: getCounts, staleTime: STALE, refetchInterval: fixture ? false : 60_000 });
}

export function useTopWork(limit = 5, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.topWork(fixture, limit), queryFn: () => getTopWork(limit), staleTime: STALE, enabled });
}

export function useObjectRules(module: string, run: string | null, rows = 0) {
  const fixture = useFixture();
  return useQuery({ queryKey: v2Keys.rules(fixture, module, run, rows), queryFn: () => getObjectRules(module, run, rows || undefined), staleTime: STALE });
}

"use client";

// Reads that the shared query files have a client for but no hook yet. Same fixture-keyed pattern as lib/v2/*-queries.ts.
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBackAfterClean } from "@/lib/api/remediation";
import { getObjectAsOf } from "@/lib/api/v2/step10";
import { getProfile } from "@/lib/api/v2/profile";

/** Post-clean monitoring (record_history.py:282): records that were fixed and came back, by week and by rule. */
export function useBackAfterClean() {
  const fx = useFixture();
  return useQuery({ queryKey: ["b13", "back", fx], queryFn: () => getBackAfterClean(12), staleTime: 60_000, retry: false });
}

export function useAsOf(module: string, run: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: ["b13", "asof", fx, module, run], queryFn: () => getObjectAsOf(module, run as string), enabled: Boolean(run), staleTime: 60_000, retry: false });
}

export function useProfile(versionId: string | null, module: string) {
  const fx = useFixture();
  return useQuery({ queryKey: ["b13", "profile", fx, versionId, module], queryFn: () => getProfile(versionId as string, module), enabled: Boolean(versionId), staleTime: 60_000, retry: false });
}

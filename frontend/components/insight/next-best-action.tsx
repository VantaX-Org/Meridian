"use client";

import { useQuery } from "@tanstack/react-query";
import { NextBestAction } from "@/design";
import { getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { nextBestActionView } from "@/lib/next-best-action";

/**
 * The one next best action for a run, or for one object of it (`module`): the planner's top-ranked action
 * (deterministic, no model), its reason and the button that opens where to act. Hidden when the planner is
 * unreachable: a missing suggestion is not an error on the page that hosts it.
 */
export function NextBestActionCard({ run, module }: { run: string; module?: string }) {
  const q = useQuery({
    queryKey: ["prescriptive", "next-best", run, module ?? ""],
    queryFn: () => getPrescriptiveAnalytics({ limit: 1, version_id: run, ...(module ? { module } : {}) }),
    retry: false,
    meta: { ignoreError: true },
  });
  if (q.isError) return null;
  const top = q.data?.actions[0];
  return (
    <NextBestAction
      loading={q.isLoading}
      action={top ? nextBestActionView(top, run) : null}
      empty={module ? "Nothing fails in this object in this run." : "Nothing to fix in this run."}
    />
  );
}

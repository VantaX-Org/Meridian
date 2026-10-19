"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useRunList } from "@/hooks/use-run-list";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getObjects } from "@/lib/api/v1/objects";
import { currentObjectRows, isScored, latestPerLineage } from "@/lib/current-state";
import { queryKeys } from "@/lib/query-keys";

/**
 * The objects list without `?run=`: every object at the latest finished run of its lineage (lib/current-state.ts).
 * One `GET /objects?run=<id>` per lineage, under the same key the `?run=` list uses, so opening one run's list
 * afterwards needs no second fetch. `GET /findings/aggregate` is read only when some run's list could not be read,
 * for the affected records of the objects listed from that run's summary instead.
 */
export function useCurrentObjects(enabled: boolean, modules: ReadonlySet<string> | null | undefined) {
  const runList = useRunList();
  const finished = (runList.data?.versions ?? []).filter(isScored);
  const runs = enabled ? latestPerLineage(finished) : [];
  const lists = useQueries({
    queries: runs.map((r) => ({
      queryKey: queryKeys.objects(r.id),
      queryFn: () => getObjects(r.id),
      retry: false,
      meta: { ignoreError: true },
    })),
  });
  const someFailed = lists.some((q) => q.isError);
  const aggregate = useQuery({
    queryKey: queryKeys.findingsAggregate("current"),
    queryFn: () => getFindingsAggregate(),
    enabled: enabled && someFailed,
    retry: false,
    meta: { ignoreError: true },
  });
  const bands = lists.find((q) => q.data?.thresholds)?.data?.thresholds;
  const rows = currentObjectRows(runs, new Map(runs.map((r, i) => [r.id, lists[i]?.data?.objects])), {
    bands,
    aggregate: aggregate.data,
    versions: finished,
    modules,
  });
  return {
    rows,
    /** The latest finished run of each lineage, newest first. */
    runs,
    bands,
    isLoading: enabled && (runList.isLoading || lists.some((q) => q.isLoading) || aggregate.isLoading),
    isError: enabled && runList.isError,
    error: runList.error,
    refetch: () => {
      void runList.refetch();
      for (const q of lists) if (q.isError) void q.refetch();
    },
  };
}

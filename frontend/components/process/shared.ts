import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getFindings } from "@/lib/api/findings";
import { useRunListWith } from "@/hooks/use-run-list";
import { isFinished } from "@/lib/runs";
import type { Version } from "@/types/api";

export const isCompleteVersion = (v: Version) => isFinished(v) && !!v.dqs_summary;

/**
 * The run the topbar selected (`?run=`) when it is finished, else the latest finished analysis. Reads the shared
 * run list, and a `?run=` older than the list by id, so a selected run is never swapped for the newest one.
 */
export function useLatestVersion() {
  const run = useSearchParams().get("run");
  const { list: q, versions: vs, fetchingRun } = useRunListWith(run);
  const latest = useMemo(
    () => (fetchingRun ? undefined : vs.find((v) => v.id === run && isCompleteVersion(v)) ?? vs.find(isCompleteVersion)),
    [vs, run, fetchingRun],
  );
  return { latest, isLoading: q.isLoading || fetchingRun, error: q.error as Error | null, refetch: q.refetch };
}

/**
 * Finding detail link for a check in a version. The process APIs name checks, not findings;
 * the findings list (worst first, 200 rows) is the only way to reach Finding detail from them.
 */
export function useFindingHref(versionId: string | undefined) {
  const q = useQuery({
    queryKey: ["findings.by-check", versionId], enabled: !!versionId, retry: false, meta: { ignoreError: true },
    queryFn: () => getFindings({ version_id: versionId, sort: "impact", limit: 200 }),
  });
  const byCheck = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of q.data?.findings ?? []) if (!m.has(`${f.module}:${f.check_id}`)) m.set(`${f.module}:${f.check_id}`, f.id);
    return m;
  }, [q.data]);
  return useCallback((module: string, checkId: string) => {
    const id = byCheck.get(`${module}:${checkId}`);
    return id ? `/analyse/finding/${id}?v=${versionId}` : undefined;
  }, [byCheck, versionId]);
}

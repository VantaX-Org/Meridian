import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { buildDrillHref } from "@/design";
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
 * Link for a check of a version that failed on that object: the object's records tab filtered to that check, in that
 * run; undefined when the run's findings (worst first, 200 rows) do not hold the check on that object, so a caller
 * that tries several objects lands on the one where it failed. The process APIs name checks, not findings, and the old
 * `/analyse/finding/<id>` link only redirected to the objects list, so the rule's records were lost on the way.
 */
export function useFindingHref(versionId: string | undefined) {
  const q = useQuery({
    queryKey: ["findings.by-check", versionId], enabled: !!versionId, retry: false, meta: { ignoreError: true },
    queryFn: () => getFindings({ version_id: versionId, sort: "impact", limit: 200 }),
  });
  const failed = useMemo(() => new Set((q.data?.findings ?? []).map((f) => `${f.module}:${f.check_id}`)), [q.data]);
  return useCallback(
    (module: string, checkId: string): string | undefined =>
      failed.has(`${module}:${checkId}`) ? buildDrillHref({ object: module, ruleId: checkId, run: versionId }) : undefined,
    [failed, versionId],
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFindings } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import type { Version } from "@/types/api";

export const isCompleteVersion = (v: Version) =>
  (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;

/** The latest complete analysis; every Process tab reads from it. */
export function useLatestVersion() {
  const q = useQuery({ queryKey: ["versions.list", { limit: 20 }], queryFn: () => getVersions({ limit: 20 }) });
  const latest = useMemo(() => q.data?.versions.find(isCompleteVersion), [q.data]);
  return { latest, isLoading: q.isLoading, error: q.error as Error | null };
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
  return (module: string, checkId: string) => {
    const id = byCheck.get(`${module}:${checkId}`);
    return id ? `/analyse/finding/${id}?v=${versionId}` : undefined;
  };
}

"use client";

// The one run list the shell, the insight pages and home share: one query key, one limit, and a by-id fallback
// for a `?run=` that is older than the list, so no label falls back to a raw id or "the previous run".
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVersion, getVersions } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";
import type { Version, VersionList } from "@/types/api";

/** How many runs the shared list holds, newest first. */
export const RUN_LIST_LIMIT = 500;
/** The API's own page cap (`GET /api/v1/versions`, `limit le=100`). */
const RUN_PAGE = 100;

/** The newest `RUN_LIST_LIMIT` runs, read page by page under the API's page cap. */
export async function fetchRunList(): Promise<VersionList> {
  const versions: Version[] = [];
  let total: number | undefined;
  while (versions.length < RUN_LIST_LIMIT) {
    const page = await getVersions({ limit: RUN_PAGE, offset: versions.length });
    const rows = page?.versions ?? [];
    total = page?.total ?? total;
    versions.push(...rows);
    if (rows.length < RUN_PAGE || (total !== undefined && versions.length >= total)) break;
  }
  return { versions: versions.slice(0, RUN_LIST_LIMIT), total };
}

/** Query options for the shared run list; `fetchQuery` callers use the same object. */
export const runListQuery = () => ({ queryKey: queryKeys.run("list"), queryFn: fetchRunList });

export function useRunList() {
  return useQuery(runListQuery());
}

/** `extra` added to `versions` when it is missing, newest first. */
export function withRun(versions: Version[], extra: Version | undefined): Version[] {
  if (!extra || versions.some((v) => v.id === extra.id)) return versions;
  return [...versions, extra].sort((a, b) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0));
}

/**
 * The shared run list, plus the run `id` names even when it is older than the list: it is read by id
 * (`GET /api/v1/versions/{id}`) and merged in, so `versions.find(id)` always finds it.
 */
export function useRunListWith(id: string | null | undefined) {
  const list = useRunList();
  const inList = id ? list.data?.versions.find((v) => v.id === id) : undefined;
  const byId = useQuery({
    queryKey: queryKeys.run(id ?? ""),
    queryFn: () => getVersion(id as string),
    enabled: !!id && list.isSuccess && !inList,
    retry: false,
    meta: { ignoreError: true },
  });
  const extra = inList ? undefined : byId.data;
  const versions = useMemo(() => withRun(list.data?.versions ?? [], extra), [list.data, extra]);
  return {
    list,
    versions,
    run: inList ?? byId.data,
    /** True while the list, or the by-id read of a run outside it, is still on its way. */
    resolving: list.isLoading || (byId.isLoading && !inList),
    /** True only while the by-id read of a run outside the list is on its way. */
    fetchingRun: byId.isLoading && !inList,
  };
}

"use client";

import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useFixture } from "@/lib/api/v2/fixture";
import type { WorkRow } from "@/lib/api/v2/types";
import { getGroups, getLinks, getRecord, getSummary, getViews, getWork, putView, type WorkFilters } from "@/lib/api/v2/work";
import { SERVER_SORT, type SortKey } from "./work";

const STALE = 15_000;
export const PAGE = 100;

/** Keys of the Work reads. All start with "v2", so one invalidation after a change reaches every one of them. */
export const workKeys = {
  summary: (fx: boolean) => ["v2", "work", "summary", fx] as const,
  groups: (fx: boolean, f: object) => ["v2", "work", "groups", fx, f] as const,
  rows: (fx: boolean, f: object, sort: string) => ["v2", "work", "rows", fx, f, sort] as const,
  group: (fx: boolean, f: object, check: string, limit: number) => ["v2", "work", "group", fx, f, check, limit] as const,
  record: (fx: boolean, module: string, key: string) => ["v2", "work", "record", fx, module, key] as const,
  links: (fx: boolean, module: string, key: string, run: string | null) => ["v2", "work", "links", fx, module, key, run] as const,
  views: (fx: boolean) => ["v2", "views", fx, "work"] as const,
};

/** Counts per status for every object: the chips, the sentence and the next step read this. */
export function useWorkSummary() {
  const fx = useFixture();
  return useQuery({ queryKey: workKeys.summary(fx), queryFn: () => getSummary(), staleTime: STALE });
}

export function useWorkGroups(f: Pick<WorkFilters, "module" | "severity">, enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: workKeys.groups(fx, f), queryFn: () => getGroups({ ...f, limit: 200 }), staleTime: STALE, enabled });
}

/** The ledger's rows, a page at a time (keyset paging: `next` is the cursor). */
export function useWorkRows(filters: WorkFilters, sort: SortKey, enabled = true) {
  const fx = useFixture();
  const server = SERVER_SORT[sort];
  return useInfiniteQuery({
    queryKey: workKeys.rows(fx, filters, server),
    queryFn: ({ pageParam }) => getWork({ ...filters, sort: server, after: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: STALE,
    enabled,
  });
}

/** The first rows of each expanded rule in the "By rule" view. */
export function useGroupRows(filters: WorkFilters, checks: readonly { check: string; limit: number }[], sort: SortKey) {
  const fx = useFixture();
  const server = SERVER_SORT[sort];
  return useQueries({
    queries: checks.map(({ check, limit }) => ({
      queryKey: workKeys.group(fx, filters, check, limit),
      queryFn: () => getWork({ ...filters, check_id: check, sort: server, limit }),
      staleTime: STALE,
    })),
  });
}

export function useWorkRecord(module: string, key: string) {
  const fx = useFixture();
  return useQuery({ queryKey: workKeys.record(fx, module, key), queryFn: () => getRecord(module, key), staleTime: STALE, retry: false });
}

export function useRecordLinks(module: string, key: string, run: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: workKeys.links(fx, module, key, run), queryFn: () => getLinks(module, key, run ?? undefined), staleTime: 60_000, retry: false });
}

/** The saved views of the Work route: the built-ins first, then the person's own. */
export function useWorkViews() {
  const fx = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: workKeys.views(fx), queryFn: () => getViews("work"), staleTime: 60_000 });
  const save = useCallback(
    async (view: Parameters<typeof putView>[0]) => {
      const saved = await putView(view);
      await qc.invalidateQueries({ queryKey: workKeys.views(fx) });
      return saved;
    },
    [qc, fx],
  );
  return { ...q, save };
}

export type { WorkRow };

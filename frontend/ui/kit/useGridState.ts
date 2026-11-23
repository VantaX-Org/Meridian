"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface GridSort { key: string; dir: "asc" | "desc" }
export interface GridState {
  sort: GridSort | null;
  /** column key to the chosen values */
  filters: Record<string, string[]>;
  groupBy: string | null;
  /** key of the row open in the side panel */
  open: string | null;
}
export interface GridApi extends GridState {
  setSort(s: GridSort | null): void;
  setFilter(column: string, values: string[]): void;
  clearFilters(): void;
  setGroupBy(column: string | null): void;
  setOpen(rowKey: string | null): void;
}

/**
 * One hook for every grid: sort, filters, group and the open row live in the query string, so a view can be
 * shared, bookmarked and survives reload. `key` prefixes the parameters (`inbox.sort`) so two grids can share a page.
 */
export function useGridState(key: string): GridApi {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const q = `${key}.`;

  const state = useMemo<GridState>(() => {
    const s = params.get(`${q}sort`);
    const [col, dir] = s ? s.split(":") : [];
    const filters: Record<string, string[]> = {};
    params.forEach((v, k) => {
      if (k.startsWith(`${q}f.`)) filters[k.slice(q.length + 2)] = v.split(",").filter(Boolean);
    });
    return {
      sort: col ? { key: col, dir: dir === "desc" ? "desc" : "asc" } : null,
      filters,
      groupBy: params.get(`${q}group`),
      open: params.get(`${q}open`),
    };
  }, [params, q]);

  const write = useCallback((edit: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString());
    edit(p);
    const qs = p.toString();
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  }, [params, path, router]);

  return {
    ...state,
    setSort: (s) => write((p) => (s ? p.set(`${q}sort`, `${s.key}:${s.dir}`) : p.delete(`${q}sort`))),
    setFilter: (c, v) => write((p) => (v.length ? p.set(`${q}f.${c}`, v.join(",")) : p.delete(`${q}f.${c}`))),
    clearFilters: () => write((p) => [...p.keys()].filter((k) => k.startsWith(`${q}f.`)).forEach((k) => p.delete(k))),
    setGroupBy: (c) => write((p) => (c ? p.set(`${q}group`, c) : p.delete(`${q}group`))),
    setOpen: (r) => write((p) => (r ? p.set(`${q}open`, r) : p.delete(`${q}open`))),
  };
}

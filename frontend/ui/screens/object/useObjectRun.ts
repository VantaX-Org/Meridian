"use client";

/**
 * The object the page shows and the run it is on. The run is `?run=`, else the last one chosen for this object in this
 * browser tab, else the newest.
 */
import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLandscape } from "@/lib/v2/queries";
import { ANY_SYSTEM, findSystem, moduleFromSlug, systemForModule, systemSlug } from "@/lib/v2/score";
import { formatModuleName } from "@/lib/format";
import { useRun, useRunsInfinite } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { recalledRun, rememberRun } from "./format";
import { isAnalysed } from "@/lib/v2/run-label";

export interface ObjectRun {
  systemId: string | null;
  systemName: string;
  module: string;
  label: string;
  landscape: ReturnType<typeof useLandscape>;
  heads: VersionHead[];
  /** True until the run list resolves, so the run id is not settled yet. */
  runsLoading: boolean;
  runId: string | null;
  run: VersionHead | null;
  previous: VersionHead | null;
  /** Keeps the query (run, fixture mode), changes the path. */
  hrefWith: (path: string, extra?: Record<string, string | null>) => string;
}

export function useObjectRun(systemSeg: string, moduleSeg: string): ObjectRun {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // An old link's `?as_of=` names the same run as `?run=`; it is rewritten below.
  const asOf = params.get("as_of");
  const urlRun = params.get("run") ?? asOf;
  const mod = moduleFromSlug(moduleSeg);
  const landscape = useLandscape(null);
  const system = landscape.data ? findSystem(landscape.data.systems, decodeURIComponent(systemSeg)) : undefined;
  const systemId = system?.id ?? null;
  const label = landscape.data?.objects.find((o) => o.module === mod)?.label ?? formatModuleName(mod);
  const runs = useRunsInfinite(systemId, mod);
  const heads = useMemo(() => runs.data?.pages.flatMap((p) => p.versions) ?? [], [runs.data]);

  // Open on the newest analysed run: an extracted-only run has no findings, receipts or workbook yet.
  // A remembered run counts only once the list has loaded and shows it analysed (or not in the first page).
  const remembered = systemId ? recalledRun(systemId, mod) : null;
  const rememberedHead = heads.find((h) => h.id === remembered);
  const recalled = remembered && runs.data && (!rememberedHead || isAnalysed(rememberedHead.status)) ? remembered : null;
  const runId = urlRun ?? recalled ?? heads.find((h) => isAnalysed(h.status))?.id ?? heads[0]?.id ?? null;

  const hrefWith = useCallback(
    (path: string, extra: Record<string, string | null> = {}) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(extra)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      const qs = q.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [params],
  );

  // `/o/_/{module}` (an old link or /objects/{module}): replace `_` with the system that holds the object.
  const L = landscape.data;
  const holder = systemSeg === ANY_SYSTEM && L ? systemForModule(L.systems, L.cells, mod) : undefined;
  useEffect(() => {
    if (!holder) return;
    const qs = params.toString();
    router.replace(`${pathname.replace(`/o/${ANY_SYSTEM}/`, `/o/${systemSlug(holder.name)}/`)}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [holder, params, router, pathname]);

  useEffect(() => {
    if (!asOf) return;
    const q = new URLSearchParams(params.toString());
    q.delete("as_of");
    if (!q.get("run")) q.set("run", asOf);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }, [asOf, params, router, pathname]);

  useEffect(() => {
    if (!urlRun && recalled) router.replace(hrefWith(pathname, { run: recalled }), { scroll: false });
  }, [urlRun, recalled, router, pathname, hrefWith]);

  useEffect(() => {
    if (systemId && urlRun) rememberRun(systemId, mod, urlRun);
  }, [systemId, mod, urlRun]);

  const inList = heads.find((h) => h.id === runId) ?? null;
  const one = useRun(inList ? null : runId);
  const run = inList ?? one.data ?? null;
  const prevId = run ? (run.parent_version_id ?? heads[heads.findIndex((h) => h.id === run.id) + 1]?.id ?? null) : null;
  const prevInList = heads.find((h) => h.id === prevId) ?? null;
  const prevOne = useRun(prevInList ? null : prevId);
  const previous = prevInList ?? prevOne.data ?? null;

  return { systemId, systemName: system?.name ?? decodeURIComponent(systemSeg), module: mod, label, landscape, heads, runsLoading: runs.isLoading, runId, run, previous, hrefWith };
}

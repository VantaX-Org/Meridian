"use client";

/**
 * The object the page shows and the run it is on. The run is `?run=`, else the last one chosen for this object in this
 * browser tab, else the newest. A recalled run is written back to the address so a copied link shows the same thing.
 */
import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLandscape } from "@/lib/v2/queries";
import { findSystem, moduleFromSlug } from "@/lib/v2/score";
import { formatModuleName } from "@/lib/format";
import { useRun, useRunsInfinite } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { recalledRun, rememberRun } from "./model";

export interface ObjectRun {
  /** Address segments, as typed. */
  systemSeg: string;
  moduleSeg: string;
  systemId: string | null;
  systemName: string;
  module: string;
  label: string;
  landscape: ReturnType<typeof useLandscape>;
  runs: ReturnType<typeof useRunsInfinite>;
  heads: VersionHead[];
  runId: string | null;
  run: VersionHead | null;
  /** The run this one was cleaned from, or the run before it for a pull. */
  previous: VersionHead | null;
  setRun: (id: string) => void;
  /** Keeps `?run=` and fixture mode, changes the rest of the query. */
  hrefWith: (path: string, extra?: Record<string, string | null>) => string;
}

export function useObjectRun(systemSeg: string, moduleSeg: string): ObjectRun {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlRun = params.get("run");
  const mod = moduleFromSlug(moduleSeg);
  const landscape = useLandscape(null);
  const system = landscape.data ? findSystem(landscape.data.systems, decodeURIComponent(systemSeg)) : undefined;
  const systemId = system?.id ?? null;
  const label = landscape.data?.objects.find((o) => o.module === mod)?.label ?? formatModuleName(mod);
  const runs = useRunsInfinite(systemId, mod);
  const heads = useMemo(() => runs.data?.pages.flatMap((p) => p.versions) ?? [], [runs.data]);

  const recalled = systemId ? recalledRun(systemId, mod) : null;
  const runId = urlRun ?? recalled ?? heads[0]?.id ?? null;

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

  useEffect(() => {
    if (!urlRun && recalled) router.replace(hrefWith(pathname, { run: recalled }), { scroll: false });
  }, [urlRun, recalled, router, pathname, hrefWith]);

  useEffect(() => {
    if (systemId && urlRun) rememberRun(systemId, mod, urlRun);
  }, [systemId, mod, urlRun]);

  const setRun = useCallback((id: string) => router.replace(hrefWith(pathname, { run: id }), { scroll: false }), [router, pathname, hrefWith]);

  const inList = heads.find((h) => h.id === runId) ?? null;
  const one = useRun(inList ? null : runId);
  const run = inList ?? one.data ?? null;
  const prevId = run ? (run.parent_version_id ?? heads[heads.findIndex((h) => h.id === run.id) + 1]?.id ?? null) : null;
  const prevInList = heads.find((h) => h.id === prevId) ?? null;
  const prevOne = useRun(prevInList ? null : prevId);
  const previous = prevInList ?? prevOne.data ?? null;

  return { systemSeg, moduleSeg, systemId, systemName: system?.name ?? decodeURIComponent(systemSeg), module: mod, label, landscape, runs, heads, runId, run, previous, setRun, hrefWith };
}

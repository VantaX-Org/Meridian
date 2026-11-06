"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { systemSlug } from "@/lib/v2/score";
import type { TimelineRun } from "@/lib/api/v2/runs";
import type { LandscapeSystem } from "@/lib/api/v2/types";

/**
 * How the shell stores scope: two URL parameters, `?system=<slug>` (one system, none for all) and `?run=<uuid>` (one run,
 * none for the current state). Run pages carry their run in the path instead: `/run/{id}` and `/run/{a}/vs/{b}`.
 */
const RUN_PATH = /^\/run\/([^/]+)(?:\/vs\/([^/]+))?\/?$/;

/** The run or pair of runs the path names, or null off the run pages. */
export function runPathIds(pathname: string): { id: string; vs: string | null } | null {
  const m = RUN_PATH.exec(pathname);
  return m ? { id: decodeURIComponent(m[1]), vs: m[2] ? decodeURIComponent(m[2]) : null } : null;
}

/** The run the canvas shows: on a run page the one in the path (the later run of a comparison), else `?run=`, else null (the current state). */
export function useCanvasRun(): string | null {
  const pathname = usePathname();
  const params = useSearchParams();
  const onRunPage = runPathIds(pathname);
  return onRunPage ? (onRunPage.vs ?? onRunPage.id) : params.get("run");
}

/** The system the scope bar chose (`?system=`), or null for all systems. */
export function useScopeSystem(): LandscapeSystem | null {
  const params = useSearchParams();
  const slug = params.get("system");
  const systems = useLandscape(null).data?.systems;
  return useMemo(() => (slug && systems ? (systems.find((s) => systemSlug(s.name) === slug) ?? null) : null), [slug, systems]);
}

/** Where picking a run goes: a run page follows the pick in its path; any other page sets `?run=` (none for the latest). */
export function useRunPicker(latestId: string | null): (runId: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const v2Href = useV2Href();
  return useCallback(
    (runId: string) => {
      if (runPathIds(pathname)) {
        router.push(v2Href(`/run/${runId}`));
        return;
      }
      const next = new URLSearchParams(params.toString());
      next.delete("open");
      if (runId === latestId) next.delete("run");
      else next.set("run", runId);
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, params, v2Href, latestId],
  );
}

/**
 * The run an object page shows: `?run=` when it names a run of that object, else the object's own newest finished run.
 * `chip` is that run (null until the timeline loads), `isLatest` is false when an older run is chosen.
 */
export function useObjectRun(systemId: string | null, module: string): { runId: string | null; isLatest: boolean; chip: TimelineRun | null } {
  const param = useSearchParams().get("run");
  const runs = useTimeline(systemId, 8).data?.runs;
  return useMemo(() => {
    const mine = (runs ?? []).filter((r) => module in r.objects);
    const latest = mine.length ? mine[mine.length - 1] : null;
    const chip = mine.find((r) => r.id === param) ?? latest;
    return { runId: chip?.id ?? param, isLatest: !chip || chip.id === latest?.id, chip };
  }, [runs, module, param]);
}

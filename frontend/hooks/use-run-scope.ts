"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useRunListWith } from "@/hooks/use-run-list";
import { usePermissions } from "@/lib/permissions";
import { resolveScope } from "@/lib/run-scope";

/**
 * The run this page shows: `?run=` when the URL names one, else the latest finished run relevant to the page
 * (`object` narrows it to the runs that measured that object). Nothing is written onto the URL: the page header's
 * `RunScope` names the run, and its picker or "Back to latest" are the only things that change `?run=`.
 */
export function useRunScope(opts: { object?: string } = {}) {
  // The hook returns null outside the App Router (unit tests, static export).
  const search = useSearchParams();
  const explicit = search?.get("run") || undefined;
  const { list, versions, fetchingRun } = useRunListWith(explicit);
  // A partial permissions object (tests, public pages) means no system scope.
  const systems = usePermissions().scopeFilter?.systems ?? null;
  const scope = useMemo(
    () => resolveScope({ explicit, versions, object: opts.object, systems }),
    [explicit, versions, opts.object, systems],
  );
  return {
    ...scope,
    versions,
    list,
    /** True only while the by-id read of a `?run=` older than the run list is on its way. */
    fetchingRun: !!explicit && fetchingRun,
    /** True while the run list, or the by-id read of a `?run=` older than it, is on its way. */
    resolving: list.isLoading || (!!explicit && fetchingRun),
  };
}

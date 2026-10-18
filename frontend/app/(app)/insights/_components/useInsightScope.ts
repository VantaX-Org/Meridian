"use client";

import { useSearchParams } from "next/navigation";
import { useRunScope } from "@/hooks/use-run-scope";
import { isFinished } from "@/lib/runs";

/**
 * `?run=` and `?module=` for every insight page. Without `?run=` the newest finished run (of an in-scope system
 * for a scoped user) is used, because the aggregate endpoints need a version id; nothing is written onto the URL.
 * A `?run=` older than the shared run list is read by id and merged into `runs`, so lineage scoping, labels and
 * "Compare with" always know it. `scope` is what the frame's "As of" line and run picker read.
 */
export function useInsightScope() {
  // The hook returns null outside the App Router (unit tests, static export).
  const search = useSearchParams();
  const mod = search?.get("module") ?? undefined;
  const scope = useRunScope();
  const { list: versions, versions: all, explicit } = scope;
  const runs = all.filter(isFinished);
  return { run: scope.runId, explicit, module: mod, runs, versions, resolving: explicit ? scope.fetchingRun : versions.isLoading, scope };
}

/** `?run=` and `?module=` carried onto a drill link. */
export function withScope(path: string, params: Record<string, string | undefined>): string {
  const at = path.indexOf("#");
  const rest = at < 0 ? path : path.slice(0, at);
  const hash = at < 0 ? undefined : path.slice(at + 1);
  const [base, existing = ""] = rest.split("?");
  const q = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return (s ? `${base}?${s}` : base) + (hash === undefined ? "" : `#${hash}`);
}

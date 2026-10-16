"use client";

import { useSearchParams } from "next/navigation";
import { useRunListWith } from "@/hooks/use-run-list";
import { isFinished } from "@/lib/runs";

/**
 * `?run=` and `?module=` for every insight page. Without `?run=` the newest finished run is used,
 * because the aggregate endpoints need a version id. A `?run=` older than the shared run list is read by id
 * and merged into `runs`, so lineage scoping, labels and "Compare with" always know it.
 */
export function useInsightScope() {
  // The hook returns null outside the App Router (unit tests, static export).
  const search = useSearchParams();
  const explicit = search?.get("run") ?? undefined;
  const mod = search?.get("module") ?? undefined;
  const { list: versions, versions: all, fetchingRun } = useRunListWith(explicit);
  const runs = all.filter(isFinished);
  const run = explicit ?? runs[0]?.id;
  return { run, explicit, module: mod, runs, versions, resolving: explicit ? fetchingRun : versions.isLoading };
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

"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRunScope } from "@/hooks/use-run-scope";
import { isFinished } from "@/lib/runs";
import { insightScopeMode } from "./scopeMode";

/**
 * `?run=` and `?module=` for every insight page. Without `?run=` the newest finished run (of an in-scope system
 * for a scoped user; with `?module=`, the newest that measured that object) is used, because the aggregate
 * endpoints need a version id; nothing is written onto the URL. `mode` says whether the page describes that one run
 * or, on a view that can (see `scopeMode.ts`), the current state across objects.
 * A `?run=` older than the shared run list is read by id and merged into `runs`, so lineage scoping, labels and
 * "Compare with" always know it. `scope` is what the frame's "As of" line and run picker read.
 */
export function useInsightScope() {
  // The hook returns null outside the App Router (unit tests, static export).
  const search = useSearchParams();
  const pathname = usePathname() ?? "";
  const mod = search?.get("module") || undefined;
  const scope = useRunScope({ object: mod });
  const { list: versions, versions: all, explicit } = scope;
  const runs = all.filter(isFinished);
  const mode = insightScopeMode(pathname, { explicit, module: mod });
  return { run: scope.runId, explicit, module: mod, runs, versions, resolving: explicit ? scope.fetchingRun : versions.isLoading, scope, mode, error: scope.error, refetch: scope.refetch };
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

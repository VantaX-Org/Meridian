"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getVersions } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";

const DONE = new Set(["complete", "agents_complete", "ai_enriched"]);

/**
 * `?run=` and `?module=` for every insight page. Without `?run=` the newest finished run is used,
 * because the aggregate endpoints need a version id.
 */
export function useInsightScope() {
  const search = useSearchParams();
  const explicit = search.get("run") ?? undefined;
  const mod = search.get("module") ?? undefined;
  const versions = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  const runs = (versions.data?.versions ?? []).filter((v) => DONE.has(v.status));
  const run = explicit ?? runs[0]?.id;
  return { run, explicit, module: mod, runs, versions, resolving: !explicit && versions.isLoading };
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

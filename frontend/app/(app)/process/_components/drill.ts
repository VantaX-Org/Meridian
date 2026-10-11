"use client";

/**
 * URL state of the L1 drill (process-discovery spec §7.1):
 * `?system=&run=&tab=&node=&case=` plus the mined-view filters of `ProcessFilter.from_query`
 * (api/services/process_discovery/filters.py): `from`, `to`, `doc_type`, `case_type`, `automated`, `org.<KEY>`.
 */
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProcessFilterParams } from "@/lib/api/process-discovery";
import type { ProcessModelDocument } from "@/types/process-model";
import { locate } from "@/app/(app)/insights/process/designer/_components/doc";

export const TABS = ["flow", "bpmn", "variants", "conformance", "cases", "reference"] as const;
export type Tab = (typeof TABS)[number];

const FILTER_KEYS = ["from", "to", "doc_type", "case_type", "automated"];

/** The filter params of a query string, ready to pass to the typed client. */
export function filterParams(search: URLSearchParams): ProcessFilterParams {
  const out: ProcessFilterParams = {};
  search.forEach((v, k) => {
    if (v && (FILTER_KEYS.includes(k) || k.startsWith("org."))) out[k] = v;
  });
  return out;
}

/**
 * Reads the drill params and patches several of them in one `router.replace`
 * (two `useUrlState` setters in a row would each start from the same stale query string).
 */
export function useProcessDrill() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search.toString();
  const filters = useMemo(() => filterParams(new URLSearchParams(qs)), [qs]);
  const set = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const next = p.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [qs, pathname, router]);
  return {
    tab: search.get("tab") ?? "",
    run: search.get("run") ?? "",
    node: search.get("node"),
    caseId: search.get("case"),
    filters,
    set,
  };
}

/** L1 › L2 › L3 › L4 from the L1 down to `node` (the L1 alone when `node` is not in `doc`). */
export function trail(doc: ProcessModelDocument, l1: string, node: string | null): { id: string; name: string; level: number }[] {
  const out: { id: string; name: string; level: number }[] = [];
  let hit = locate(doc, node);
  while (hit) {
    out.unshift({ id: hit.item.id, name: hit.item.name, level: hit.level });
    hit = hit.parent ? locate(doc, hit.parent.id) : null;
  }
  if (out[0]?.id !== l1) {
    const root = doc.l1.find((x) => x.id === l1);
    return root ? [{ id: root.id, name: root.name, level: 1 }] : [];
  }
  return out;
}

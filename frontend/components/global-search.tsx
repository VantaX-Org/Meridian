"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import type { CommandItem } from "@/design";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchWork } from "@/lib/api/work";
import { formatModuleName, plural, recordKeyLabel } from "@/lib/format";

/** Results shown at most; the API ranks them. */
export const SEARCH_LIMIT = 20;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
/** Group heading the palette shows record hits under. */
export const RECORDS_GROUP = "Records";

type Result = Awaited<ReturnType<typeof searchWork>>["items"][number];

/** Screens whose `?run=` is a process-discovery run, not an analysis run (components/global-run.tsx). */
const ownsRun = (path: string) => path === "/process" || path.startsWith("/process/");

/** The record's page in its object workbench, keeping the run the user is looking at. */
export function recordHref(item: Pick<Result, "module" | "record_key">, run: string | null): string {
  const params = new URLSearchParams({ record: item.record_key });
  if (run) params.set("run", run);
  return `/objects/${encodeURIComponent(item.module)}?${params}`;
}

/**
 * Record hits for the global search (the command palette): type a record key or name and get the failing records it
 * matches in the chosen run (or, with none, the current state), each opening in its object. Debounced; nothing is
 * searched under two characters. This is the one place records are searched from the shell: the scope bar has no
 * finder of its own.
 */
export function useRecordItems(text: string): CommandItem[] {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const run = ownsRun(pathname) ? null : search?.get("run") ?? null;
  const q = useDebouncedValue(text.trim(), DEBOUNCE_MS);
  const enabled = q.length >= MIN_CHARS;
  const { data } = useQuery({
    queryKey: ["work-search", run ?? "current", q],
    queryFn: () => searchWork(q, run ?? undefined),
    enabled,
    staleTime: 30_000,
  });
  return useMemo(
    () =>
      enabled
        ? (data?.items ?? []).slice(0, SEARCH_LIMIT).map((item) => ({
            label: `${item.name ?? recordKeyLabel(item.record_key)} (${formatModuleName(item.module)}, ${item.record_key}, ${plural(item.issues, "issue")})`,
            // Without a run the search covers the current state: the record opens in the run it was found in.
            href: recordHref(item, run ?? item.version_id ?? null),
            group: RECORDS_GROUP,
            moduleId: item.module,
          }))
        : [],
    [enabled, data, run],
  );
}

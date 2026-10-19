"use client";

// Queries, hooks and columns shared by the object page, its Records tab and the Overview workbench.
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Mono } from "@/design";
import { getObject, type ObjectRule } from "@/lib/api/v1/objects";
import { getFindingRecords, type FindingRecord } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";
import { formatModuleName } from "@/lib/format";

export const PAGE_SIZE = 50;
/** Page-level and tab-level hooks share these keys; a fresh window stops the tab remount refetching. */
export const STALE_MS = 30_000;

export const objectQuery = (object: string, run: string) => ({
  queryKey: queryKeys.object(object, run),
  queryFn: () => getObject(object, run),
  enabled: !!run,
  staleTime: STALE_MS,
});

/** Blocking = critical or high severity (the same rule the migration export uses). */
export const isBlocking = (r: ObjectRule) => r.severity === "critical" || r.severity === "high";

export const recordsQuery = (run: string, checkId: string, page: number) => ({
  queryKey: [...queryKeys.rule(checkId, run), page],
  queryFn: () => getFindingRecords(run, checkId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  enabled: !!run && !!checkId,
  staleTime: STALE_MS,
});

export const fixSheetHref = (object: string, run: string, key: string) =>
  `/objects/${object}/records/${encodeURIComponent(key)}?run=${run}`;

/** `f` opens the fix sheet of the row DataTable's keyboard cursor is on (aria-activedescendant), else the first row. */
export function useFixShortcut(object: string, run: string, firstKey: string | undefined) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "f" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable],[role=dialog]")) return;
      const rowId = document.querySelector("[role=grid][aria-activedescendant]")?.getAttribute("aria-activedescendant");
      const key = (rowId ? document.getElementById(rowId)?.querySelector<HTMLElement>("[data-fix]")?.dataset.fix : undefined) ?? firstKey;
      if (key) router.push(fixSheetHref(object, run, key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstKey, object, run, router]);
}

/** The record, grain and module columns, one mono column per field_values key unioned across `records`, and the fix sheet link. */
export function useRecordColumns(object: string, run: string, records: readonly FindingRecord[] | undefined): ColumnDef<FindingRecord>[] {
  // Spec section 5.2: one mono column per field_values key, unioned across the current page of records.
  const fieldValueKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of records ?? []) {
      if (r.field_values) for (const k of Object.keys(r.field_values)) keys.add(k);
    }
    return [...keys];
  }, [records]);

  return useMemo<ColumnDef<FindingRecord>[]>(
    () => [
      { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
      { accessorKey: "grain", header: "Grain", cell: ({ row }) => row.original.grain ?? "—" },
      { accessorKey: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
      ...fieldValueKeys.map((key): ColumnDef<FindingRecord> => ({
        id: `field_values.${key}`,
        header: key,
        cell: ({ row }) => {
          const value = row.original.field_values?.[key];
          return value == null ? "—" : <Mono>{value}</Mono>;
        },
      })),
      {
        id: "fix",
        header: "Fix sheet",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            render={
              <Link
                href={fixSheetHref(object, run, row.original.record_key)}
                data-fix={row.original.record_key}
                aria-label={`Open fix sheet for ${row.original.record_key}`}
                onClick={(e) => e.stopPropagation()}
              >
                Open fix sheet
              </Link>
            }
          />
        ),
      },
    ],
    [object, run, fieldValueKeys],
  );
}

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Mono, Pill, Skeleton, type PillTone } from "@/design";
import { getFindingRootCause, type RootCauseOrigin } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";

const ORIGIN: Record<RootCauseOrigin["origin"], { label: string; tone: PillTone }> = {
  interface: { label: "Interface / batch", tone: "at-risk" },
  dialog: { label: "Dialog user", tone: "neutral" },
  migration: { label: "Migration load", tone: "no-go" },
  unknown: { label: "No change document", tone: "neutral" },
};

const NOTE: Record<string, string> = {
  not_computed: "Root cause is not computed for this run yet. It runs after the analysis of a live SAP download.",
  not_applicable: "This rule's field has no SAP change documents, so its origin cannot be traced.",
  unavailable: "SAP change documents could not be read for this run.",
};

export function RootCauseSection({ run, ruleId }: { run: string; ruleId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [...queryKeys.rule(ruleId, run), "root-cause"],
    queryFn: () => getFindingRootCause(run, ruleId),
    enabled: !!run,
  });

  const columns = useMemo<ColumnDef<RootCauseOrigin>[]>(
    () => [
      { accessorKey: "origin", header: "Origin",
        cell: ({ row }) => <Pill tone={ORIGIN[row.original.origin].tone}>{ORIGIN[row.original.origin].label}</Pill> },
      { accessorKey: "username", header: "User", cell: ({ row }) => <Mono>{row.original.username || "—"}</Mono> },
      { accessorKey: "tcode", header: "Transaction", cell: ({ row }) => <Mono>{row.original.tcode || "—"}</Mono> },
      { accessorKey: "records", header: "Records" },
      { accessorKey: "share", header: "Share", cell: ({ row }) => `${Math.round(row.original.share)}%` },
    ],
    [],
  );

  if (isLoading) return <Skeleton height={32} />;
  if (isError || !data) return null; // the failing records above stay usable without it

  return (
    <section className="flex flex-col gap-2">
      <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Root cause</p>
      {data.status === "computed" ? (
        <>
          <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{data.summary}</p>
          <DataTable columns={columns} data={data.origins}
            getRowId={(o) => `${o.origin}|${o.username}|${o.tcode}`} />
          {data.analysed < data.total && (
            <p className="text-[12px]" style={{ color: "var(--m-ink-2)" }}>
              Based on {data.analysed} of {data.total} failing records.
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          {NOTE[data.status]}{data.detail ? ` ${data.detail}` : ""}
        </p>
      )}
    </section>
  );
}

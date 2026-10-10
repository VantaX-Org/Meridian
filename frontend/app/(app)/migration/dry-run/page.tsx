// frontend/app/(app)/migration/dry-run/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Mono, Pill, ReportPage, Stat } from "@/design";
import { getDryRunRecords, getMigrationRun, dryRunExportUrl, type DryRunRecord } from "@/lib/api/migration";
import { VERDICT_LABEL, VERDICT_TONE } from "@/app/(app)/migration/page";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { TransferVerdict, WaveVerdict } from "@/types/api";

const FROM_ENGINE: Record<TransferVerdict, WaveVerdict> = { go: "go", conditional: "at_risk", "no-go": "no_go" };

const STATUS_TONE = { load_ready: "go", load_fail: "no-go" } as const;
const STATUS_LABEL = { load_ready: "Load ready", load_fail: "Load fail" } as const;

const columns: ColumnDef<DryRunRecord>[] = [
  { accessorKey: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
  { accessorKey: "source_table", header: "Source table", cell: ({ row }) => <Mono>{row.original.source_table}</Mono> },
  { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Pill>,
  },
  {
    accessorKey: "reasons",
    header: "Reasons",
    cell: ({ row }) => row.original.reasons.join("; "),
  },
];

export default function DryRunPage() {
  const search = useSearchParams();
  const runId = search.get("run") ?? undefined;

  const runQuery = useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () => getMigrationRun(runId as string),
    enabled: !!runId,
  });

  const recordsQuery = useQuery({
    queryKey: queryKeys.migrationDryRun(runId ?? "", { status: "load_fail" }),
    queryFn: () => getDryRunRecords(runId as string, { status: "load_fail" }),
    enabled: !!runId,
  });

  const refetch = () => {
    void runQuery.refetch();
    void recordsQuery.refetch();
  };

  if (!runId) {
    return (
      <ReportPage
        narrative="Choose a dry run to see which records would load into S/4HANA."
        charts={null}
        state="empty"
        emptyProps={{ title: "No dry run selected." }}
      />
    );
  }

  const isLoading = runQuery.isLoading || recordsQuery.isLoading;
  const isError = runQuery.isError || recordsQuery.isError;
  const run = runQuery.data?.run;
  const rows = recordsQuery.data?.rows ?? [];

  const state = isLoading ? "loading" : isError ? "error" : undefined;

  const moduleBadges = run
    ? Object.entries(run.gap_summary ?? {}).map(([module, summary]) => {
        const verdict = FROM_ENGINE[summary.verdict];
        return (
          <Pill key={module} tone={VERDICT_TONE[verdict]}>
            {formatModuleName(module)}: {VERDICT_LABEL[verdict]}
          </Pill>
        );
      })
    : [];

  return (
    <ReportPage
      narrative={
        run
          ? `Dry run against S/4HANA release ${run.target_release ?? "target"} — ${run.records_blocked} of ${run.records_total} records would fail to load.`
          : "S/4 load dry run results."
      }
      charts={
        <div className="flex flex-wrap items-center gap-3">
          {moduleBadges}
          {run && <Stat label="Blocked" value={run.records_blocked} />}
          {run && <Stat label="Total" value={run.records_total} />}
          <Button variant="secondary" render={<a href={dryRunExportUrl(runId, "xlsx")} />}>
            Export Excel
          </Button>
          <Button variant="secondary" render={<a href={dryRunExportUrl(runId, "pdf")} />}>
            Export PDF
          </Button>
        </div>
      }
      tables={<DataTable columns={columns} data={rows} getRowId={(row) => `${row.module}:${row.record_key}`} />}
      state={state}
      emptyProps={{ title: "No failing records for this dry run." }}
      errorProps={{
        message: runQuery.error ? apiErrorMessage(runQuery.error) : recordsQuery.error ? apiErrorMessage(recordsQuery.error) : "Couldn't load the dry run. Try again.",
        onRetry: refetch,
      }}
    />
  );
}

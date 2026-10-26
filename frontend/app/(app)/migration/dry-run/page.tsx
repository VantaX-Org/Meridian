// frontend/app/(app)/migration/dry-run/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isAxiosError } from "axios";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Mono, Notice, PageHeader, Pager, Pill, ReportPage, Skeleton, Stat, Status, asyncStateOf } from "@/design";
import { getDryRunRecords, getMigrationRun, getMigrationRuns, dryRunExportUrl, type DryRunRecord } from "@/lib/api/migration";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationRun, MigrationStatus, TransferVerdict, WaveVerdict } from "@/types/api";

const FROM_ENGINE: Record<TransferVerdict, WaveVerdict> = { go: "go", conditional: "at_risk", "no-go": "no_go" };

/** Failing records per page: the records endpoint's default page. */
export const DRY_RUN_PAGE = 200;

const inFlight = (status: MigrationStatus | undefined) => status === "queued" || status === "running";

const STATUS_TONE ={ load_ready: "go", load_fail: "no-go" } as const;
const STATUS_LABEL = { load_ready: "Load ready", load_fail: "Load fail" } as const;

const columnsFor = (srcVersion: string | null | undefined): ColumnDef<DryRunRecord>[] => [
  { accessorKey: "module", header: "Object", cell: ({ row }) => formatModuleName(row.original.module) },
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
  {
    id: "open",
    header: "",
    size: 80,
    cell: ({ row }) => (
      <Link href={`/objects/${row.original.module}${srcVersion ? `?run=${srcVersion}&tab=records` : ""}`} className="m-ink-accent-ink underline">Open</Link>
    ),
  },
];

const pickerColumns: ColumnDef<MigrationRun>[] = [
  { accessorKey: "created_at", header: "Started", cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
  { id: "objects", header: "Objects", accessorFn: (r) => r.modules.map(formatModuleName).join(", ") },
  { accessorKey: "target_release", header: "S/4HANA release", cell: ({ row }) => row.original.target_release ?? "Target" },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
  { id: "blocked", header: "Records that would fail", meta: { numeric: true }, accessorFn: (r) => r.records_blocked, cell: ({ row }) => `${row.original.records_blocked.toLocaleString()} of ${row.original.records_total.toLocaleString()}` },
];

/** Every S/4 load dry run, newest first: shown when no dry run is chosen, or the run in the address is not one. */
function DryRunPicker({ notADryRun }: { notADryRun?: boolean }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ["migration", "runs", "s4_dry_run"], queryFn: () => getMigrationRuns({ mode: "s4_dry_run" }) });
  const runs = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="S/4 load dry runs" meta="Choose a dry run to see which records would load into S/4HANA" />
      {notADryRun ? <Notice tone="info">The run in the address is not a dry run. Choose one below.</Notice> : null}
      <ExplorerPage
        state={asyncStateOf(q, () => runs.length === 0, true)}
        emptyProps={{
          title: "No dry runs yet",
          detail: "Start one from a migration wave with Dry run (S/4 load). It checks every record against the S/4HANA load rules without loading anything.",
          action: <Button render={<Link href="/migration">Open migration cockpit</Link>} />,
        }}
        errorProps={{ error: q.error, onRetry: () => q.refetch() }}
        table={<DataTable columns={pickerColumns} data={runs} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/migration/dry-run?run=${r.id}`)} />}
      />
    </div>
  );
}

export default function DryRunPage() {
  const search = useSearchParams();
  const runId = search.get("run") ?? undefined;
  const [page, setPage] = useState(1);

  const runQuery = useQuery({
    queryKey: queryKeys.migrationRun(runId ?? ""),
    queryFn: () => getMigrationRun(runId as string),
    enabled: !!runId,
    refetchInterval: (q) => (inFlight(q.state.data?.run.status) ? 3000 : false),
  });
  const running = inFlight(runQuery.data?.run.status);

  const recordsQuery = useQuery({
    queryKey: queryKeys.migrationDryRun(runId ?? "", { status: "load_fail", page }),
    queryFn: () => getDryRunRecords(runId as string, { status: "load_fail", limit: DRY_RUN_PAGE, offset: (page - 1) * DRY_RUN_PAGE }),
    enabled: !!runId,
    refetchInterval: running ? 3000 : false,
  });

  const refetch = () => {
    void runQuery.refetch();
    void recordsQuery.refetch();
  };

  if (!runId) return <DryRunPicker />;
  // The app scopes pages with ?run=, so a data quality run's id can arrive here; it is not a dry run.
  if (isAxiosError(runQuery.error) && runQuery.error.response?.status === 404) return <DryRunPicker notADryRun />;

  const isLoading = runQuery.isLoading || recordsQuery.isLoading;
  const isError = runQuery.isError || isListFailure(recordsQuery);
  const run = runQuery.data?.run;
  const rows = recordsQuery.data?.rows ?? [];
  const total = recordsQuery.data?.total ?? rows.length;

  const state = isLoading ? "loading" : isError ? "error" : undefined;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="grid grid-cols-3 gap-3">
          <Skeleton height={88} />
          <Skeleton height={88} />
          <Skeleton height={88} />
        </div>
        <Skeleton height={240} />
      </div>
    );
  }

  const columns = columnsFor(run?.source_version_id);
  // The stats count this dry run's records, not the data quality run's findings: they open the list below.
  const failingHref = "#failing-records";
  const moduleBadges = run
    ? Object.entries(run.gap_summary ?? {}).map(([module, summary]) => {
        const verdict = FROM_ENGINE[summary.verdict];
        return (
          <span key={module} className="inline-flex items-center gap-1">
            {formatModuleName(module)} <Status kind="verdict" value={verdict} />
          </span>
        );
      })
    : [];

  return (
    <ReportPage
      title="S/4 load dry run"
      meta={run ? `Release ${run.target_release ?? "target"}` : undefined}
      exportMenu={
        <>
          <Button variant="secondary" render={<a href={dryRunExportUrl(runId, "xlsx")} />}>
            Export Excel
          </Button>
          <Button variant="secondary" render={<a href={dryRunExportUrl(runId, "pdf")} />}>
            Export PDF
          </Button>
        </>
      }
      narrative={
        run
          ? `${running ? "Still checking. " : ""}Each record was checked against the S/4HANA ${run.target_release ?? "target"} load rules without loading anything: ${run.records_blocked.toLocaleString()} of ${run.records_total.toLocaleString()} would fail. The list below says why, so they can be fixed before the real load`
          : "S/4 load dry run results"
      }
      charts={
        <div className="flex flex-col [gap:var(--m-section-gap)]">
          {run ? (
            <div className="m-stat-grid">
              <Stat label="Would fail to load" value={run.records_blocked.toLocaleString()} tone={run.records_blocked > 0 ? "no-go" : "go"} href={run.records_blocked > 0 ? failingHref : undefined} />
              <Stat label="Records checked" value={run.records_total.toLocaleString()} />
            </div>
          ) : null}
          {moduleBadges.length ? <div className="flex flex-wrap items-center gap-3">{moduleBadges}</div> : null}
        </div>
      }
      tables={
        <div id="failing-records" className="flex flex-col gap-2">
          <DataTable columns={columns} data={rows} getRowId={(row) => `${row.module}:${row.record_key}`} />
          {total > DRY_RUN_PAGE ? (
            <Pager page={page} pageCount={Math.ceil(total / DRY_RUN_PAGE)} pageSize={DRY_RUN_PAGE} total={total} onPageChange={setPage} />
          ) : null}
        </div>
      }
      state={state}
      emptyProps={{ title: "No records would fail", detail: "Every record passed the S/4HANA load rules in this dry run." }}
      errorProps={{
        message: runQuery.error ? apiErrorMessage(runQuery.error) : isListFailure(recordsQuery) ? apiErrorMessage(recordsQuery.error) : "Couldn't load the dry run. Try again.",
        onRetry: refetch,
      }}
    />
  );
}

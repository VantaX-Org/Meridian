// frontend/app/(app)/objects/[object]/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bar, Button, DataTable, EmptyState, ErrorState, ExportMenu, Mono, Pager, Pill, SeverityDot,
  Skeleton, Stat, Tabs, emptyExportOptions, isSeverity,
} from "@/design";
import { exportObject, getObject, type ObjectRule } from "@/lib/api/v1/objects";
import { downloadAuthenticated } from "@/lib/api/download";
import { getObjectReportUrl } from "@/lib/api/reports";
import { exportFindingRecords } from "@/lib/api/findings";
import { getFindingRecords, getVersion, type FindingRecord } from "@/lib/api/versions";
import { getVersionProfile } from "@/lib/api/field-profile";
import { apiErrorMessage } from "@/lib/error";
import { getRuleHistory } from "@/lib/api/rules";
import { queryKeys } from "@/lib/query-keys";

const PAGE_SIZE = 25;
// Per-row rule-history fan-out is capped at this many visible rows; there is no
// batch endpoint for "pass rate over time for N rules at once" yet. G1.
const RULE_HISTORY_CAP = 25;

const READINESS_TONE: Record<string, "go" | "at-risk" | "no-go"> = { pass: "go", warn: "at-risk", fail: "no-go" };

function RulesTab({ object, run }: { object: string; run: string }) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.object(object, run),
    queryFn: () => getObject(object, run),
    enabled: !!run,
  });

  const rulesRanked = data ? [...data.rules].sort((a, b) => b.affected_count - a.affected_count) : [];
  const historyRows = rulesRanked.slice(0, RULE_HISTORY_CAP);
  // G1: fan out one request per visible rule instead of one batch call, capped above.
  const histories = useQueries({
    queries: historyRows.map((r) => ({
      queryKey: queryKeys.ruleHistory(r.check_id),
      queryFn: () => getRuleHistory(r.check_id, { limit: 2 }),
    })),
  });

  const delta = (checkId: string): number | null => {
    const idx = historyRows.findIndex((r) => r.check_id === checkId);
    const runs = histories[idx]?.data?.runs;
    if (!runs || runs.length < 2 || runs[0].pass_rate == null || runs[1].pass_rate == null) return null;
    return runs[0].pass_rate - runs[1].pass_rate;
  };

  const columns: ColumnDef<ObjectRule>[] = [
    {
      accessorKey: "severity",
      header: "Severity",
      cell: ({ row }) =>
        isSeverity(row.original.severity) ? <SeverityDot severity={row.original.severity} /> : row.original.severity,
    },
    { accessorKey: "check_id", header: "Check" },
    { accessorKey: "dimension", header: "Dimension", cell: ({ row }) => row.original.dimension ?? "—" },
    { accessorKey: "affected_count", header: "Affected" },
    {
      accessorKey: "pass_rate",
      header: "Pass rate",
      cell: ({ row }) => (row.original.pass_rate == null ? "—" : `${Math.round(row.original.pass_rate * 100)}%`),
    },
    {
      id: "trend",
      header: "Trend",
      cell: ({ row }) => {
        const d = delta(row.original.check_id);
        if (d == null) return "—";
        const pct = Math.round(d * 100);
        if (pct === 0) return "No change.";
        return (
          <span style={{ color: pct > 0 ? "var(--m-pass)" : "var(--m-fail)" }}>
            {pct > 0 ? "+" : ""}{pct} pts vs previous run.
          </span>
        );
      },
    },
  ];

  if (isLoading) return <Skeleton height={320} />;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data || data.rules.length === 0) {
    return (
      <EmptyState
        title="No results for this object in this run."
        detail="The run did not include this object's module."
        action={<Button render={<Link href={`/objects?run=${run}`}>All objects</Link>} />}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={rulesRanked}
      getRowId={(row) => row.check_id}
      onRowClick={(row) => router.push(`/objects/${object}?run=${run}&tab=records&check_id=${row.check_id}`)}
    />
  );
}

function OverviewTab({ object, run }: { object: string; run: string }) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.object(object, run),
    queryFn: () => getObject(object, run),
    enabled: !!run,
  });

  if (isLoading) return <Skeleton height={240} />;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data) return null;

  const dimensionPoints = Object.entries(data.dimension_scores).map(([dimension, score]) => ({
    x: dimension,
    y: score,
    dimension,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-6">
        <Stat label="Composite score" value={data.composite_score != null ? String(data.composite_score) : "—"} />
        <Stat label="Failing checks" value={String(data.failing_checks)} />
        <Stat label="Affected records" value={String(data.affected_records)} />
      </div>
      {dimensionPoints.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No dimension scores for this object in this run.</p>
      ) : (
        <Bar
          data={dimensionPoints}
          onPointClick={(p) => router.push(`/objects/${object}?run=${run}&tab=rules&dimension=${p.dimension ?? ""}`)}
        />
      )}
    </div>
  );
}

function FieldsTab({ object, run, systemId }: { object: string; run: string; systemId: string | null }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.versionProfile(systemId ?? "", run, object),
    queryFn: () => getVersionProfile(systemId ?? "", run, object),
    enabled: !!systemId && !!run,
  });

  if (!systemId) {
    // G3: field profiles are only produced for runs extracted from a connected
    // system; an upload-sourced run has no system_id to profile against.
    return (
      <EmptyState
        title="No field profile for this run."
        detail="This run came from an upload, not a connected system. Connect a system and run an extraction to see field shapes and dependencies."
      />
    );
  }
  if (isLoading) return <Skeleton height={240} />;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data || data.tables.length === 0) {
    return <EmptyState title="No field profile for this object in this run." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {data.tables.map((table) => (
        <section key={table.table} className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">
            <Mono>{table.table}</Mono>
          </h2>
          <DataTable
            columns={[
              { accessorKey: "field", header: "Field" },
              { accessorKey: "ddic_type", header: "Type", cell: ({ row }) => row.original.stats.ddic_type ?? "—" },
              {
                id: "blank_pct",
                header: "Blank",
                cell: ({ row }) => `${Math.round(row.original.stats.blank_pct * 100)}%`,
              },
              { id: "distinct", header: "Distinct", cell: ({ row }) => String(row.original.stats.distinct) },
            ]}
            data={table.fields}
            getRowId={(f) => f.field}
          />
        </section>
      ))}
    </div>
  );
}

function RecordsTab({ object, run, checkId }: { object: string; run: string; checkId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...queryKeys.rule(checkId, run), page],
    queryFn: () => getFindingRecords(run, checkId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    enabled: !!run && !!checkId,
  });

  const columns = useMemo<ColumnDef<FindingRecord>[]>(
    () => [
      { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
      { accessorKey: "grain", header: "Grain", cell: ({ row }) => row.original.grain ?? "—" },
      { accessorKey: "module", header: "Module" },
      {
        id: "fix",
        header: "Fix sheet",
        cell: ({ row }) => (
          // DrillLink has no way to address the record fix-sheet route, so this is a plain Link.
          <Link
            href={`/objects/${object}/records/${encodeURIComponent(row.original.record_key)}?run=${run}`}
            style={{ color: "var(--m-accent)" }}
          >
            Open fix sheet
          </Link>
        ),
      },
    ],
    [object, run],
  );

  if (isLoading) return <Skeleton height={240} />;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data || data.records.length === 0) {
    return (
      <EmptyState
        title="No failing records for this rule."
        detail="Every record passed this check in this run."
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const exportOptions = [{ format: "xlsx" as const, run: () => exportFindingRecords(run, checkId, "xlsx") }];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>
          {data.total} record{data.total === 1 ? "" : "s"} fail {checkId}.
        </p>
        <ExportMenu options={exportOptions} />
      </div>
      <DataTable columns={columns} data={data.records} getRowId={(row) => row.record_key} />
      <Pager page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}

export default function ObjectDetailPage() {
  const params = useParams<{ object: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const object = params.object;
  const run = search.get("run") ?? "";
  const tab = search.get("tab") ?? "overview";
  const checkId = search.get("check_id") ?? "";

  const setTab = (next: string) => router.push(`/objects/${object}?run=${run}&tab=${next}`);

  const { data } = useQuery({
    queryKey: queryKeys.object(object, run),
    queryFn: () => getObject(object, run),
    enabled: !!run,
  });
  const { data: version } = useQuery({
    queryKey: queryKeys.run(run),
    queryFn: () => getVersion(run),
    enabled: !!run,
  });
  const systemId = version?.metadata?.system_id ?? null;

  if (!run) {
    return <EmptyState title="Select a run to see this object's data quality." />;
  }

  const exportOptions = [
    { format: "xlsx" as const, run: () => exportObject(object, run) },
    {
      format: "pdf" as const,
      label: "PDF analysis",
      run: () =>
        downloadAuthenticated(
          getObjectReportUrl(run, object),
          `meridian-${object}-${version?.label ?? run}.pdf`,
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <strong>{data?.label ?? object}</strong>
          {data?.readiness ? <Pill tone={READINESS_TONE[data.readiness] ?? "neutral"}>{data.readiness}</Pill> : null}
        </div>
        <ExportMenu options={data ? exportOptions : emptyExportOptions(exportOptions)} />
      </header>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "overview", label: "Overview", content: <OverviewTab object={object} run={run} /> },
          { value: "rules", label: "Rules", content: <RulesTab object={object} run={run} /> },
          { value: "fields", label: "Fields", content: <FieldsTab object={object} run={run} systemId={systemId} /> },
          {
            value: "records",
            label: "Records",
            content: checkId ? (
              <RecordsTab object={object} run={run} checkId={checkId} />
            ) : (
              <EmptyState title="Open the rules tab and choose a rule to see its failing records." />
            ),
          },
        ]}
      />
    </div>
  );
}

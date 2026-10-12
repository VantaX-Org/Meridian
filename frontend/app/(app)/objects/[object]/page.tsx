// frontend/app/(app)/objects/[object]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bar, Button, Card, DataTable, Delta, DrillLink, EmptyState, ErrorState, ExportMenu, Mono, Pager, Pill, ScoreRing,
  SeverityDot, Skeleton, Stat, Tabs, emptyExportOptions, isSeverity,
  entityTabs,
} from "@/design";
import { OwnerPicker } from "@/components/owners/OwnerPicker";
import { FilterChips, ObjectsHeader } from "../_header";
import { FindingContextPanel } from "./rules/[ruleId]/finding-context-panel";
import { RootCauseSection } from "./rules/[ruleId]/root-cause";
import { useRole } from "@/hooks/use-role";
import { exportObject, getObject, type ObjectRule, type ObjectSummary } from "@/lib/api/v1/objects";
import { downloadAuthenticated } from "@/lib/api/download";
import { getObjectReportUrl } from "@/lib/api/reports";
import { exportFindingRecords } from "@/lib/api/findings";
import { getFindingRecords, getVersion, type FindingRecord } from "@/lib/api/versions";
import { getProfileByVersion, type ShapeCount, type ValueCount } from "@/lib/api/field-profile";
import { apiErrorMessage } from "@/lib/error";
import { getRuleHistoryBatch } from "@/lib/api/rules";
import { queryKeys } from "@/lib/query-keys";
import { formatModuleName } from "@/lib/format";

const PAGE_SIZE = 50;
/** Page-level and tab-level hooks share these keys; a fresh window stops the tab remount refetching. */
const STALE_MS = 30_000;
const RULE_HISTORY_RUNS = 8;

const READINESS_TONE: Record<string, "go" | "at-risk" | "no-go"> = { pass: "go", warn: "at-risk", fail: "no-go" };
const READINESS_LABEL: Record<string, string> = { pass: "Go", warn: "At risk", fail: "No-go" };
const TAB_KEYS = ["overview", "rules", "fields", "records"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
const isBlocking = (r: ObjectRule) => r.severity === "critical" || r.severity === "high";

const objectQuery = (object: string, run: string) => ({
  queryKey: queryKeys.object(object, run),
  queryFn: () => getObject(object, run),
  enabled: !!run,
  staleTime: STALE_MS,
});
const historyQuery = (object: string, run: string) => ({
  queryKey: queryKeys.ruleHistoryBatch(run, object),
  queryFn: () => getRuleHistoryBatch({ version_id: run, module: object, limit_runs: RULE_HISTORY_RUNS }),
  enabled: !!run,
  staleTime: STALE_MS,
});

const fixSheetHref = (object: string, run: string, key: string) =>
  `/objects/${object}/records/${encodeURIComponent(key)}?run=${run}`;

/** The field's most common value shape (highest share), or "—" when none was profiled. */
function topShape(shapes: ShapeCount[]): string {
  if (shapes.length === 0) return "—";
  const top = shapes.reduce((best, s) => (s.share > best.share ? s : best), shapes[0]);
  return `${top.shape} (${Math.round(top.share * 100)}%)`;
}

/** The field's most common values, joined for display, or "—" when not profiled/eligible. */
function topValues(values: ValueCount[] | null): string {
  if (!values || values.length === 0) return "—";
  return values.slice(0, 3).map((v) => `${v.value} (${v.count})`).join(", ");
}

function RulesTab({ object, run }: { object: string; run: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dimension = searchParams.get("dimension");
  const severity = searchParams.get("severity");
  // Blocking = critical or high severity (the same rule the migration export uses). Only "true" filters.
  const blocking = searchParams.get("blocking") === "true";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/objects/${object}?${next.toString()}`, { scroll: false });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams.toString());
    for (const k of ["blocking", "dimension", "severity"]) next.delete(k);
    router.replace(`/objects/${object}?${next.toString()}`, { scroll: false });
  };
  const { data, isLoading, isError, error, refetch } = useQuery(objectQuery(object, run));
  const batch = useQuery(historyQuery(object, run));

  const rulesRanked = data
    ? [...data.rules]
        .filter((r) => !dimension || r.dimension === dimension)
        .filter((r) => !severity || r.severity === severity)
        .filter((r) => !blocking || isBlocking(r))
        .sort((a, b) => b.affected_count - a.affected_count)
    : [];

  const delta = (checkId: string): number | null => {
    const runs = batch.data?.history[checkId];
    if (!runs || runs.length < 2 || runs[0].pass_rate == null || runs[1].pass_rate == null) return null;
    return runs[0].pass_rate - runs[1].pass_rate;
  };
  const recordsHref = (checkId: string) => `/objects/${object}?run=${run}&tab=records&check_id=${checkId}`;

  const columns: ColumnDef<ObjectRule>[] = [
    {
      accessorKey: "severity",
      header: "Severity",
      cell: ({ row }) =>
        isSeverity(row.original.severity) ? <SeverityDot severity={row.original.severity} /> : row.original.severity,
    },
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { accessorKey: "dimension", header: "Dimension", cell: ({ row }) => row.original.dimension ?? "—" },
    {
      accessorKey: "affected_count",
      header: "Records failing",
      cell: ({ row }) => <DrillLink href={recordsHref(row.original.check_id)}>{row.original.affected_count.toLocaleString()}</DrillLink>,
    },
    {
      accessorKey: "pass_rate",
      header: "Pass rate",
      cell: ({ row }) => (row.original.pass_rate == null ? "—" : `${(row.original.pass_rate * 100).toFixed(1)}%`),
    },
    {
      id: "trend",
      header: "Trend",
      cell: ({ row }) => {
        const d = delta(row.original.check_id);
        return d == null ? "—" : <Delta value={d * 100} run="previous run" />;
      },
    },
    {
      id: "open",
      header: "Action",
      cell: ({ row }) => <Button variant="ghost" size="sm" render={<Link href={recordsHref(row.original.check_id)} onClick={(e) => e.stopPropagation()}>Open records</Link>} />,
    },
  ];

  if (isLoading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data || data.rules.length === 0) {
    return (
      <EmptyState
        title="No rules ran for this object"
        ghost="table"
        detail="The run did not include this object's module."
        action={<Button render={<Link href={`/runs/${run}?tab=steps`}>Open run steps</Link>} />}
      />
    );
  }
  if (batch.isError) return <ErrorState message={apiErrorMessage(batch.error)} onRetry={() => batch.refetch()} />;

  const dimensions = [...new Set(data.rules.map((r) => r.dimension).filter((d): d is string => !!d))].map((d) => ({ value: d, label: d }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <FilterChips label="Severity" value={severity} options={SEVERITIES} onChange={(v) => setParam("severity", v)} />
        {dimensions.length > 1 ? <FilterChips label="Dimension" value={dimension} options={dimensions} onChange={(v) => setParam("dimension", v)} /> : null}
        <FilterChips label="Show" value={blocking ? "true" : null} options={[{ value: "true", label: "Blocking only" }]} onChange={(v) => setParam("blocking", v)} />
      </div>
      {rulesRanked.length === 0 ? (
        <EmptyState
          title="No rules match"
          detail="No rule fits the current filters."
          action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rulesRanked}
          getRowId={(row) => row.check_id}
          onRowClick={(row) => router.push(recordsHref(row.check_id))}
        />
      )}
    </div>
  );
}

function OverviewTab({ object, run }: { object: string; run: string }) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useQuery(objectQuery(object, run));

  if (isLoading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data) return null;

  const dimensionPoints = Object.entries(data.dimension_scores).map(([dimension, score]) => ({
    x: dimension,
    y: score,
    dimension,
  }));
  const blockingRules = data.rules.filter((r) => isBlocking(r) && r.affected_count > 0).length;
  const rulesHref = `/objects/${object}?run=${run}&tab=rules`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-6">
        <Card title="DQS" padding="sm">
          <div className="flex items-center gap-3">
            {data.composite_score != null ? <ScoreRing score={data.composite_score} size={48} /> : null}
            <span className="m-numeric font-semibold" style={{ fontSize: "var(--m-text-stat)", minWidth: "4ch" }}>{data.composite_score != null ? String(data.composite_score) : "—"}</span>
          </div>
        </Card>
        <Stat label="Blocking rules" value={blockingRules} tone={blockingRules > 0 ? "no-go" : "go"} href={`${rulesHref}&blocking=true`} />
        <Stat label="Affected records" value={data.affected_records.toLocaleString()} href={`/objects/${object}?run=${run}&tab=records`} />
      </div>
      <Card title="Score by dimension">
        {dimensionPoints.length === 0 ? (
          <EmptyState
            title="No dimension scores"
            detail="This run produced no per-dimension scores for this object."
            action={<Button render={<Link href={rulesHref}>Open rules</Link>} />}
          />
        ) : (
          <Bar
            data={dimensionPoints}
            onPointClick={(p) => router.push(`${rulesHref}&dimension=${p.dimension ?? ""}`)}
          />
        )}
      </Card>
    </div>
  );
}

const profileQuery = (object: string, run: string) => ({
  queryKey: queryKeys.versionProfileByVersion(run, object),
  queryFn: () => getProfileByVersion(run, object),
  enabled: !!run,
  staleTime: STALE_MS,
});
const recordsQuery = (run: string, checkId: string, page: number) => ({
  queryKey: [...queryKeys.rule(checkId, run), page],
  queryFn: () => getFindingRecords(run, checkId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  enabled: !!run && !!checkId,
  staleTime: STALE_MS,
});

function FieldsTab({ object, run }: { object: string; run: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery(profileQuery(object, run));

  if (isLoading) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data || data.tables.length === 0) {
    return (
      <EmptyState
        title="No field profile for this object"
        detail="The run did not profile this object's fields."
        action={<Button render={<Link href={`/runs/${run}?tab=steps`}>Open run steps</Link>} />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.tables.map((table) => (
        <Card key={table.table} title={<Mono>{table.table}</Mono>} padding="sm">
          <DataTable
            columns={[
              {
                id: "field",
                header: "Field",
                cell: ({ row }) => <Mono>{table.table}.{row.original.field}</Mono>,
              },
              { accessorKey: "ddic_type", header: "Type", cell: ({ row }) => row.original.stats.ddic_type ?? "—" },
              {
                id: "blank_pct",
                header: "Blank",
                cell: ({ row }) =>
                  `${row.original.stats.blank} (${Math.round(row.original.stats.blank_pct * 100)}%)`,
              },
              { id: "distinct", header: "Distinct", cell: ({ row }) => String(row.original.stats.distinct) },
              { id: "top_shape", header: "Top shape", cell: ({ row }) => <Mono>{topShape(row.original.stats.shapes)}</Mono> },
              {
                id: "top_values",
                header: "Top values",
                cell: ({ row }) =>
                  row.original.stats.masked ? (
                    <Pill tone="neutral">Masked: {row.original.stats.mask_reason ?? "unknown"}</Pill>
                  ) : (
                    topValues(row.original.stats.top_values)
                  ),
              },
            ]}
            data={table.fields}
            getRowId={(f) => f.field}
          />
        </Card>
      ))}
    </div>
  );
}

function RecordsTab({ object, run, checkId }: { object: string; run: string; checkId: string }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery(recordsQuery(run, checkId, page));
  // Fix sheet for the row last hovered or focused; `f` opens it (falls back to the first row).
  const activeKey = useRef<string | null>(null);
  const trackRow = (target: EventTarget) => {
    const key = (target as HTMLElement).closest?.("tr")?.querySelector<HTMLElement>("[data-fix]")?.dataset.fix;
    if (key) activeKey.current = key;
  };
  const firstKey = data?.records[0]?.record_key;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "f" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable]")) return;
      const key = activeKey.current ?? firstKey;
      if (key) router.push(fixSheetHref(object, run, key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstKey, object, run, router]);

  // Spec §5.2: one mono column per field_values key, unioned across the current page of records.
  const fieldValueKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of data?.records ?? []) {
      if (r.field_values) for (const k of Object.keys(r.field_values)) keys.add(k);
    }
    return [...keys];
  }, [data]);

  const columns = useMemo<ColumnDef<FindingRecord>[]>(
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

  if (isLoading) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
  if (!data || data.records.length === 0) {
    return (
      <EmptyState
        title="No failing records for this rule"
        detail="Every record passed this check in this run."
        action={<Button render={<Link href={`/objects/${object}?run=${run}&tab=rules`}>Back to rules</Link>} />}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const exportOptions = [{ format: "xlsx" as const, run: () => exportFindingRecords(run, checkId, "xlsx") }];

  return (
    <div className="flex flex-col gap-4">
      <FindingContextPanel
        ruleId={checkId}
        run={run}
        moduleId={data.records[0]?.module ?? ""}
        fields={Object.keys(data.records[0]?.field_values ?? {})}
      />
      <Card
        title={<>{data.total.toLocaleString()} record{data.total === 1 ? "" : "s"} fail <Mono>{checkId}</Mono></>}
        actions={
          <>
            <Button render={<Link href={fixSheetHref(object, run, data.records[0].record_key)}>Open fix sheet</Link>} />
            <ExportMenu options={exportOptions} />
          </>
        }
      >
        <div onFocusCapture={(e) => trackRow(e.target)} onPointerOver={(e) => trackRow(e.target)}>
          <DataTable
            columns={columns}
            data={data.records}
            getRowId={(row) => row.record_key}
            onRowClick={(row) => router.push(fixSheetHref(object, run, row.record_key))}
          />
        </div>
        <Pager page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
      </Card>
      <RootCauseSection run={run} ruleId={checkId} />
    </div>
  );
}

export default function ObjectDetailPage() {
  const params = useParams<{ object: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const object = params.object;
  const run = search.get("run") ?? "";
  const tab = search.get("tab") ?? "overview";
  const checkId = search.get("check_id") ?? "";

  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.push(`/objects/${object}?${params.toString()}`);
  };

  // All detail queries start together at page level; tabs share these keys, so switching tabs never waterfalls.
  const { data } = useQuery(objectQuery(object, run));
  const { data: version } = useQuery({
    queryKey: queryKeys.run(run),
    queryFn: () => getVersion(run),
    enabled: !!run,
  });
  useQuery(historyQuery(object, run));
  useQuery(profileQuery(object, run));
  useQuery(recordsQuery(run, checkId, 1));

  // Header content from the list cache while the detail request is in flight.
  const listed = queryClient
    .getQueryData<{ objects: ObjectSummary[] }>(queryKeys.objects(run))
    ?.objects.find((o) => o.module === object);
  const summary = data ?? listed;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable]")) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) setTab(TAB_KEYS[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!run) {
    return (
      <EmptyState
        title="Select a run to see this object's data quality"
        action={<Button render={<Link href="/objects">All objects</Link>} />}
      />
    );
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
  const meta = [
    version?.label ? `Run ${version.label}` : null,
    summary ? `${summary.failing_checks.toLocaleString()} failing checks` : null,
    summary ? `${summary.affected_records.toLocaleString()} affected records` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4 p-6">
      <ObjectsHeader
        title={summary?.label ?? formatModuleName(object)}
        meta={meta || undefined}
        status={summary?.readiness ? <Pill tone={READINESS_TONE[summary.readiness] ?? "neutral"}>{READINESS_LABEL[summary.readiness] ?? summary.readiness}</Pill> : null}
        actions={
          <>
            <OwnerPicker kind="object" refId={object} />
            <ExportMenu options={data ? exportOptions : emptyExportOptions(exportOptions)} />
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "overview", label: "Overview", content: <OverviewTab object={object} run={run} /> },
          { value: "rules", label: "Rules", content: <RulesTab object={object} run={run} /> },
          { value: "fields", label: "Fields", content: <FieldsTab object={object} run={run} /> },
          {
            value: "records",
            label: "Records",
            content: checkId ? (
              <RecordsTab object={object} run={run} checkId={checkId} />
            ) : (
              <EmptyState
                title="No rule selected"
                detail="Choose a rule to see its failing records."
                action={<Button render={<Link href={`/objects/${object}?run=${run}&tab=rules`}>Open rules</Link>} />}
              />
            ),
          },
          ...entityTabs({ entityType: "objects", entityId: object, auditPath: `/objects/${object}`, exportOptions: data ? exportOptions : undefined, canExport: can("export") }),
        ]}
      />
    </div>
  );
}

// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, DataTable, Delta, Dialog, DimensionBars, EmptyState, ErrorState, ExplorerPage, ExportMenu, Field, FindingDrawer, Input, Line, Mono, Pager, Pill, Tooltip, DrillLink, Score, Select, SeverityDot, Skeleton, Sparkline, Stat, Tabs, isSeverity, entityTabs, NextActions, PageHeader, Status, asyncStateOf, type CellMeta } from "@/design";
import { getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { useRole } from "@/hooks/use-role";
import { downloadAuthenticated } from "@/lib/api/download";
import { exportFindings, getFindings, getFindingsAggregate, getScoreHistory, type FindingsAggregate } from "@/lib/api/findings";
import { errorText } from "@/lib/api/remediation";
import { getAnalysisReportUrl, getReportDownloadUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { exportRunSteps, getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { getSystems } from "@/lib/api/connectivity";
import { getVersion, getVersions, patchVersionLabel, pinBaseline } from "@/lib/api/versions";
import { getAnalysisStatus } from "@/lib/api/upload";
import { analyseVersion } from "@/lib/api/system-objects";
import { RunProgressBanner } from "@/components/run-progress-banner";
import { DIMENSIONS, formatDate, formatModuleName, labelOf, runAxisLabels } from "@/lib/format";
import { ConfigMatchesTab } from "./config-matches-tab";
import { queryKeys } from "@/lib/query-keys";
import { baselineRunId, isFinished, lineageOf, overallDqs, previousRunId, runPageHref } from "@/lib/runs";
import { latestFinishedRun, lineageChoices } from "@/lib/run-scope";
import { RunScope } from "@/components/run-scope";
import type { Finding, Version } from "@/types/api";
import { clsx } from "clsx";




const SEVERITY_OPTIONS = [
  { value: "", label: "All severities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const DIMENSION_OPTIONS = [{ value: "", label: "All dimensions" }, ...DIMENSIONS.map((d) => ({ value: d.id, label: d.label }))];

const stepColumns: ColumnDef<RunStep>[] = [
  { accessorKey: "step_name", header: "Step" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} />,
  },
  { accessorKey: "started_at", header: "Started", cell: ({ row }) => formatDate(row.original.started_at, "datetime") },
  {
    accessorKey: "duration_ms",
    header: "Duration",
    cell: ({ row }) => (row.original.duration_ms == null ? "—" : `${(row.original.duration_ms / 1000).toFixed(1)}s`),
  },
  {
    id: "error",
    header: "Error",
    accessorFn: (s) => s.error_detail ?? "",
    cell: ({ row }) => (row.original.error_detail ? <span className="block max-w-[320px] truncate">{row.original.error_detail}</span> : "—"),
  },
];

type History = UseQueryResult<Awaited<ReturnType<typeof getScoreHistory>>>;
const FINDINGS_PAGE = 100;

function ObjectsTab({ versionId, history, onOpenSteps }: { versionId: string; history: History; onOpenSteps: () => void }) {
  const { can } = useRole();
  const objects = useQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  // Ranked by records affected, the same order as the overview ledger.
  const rows = [...(objects.data?.objects ?? [])].sort((x, y) => y.affected_records - x.affected_records);
  const modules = history.data?.modules ?? {};

  const columns: ColumnDef<ObjectSummary>[] = [
    {
      id: "module",
      header: "Object",
      accessorFn: (o) => formatModuleName(o.module),
      cell: ({ row }) => <DrillLink object={row.original.module} run={versionId}>{formatModuleName(row.original.module)}</DrillLink>,
    },
    {
      id: "composite",
      header: "Composite",
      cell: ({ row }) => (row.original.composite_score == null ? "—" : (
        <DrillLink object={row.original.module} run={versionId}>{row.original.composite_score.toFixed(1)}</DrillLink>
      )),
    },
    {
      id: "readiness",
      header: "Readiness",
      cell: ({ row }) =>
        row.original.readiness ? <Status kind="verdict" value={row.original.readiness} /> : "—",
    },
    {
      accessorKey: "failing_checks",
      header: "Failing checks",
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}`}>{row.original.failing_checks}</DrillLink>,
    },
    {
      accessorKey: "affected_records",
      header: "Affected records",
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}`}>{row.original.affected_records}</DrillLink>,
    },
    {
      id: "trend",
      header: "Trend",
      cell: ({ row }) => {
        const series = modules[row.original.module];
        if (!series || series.length < 2) return "—";
        return <Sparkline data={series.map((s) => ({ x: s.version_id, y: s.composite }))} />;
      },
    },
    {
      id: "open",
      header: "",
      size: 90,
      enableSorting: false,
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Link href={`/objects/${row.original.module}?run=${versionId}`} aria-label={`Open ${formatModuleName(row.original.module)}`} className="m-ink-accent">Open</Link>
        </span>
      ),
    },
  ];

  return (
    <ExplorerPage
      toolbarEnd={can("export") ? <ExportMenu options={[{ format: "xlsx", run: () => exportObjects(versionId, "xlsx") }]} /> : undefined}
      table={
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(o) => o.module}
          rowHref={(o) => `/objects/${o.module}?run=${versionId}`}
        />
      }
      state={asyncStateOf(objects, () => rows.length === 0, true)}
      emptyProps={{ title: "No objects scored", detail: "This run produced no object scores.", action: <Button onClick={onOpenSteps}>Open steps</Button> }}
      errorProps={{ message: errorText(objects.error), onRetry: () => objects.refetch() }}
    />
  );
}

type ModuleRow = FindingsAggregate["by_module"][number];

/** The run's objects as a ledger ranked by records affected, each with its blocking rule and one action. */
function RunLedger({ versionId, rows, objects }: { versionId: string; rows: ModuleRow[]; objects: Map<string, ObjectSummary> }) {
  const columns: ColumnDef<ModuleRow>[] = [
    {
      id: "module",
      header: "Object",
      accessorFn: (m) => formatModuleName(m.module),
      cell: ({ row }) => <DrillLink object={row.original.module} run={versionId}>{formatModuleName(row.original.module)}</DrillLink>,
    },
    {
      id: "score",
      header: "Score",
      accessorFn: (m) => objects.get(m.module)?.composite_score ?? -1,
      cell: ({ row }) => <Score value={objects.get(row.original.module)?.composite_score} size="sm" />,
    },
    {
      id: "rule",
      header: "Blocking rule",
      enableSorting: false,
      cell: ({ row }) => {
        const o = objects.get(row.original.module);
        return o?.blocking_rule_id ? (
          <span className="inline-flex min-w-0 items-baseline gap-2">
            <Mono>{o.blocking_rule_id}</Mono>
            {o.blocking_rule_name ? <span className="m-ink-2 truncate">{o.blocking_rule_name}</span> : null}
          </span>
        ) : <span className="m-ink-3">—</span>;
      },
    },
    {
      id: "critical", header: "Critical", accessorFn: (m) => m.critical, meta: { numeric: true } satisfies CellMeta, size: 90,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}&severity=critical`}>{row.original.critical.toLocaleString()}</DrillLink>,
    },
    {
      id: "high", header: "High", accessorFn: (m) => m.high, meta: { numeric: true } satisfies CellMeta, size: 80,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}&severity=high`}>{row.original.high.toLocaleString()}</DrillLink>,
    },
    {
      id: "records", header: "Records", accessorFn: (m) => m.affected ?? 0, meta: { numeric: true } satisfies CellMeta,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}`}>{(row.original.affected ?? 0).toLocaleString()}</DrillLink>,
    },
    {
      id: "open",
      header: "",
      size: 90,
      enableSorting: false,
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Link href={`/objects/${row.original.module}?run=${versionId}`} aria-label={`Open ${formatModuleName(row.original.module)}`} className="m-ink-accent">Open</Link>
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(m) => m.module}
      rowHref={(m) => `/objects/${m.module}?run=${versionId}`}
      hideSearch
      hideToolbar
      tableId="run-objects"
      exportName="run-objects"
    />
  );
}

function SummaryTab({
  versionId, aggregate, history, systemId, versionLoading, lineage,
}: {
  versionId: string; aggregate: UseQueryResult<FindingsAggregate>; history: History; systemId?: string; versionLoading: boolean;
  /** Scored runs of this run's lineage (uploads of the same objects), used for the composite line when there is no system history. */
  lineage: Version[];
}) {
  const router = useRouter();
  const prescriptive = useQuery({ queryKey: ["prescriptive", "next-actions", "all-systems"], queryFn: () => getPrescriptiveAnalytics({ limit: 5 }) });
  // Shared with the Objects tab: the score, blocking rule and readiness of each object.
  const objects = useQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  const objectByModule = new Map((objects.data?.objects ?? []).map((o) => [o.module, o]));

  if (aggregate.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="m-hero"><Skeleton height={168} /></div>
        <Skeleton height={240} />
      </div>
    );
  }
  if (aggregate.isError || !aggregate.data) {
    return <ErrorState message={errorText(aggregate.error)} onRetry={() => aggregate.refetch()} />;
  }

  const a = aggregate.data;
  if (a.total === 0) {
    return (
      <div>
        <EmptyState
          title="No findings in this run"
          detail="Open steps to see what ran."
          action={<Button render={<Link href={`/runs/${versionId}?tab=steps`}>Open steps</Link>} />}
        />
      </div>
    );
  }

  const composite = a.dqs.composite;
  const delta = composite != null && a.previous_dqs != null ? Math.round((composite - a.previous_dqs) * 10) / 10 : null;
  const blocking = a.severity.critical + a.severity.high;
  // A critical finding holds the score at the cap: the ruler draws the measured value beyond it.
  const raw = a.dqs.raw ?? composite;
  const capped = a.dqs.capped === true && composite != null && raw != null && raw > composite;

  // Only the dimensions this run measured: an unmeasured one is not a gap in the data.
  const dimensions = DIMENSIONS.filter((d) => a.dqs.dimension_scores[d.id] != null).map((d) => ({
    key: d.id,
    label: d.label,
    score: Math.round(a.dqs.dimension_scores[d.id] * 10) / 10,
    href: `/runs/${versionId}?tab=findings&dimension=${d.id}`,
  }));

  // The line is keyed by run id with the date as the tick (date and time when two runs share a day): a system's
  // score history, or for an upload the scored runs of the same objects.
  const historyRows = systemId != null
    ? [...(history.data?.history ?? [])].reverse().map((h) => ({ id: h.version_id, run_at: h.run_at, composite: h.at_the_time.composite }))
    : [...lineage].sort((a, b) => (a.run_at < b.run_at ? -1 : 1)).map((v) => ({ id: v.id, run_at: v.run_at, composite: overallDqs(v) }));
  const ticks = runAxisLabels(historyRows);
  const points = historyRows.flatMap((h) => (h.composite == null ? [] : [{ x: h.id, label: ticks.get(h.id), y: Math.round(h.composite * 10) / 10, runId: h.id }]));
  // Mark this run, and any run whose composite fell 5 points or more from the one before it.
  const annotations = points.flatMap((p, i): { x: string; label: string; kind: "event" | "change" }[] => {
    if (p.runId === versionId) return [{ x: p.x, label: "This run", kind: "event" as const }];
    return i > 0 && points[i - 1].y - p.y >= 5 ? [{ x: p.x, label: "Score fell", kind: "change" as const }] : [];
  });

  // Ranked by what moves the score: records affected, then critical and high findings.
  const ledgerRows = [...a.by_module].sort((x, y) => (y.affected ?? 0) - (x.affected ?? 0) || y.critical - x.critical || y.high - x.high);

  const presentModules = new Set(a.by_module.map((m) => m.module));
  const next = (prescriptive.data?.actions ?? []).filter((act) => !act.module || presentModules.has(act.module)).slice(0, 5).map((act) => ({
    id: act.id,
    title: act.title,
    impact: [`${act.affected_count.toLocaleString()} records`, `${act.impact_points.toLocaleString()} impact points`],
    verb: act.type === "finding" ? "Open finding" : act.type === "cleaning" ? "Open cleaning" : "Open exception",
    href: act.type === "finding" ? `/runs/${versionId}?tab=findings${act.module ? `&module=${act.module}` : ""}` : "/inbox",
    why: `Ranked by impact points per hour of effort (${act.value_per_hour.toFixed(1)}), ${act.severity} severity.`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <section className="m-hero grid gap-6 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" aria-label="Score">
        <div className="flex min-w-0 flex-col gap-4">
          <Score
            size="hero"
            value={raw}
            cap={capped ? composite ?? undefined : undefined}
            criticals={a.severity.critical}
            versionId={versionId}
            delta={delta != null ? <Delta value={delta} run="previous run" /> : undefined}
            href={`/runs/${versionId}?tab=findings`}
          />
          <div className="m-stat-grid">
            <Stat label="Blocking findings" value={blocking.toLocaleString()} tone={blocking > 0 ? "no-go" : undefined} href={`/runs/${versionId}?tab=findings&severity=critical`} />
            <Stat label="Affected records" value={a.affected_records.toLocaleString()} href={`/runs/${versionId}?tab=findings`} />
            {a.cost_at_risk != null ? (
              <Stat label="Cost at risk" value={a.cost_at_risk.toLocaleString()} href={`/runs/${versionId}?tab=findings`} />
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="font-semibold m-text-h">Score by dimension</h2>
          <DimensionBars items={dimensions} label="Score by dimension" />
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold m-text-h">Objects in this run</h2>
        <RunLedger versionId={versionId} rows={ledgerRows} objects={objectByModule} />
      </section>
      <section className={clsx("flex flex-col gap-2", prescriptive.isLoading && "[min-height:124px]")} data-testid="next-actions-slot">
        <h2 className="font-semibold m-text-h">Next actions</h2>
        {prescriptive.isLoading ? (
          <Skeleton height={96} />
        ) : next.length > 0 ? (
          <NextActions actions={next} />
        ) : (
          <p className="text-sm m-ink-3">No next actions for this run</p>
        )}
      </section>
      <Card title="Composite over runs">
        {versionLoading || (systemId != null && history.isLoading) ? (
          <Skeleton height={160} />
        ) : points.length <= 1 ? (
          <EmptyState
            variant="inline"
            title="Only one run so far"
            detail={systemId ? "Scores over time appear after a second run of this system." : "Scores over time appear after a second upload of the same objects."}
            action={<Button render={<Link href={systemId ? `/systems/${systemId}` : "/import"}>{systemId ? "Run analysis" : "Import file"}</Link>} />}
          />
        ) : (
          <Line data={points} label="Composite over runs" height={160} annotations={annotations} onPointClick={(p) => { if (p.runId) router.push(runPageHref(p.runId)); }} />
        )}
      </Card>
    </div>
  );
}

const findingsKey = (versionId: string, severity: string, dimension: string, moduleFilter: string, page: number) =>
  [...queryKeys.run(versionId), "findings", severity, dimension, moduleFilter, page] as const;

const findingsFetch = (versionId: string, severity: string, dimension: string, moduleFilter: string, page: number) =>
  getFindings({
    version_id: versionId,
    severity: severity || undefined,
    dimension: dimension || undefined,
    module: moduleFilter || undefined,
    sort: "severity",
    limit: FINDINGS_PAGE,
    offset: (page - 1) * FINDINGS_PAGE,
  });

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      className="inline-flex items-center gap-1 rounded px-2 py-1 m-motion-colors [background:var(--m-accent-soft)]! m-ink-accent [font-size:var(--m-text-meta)]!"
    >
      {label}
      <span aria-hidden>×</span>
    </button>
  );
}

function FindingsTab({ versionId, onOpenSteps }: { versionId: string; onOpenSteps: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useRole();
  const severity = searchParams.get("severity") ?? "";
  const dimension = searchParams.get("dimension") ?? "";
  const moduleFilter = searchParams.get("module") ?? "";
  const findingId = searchParams.get("finding");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const push = (params: URLSearchParams) => router.push(`/runs/${versionId}?${params.toString()}`);
  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete("page");
    push(params);
  };
  const setPage = (n: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (n > 1) params.set("page", String(n)); else params.delete("page");
    push(params);
  };
  const openFinding = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("finding", id); else params.delete("finding");
    push(params);
  };
  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    ["severity", "dimension", "module", "page"].forEach((k) => params.delete(k));
    push(params);
  };

  const filters = {
    version_id: versionId,
    severity: severity || undefined,
    dimension: dimension || undefined,
    module: moduleFilter || undefined,
  };
  const findings = useQuery({
    queryKey: findingsKey(versionId, severity, dimension, moduleFilter, page),
    queryFn: () => findingsFetch(versionId, severity, dimension, moduleFilter, page),
    placeholderData: (prev) => prev,
  });
  const rows = findings.data?.findings ?? [];
  const total = findings.data?.total ?? rows.length;
  const filtered = Boolean(severity || dimension || moduleFilter);

  const columns: ColumnDef<Finding>[] = [
    {
      id: "severity",
      header: "Severity",
      accessorFn: (f) => f.severity,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          {isSeverity(row.original.severity) ? <SeverityDot severity={row.original.severity} /> : null}
          {labelOf(row.original.severity)}
        </span>
      ),
    },
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Object", accessorFn: (f) => formatModuleName(f.module) },
    { id: "dimension", header: "Dimension", accessorFn: (f) => labelOf(f.dimension) },
    {
      id: "affected",
      header: "Records",
      accessorFn: (f) => f.affected_count,
      cell: ({ row }) => (
        <DrillLink href={`/objects/${row.original.module}?run=${versionId}&tab=records&check_id=${row.original.check_id}`}>
          {row.original.affected_count.toLocaleString()} of {row.original.total_count.toLocaleString()}
        </DrillLink>
      ),
    },
    { id: "message", header: "Message", accessorFn: (f) => f.details.message ?? "—", cell: ({ row }) => <span className="block max-w-[360px] truncate">{row.original.details.message ?? "—"}</span> },
  ];

  return (
    <ExplorerPage
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Severity" value={severity} onValueChange={(v) => setFilter("severity", v)} options={SEVERITY_OPTIONS} placeholder="Severity" />
          <Select label="Dimension" value={dimension} onValueChange={(v) => setFilter("dimension", v)} options={DIMENSION_OPTIONS} placeholder="Dimension" />
          {severity ? <FilterChip label={`Severity: ${labelOf(severity)}`} onRemove={() => setFilter("severity", "")} /> : null}
          {dimension ? <FilterChip label={`Dimension: ${DIMENSIONS.find((d) => d.id === dimension)?.label ?? labelOf(dimension)}`} onRemove={() => setFilter("dimension", "")} /> : null}
          {moduleFilter ? <FilterChip label={`Object: ${formatModuleName(moduleFilter)}`} onRemove={() => setFilter("module", "")} /> : null}
        </div>
      }
      toolbarEnd={
        can("export") ? (
          <ExportMenu options={[{ format: "xlsx", run: () => exportFindings("xlsx", filters) }]} />
        ) : undefined
      }
      table={
        <div className="flex flex-col gap-2">
          <DataTable columns={columns} data={rows} getRowId={(f) => f.id} onRowClick={(f) => openFinding(f.id)} dataTour="finding-rows" />
          <div className="[min-height:var(--m-control-h)]">
            {total > FINDINGS_PAGE ? (
              <Pager page={page} pageCount={Math.ceil(total / FINDINGS_PAGE)} onPageChange={setPage} pageSize={FINDINGS_PAGE} total={total} />
            ) : null}
          </div>
        </div>
      }
      state={asyncStateOf(findings, () => rows.length === 0, true)}
      emptyProps={
        filtered
          ? { title: "No findings match", detail: "Try removing a filter.", action: <Button onClick={clearFilters}>Clear filters</Button> }
          : { title: "No findings in this run", detail: "Open steps to see what ran.", action: <Button onClick={onOpenSteps}>Open steps</Button> }
      }
      errorProps={{ message: errorText(findings.error), onRetry: () => findings.refetch() }}
      drawer={<FindingDrawer findingId={findingId} versionId={versionId} onClose={() => openFinding(null)} />}
    />
  );
}

export default function RunDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { can } = useRole();
  // "summary" is the pre-18a name of the first tab; keep old deep links working.
  const rawTab = searchParams.get("tab") ?? "overview";
  const tab = rawTab === "summary" ? "overview" : rawTab;

  // Everything keyed by the URL id starts on mount, in parallel.
  const version = useQuery({ queryKey: queryKeys.run(versionId), queryFn: () => getVersion(versionId) });
  const analysisStatus = useQuery({
    queryKey: [...queryKeys.run(versionId), "status"],
    queryFn: () => getAnalysisStatus(versionId),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "queued" || q.state.data?.status === "processing" ? 2500 : false),
  });
  const steps = useQuery({ queryKey: [...queryKeys.run(versionId), "steps"], queryFn: () => getRunSteps(versionId) });
  const aggregate = useQuery({ queryKey: queryKeys.findingsAggregate(versionId), queryFn: () => getFindingsAggregate(versionId) });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  useEffect(() => {
    void qc.prefetchQuery({ queryKey: findingsKey(versionId, "", "", "", 1), queryFn: () => findingsFetch(versionId, "", "", "", 1) });
  }, [qc, versionId]);
  const warmObjects = () => void qc.prefetchQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  const onTabsHover = (e: { target: EventTarget }) => {
    if ((e.target as HTMLElement).closest('[role="tab"]')?.textContent === "Objects") warmObjects();
  };
  // Only the system id comes from the version; these two wait for it and render skeletons meanwhile.
  const systemId = version.data?.metadata?.system_id;
  const scope = useQuery({
    queryKey: queryKeys.versionsList({ system_id: systemId }),
    queryFn: () => getVersions({ ...(systemId ? { system_id: systemId } : {}), limit: 100 }),
    enabled: version.isSuccess,
  });
  const history = useQuery({
    queryKey: queryKeys.scoreHistory(systemId),
    queryFn: () => getScoreHistory({ system_id: systemId, limit: 20 }),
    enabled: systemId != null,
  });

  const isBaseline = version.data?.metadata?.baseline === true;
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const rename = useMutation({
    mutationFn: () => patchVersionLabel(versionId, draftLabel.trim()),
    onSuccess: (next) => {
      qc.setQueryData<Version>(queryKeys.run(versionId), (prev) => (prev ? { ...prev, label: next.label } : prev));
      qc.invalidateQueries({ queryKey: queryKeys.run("list") });
      qc.invalidateQueries({ queryKey: ["versions-list"] });
      setRenameOpen(false);
      toast.success("Run renamed");
    },
    onError: (e: Error) => toast.error(errorText(e)),
  });
  const openRename = () => { setDraftLabel(version.data?.label ?? ""); setRenameOpen(true); };
  const running = analysisStatus.data?.status === "queued" || analysisStatus.data?.status === "processing";
  const rerun = useMutation({
    mutationFn: () => analyseVersion(versionId),
    onSuccess: () => {
      toast.success("Re-analysis started. Progress shows above.");
      void qc.invalidateQueries({ queryKey: [...queryKeys.run(versionId), "status"] });
      void qc.invalidateQueries({ queryKey: queryKeys.run(versionId), exact: true });
    },
    onError: (e: Error) => toast.error(errorText(e)),
  });
  const pin = useMutation({
    mutationFn: () => pinBaseline(versionId, !isBaseline),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.run(versionId), exact: true });
      const prev = qc.getQueryData<Version>(queryKeys.run(versionId));
      if (prev?.metadata) qc.setQueryData<Version>(queryKeys.run(versionId), { ...prev, metadata: { ...prev.metadata, baseline: !isBaseline } });
      return { prev };
    },
    onSuccess: (r) => {
      // The optimistic update has already flipped isBaseline; trust the server's answer.
      toast.success(r.baseline ? "Pinned as baseline" : "Baseline unpinned");
      qc.invalidateQueries({ queryKey: queryKeys.run("list") });
      qc.invalidateQueries({ queryKey: ["versions-list"] });
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.run(versionId), ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.run(versionId), exact: true }),
  });

  if (version.isError) {
    if (isAxiosError(version.error) && version.error.response?.status === 404) {
      return (
        <EmptyState
          title="Run not found"
          detail="It may have been archived."
          action={<Button render={<Link href="/runs">All runs</Link>} />}
        />
      );
    }
    return <ErrorState message={errorText(version.error)} onRetry={() => version.refetch()} />;
  }

  const v = version.data;
  const runs = scope.data?.versions ?? [];
  const prevId = v ? previousRunId(v, runs) : null;
  // The other runs of this run's lineage, to switch to from the header; "Back to latest" when this is an older one.
  const choices = v ? lineageChoices(v, runs) : [];
  const latestOfLineage = latestFinishedRun(choices);
  const runScope = { run: v, choices, latestId: latestOfLineage?.id, pinned: !!v && !!latestOfLineage && latestOfLineage.id !== v.id };
  const baseId = v ? baselineRunId(v, runs) : null;
  const stepRows = steps.data?.steps ?? [];
  const systemName = systems.data?.find((s) => s.id === systemId)?.name;
  const totalMs = stepRows.reduce((n, s) => n + (s.duration_ms ?? 0), 0);
  const duration = totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : null;

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.push(`/runs/${versionId}?${params.toString()}`);
  };
  const openSteps = () => setTab("steps");

  const exportOptions = [
    { format: "xlsx" as const, run: () => exportRunSteps(versionId, "xlsx") },
    {
      format: "pdf" as const,
      label: "Analysis report (PDF)",
      run: () => downloadAuthenticated(getAnalysisReportUrl(versionId), `meridian-analysis-${v?.label ?? versionId}.pdf`),
    },
    ...(v?.status === "ai_enriched"
      ? [
          {
            format: "pdf" as const,
            label: "Narrative report (PDF)",
            run: () => downloadAuthenticated(getReportDownloadUrl(versionId), `meridian-narrative-${v?.label ?? versionId}.pdf`),
          },
        ]
      : []),
  ];

  const header = v ? (
    <PageHeader
      title={v.label ?? formatDate(v.run_at, "datetime")}
      meta={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{["Started " + formatDate(v.run_at, "datetime"), systemName, duration].filter(Boolean).join(", ")}</span>
          {(choices.length > 1 || runScope.pinned) && (
            <RunScope scope={runScope} picker hrefFor={(id) => runPageHref(id ?? latestOfLineage?.id ?? versionId)} />
          )}
        </span>
      }
      status={
        <>
          <Status kind="lifecycle" value={v.status} />
          {isBaseline ? <Pill>Baseline</Pill> : null}
        </>
      }
      actions={
        <>
          {prevId ? (
            <Tooltip label="What changed since the run before this one" render={<Button variant="secondary" render={<Link href={`/runs/${versionId}/vs/${prevId}`} />} />}>
              Compare with previous
            </Tooltip>
          ) : null}
          {baseId ? (
            <Tooltip label="What changed since the pinned baseline run" render={<Button variant="secondary" render={<Link href={`/runs/${versionId}/vs/baseline`} />} />}>
              Compare with baseline
            </Tooltip>
          ) : null}
          {can("analyse") ? (
            <>
              <Tooltip label="Give this run a name you will recognise in lists and comparisons" render={<Button variant="ghost" onClick={openRename} />}>
                Rename
              </Tooltip>
              <Tooltip
                label={isBaseline ? "Stop comparing later runs in this system with this run" : "Later runs in this system are compared with this run on the Monitor tab"}
                render={<Button variant="ghost" onClick={() => pin.mutate()} pending={pin.isPending} />}
              >
                {isBaseline ? "Unpin baseline" : "Pin as baseline"}
              </Tooltip>
              <Tooltip
                label={running ? "Analysis is already running" : "Re-check this run's stored data with the current rules. Findings are replaced; the name, baseline and history stay."}
                maxWidth={280}
                render={<Button variant="ghost" onClick={() => rerun.mutate()} pending={rerun.isPending} disabled={running} />}
              >
                Re-run analysis
              </Tooltip>
            </>
          ) : null}
          {can("export") ? <ExportMenu options={exportOptions} /> : null}
        </>
      }
    />
  ) : (
    <Skeleton height={48} />
  );

  return (
    <div className="flex flex-col gap-4">
      <Dialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename run"
        footer={
          <>
            <Button variant="secondary" disabled={rename.isPending} onClick={() => setRenameOpen(false)}>Keep</Button>
            <Button pending={rename.isPending} disabled={!draftLabel.trim()} onClick={() => rename.mutate()}>Save name</Button>
          </>
        }
      >
        <Field label="Name">
          <Input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} autoFocus placeholder={v ? formatDate(v.run_at, "datetime") : undefined}
            onKeyDown={(e) => { if (e.key === "Enter" && draftLabel.trim() && !rename.isPending) rename.mutate(); }} />
        </Field>
      </Dialog>
      <div>{header}</div>
      {analysisStatus.data?.status === "queued" || analysisStatus.data?.status === "processing" ? (
        <RunProgressBanner
          percent={analysisStatus.data.progress.percent_complete}
          label={analysisStatus.data.status === "queued" ? "Analysis queued" : "Analysis running"}
          step={analysisStatus.data.progress.current_step}
          detail={
            analysisStatus.data.progress.total_rows > 0
              ? `${analysisStatus.data.progress.rows_processed.toLocaleString()} / ${analysisStatus.data.progress.total_rows.toLocaleString()} rows`
              : undefined
          }
        />
      ) : null}
      <div onPointerOver={onTabsHover} onFocus={onTabsHover}>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "overview", label: "Overview", content: <SummaryTab versionId={versionId} aggregate={aggregate} history={history} systemId={systemId} versionLoading={version.isLoading} lineage={v ? runs.filter((r) => lineageOf(r) === lineageOf(v) && isFinished(r)) : []} /> },
          { value: "objects", label: "Objects", content: <ObjectsTab versionId={versionId} history={history} onOpenSteps={openSteps} /> },
          { value: "findings", label: "Findings", content: <FindingsTab versionId={versionId} onOpenSteps={openSteps} /> },
          {
            value: "steps",
            label: "Steps",
            content: (
              <ExplorerPage
                table={
                  <DataTable
                    columns={stepColumns}
                    data={stepRows}
                    getRowId={(s) => String(s.step_number)}
                    renderDrawer={(s) => (
                      <div className="flex flex-col gap-2 p-4">
                        <h2 className="font-semibold m-text-h">{s.step_name}</h2>
                        <Status kind="lifecycle" value={s.status} />
                        <p className="m-ink-2">{s.error_detail ?? "No error recorded"}</p>
                      </div>
                    )}
                  />
                }
                state={asyncStateOf(steps, () => stepRows.length === 0, true)}
                emptyProps={{
                  title: "No steps recorded",
                  detail: "This run has no step history.",
                  action: can("analyse") ? <Button onClick={() => rerun.mutate()} pending={rerun.isPending} disabled={running}>Re-run analysis</Button> : undefined,
                }}
                errorProps={{ message: errorText(steps.error), onRetry: () => steps.refetch() }}
              />
            ),
          },
          { value: "config", label: "Configuration", content: <ConfigMatchesTab versionId={versionId} /> },
          ...entityTabs({ entityType: "versions", entityId: versionId, skip: ["overview", "related", "history"] }),
        ]}
      />
      </div>
    </div>
  );
}

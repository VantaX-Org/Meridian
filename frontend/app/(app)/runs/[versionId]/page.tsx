// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Bar, Button, Card, DataTable, Delta, Dialog, EmptyState, ErrorState, ExplorerPage, ExportMenu, Field, FindingDrawer, Heatmap, Input, Line, Mono, Pager, Pill, Tooltip,
  DrillLink, Select, SeverityDot, Skeleton, Sparkline, Stat, Tabs, isSeverity, type PillTone, type HeatmapCell,
  entityTabs, NextActions,
  PageHeader,
} from "@/design";
import { DqsScore } from "@/components/insight/dqs-score";
import { getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { useRole } from "@/hooks/use-role";
import { downloadAuthenticated } from "@/lib/api/download";
import { isListFailure } from "@/lib/error";
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

const STATUS_TONE: Record<string, PillTone> = {
  failed: "no-go",
  agents_failed: "no-go",
  complete: "go",
  agents_complete: "go",
  ai_enriched: "go",
};

const statusTone = (status: string): PillTone => STATUS_TONE[status] ?? "at-risk";

const READINESS_TONE: Record<string, PillTone> = { pass: "go", warn: "at-risk", fail: "no-go" };

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
    cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill>,
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
const sectionTitle = { fontSize: "var(--m-text-section)", lineHeight: "var(--m-leading-section)" } as const;

function ObjectsTab({ versionId, history, onOpenSteps }: { versionId: string; history: History; onOpenSteps: () => void }) {
  const { can } = useRole();
  const objects = useQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  const rows = objects.data?.objects ?? [];
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
        row.original.readiness ? <Pill tone={READINESS_TONE[row.original.readiness] ?? "neutral"}>{labelOf(row.original.readiness)}</Pill> : "—",
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
      state={objects.isLoading ? "loading" : isListFailure(objects) ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No objects scored", detail: "This run produced no object scores.", action: <Button onClick={onOpenSteps}>Open steps</Button> }}
      errorProps={{ message: errorText(objects.error), onRetry: () => objects.refetch() }}
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

  if (aggregate.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="flex flex-wrap items-center gap-8">
          {[0, 1, 2, 3].map((i) => <Stat key={i} label="" value="" loading />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Score by dimension"><Skeleton height={240} /></Card>
          <Card title="Where findings concentrate"><Skeleton height={240} /></Card>
        </div>
        <Card title="Composite over runs"><Skeleton height={240} /></Card>
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

  const dimensionData = Object.entries(a.dqs.dimension_scores).map(([dimension, score]) => ({
    x: DIMENSIONS.find((d) => d.id === dimension)?.label ?? formatModuleName(dimension),
    y: Math.round(score * 10) / 10,
    dimension,
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

  const severities = ["critical", "high", "medium", "low"] as const;
  const moduleByLabel = new Map(a.by_module.map((m) => [formatModuleName(m.module), m.module]));
  // Each cell prints its finding count; the tint repeats the severity so colour is never the only signal.
  const heatCells: HeatmapCell[] = a.by_module.flatMap((m) =>
    severities.map((sev): HeatmapCell => ({ row: formatModuleName(m.module), col: labelOf(sev), value: m[sev] })),
  );
  const heatTone = (cell: HeatmapCell) => {
    const sev = severities.find((s) => labelOf(s) === cell.col);
    return cell.value === 0 ? "go" as const : sev === "critical" || sev === "high" ? "no-go" as const : "at-risk" as const;
  };

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
      <div className="flex flex-wrap items-center gap-8">
        <div className="flex items-center gap-2">
          <DqsScore agg={a} versionId={versionId} />
          {delta != null ? <Delta value={delta} run="previous run" /> : null}
        </div>
        <Stat label="Blocking findings" value={blocking.toLocaleString()} tone={blocking > 0 ? "no-go" : undefined} href={`/runs/${versionId}?tab=findings&severity=critical`} />
        <Stat label="Affected records" value={a.affected_records.toLocaleString()} href={`/runs/${versionId}?tab=findings`} />
        {a.cost_at_risk != null ? (
          <Stat label="Cost at risk" value={a.cost_at_risk.toLocaleString()} href={`/runs/${versionId}?tab=findings`} />
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Score by dimension">
          <Bar data={dimensionData} onPointClick={(p) => router.push(`/runs/${versionId}?tab=findings&dimension=${p.dimension ?? ""}`)} />
        </Card>
        <Card title="Where findings concentrate">
          <Heatmap
            rows={a.by_module.map((m) => formatModuleName(m.module))}
            cols={severities.map(labelOf)}
            cells={heatCells}
            tone={heatTone}
            cellSize={40}
            onPointClick={(c) => router.push(`/runs/${versionId}?tab=findings&module=${moduleByLabel.get(c.row) ?? ""}&severity=${c.col.toLowerCase()}`)}
          />
        </Card>
      </div>
      <section className="flex flex-col gap-2" data-testid="next-actions-slot" style={{ minHeight: prescriptive.isLoading ? 96 + 28 : undefined }}>
        <h2 className="font-semibold" style={sectionTitle}>Next actions</h2>
        {prescriptive.isLoading ? (
          <Skeleton height={96} />
        ) : next.length > 0 ? (
          <NextActions actions={next} />
        ) : (
          <p className="text-sm" style={{ color: "var(--m-ink-muted)" }}>No next actions for this run</p>
        )}
      </section>
      <Card title="Composite over runs">
        {versionLoading || (systemId != null && history.isLoading) ? (
          <Skeleton height={240} />
        ) : points.length <= 1 ? (
          <EmptyState
            title="Only one run so far"
            detail={systemId ? "Scores over time appear after a second run of this system." : "Scores over time appear after a second upload of the same objects."}
            action={<Button render={<Link href={systemId ? `/systems/${systemId}` : "/import"}>{systemId ? "Run analysis" : "Import file"}</Link>} />}
          />
        ) : (
          <Line data={points} label="Composite over runs" annotations={annotations} onPointClick={(p) => { if (p.runId) router.push(runPageHref(p.runId)); }} />
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
      className="inline-flex items-center gap-1 rounded px-2 py-1 m-motion-colors"
      style={{ background: "var(--m-accent-soft)", color: "var(--m-accent)", fontSize: "var(--m-text-meta)" }}
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
          <div style={{ minHeight: "var(--m-control-h)" }}>
            {total > FINDINGS_PAGE ? (
              <Pager page={page} pageCount={Math.ceil(total / FINDINGS_PAGE)} onPageChange={setPage} pageSize={FINDINGS_PAGE} total={total} />
            ) : null}
          </div>
        </div>
      }
      state={findings.isLoading ? "loading" : isListFailure(findings) ? "error" : rows.length === 0 ? "empty" : undefined}
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
          <Pill tone={statusTone(v.status)}>{labelOf(v.status)}</Pill>
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
                        <h2 className="font-semibold" style={sectionTitle}>{s.step_name}</h2>
                        <Pill tone={statusTone(s.status)}>{labelOf(s.status)}</Pill>
                        <p style={{ color: "var(--m-ink-2)" }}>{s.error_detail ?? "No error recorded"}</p>
                      </div>
                    )}
                  />
                }
                state={steps.isLoading ? "loading" : isListFailure(steps) ? "error" : stepRows.length === 0 ? "empty" : undefined}
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

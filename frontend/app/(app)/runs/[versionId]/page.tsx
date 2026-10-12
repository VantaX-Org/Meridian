// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Bar, Button, Card, DataTable, Delta, EmptyState, ErrorState, ExplorerPage, ExportMenu, FindingDrawer, Heatmap, Line, Mono, Pager, Pill,
  DrillLink, Select, SeverityDot, Skeleton, Sparkline, Stat, Tabs, isSeverity, type PillTone, type HeatmapCell,
  entityTabs, NextActions,
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
import { getVersion, getVersions, pinBaseline } from "@/lib/api/versions";
import { DIMENSIONS, formatDate, formatModuleName, labelOf } from "@/lib/format";
import { ConfigMatchesTab } from "./config-matches-tab";
import { RunsPageHeader, RunsPageHeaderSkeleton } from "../_page-header";
import { queryKeys } from "@/lib/query-keys";
import { baselineRunId, previousRunId } from "@/lib/runs";
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
const pad = { padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" } as const;
const sectionTitle = { fontSize: "var(--m-text-section)", lineHeight: "var(--m-leading-section)" } as const;

function ObjectsTab({ versionId, history, onOpenSteps }: { versionId: string; history: History; onOpenSteps: () => void }) {
  const router = useRouter();
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
          onRowClick={(o) => router.push(`/objects/${o.module}?run=${versionId}`)}
        />
      }
      state={objects.isLoading ? "loading" : isListFailure(objects) ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No objects scored", detail: "This run produced no object scores.", action: <Button variant="secondary" onClick={onOpenSteps}>Open steps</Button> }}
      errorProps={{ message: errorText(objects.error), onRetry: () => objects.refetch() }}
    />
  );
}

function SummaryTab({
  versionId, aggregate, history, systemId,
}: { versionId: string; aggregate: UseQueryResult<FindingsAggregate>; history: History; systemId?: string }) {
  const router = useRouter();
  const prescriptive = useQuery({ queryKey: ["prescriptive", "next-actions", "all-systems"], queryFn: () => getPrescriptiveAnalytics({ limit: 5 }) });

  if (aggregate.isLoading) {
    return (
      <div className="flex flex-col gap-4" style={pad} aria-busy="true">
        <div className="flex gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} width={160} height={88} />)}</div>
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
      <div style={pad}>
        <EmptyState
          title="No findings in this run"
          detail="Open steps to see what ran."
          action={<Button variant="secondary" render={<Link href={`/runs/${versionId}?tab=steps`}>Open steps</Link>} />}
        />
      </div>
    );
  }

  const composite = a.dqs.composite;
  const delta = composite != null && a.previous_dqs != null ? Math.round((composite - a.previous_dqs) * 10) / 10 : null;
  const blocking = a.severity.critical + a.severity.high;
  const currency = prescriptive.data?.actions[0]?.currency;

  const dimensionData = Object.entries(a.dqs.dimension_scores).map(([dimension, score]) => ({
    x: DIMENSIONS.find((d) => d.id === dimension)?.label ?? formatModuleName(dimension),
    y: Math.round(score * 10) / 10,
    dimension,
  }));

  const historyRows = [...(history.data?.history ?? [])].reverse();
  const points = historyRows.map((h) => ({ x: formatDate(h.run_at, "date"), y: h.at_the_time.composite ?? 0, runId: h.version_id }));
  // Mark this run, and any run whose composite fell 5 points or more from the one before it.
  const annotations = points.flatMap((p, i): { x: string; label: string; kind: "event" | "change" }[] => {
    if (p.runId === versionId) return [{ x: p.x, label: "This run", kind: "event" as const }];
    return i > 0 && points[i - 1].y - p.y >= 5 ? [{ x: p.x, label: "Score fell", kind: "change" as const }] : [];
  });

  const severities = ["critical", "high", "medium", "low"] as const;
  const moduleByLabel = new Map(a.by_module.map((m) => [formatModuleName(m.module), m.module]));
  const heatCells: HeatmapCell[] = a.by_module.flatMap((m) =>
    severities.map((sev): HeatmapCell => ({
      row: formatModuleName(m.module),
      col: labelOf(sev),
      value: m[sev] === 0 ? "go" : sev === "critical" ? "no-go" : "at-risk",
    })),
  );

  const next = (prescriptive.data?.actions ?? []).slice(0, 5).map((act) => ({
    id: act.id,
    title: act.title,
    impact: [`${act.affected_count.toLocaleString()} records`, `${act.impact_points.toLocaleString()} impact points`],
    verb: act.type === "finding" ? "Open finding" : act.type === "cleaning" ? "Open cleaning" : "Open exception",
    href: act.type === "finding" ? `/runs/${versionId}?tab=findings${act.module ? `&module=${act.module}` : ""}` : "/inbox",
    why: `Ranked by impact points per hour of effort (${act.value_per_hour.toFixed(1)}), ${act.severity} severity.`,
  }));

  return (
    <div className="flex flex-col gap-6" style={pad}>
      <div className="flex flex-wrap items-center gap-8">
        <div className="flex items-center gap-2">
          <DqsScore agg={a} versionId={versionId} />
          {delta != null ? <Delta value={delta} run="previous run" /> : null}
        </div>
        <Stat label="Blocking findings" value={blocking.toLocaleString()} tone={blocking > 0 ? "no-go" : undefined} href={`/runs/${versionId}?tab=findings&severity=critical`} />
        <Stat label="Affected records" value={a.affected_records.toLocaleString()} href={`/runs/${versionId}?tab=findings`} />
        {a.cost_at_risk != null ? (
          <Stat label={currency ? `Cost at risk (${currency})` : "Cost at risk"} value={a.cost_at_risk.toLocaleString()} href={`/runs/${versionId}?tab=findings`} />
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
            onPointClick={(c) => router.push(`/runs/${versionId}?tab=findings&module=${moduleByLabel.get(c.row) ?? ""}&severity=${c.col.toLowerCase()}`)}
          />
        </Card>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold" style={sectionTitle}>Next actions</h2>
        {prescriptive.isLoading ? <Skeleton height={96} /> : <NextActions actions={next} />}
      </section>
      <Card title="Composite over runs">
        {systemId == null || history.isLoading ? (
          <Skeleton height={240} />
        ) : historyRows.length <= 1 ? (
          <EmptyState
            title="Only one run so far"
            detail="Scores over time appear after a second run."
            action={<Button variant="secondary" render={<Link href={`/systems/${systemId}`}>Run analysis</Link>} />}
          />
        ) : (
          <Line data={points} annotations={annotations} onPointClick={(p) => p.runId && router.push(`/runs/${p.runId}`)} />
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
          {moduleFilter ? (
            <button
              type="button"
              onClick={() => setFilter("module", "")}
              aria-label={`Remove filter ${formatModuleName(moduleFilter)}`}
              className="inline-flex items-center gap-1 rounded px-2 py-1 m-motion-colors"
              style={{ background: "var(--m-accent-soft)", color: "var(--m-accent)", fontSize: "var(--m-text-meta)" }}
            >
              {formatModuleName(moduleFilter)}
              <span aria-hidden>×</span>
            </button>
          ) : null}
        </div>
      }
      toolbarEnd={
        can("export") ? (
          <ExportMenu options={[{ format: "xlsx", run: () => exportFindings("xlsx", filters) }]} />
        ) : undefined
      }
      table={
        <div className="flex flex-col gap-2">
          <DataTable columns={columns} data={rows} getRowId={(f) => f.id} onRowClick={(f) => openFinding(f.id)} />
          {total > FINDINGS_PAGE ? (
            <Pager page={page} pageCount={Math.ceil(total / FINDINGS_PAGE)} onPageChange={setPage} pageSize={FINDINGS_PAGE} total={total} />
          ) : null}
        </div>
      }
      state={findings.isLoading ? "loading" : isListFailure(findings) ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={
        filtered
          ? { title: "No findings match", detail: "Try removing a filter.", action: <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> }
          : { title: "No findings in this run", detail: "Open steps to see what ran.", action: <Button variant="secondary" onClick={onOpenSteps}>Open steps</Button> }
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
  const steps = useQuery({ queryKey: [...queryKeys.run(versionId), "steps"], queryFn: () => getRunSteps(versionId) });
  const aggregate = useQuery({ queryKey: queryKeys.findingsAggregate(versionId), queryFn: () => getFindingsAggregate(versionId) });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  useEffect(() => {
    void qc.prefetchQuery({ queryKey: findingsKey(versionId, "", "", "", 1), queryFn: () => findingsFetch(versionId, "", "", "", 1) });
    void qc.prefetchQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  }, [qc, versionId]);
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
  const pin = useMutation({
    mutationFn: () => pinBaseline(versionId, !isBaseline),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.run(versionId), exact: true });
      const prev = qc.getQueryData<Version>(queryKeys.run(versionId));
      if (prev?.metadata) qc.setQueryData<Version>(queryKeys.run(versionId), { ...prev, metadata: { ...prev.metadata, baseline: !isBaseline } });
      return { prev };
    },
    onSuccess: () => {
      toast.success(isBaseline ? "Baseline unpinned" : "Pinned as baseline");
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
    <RunsPageHeader
      title={v.label ?? formatDate(v.run_at, "datetime")}
      meta={["Started " + formatDate(v.run_at, "datetime"), systemName, duration].filter(Boolean).join(", ")}
      status={
        <>
          <Pill tone={statusTone(v.status)}>{labelOf(v.status)}</Pill>
          {isBaseline ? <Pill>Baseline</Pill> : null}
        </>
      }
      actions={
        <>
          {prevId ? <Button variant="secondary" render={<Link href={`/runs/${versionId}/vs/${prevId}`}>Compare with previous</Link>} /> : null}
          {baseId ? <Button variant="secondary" render={<Link href={`/runs/${versionId}/vs/baseline`}>Compare with baseline</Link>} /> : null}
          {can("analyse") ? (
            <Button variant="ghost" onClick={() => pin.mutate()}>
              {isBaseline ? "Unpin baseline" : "Pin as baseline"}
            </Button>
          ) : null}
          {can("export") ? <ExportMenu options={exportOptions} /> : null}
        </>
      }
    />
  ) : (
    <RunsPageHeaderSkeleton />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto w-full" style={{ ...pad, paddingBottom: 0 }}>{header}</div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "overview", label: "Overview", content: <SummaryTab versionId={versionId} aggregate={aggregate} history={history} systemId={systemId} /> },
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
                  action: <Button variant="secondary" render={<Link href={systemId ? `/systems/${systemId}` : "/systems"}>Re-run analysis</Link>} />,
                }}
                errorProps={{ message: errorText(steps.error), onRetry: () => steps.refetch() }}
              />
            ),
          },
          { value: "config", label: "Configuration", content: <ConfigMatchesTab versionId={versionId} /> },
          ...entityTabs({ entityType: "versions", entityId: versionId, skip: ["overview", "related", "history", "export"] }),
        ]}
      />
    </div>
  );
}

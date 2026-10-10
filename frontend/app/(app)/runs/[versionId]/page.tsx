// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Bar, Button, DataTable, EmptyState, ErrorState, ExplorerPage, ExportMenu, FindingDrawer, Line, Pill, ReportPage,
  Select, SeverityDot, Skeleton, Stat, Tabs, isSeverity, type PillTone,
} from "@/design";
import { useRole } from "@/hooks/use-role";
import { downloadAuthenticated } from "@/lib/api/download";
import { exportFindings, getFindings, getFindingsAggregate, getScoreHistory } from "@/lib/api/findings";
import { errorText } from "@/lib/api/remediation";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { exportRunSteps, getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { getVersion, getVersions, pinBaseline } from "@/lib/api/versions";
import { DIMENSIONS, formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { baselineRunId, previousRunId } from "@/lib/runs";
import type { Finding } from "@/types/api";

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
  { accessorKey: "step_number", header: "#" },
  { accessorKey: "step_name", header: "Step" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill>,
  },
  {
    accessorKey: "duration_ms",
    header: "Duration",
    cell: ({ row }) => (row.original.duration_ms == null ? "—" : `${(row.original.duration_ms / 1000).toFixed(1)}s`),
  },
  {
    id: "error",
    header: "Error",
    cell: ({ row }) => (row.original.error_detail ? <p role="alert">{row.original.error_detail}</p> : "—"),
  },
];

function ObjectsTab({ versionId }: { versionId: string }) {
  const router = useRouter();
  const { can } = useRole();
  const objects = useQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  const rows = objects.data?.objects ?? [];

  const columns: ColumnDef<ObjectSummary>[] = [
    { id: "module", header: "Object", accessorFn: (o) => formatModuleName(o.module) },
    {
      id: "composite",
      header: "Composite score",
      cell: ({ row }) => (row.original.composite_score == null ? "—" : row.original.composite_score.toFixed(1)),
    },
    {
      id: "readiness",
      header: "Readiness",
      cell: ({ row }) =>
        row.original.readiness ? <Pill tone={READINESS_TONE[row.original.readiness] ?? "neutral"}>{labelOf(row.original.readiness)}</Pill> : "—",
    },
    { accessorKey: "failing_checks", header: "Failing checks" },
    { accessorKey: "affected_records", header: "Affected records" },
    // Per-module score trend omitted here: /api/v1/scores/history returns a snapshot of
    // today's weights (under_current.modules), not a series over time for each module. G2.
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
      state={objects.isLoading ? "loading" : objects.isError ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No objects were scored in this run." }}
      errorProps={{ message: errorText(objects.error), onRetry: () => objects.refetch() }}
    />
  );
}

function SummaryTab({ versionId, systemId }: { versionId: string; systemId?: string }) {
  const router = useRouter();
  const aggregate = useQuery({ queryKey: queryKeys.findingsAggregate(versionId), queryFn: () => getFindingsAggregate(versionId) });
  const history = useQuery({
    queryKey: queryKeys.scoreHistory(systemId),
    queryFn: () => getScoreHistory({ system_id: systemId, limit: 20 }),
    enabled: systemId != null,
  });

  if (aggregate.isLoading) return <Skeleton height={240} />;
  if (aggregate.isError || !aggregate.data) {
    return <ErrorState message={errorText(aggregate.error)} onRetry={() => aggregate.refetch()} />;
  }

  const a = aggregate.data;
  if (a.total === 0) {
    return <EmptyState title="No findings were produced for this run. Open the steps tab to see what ran." />;
  }

  const composite = a.dqs.composite;
  const delta = composite != null && a.previous_dqs != null ? Math.round((composite - a.previous_dqs) * 10) / 10 : null;

  const dimensionData = Object.entries(a.dqs.dimension_scores).map(([dimension, score]) => ({
    x: DIMENSIONS.find((d) => d.id === dimension)?.label ?? formatModuleName(dimension),
    y: Math.round(score * 10) / 10,
    dimension,
  }));

  const historyRows = [...(history.data?.history ?? [])].reverse();

  return (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-[13px]">
        The composite score for this run is {composite != null ? composite.toFixed(1) : "not scored"}.
        {a.dqs.capped ? " The score is capped by a critical finding." : ""}
      </p>
      <div className="flex flex-wrap gap-8">
        <Stat
          label="Composite score"
          value={composite != null ? composite.toFixed(1) : "—"}
          delta={delta != null ? <span>vs previous run: <span style={{ color: delta >= 0 ? "var(--m-pass)" : "var(--m-critical)" }}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}</span></span> : undefined}
        />
        <Stat label="Affected records" value={a.affected_records.toLocaleString()} />
        <Stat label="Findings" value={a.total.toLocaleString()} />
        {a.cost_at_risk != null ? <Stat label="Cost at risk" value={a.cost_at_risk.toLocaleString()} /> : null}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold">Score by dimension</h2>
        <Bar
          data={dimensionData}
          onPointClick={(p) => router.push(`/runs/${versionId}?tab=findings&dimension=${p.dimension ?? ""}`)}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold">Composite over runs</h2>
        {history.isLoading ? (
          <Skeleton height={120} />
        ) : historyRows.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No score history for this system yet.</p>
        ) : (
          <Line
            data={historyRows.map((h) => ({
              x: formatDate(h.run_at, "date"),
              y: h.at_the_time.composite ?? 0,
              // ChartPoint has no run field; reuse `dimension` to carry the version id for the click handler below.
              dimension: h.version_id,
            }))}
            onPointClick={(p) => p.dimension && router.push(`/runs/${p.dimension}`)}
          />
        )}
      </section>
    </div>
  );
}

function FindingsTab({ versionId }: { versionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useRole();
  const severity = searchParams.get("severity") ?? "";
  const dimension = searchParams.get("dimension") ?? "";
  const moduleFilter = searchParams.get("module") ?? "";
  const findingId = searchParams.get("finding");

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.push(`/runs/${versionId}?${params.toString()}`);
  };
  const openFinding = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("finding", id); else params.delete("finding");
    router.push(`/runs/${versionId}?${params.toString()}`);
  };

  const filters = {
    version_id: versionId,
    severity: severity || undefined,
    dimension: dimension || undefined,
    module: moduleFilter || undefined,
  };
  const findings = useQuery({
    queryKey: [...queryKeys.run(versionId), "findings", severity, dimension, moduleFilter],
    queryFn: () => getFindings({ ...filters, sort: "severity", limit: 200 }),
  });
  const rows = findings.data?.findings ?? [];

  const columns: ColumnDef<Finding>[] = [
    {
      id: "severity",
      header: "Severity",
      cell: ({ row }) => (isSeverity(row.original.severity) ? <SeverityDot severity={row.original.severity} /> : row.original.severity),
    },
    { accessorKey: "check_id", header: "Check" },
    { id: "module", header: "Object", accessorFn: (f) => formatModuleName(f.module) },
    { id: "dimension", header: "Dimension", accessorFn: (f) => labelOf(f.dimension) },
    {
      id: "affected",
      header: "Affected",
      accessorFn: (f) => `${f.affected_count.toLocaleString()} of ${f.total_count.toLocaleString()}`,
    },
  ];

  return (
    <ExplorerPage
      filterBar={
        <div className="flex gap-2">
          <Select value={severity} onValueChange={(v) => setFilter("severity", v)} options={SEVERITY_OPTIONS} placeholder="Severity" />
          <Select value={dimension} onValueChange={(v) => setFilter("dimension", v)} options={DIMENSION_OPTIONS} placeholder="Dimension" />
        </div>
      }
      toolbarEnd={
        can("export") ? (
          <ExportMenu options={[{ format: "xlsx", run: () => exportFindings("xlsx", filters) }]} />
        ) : undefined
      }
      table={
        <DataTable columns={columns} data={rows} getRowId={(f) => f.id} onRowClick={(f) => openFinding(f.id)} />
      }
      state={findings.isLoading ? "loading" : findings.isError ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No findings match these filters." }}
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
  const tab = searchParams.get("tab") ?? "summary";

  const version = useQuery({ queryKey: queryKeys.run(versionId), queryFn: () => getVersion(versionId) });
  const steps = useQuery({ queryKey: [...queryKeys.run(versionId), "steps"], queryFn: () => getRunSteps(versionId) });
  const systemId = version.data?.metadata?.system_id;
  const scope = useQuery({
    queryKey: queryKeys.versionsList({ system_id: systemId }),
    queryFn: () => getVersions({ ...(systemId ? { system_id: systemId } : {}), limit: 100 }),
    enabled: version.isSuccess,
  });

  const isBaseline = version.data?.metadata?.baseline === true;
  const pin = useMutation({
    mutationFn: () => pinBaseline(versionId, !isBaseline),
    onSuccess: () => {
      toast.success(isBaseline ? "Baseline unpinned" : "Pinned as baseline");
      qc.invalidateQueries({ queryKey: queryKeys.run(versionId) });
      qc.invalidateQueries({ queryKey: queryKeys.run("list") });
      qc.invalidateQueries({ queryKey: ["versions-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (version.isError) {
    if (isAxiosError(version.error) && version.error.response?.status === 404) {
      return (
        <EmptyState
          title="Run not found."
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

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.push(`/runs/${versionId}?${params.toString()}`);
  };

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
            run: () => downloadAuthenticated(getAnalysisReportUrl(versionId), `meridian-narrative-${v?.label ?? versionId}.pdf`),
          },
        ]
      : []),
  ];

  const header = v ? (
    <div className="flex flex-col gap-2 p-6 pb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2">
          <span>{v.label ?? versionId}</span>
          <span>— started {formatDate(v.run_at, "datetime")}.</span>
          <Pill tone={statusTone(v.status)}>{labelOf(v.status)}</Pill>
          {isBaseline ? <Pill tone="go">Baseline</Pill> : null}
        </p>
        {can("export") ? <ExportMenu options={exportOptions} /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {prevId ? <Link href={`/runs/${versionId}/vs/${prevId}`}><Button variant="secondary">Compare with previous</Button></Link> : null}
        {baseId ? <Link href={`/runs/${versionId}/vs/baseline`}><Button variant="secondary">Compare with baseline</Button></Link> : null}
        {can("analyse") ? (
          <Button variant="ghost" disabled={pin.isPending} onClick={() => pin.mutate()}>
            {isBaseline ? "Unpin baseline" : "Pin as baseline"}
          </Button>
        ) : null}
      </div>
    </div>
  ) : (
    <p className="p-6 pb-0">Run…</p>
  );

  return (
    <div className="flex flex-col gap-4">
      {header}
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "summary", label: "Summary", content: <SummaryTab versionId={versionId} systemId={systemId} /> },
          { value: "objects", label: "Objects", content: <ObjectsTab versionId={versionId} /> },
          { value: "findings", label: "Findings", content: <FindingsTab versionId={versionId} /> },
          {
            value: "steps",
            label: "Steps",
            content: (
              <ReportPage
                narrative={null}
                charts={null}
                tables={<DataTable columns={stepColumns} data={stepRows} getRowId={(s) => String(s.step_number)} />}
                state={steps.isLoading ? "loading" : steps.isError ? "error" : stepRows.length === 0 ? "empty" : undefined}
                emptyProps={{ title: "No step history for this run yet." }}
                errorProps={{ message: errorText(steps.error), onRetry: () => steps.refetch() }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

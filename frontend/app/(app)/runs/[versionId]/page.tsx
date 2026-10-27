// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, ConfirmDialog, DataTable, Delta, Dialog, DimensionBars, EmptyState, ErrorState, ExplorerPage, ExportMenu, Field, FilterChip, FindingDrawer, Input, InsightHeader, Line, Pager, Pill, Tooltip, DrillLink, Score, Select, SeverityDot, Skeleton, Sparkline, Tabs, isSeverity, entityTabs, NextActions, PageHeader, Status, Switch, asyncStateOf, type CellMeta } from "@/design";
import { getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { useRole } from "@/hooks/use-role";
import { downloadAuthenticated } from "@/lib/api/download";
import { exportFindings, getFindings, getFindingsAggregate, getScoreHistory, type FindingsAggregate } from "@/lib/api/findings";
import { errorText } from "@/lib/api/remediation";
import { getAnalysisReportUrl, getReportDownloadUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { exportRunSteps, getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { getSystems } from "@/lib/api/connectivity";
import { getCostModel } from "@/lib/api/settings";
import { AI_RERUN_STATUSES, getVersion, getVersions, patchVersionLabel, pinBaseline, runAgents } from "@/lib/api/versions";
import { useDqsExplanation } from "@/components/insight/dqs-score";
import { getAnalysisStatus } from "@/lib/api/upload";
import { analyseVersion } from "@/lib/api/system-objects";
import { RunProgressBanner } from "@/components/run-progress-banner";
import { DIMENSIONS, formatDate, formatModuleName, formatMoneyCompact, formatNumber, labelOf, plural } from "@/lib/format";
import { runAxisTicks } from "@/lib/run-axis";
import { capSummary } from "@/lib/home-metrics";
import { ConfigMatchesTab } from "./config-matches-tab";
import { queryKeys } from "@/lib/query-keys";
import { baselineRunId, isFinished, lineageOf, overallDqs, previousRunId, runPageHref } from "@/lib/runs";
import { latestFinishedRun, lineageChoices, runName } from "@/lib/run-scope";
import { RunScope } from "@/components/run-scope";
import { RuleCell } from "@/components/fix/rule-cell";
import type { Finding, Version } from "@/types/api";
import { clsx } from "clsx";

const SEVERITY_OPTIONS = [
  { value: "", label: "All severities" },
  // The Home and Insights "Critical and high failing rules" tiles drill here with both.
  { value: "critical,high", label: "Critical and high" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** The chip's words for a severity filter: the option's label, else each severity in plain words. */
function severityFilterLabel(severity: string): string {
  const option = SEVERITY_OPTIONS.find((o) => o.value === severity);
  if (option) return option.label;
  const words = severity.split(",").filter(Boolean).map((s, i) => (i === 0 ? labelOf(s) : labelOf(s).toLowerCase()));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] ?? severity;
}

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
  // Ranked by rule failures, the same order as the overview ledger.
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
      header: "Score",
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
      header: "Failing rules",
      meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}`}>{formatNumber(row.original.failing_checks)}</DrillLink>,
    },
    {
      // Summed over the object's failing rules (a record failing two rules counts twice): rule failures.
      accessorKey: "affected_records",
      header: "Rule failures",
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}`}>{formatNumber(row.original.affected_records)}</DrillLink>,
    },
    {
      id: "trend",
      header: "Trend",
      meta: { priority: "low" } satisfies CellMeta,
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
      meta: { priority: "low" } satisfies CellMeta,
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
      // A phone keeps the object, its score, its failing records and Open; the rule and the counts step aside.
      id: "rule",
      header: "Blocking rule",
      enableSorting: false,
      meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row }) => {
        const o = objects.get(row.original.module);
        return o?.blocking_rule_id ? <RuleCell id={o.blocking_rule_id} fallback={o.blocking_rule_name} /> : <span className="m-ink-3">—</span>;
      },
    },
    {
      id: "critical", header: "Critical", accessorFn: (m) => m.critical, meta: { numeric: true, priority: "low" } satisfies CellMeta, size: 90,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}&severity=critical`}>{row.original.critical.toLocaleString()}</DrillLink>,
    },
    {
      id: "high", header: "High", accessorFn: (m) => m.high, meta: { numeric: true, priority: "low" } satisfies CellMeta, size: 80,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}&severity=high`}>{row.original.high.toLocaleString()}</DrillLink>,
    },
    {
      // The aggregate's per-object sum over failing rules: rule failures, never distinct records.
      id: "records", header: "Rule failures", accessorFn: (m) => m.affected ?? 0, meta: { numeric: true } satisfies CellMeta,
      cell: ({ row }) => <DrillLink href={`/runs/${versionId}?tab=findings&module=${row.original.module}`}>{(row.original.affected ?? 0).toLocaleString()}</DrillLink>,
    },
    {
      id: "open",
      header: "",
      size: 90,
      enableSorting: false,
      meta: { sticky: "end" } satisfies CellMeta,
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
  versionId, aggregate, history, systemId, versionLoading, lineage, inProgress = false,
}: {
  versionId: string; aggregate: UseQueryResult<FindingsAggregate>; history: History; systemId?: string; versionLoading: boolean;
  /** The run is still extracting or analysing: no findings yet means "not scored yet", not "nothing failed". */
  inProgress?: boolean;
  /** Scored runs of this run's lineage (uploads of the same objects), used for the composite line when there is no system history. */
  lineage: Version[];
}) {
  const router = useRouter();
  // Next actions come from this run's findings, not the newest run of the tenant.
  const prescriptive = useQuery({ queryKey: ["prescriptive", "next-actions", versionId], queryFn: () => getPrescriptiveAnalytics({ limit: 5, version_id: versionId }) });
  // Shared with the Objects tab: the score, blocking rule and readiness of each object.
  const objects = useQuery({ queryKey: queryKeys.objects(versionId), queryFn: () => getObjects(versionId) });
  const objectByModule = new Map((objects.data?.objects ?? []).map((o) => [o.module, o]));
  const cost = aggregate.data?.cost_at_risk;
  // The tenant currency names the cost; until it is known the figure prints as plain digits.
  const costModel = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel, enabled: cost != null, retry: false, meta: { ignoreError: true }, staleTime: 300_000 });
  // The breakdown behind the hero's number, opened from its label: formula, weights, cap and costliest rules.
  const explained = useDqsExplanation({ agg: aggregate.data, versionId });

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
  if (inProgress && aggregate.data.total === 0) {
    return (
      <EmptyState
        title="Analysis is running"
        detail="The score, objects and findings appear here when it finishes. Steps shows how far it has got."
        action={<Button variant="secondary" render={<Link href={`/runs/${versionId}?tab=steps`}>Open steps</Link>} />}
      />
    );
  }

  const a = aggregate.data;
  // A run with nothing failing still has a score: the hero stays, the ledger and next actions give way.
  const clean = a.total === 0;
  const composite = a.dqs.composite;
  const delta = composite != null && a.previous_dqs != null ? Math.round((composite - a.previous_dqs) * 10) / 10 : null;
  const blocking = a.severity.critical + a.severity.high;
  // A critical finding holds the score at the cap: the numeral is the capped composite (the score every other
  // page shows, and the one the delta compares), and the ruler draws the measured value as a ghost beyond it.
  const raw = a.dqs.raw ?? composite;
  const capped = a.dqs.capped === true && composite != null && raw != null && raw > composite;
  // "Capped at 70, N critical" counts the critical failing rules that cap (over tolerance), as Home and the executive
  // summary do (lib/home-metrics.ts capSummary); a run outside the lineage list falls back to its critical failing rules.
  const thisRun = lineage.find((v) => v.id === versionId);
  const capRules = thisRun ? capSummary(thisRun).rules || a.severity.critical : a.severity.critical;

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
  const ticks = runAxisTicks(historyRows);
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
    href: act.type === "finding"
      ? `/runs/${versionId}?tab=findings${act.module ? `&module=${act.module}` : ""}`
      // Carry this run: without it the cleaning queue opens across every run (or a stale carried one),
      // so the user leaves a run and lands somewhere that is not that run.
      : act.type === "cleaning" ? `/fix?${new URLSearchParams({ tab: "cleaning", run: versionId, ...(act.module ? { module: act.module } : {}) })}` : "/inbox",
    // Plain words from the same action: its records, how many of them are critical, and the effort.
    why: `${plural(act.affected_count, "record")}, ${(act.severity === "critical" ? act.affected_count : 0).toLocaleString()} critical; about ${plural(Math.max(1, Math.round(act.effort_hours)), "hour")}.`,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* The score band as Insights and MDM draw it: the hero score and its verdict on the left, the stats beside it. */}
      <InsightHeader
        hero
        bare
        lead={
          <div className="m-hero-lead">
            <Score
              size="hero"
              value={composite}
              measured={capped ? raw : undefined}
              cap={capped ? composite ?? undefined : undefined}
              criticals={capRules}
              versionId={versionId}
              explain={explained?.explain}
              delta={delta != null ? <Delta value={delta} run="previous run" /> : undefined}
              hint={clean ? "Nothing failed in this run" : undefined}
              href={`/runs/${versionId}?tab=findings`}
            />
          </div>
        }
        stats={[
          // The findings list filters by one severity, so the two that block are two drills.
          {
            label: "Critical and high failing rules",
            value: blocking.toLocaleString(),
            tone: blocking > 0 ? "no-go" : undefined,
            hint: (
              <span className="inline-flex gap-2">
                <DrillLink href={`/runs/${versionId}?tab=findings&severity=critical`}>{a.severity.critical.toLocaleString()} critical</DrillLink>
                <DrillLink href={`/runs/${versionId}?tab=findings&severity=high`}>{a.severity.high.toLocaleString()} high</DrillLink>
              </span>
            ),
          },
          // Summed over the failing rules (a record failing two rules counts twice): rule failures, the ledger's column.
          { label: "Rule failures", value: a.affected_records.toLocaleString(), hint: "records failing a rule, per rule", to: `/runs/${versionId}?tab=findings` },
          ...(cost != null ? [{ label: "Cost at risk", value: formatMoneyCompact(cost, costModel.data?.currency), to: `/runs/${versionId}?tab=findings` }] : []),
        ]}
        // `bare` sets the score band alone; the cells below are not drawn.
        situation={{ sentence: "" }}
        changed={{ sentence: "" }}
        why={{ sentence: "" }}
        next={{ sentence: "" }}
      />
      {/* The dimension bars are a strip under the score, not a chart of their own. */}
      {dimensions.length > 0 ? (
        <section aria-label="Score by dimension" data-testid="run-dimensions" className="@5xl:max-w-[50%]">
          <h2 className="m-text-meta m-ink-3 pb-1">Score by dimension</h2>
          <DimensionBars items={dimensions} label="Score by dimension" />
        </section>
      ) : null}
      {clean ? (
        <EmptyState
          variant="inline"
          title="Nothing failed in this run"
          detail="Open steps to see what ran."
          action={<Button variant="ghost" render={<Link href={`/runs/${versionId}?tab=steps`}>Open steps</Link>} />}
        />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold m-text-h">Objects in this run</h2>
            <RunLedger versionId={versionId} rows={ledgerRows} objects={objectByModule} />
          </section>
          {/* A run with no prescribed action shows no section, not a heading over "No next actions". */}
          {prescriptive.isLoading || next.length > 0 ? (
            <section className={clsx("flex flex-col gap-2", prescriptive.isLoading && "[min-height:124px]")} data-testid="next-actions-slot">
              <h2 className="font-semibold m-text-h">Next actions</h2>
              {prescriptive.isLoading ? <Skeleton height={96} /> : <NextActions actions={next} />}
            </section>
          ) : null}
        </>
      )}
      <Card title="Composite over runs">
        {versionLoading || (systemId != null && history.isLoading) ? (
          <Skeleton height={160} />
        ) : points.length <= 1 ? (
          // A note, not a call to action: reading a run is no moment to import a file or start another analysis.
          <EmptyState
            variant="inline"
            title="Only one run so far"
            detail={systemId ? "Scores over time appear after a second run of this system." : "Scores over time appear after a second upload of the same objects."}
          />
        ) : (
          <Line data={points} label="Composite over runs" height={160} annotations={annotations} onPointClick={(p) => { if (p.runId) router.push(runPageHref(p.runId)); }} />
        )}
      </Card>
    </div>
  );
}

const findingsKey = (versionId: string, severity: string, dimension: string, moduleFilter: string, page: number, passing = false) =>
  [...queryKeys.run(versionId), "findings", severity, dimension, moduleFilter, page, passing ? "all" : "failing"] as const;

/** The "Failing rules" tab: rules with failing records only, unless the reader asks for passing rules too. */
const findingsFetch = (versionId: string, severity: string, dimension: string, moduleFilter: string, page: number, passing = false) =>
  getFindings({
    version_id: versionId,
    severity: severity || undefined,
    dimension: dimension || undefined,
    module: moduleFilter || undefined,
    failing: passing ? undefined : true,
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
  // A rule evaluated with 0 failing records is not a failing rule: listed only when asked for.
  const passing = searchParams.get("passing") === "1";

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
    failing: passing ? undefined : true,
  };
  const findings = useQuery({
    queryKey: findingsKey(versionId, severity, dimension, moduleFilter, page, passing),
    queryFn: () => findingsFetch(versionId, severity, dimension, moduleFilter, page, passing),
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
    // The rule's words (catalogue name, else the finding's message) beside its id; the message column is gone with it.
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <RuleCell id={row.original.check_id} fallback={row.original.details.message} /> },
    { id: "module", header: "Object", meta: { priority: "low" } satisfies CellMeta, accessorFn: (f) => formatModuleName(f.module) },
    { id: "dimension", header: "Dimension", meta: { priority: "low" } satisfies CellMeta, accessorFn: (f) => labelOf(f.dimension) },
    {
      id: "affected",
      header: "Failing records",
      accessorFn: (f) => f.affected_count,
      cell: ({ row }) => (
        <DrillLink href={`/objects/${row.original.module}?run=${versionId}&tab=records&check_id=${row.original.check_id}`}>
          {row.original.affected_count.toLocaleString()} of {row.original.total_count.toLocaleString()}
        </DrillLink>
      ),
    },
  ];

  return (
    <ExplorerPage
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Severity" value={severity} onValueChange={(v) => setFilter("severity", v)} options={SEVERITY_OPTIONS} placeholder="Severity" />
          <Select label="Dimension" value={dimension} onValueChange={(v) => setFilter("dimension", v)} options={DIMENSION_OPTIONS} placeholder="Dimension" />
          {severity ? <FilterChip label="Severity" value={severityFilterLabel(severity)} onRemove={() => setFilter("severity", "")} /> : null}
          {dimension ? <FilterChip label="Dimension" value={DIMENSIONS.find((d) => d.id === dimension)?.label ?? labelOf(dimension)} onRemove={() => setFilter("dimension", "")} /> : null}
          {moduleFilter ? <FilterChip label="Object" value={formatModuleName(moduleFilter)} onRemove={() => setFilter("module", "")} /> : null}
          <Switch checked={passing} onCheckedChange={(on) => setFilter("passing", on ? "1" : "")} label="Show passing rules too" />
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
          ? { title: "No failing rules match", detail: "Try removing a filter.", action: <Button onClick={clearFilters}>Clear filters</Button> }
          : { title: "No failing rules in this run", detail: "Open steps to see what ran.", action: <Button onClick={onOpenSteps}>Open steps</Button> }
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
  const [aiOpen, setAiOpen] = useState(false);
  const rerunAi = useMutation({
    mutationFn: () => runAgents(versionId),
    onSuccess: () => {
      setAiOpen(false);
      toast.success("AI analysis started. Progress shows above.");
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
      title={runName(v)}
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
      secondary={
        <>
          {can("analyse") ? (
            <>
              <Tooltip label="Give this run a name you will recognise in lists and comparisons" render={<Button variant="ghost" onClick={openRename} />}>
                Rename
              </Tooltip>
              <Tooltip
                label={isBaseline ? "Stop comparing later runs in this system with this run" : "Later runs in this system are compared with this run on Insights › Since baseline"}
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
              {AI_RERUN_STATUSES.includes(v.status) ? (
                <Tooltip
                  label={running ? "Analysis is already running" : "Run the AI pipeline again over this run's findings. Findings and scores stay; summaries, remediation and the narrative report are rewritten."}
                  maxWidth={280}
                  render={<Button variant="ghost" onClick={() => setAiOpen(true)} disabled={running} />}
                >
                  Re-run AI analysis
                </Tooltip>
              ) : null}
            </>
          ) : null}
        </>
      }
      more={can("analyse") ? [
        { label: "Rename", onSelect: openRename },
        { label: isBaseline ? "Unpin baseline" : "Pin as baseline", onSelect: () => pin.mutate(), disabled: pin.isPending },
        { label: "Re-run analysis", onSelect: () => rerun.mutate(), disabled: running || rerun.isPending },
        ...(AI_RERUN_STATUSES.includes(v.status) ? [{ label: "Re-run AI analysis", onSelect: () => setAiOpen(true), disabled: running }] : []),
      ] : undefined}
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
      <ConfirmDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        title="Re-run AI analysis"
        body={<p className="m-ink-2">The AI pipeline runs again over this run&apos;s aggregated findings. Findings and scores do not change; the summaries, remediation advice and narrative report are replaced when it finishes.</p>}
        confirmLabel="Re-run AI analysis"
        pending={rerunAi.isPending}
        onConfirm={() => rerunAi.mutate()}
      />
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
          { value: "overview", label: "Overview", content: <SummaryTab versionId={versionId} aggregate={aggregate} history={history} systemId={systemId} versionLoading={version.isLoading} lineage={v ? runs.filter((r) => lineageOf(r) === lineageOf(v) && isFinished(r)) : []} inProgress={running || v?.status === "pending" || v?.status === "running"} /> },
          { value: "objects", label: "Objects", content: <ObjectsTab versionId={versionId} history={history} onOpenSteps={openSteps} /> },
          { value: "findings", label: "Failing rules", content: <FindingsTab versionId={versionId} onOpenSteps={openSteps} /> },
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

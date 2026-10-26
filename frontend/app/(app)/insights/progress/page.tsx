"use client";

/**
 * Insights > Progress: the lead's screen. How fast the data is getting fixed, and what is slowing it down:
 * the burn-down with its projected finish, decisions per person, time to fix, what keeps coming back, where
 * the failing records sit, how good the proposals are, and what changed since the previous run. Without `?run=`
 * it reads the current state (every object at its own latest run, Home's scope); with `?run=` that run, and the
 * toolbar pins the run later comparisons start from (the baseline).
 * Every number comes from /api/v1/work/analytics (SQL over the work already recorded).
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Bar, Button, Card, DataTable, EmptyState, Funnel, HelpHint, Line, Mono, Pareto, Select, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getComparisonReportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { pinBaseline } from "@/lib/api/versions";
import {
  getBurndown, getProposalQuality, getRecurrence, getRootCauses, getRunChange, getThroughput, getTimeToFix,
  type DecisionKind, type PersonThroughput, type ProposalSourceStat, type Recurrence, type RootCauseValue,
  type RunChangeObject, type TimeToFix, type Workload,
} from "@/lib/api/work-analytics";
import { drillLabel, fixHref as fixLink, type FixStatus } from "@/lib/drill";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, formatModuleName, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { lineageOf } from "@/lib/runs";
import { runName, runScopeLabel } from "@/lib/run-scope";
import { DrillCount } from "../_components/DrillCount";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { Section } from "../_components/Section";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { burndownChart, DECISION_LABELS, daysText, finishSentence, pct, rateText, sourceLabel } from "./progress-model";

const PURPOSE = "How fast the data is getting fixed, and what is slowing it down.";
const n = (x: number) => x.toLocaleString();
const KINDS: DecisionKind[] = ["accept", "edit", "not_an_issue", "accept_risk", "approve"];
const linkClass = "m-ink-accent underline-offset-2 hover:underline";
/** The proposal funnel's stages and the work status each one lists. */
const STAGE_STATUS: Record<string, FixStatus> = { Proposed: "proposed", Approved: "approved", "Sent to SAP": "sent", Fixed: "fixed" };

type CheckFix = TimeToFix["by_check"][number];
type CheckRecurrence = Recurrence["by_check"][number];
type SystemRecurrence = Recurrence["by_system"][number];

export default function ProgressPage() {
  const dayOne = useDayOne();
  const router = useRouter();
  const { run: scopedRun, module, mode, runs, resolving, error: listError, refetch: refetchList } = useInsightScope();
  // The current state (no ?run=): the run-bound reads span every object at its own latest run, and every drill
  // opens Fix work in the same scope. ?run= (or an object filter) reads that one run.
  const isCurrent = mode === "current";
  const run = isCurrent ? undefined : scopedRun;
  // No run because the run list (or the day-one sources) failed: an error, never "Nothing to track yet".
  const loadError = scopedRun ? null : listError ?? (dayOne.status === "error" ? dayOne.error : null);
  const { can } = useRole();
  const qc = useQueryClient();
  const scope = { versionId: run, module };
  const key = (name: string) => ["work-analytics", name, run ?? "current", module ?? null];
  const ready = !resolving;

  const burn = useQuery({ queryKey: key("burndown"), queryFn: () => getBurndown(scope), enabled: ready });
  const ttf = useQuery({ queryKey: key("time-to-fix"), queryFn: () => getTimeToFix(scope), enabled: ready });
  const thr = useQuery({ queryKey: key("throughput"), queryFn: () => getThroughput(scope), enabled: ready });
  const rec = useQuery({ queryKey: key("recurrence"), queryFn: () => getRecurrence(scope), enabled: ready });
  const roots = useQuery({ queryKey: key("root-causes"), queryFn: () => getRootCauses(scope), enabled: ready });
  const prop = useQuery({ queryKey: key("proposal-quality"), queryFn: () => getProposalQuality(scope), enabled: ready });
  const change = useQuery({ queryKey: key("run-change"), queryFn: () => getRunChange(scope), enabled: ready });

  const b = burn.data;
  const chart = useMemo(() => (b ? burndownChart(b) : null), [b]);
  const fixHref = fixLink({ run, module });
  /** Fix work for these records, in this page's run and object scope. */
  const fix = useCallback((f: Parameters<typeof fixLink>[0] = {}) => fixLink({ run, module, ...f }), [run, module]);
  const runsHref = "/runs";

  // The pinned baseline of this run's system (or uploads of the same objects), if any; the shown run itself may be it.
  const current = runs.find((r) => r.id === run);
  const pinnedRun = current ? runs.find((r) => lineageOf(r) === lineageOf(current) && r.metadata?.baseline === true) : undefined;
  const pinnedHere = !!run && pinnedRun?.id === run;
  const pin = useMutation({
    mutationFn: () => pinBaseline(run ?? "", !pinnedHere),
    onSuccess: (r) => {
      toast.success(r.baseline ? "Pinned as baseline. Later runs compare against it." : "Baseline unpinned. Later runs compare against the previous run.");
      void qc.invalidateQueries({ queryKey: queryKeys.run("list") });
      void qc.invalidateQueries({ queryKey: ["versions"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // ── columns ────────────────────────────────────────────────────────────────
  const peopleColumns = useMemo<ColumnDef<PersonThroughput>[]>(() => [
    { accessorKey: "person", header: "Person", cell: ({ row }) => (
      <DrillCount href={row.original.user_id ? fix({ assignee: row.original.user_id }) : undefined}
        label={`Open the records assigned to ${row.original.person}`}>{row.original.person}</DrillCount>
    ) },
    ...KINDS.map((k): ColumnDef<PersonThroughput> => ({ id: k, accessorFn: (r) => r[k], header: DECISION_LABELS[k], meta: { numeric: true }, cell: ({ row }) => n(row.original[k]) })),
    { accessorKey: "total", header: "Decisions", meta: { numeric: true }, cell: ({ row }) => n(row.original.total) },
  ], [fix]);

  const workloadColumns = useMemo<ColumnDef<Workload>[]>(() => [
    { id: "who", header: "Assigned to", accessorFn: (r) => r.name ?? "Nobody yet", cell: ({ row }) => {
      const w = row.original;
      if (!w.name) return <span className="m-ink-3">Nobody yet</span>;
      return <DrillCount href={fix({ assignee: w.assignee_id ?? "unassigned" })} label={`Open the records assigned to ${w.name}`}>{w.name}</DrillCount>;
    } },
    { accessorKey: "open", header: "Open", meta: { numeric: true }, cell: ({ row }) => {
      const w = row.original;
      return <DrillCount href={fix({ assignee: w.assignee_id ?? "unassigned" })} count={w.open} label={`${drillLabel({ count: w.open, what: "open records" })} assigned to ${w.assignee_id ? w.name ?? "this person" : "nobody"}`}>{n(w.open)}</DrillCount>;
    } },
    { accessorKey: "critical", header: "Critical", meta: { numeric: true }, cell: ({ row }) => {
      const w = row.original;
      return <DrillCount href={fix({ assignee: w.assignee_id ?? "unassigned", sev: "critical" })} count={w.critical} label={`${drillLabel({ count: w.critical, sev: "critical" })} assigned to ${w.assignee_id ? w.name ?? "this person" : "nobody"}`}>{n(w.critical)}</DrillCount>;
    } },
    { accessorKey: "overdue", header: "Overdue", meta: { numeric: true }, cell: ({ row }) => {
      const w = row.original;
      if (!w.overdue) return "0";
      return <DrillCount href={fix({ assignee: w.assignee_id ?? "unassigned", due: "overdue" })} label={`${drillLabel({ count: w.overdue, what: "overdue records" })} assigned to ${w.assignee_id ? w.name ?? "this person" : "nobody"}`}><span className="m-ink-critical">{n(w.overdue)}</span></DrillCount>;
    } },
  ], [fix]);

  const ttfColumns = useMemo<ColumnDef<CheckFix>[]>(() => [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <DrillCount href={fix({ module: row.original.module, check: row.original.check_id })} label={drillLabel({ what: "open records", check: row.original.check_id, module: row.original.module })}><Mono>{row.original.check_id}</Mono></DrillCount> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module), cell: ({ row }) => <DrillCount href={fix({ module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module })}>{formatModuleName(row.original.module)}</DrillCount> },
    { accessorKey: "fixed", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={fix({ module: row.original.module, check: row.original.check_id, st: "fixed" })} count={row.original.fixed} label={drillLabel({ what: "fixed records", check: row.original.check_id, module: row.original.module, of: "this run" })}>{n(row.original.fixed)}</DrillCount> },
    { accessorKey: "median_days", header: "Typical time", meta: { numeric: true }, cell: ({ row }) => daysText(row.original.median_days) },
    { accessorKey: "p90_days", header: "9 in 10 within", meta: { numeric: true }, cell: ({ row }) => daysText(row.original.p90_days) },
  ], [fix]);

  const recurColumns = useMemo<ColumnDef<CheckRecurrence>[]>(() => [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <DrillCount href={fix({ module: row.original.module, check: row.original.check_id })} label={drillLabel({ what: "open records", check: row.original.check_id, module: row.original.module })}><Mono>{row.original.check_id}</Mono></DrillCount> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module), cell: ({ row }) => <DrillCount href={fix({ module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module })}>{formatModuleName(row.original.module)}</DrillCount> },
    { accessorKey: "reopened", header: "Came back", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={fix({ module: row.original.module, check: row.original.check_id })} count={row.original.reopened} label={`${drillLabel({ what: "open records", check: row.original.check_id, module: row.original.module })}; ${n(row.original.reopened)} came back after a fix`}>{n(row.original.reopened)}</DrillCount> },
    { accessorKey: "issues", header: "Tracked", meta: { numeric: true }, cell: ({ row }) => n(row.original.issues) },
    { accessorKey: "rate_pct", header: "Rate", meta: { numeric: true }, cell: ({ row }) => pct(row.original.rate_pct) },
  ], [fix]);

  const systemColumns = useMemo<ColumnDef<SystemRecurrence>[]>(() => [
    { id: "name", header: "System", accessorFn: (r) => r.name ?? r.scope, cell: ({ row }) => row.original.name ?? <Mono>{row.original.scope}</Mono> },
    // Fix work has no system filter: the count opens this run's open records (one system per run).
    { accessorKey: "reopened", header: "Came back", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={row.original.version_id ? fix({ run: row.original.version_id, system: row.original.scope }) : undefined} count={row.original.reopened} label={`Open the open records of ${row.original.name ?? row.original.scope}`}>{n(row.original.reopened)}</DrillCount> },
    { accessorKey: "issues", header: "Tracked", meta: { numeric: true }, cell: ({ row }) => n(row.original.issues) },
    { accessorKey: "rate_pct", header: "Rate", meta: { numeric: true }, cell: ({ row }) => pct(row.original.rate_pct) },
  ], [fix]);

  const [dim, setDim] = useState<string>("");
  const dims = roots.data?.dimensions ?? [];
  const activeDim = dims.find((d) => d.field === dim) ?? dims[0];
  const field = activeDim?.field ?? "";
  const rootColumns = useMemo<ColumnDef<RootCauseValue>[]>(() => {
    const at = (v: string) => `${field} ${v}`;
    return [
      { accessorKey: "value", header: "Value", cell: ({ row }) => <DrillCount href={fix({ part: { field, value: row.original.value } })} label={drillLabel({ what: "open records", of: at(row.original.value) })}><Mono>{row.original.value}</Mono></DrillCount> },
      { accessorKey: "records", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => n(row.original.records) },
      { accessorKey: "open", header: "Still to fix", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={fix({ part: { field, value: row.original.value } })} count={row.original.open} label={drillLabel({ count: row.original.open, what: "open records", of: at(row.original.value) })}>{n(row.original.open)}</DrillCount> },
      { accessorKey: "critical", header: "Critical", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={fix({ part: { field, value: row.original.value }, sev: "critical" })} count={row.original.critical} label={drillLabel({ sev: "critical", what: "open records", of: at(row.original.value) })}>{n(row.original.critical)}</DrillCount> },
      { accessorKey: "share_pct", header: isCurrent ? "Share" : "Share of run", meta: { numeric: true }, cell: ({ row }) => pct(row.original.share_pct) },
    ];
  }, [field, fix, isCurrent]);

  const sourceColumns = useMemo<ColumnDef<ProposalSourceStat>[]>(() => [
    // Fix work has no filter by proposal source: cleaning proposals have their own tab, every other value waits for approval in Inbox › Approvals.
    { id: "source", header: "Where the value came from", accessorFn: (r) => sourceLabel(r.source), cell: ({ row }) => (
      <DrillCount href={row.original.source === "cleaning" ? "/fix?tab=cleaning" : "/fix?tab=batches"} label={row.original.source === "cleaning" ? "Open the cleaning proposals" : `Open approvals and export for ${sourceLabel(row.original.source).toLowerCase()} values`}>{sourceLabel(row.original.source)}</DrillCount>
    ) },
    { accessorKey: "proposed", header: "Proposed", meta: { numeric: true }, cell: ({ row }) => n(row.original.proposed) },
    { accessorKey: "approval_rate_pct", header: "Approved", meta: { numeric: true }, cell: ({ row }) => `${n(row.original.approved)} (${pct(row.original.approval_rate_pct)})` },
    { accessorKey: "exported", header: "Sent to SAP", meta: { numeric: true }, cell: ({ row }) => n(row.original.exported) },
    { accessorKey: "fixed", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => n(row.original.fixed) },
    { accessorKey: "still_failing", header: "Still failing", meta: { numeric: true }, cell: ({ row }) => n(row.original.still_failing) },
    { accessorKey: "fix_rate_pct", header: "Fix rate", meta: { numeric: true }, cell: ({ row }) => pct(row.original.fix_rate_pct) },
  ], []);

  const changeColumns = useMemo<ColumnDef<RunChangeObject>[]>(() => [
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module), cell: ({ row }) => <DrillCount href={fixLink({ run, module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module })}>{formatModuleName(row.original.module)}</DrillCount> },
    { accessorKey: "new", header: "New", meta: { numeric: true }, cell: ({ row }) => (row.original.new ? <DrillCount href={fixLink({ run, module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module, of: "this run" })}><span className="m-ink-critical">{n(row.original.new)}</span></DrillCount> : "0") },
    { accessorKey: "fixed", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={fixLink({ run, module: row.original.module, st: "fixed" })} count={row.original.fixed} label={drillLabel({ count: row.original.fixed, what: "fixed records", module: row.original.module })}>{n(row.original.fixed)}</DrillCount> },
    { accessorKey: "still_failing", header: "Still failing", meta: { numeric: true }, cell: ({ row }) => <DrillCount href={fixLink({ run, module: row.original.module })} count={row.original.still_failing} label={drillLabel({ what: "open records", module: row.original.module })}>{n(row.original.still_failing)}</DrillCount> },
    { accessorKey: "not_comparable_checks", header: "Rules not in both runs", meta: { numeric: true }, cell: ({ row }) => n(row.original.not_comparable_checks) },
    { id: "action", header: "", enableSorting: false, cell: ({ row }) => <Link href={withScope(`/objects/${row.original.module}`, { run })} className={linkClass} aria-label={`Open ${formatModuleName(row.original.module)}`}>Open</Link> },
  ], [run]);

  // ── the four sentences and the KPI strip ───────────────────────────────────
  // One run compares with its previous run; the current state with each object's previous run.
  const hasChange = !!change.data?.previous || (change.data?.compared?.length ?? 0) > 0;
  const slowest = ttf.data?.by_object[0];
  const overall = ttf.data?.overall;
  const neverRan = !!b && !b.version_id && b.days.every((d) => d.open === 0 && d.opened === 0);
  const state: "loading" | "empty" | "error" | undefined = resolving || burn.isLoading || dayOne.status === "loading"
    ? "loading"
    : burn.isError || (neverRan && loadError) ? "error" : neverRan ? "empty" : undefined;
  // One noun: a failing record is one record failing one rule (the burn-down's unit); records to fix are the distinct
  // records in the work list.
  const openLabel = b?.open_records != null ? "Records to fix" : "Failing records";
  const openValue = b ? (b.open_records ?? b.open_now) : "—";

  return (
    <InsightFrame
      title="Progress"
      scope
      purpose={PURPOSE}
      run={run}
      module={module}
      toolbar={run && !isCurrent ? (
        <>
          <span className="inline-flex items-center gap-1 m-text-meta m-ink-3" data-testid="baseline-line">
            {pinnedRun ? `Baseline: ${runScopeLabel(pinnedRun)}` : "No baseline pinned"}
            <HelpHint term="baseline" />
          </span>
          {can("analyse") ? <Button variant="secondary" onClick={() => pin.mutate()} pending={pin.isPending}>{pinnedHere ? "Unpin baseline" : "Pin as baseline"}</Button> : null}
        </>
      ) : undefined}
      exportOptions={run && !isCurrent ? [
        { format: "pdf", label: "Progress report (PDF)", run: () => downloadAuthenticated(getComparisonReportUrl(run), `progress_${run}.pdf`) },
        { format: "xlsx", label: "Comparison workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(run, { module }), `comparison_${run}.xlsx`) },
      ] : []}
      insight={{
        hero: true,
        stats: [
          { label: openLabel, value: openValue, hint: b && b.open_records != null ? `${n(b.open_now)} failing records` : undefined, to: fixHref },
          // Fix work has no date filter, so the count says the last 7 days and the drill says it opens every fixed record.
          { label: "Fixed this week", value: b?.fixed_7d ?? "—", tone: b?.fixed_7d ? "go" : undefined, hint: "Last 7 days; opens all fixed records", to: fix({ st: "fixed" }) },
          { label: "Median time to fix", value: overall ? daysText(overall.median_days) : "—", hint: overall?.fixed ? `Over ${plural(overall.fixed, "fix", "fixes")}` : undefined, to: overall?.fixed ? "#time-to-fix" : undefined },
          { label: "Projected finish", value: b?.projected_finish ? formatDate(b.projected_finish) : b && b.open_now === 0 ? "Done" : "No date yet", tone: b?.projected_finish ? "go" : b && b.open_now > 0 ? "at-risk" : undefined, hint: b ? `At the last ${b.pace_window_days} days' pace` : undefined, to: b ? "#burndown" : undefined },
        ],
        situation: { sentence: b ? (b.open_now ? `${plural(b.open_now, "failing record")} open${b.open_records != null ? `, ${plural(b.open_records, "record")} to fix` : ""}` : "Nothing is open") : "—", tone: b && b.open_now === 0 ? "go" : undefined },
        changed: { sentence: b ? `${plural(b.fixed_7d, "failing record")} fixed in the last 7 days; ${b.pace_per_day >= 0 ? `${rateText(b.pace_per_day)} a day net closed` : `${rateText(b.pace_per_day)} a day net added`} over ${b.pace_window_days} days` : "—" },
        why: { sentence: slowest ? `${formatModuleName(slowest.module)} takes longest to fix: typically ${daysText(slowest.median_days)}` : "No fixes recorded yet, so no fix times", href: slowest ? fix({ module: slowest.module }) : undefined },
        next: b && b.projected_finish
          ? { sentence: finishSentence(b), tone: "go", action: { label: "Open Fix work", href: fixHref } }
          : { sentence: b ? finishSentence(b) : "—", tone: b && b.open_now > 0 ? "at-risk" : undefined, action: { label: "Open Fix work", href: fixHref } },
      }}
      state={state}
      skeleton={<><CardSkeleton height={280} /><CardSkeleton height={240} /><CardSkeleton height={240} /></>}
      emptyProps={{
        title: "Nothing to track yet",
        detail: dayOne.step?.detail ?? "Progress appears once a finished run has found failing records.",
        ghost: "chart",
        action: <DayOneAction step={dayOne.step} fallbackHref={runsHref} fallbackLabel="Open runs" />,
      }}
      errorProps={burn.isError ? { error: burn.error, onRetry: () => void burn.refetch() } : { error: loadError, onRetry: () => { refetchList(); dayOne.refetch(); } }}
    >
      {/* Who decided what leads: the lead's operational view of the work, then the backlog it moves. */}
      <Section title="Decisions by person" height={240} query={thr} meta={thr.data ? `${plural(thr.data.totals.total, "decision")} in the last ${thr.data.window_days} days` : undefined}>
        {thr.data && thr.data.people.length ? (
          <div className="flex flex-col gap-4">
            <Bar data={thr.data.people.slice(0, 12).map((p) => ({ x: p.person, y: p.total }))} height={Math.max(120, Math.min(12, thr.data.people.length) * 32)} label="Decisions per person, last 30 days" />
            <DataTable columns={peopleColumns} data={thr.data.people} getRowId={(r) => r.person} hideToolbar height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="No decisions in the last 30 days" action={<Link href={fixHref} className={linkClass}>Start fixing</Link>} />
        )}
        {thr.data && thr.data.workload.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="m-text-meta m-ink-3">Open work per person</p>
            <DataTable columns={workloadColumns} data={thr.data.workload} getRowId={(r) => r.assignee_id ?? "unassigned"} hideToolbar height="auto" />
          </div>
        )}
      </Section>

      <div id="burndown" className="scroll-mt-24">
      <Card
        title="Burn-down"
        meta={b && chart ? `Failing records open per day over the last 90 days, at most ${n(chart.peak)}. ${finishSentence(b)}` : undefined}
        actions={<Link href={fixHref} className={linkClass}>Open Fix work</Link>}
      >
        {b && chart && b.days.some((d) => d.open > 0) ? (
          <div className="flex flex-col gap-4">
            <Line series={chart.series} data={[]} xDomain={chart.xDomain} height={260} counts="fit" dqsThreshold={chart.target} thresholdLabel="Target: none open" label="Failing records open per day" />
            {b.runs.length > 1 && (
              <div>
                <p className="m-text-meta m-ink-3">Failing records in each run of this system</p>
                <Bar data={b.runs.map((r) => ({ x: r.version_id, y: r.issues, label: runName(r), runId: r.version_id }))} height={Math.max(120, b.runs.length * 28)} label="Failing records per run" onPointClick={(p) => { if (p.runId) router.push(fixLink({ run: p.runId, module })); }} />
              </div>
            )}
          </div>
        ) : (
          <EmptyState variant="inline" title="No failing records open in the last 90 days" action={<Link href={runsHref} className={linkClass}>Open runs</Link>} />
        )}
      </Card>
      </div>

      <div id="time-to-fix" className="scroll-mt-24">
      <Section title="Time to fix" height={240} query={ttf} meta={overall?.fixed ? `Typically ${daysText(overall.median_days)} from first seen to fixed; 9 in 10 within ${daysText(overall.p90_days)}. ${plural(overall.fixed, "fix", "fixes")} in the last ${ttf.data?.window_days ?? 180} days` : undefined}>
        {ttf.data && ttf.data.by_object.length ? (
          <div className="flex flex-col gap-4">
            <Bar data={ttf.data.by_object.map((o) => ({ x: o.module, y: o.median_days ?? 0, label: formatModuleName(o.module), object: o.module }))} height={Math.max(120, ttf.data.by_object.length * 32)} label="Typical days to fix per object" onPointClick={(p) => { if (p.object) router.push(fix({ module: p.object })); }} />
            {ttf.data.by_severity.length > 0 && (
              <p className="m-text-body m-ink-2 flex flex-wrap items-center gap-3">
                {ttf.data.by_severity.map((s) => (
                  <span key={s.severity} className="inline-flex items-center gap-1"><Status kind="severity" value={s.severity} /> {daysText(s.median_days)}</span>
                ))}
              </p>
            )}
            <DataTable columns={ttfColumns} data={ttf.data.by_check} getRowId={(r) => `${r.module}:${r.check_id}`} hideToolbar height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="Nothing fixed yet" detail="Fix times appear once a run shows a record passing" action={<Link href={fixHref} className={linkClass}>Open Fix work</Link>} />
        )}
      </Section>
      </div>

      <Section title="Problems that come back" height={200} query={rec} meta={rec.data?.totals.reopened ? `${plural(rec.data.totals.reopened, "failing record")} failed again after a fix: ${pct(rec.data.totals.rate_pct)} of ${n(rec.data.totals.issues)} tracked` : undefined}>
        {rec.data && rec.data.by_check.length ? (
          <div className="flex flex-col gap-4">
            <DataTable columns={recurColumns} data={rec.data.by_check} getRowId={(r) => `${r.module}:${r.check_id}`} hideToolbar height="auto" />
            {rec.data.by_system.length > 0 && <DataTable columns={systemColumns} data={rec.data.by_system} getRowId={(r) => r.scope} hideToolbar height="auto" />}
          </div>
        ) : (
          <EmptyState variant="inline" title="Nothing has come back after a fix" action={<Link href={withScope("/insights/rules", { run })} className={linkClass}>Open rules</Link>} />
        )}
      </Section>

      <Section
        title="Where the failing records sit"
        height={240}
        query={roots}
        meta={activeDim ? `${activeDim.label}: ${plural(activeDim.records, "failing record")} across ${plural(activeDim.values, "value")}, the top ${Math.min(20, activeDim.top.length)} shown` : undefined}
        actions={dims.length > 1 ? <Select label="Slice by" value={activeDim?.field ?? ""} onValueChange={setDim} options={dims.map((d) => ({ value: d.field, label: d.label }))} /> : undefined}
      >
        {activeDim ? (
          <div className="flex flex-col gap-4">
            <Pareto data={activeDim.top.map((v) => ({ x: v.value, y: v.records }))} label={`Failing records by ${activeDim.label.toLowerCase()}`} onPointClick={(p) => router.push(fix({ part: { field: activeDim.field, value: String(p.x) } }))} />
            <p className="m-text-meta m-ink-3">Read from the record key: <Mono>{activeDim.field}</Mono></p>
            <DataTable columns={rootColumns} data={activeDim.top} getRowId={(r) => r.value} hideToolbar height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="No organisational unit in the failing records' keys" action={<Link href={withScope("/insights/rules", { run })} className={linkClass}>Explore by rule</Link>} />
        )}
      </Section>

      <Section title="How good the proposals are" height={240} query={prop} meta={prop.data?.totals.proposed ? `${plural(prop.data.totals.proposed, "value")} proposed; checked against the next run after the SAP load` : undefined}>
        {prop.data && prop.data.totals.proposed ? (
          <div className="flex flex-col gap-4">
            <Funnel stages={[
              { label: "Proposed", value: prop.data.totals.proposed },
              { label: "Approved", value: prop.data.totals.approved },
              { label: "Sent to SAP", value: prop.data.totals.exported },
              { label: "Fixed", value: prop.data.totals.fixed },
            ]} onStageClick={(stage) => { const st = STAGE_STATUS[stage.label]; if (st) router.push(fix({ st })); }} />
            <DataTable columns={sourceColumns} data={prop.data.sources.filter((s) => s.proposed || s.fixed || s.still_failing)} getRowId={(r) => r.source} hideToolbar height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="No values proposed yet" action={<Link href={fixHref} className={linkClass}>Open Fix work</Link>} />
        )}
      </Section>

      <Section
        title="Change since the previous run"
        height={200}
        query={change}
        meta={hasChange && change.data ? `${change.data.previous ? `Compared with ${runName(change.data.previous)}` : `Each object compared with the run before its own latest run (${plural(change.data.compared?.length ?? 0, "run")})`}: ${n(change.data.totals.fixed)} fixed, ${n(change.data.totals.new)} new, ${n(change.data.totals.still_failing)} still failing${change.data.not_comparable_checks ? `; ${plural(change.data.not_comparable_checks, "rule")} not in both runs left out` : ""}` : undefined}
      >
        {hasChange && change.data ? (
          change.data.objects.length ? <DataTable columns={changeColumns} data={change.data.objects} getRowId={(r) => r.module} hideToolbar height="auto" />
            : <EmptyState variant="inline" title="No object failed in either run" action={<Link href={runsHref} className={linkClass}>Open runs</Link>} />
        ) : (
          <EmptyState variant="inline" title={isCurrent ? "No object has an earlier run to compare with" : "No earlier run of this system to compare with"} detail="The change appears after the next run" action={<Link href={runsHref} className={linkClass}>Open runs</Link>} />
        )}
      </Section>
    </InsightFrame>
  );
}

"use client";

/**
 * Insights > Progress: the lead's screen. How fast the data is getting fixed, and what is slowing it down:
 * the burn-down with its projected finish, decisions per person, time to fix, what keeps coming back, where
 * the failing records sit, how good the proposals are, and what changed since the previous run.
 * Every number comes from /api/v1/work/analytics (SQL over the work already recorded).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Card, DataTable, DrillLink, EmptyState, Funnel, Line, Mono, Pareto, Select, Status } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getComparisonReportUrl, getWorkbookUrl } from "@/lib/api/reports";
import {
  getBurndown, getProposalQuality, getRecurrence, getRootCauses, getRunChange, getThroughput, getTimeToFix,
  type DecisionKind, type PersonThroughput, type ProposalSourceStat, type Recurrence, type RootCauseValue,
  type RunChangeObject, type TimeToFix, type Workload,
} from "@/lib/api/work-analytics";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, formatModuleName, plural } from "@/lib/format";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { Section } from "../_components/Section";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { burndownChart, DECISION_LABELS, daysText, finishSentence, pct, sourceLabel } from "./progress-model";

const PURPOSE = "How fast the data is getting fixed, and what is slowing it down.";
const n = (x: number) => x.toLocaleString();
const KINDS: DecisionKind[] = ["accept", "edit", "not_an_issue", "accept_risk", "approve"];
const linkClass = "m-ink-accent underline-offset-2 hover:underline";

type CheckFix = TimeToFix["by_check"][number];
type CheckRecurrence = Recurrence["by_check"][number];
type SystemRecurrence = Recurrence["by_system"][number];

export default function ProgressPage() {
  const dayOne = useDayOne();
  const { run, module, resolving } = useInsightScope();
  const scope = { versionId: run, module };
  const key = (name: string) => ["work-analytics", name, run ?? null, module ?? null];
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
  const fixHref = withScope("/fix", { run, module });
  const runsHref = "/runs";

  // ── columns ────────────────────────────────────────────────────────────────
  const peopleColumns = useMemo<ColumnDef<PersonThroughput>[]>(() => [
    { accessorKey: "person", header: "Person" },
    ...KINDS.map((k): ColumnDef<PersonThroughput> => ({ id: k, accessorFn: (r) => r[k], header: DECISION_LABELS[k], meta: { numeric: true }, cell: ({ row }) => n(row.original[k]) })),
    { accessorKey: "total", header: "Decisions", meta: { numeric: true }, cell: ({ row }) => n(row.original.total) },
  ], []);

  const workloadColumns = useMemo<ColumnDef<Workload>[]>(() => [
    { id: "who", header: "Assigned to", accessorFn: (r) => r.name ?? "Nobody yet", cell: ({ row }) => row.original.name ?? <span className="m-ink-3">Nobody yet</span> },
    { accessorKey: "open", header: "Open", meta: { numeric: true }, cell: ({ row }) => n(row.original.open) },
    { accessorKey: "critical", header: "Critical", meta: { numeric: true }, cell: ({ row }) => n(row.original.critical) },
    { accessorKey: "overdue", header: "Overdue", meta: { numeric: true }, cell: ({ row }) => (row.original.overdue ? <span className="m-ink-critical">{n(row.original.overdue)}</span> : "0") },
  ], []);

  const ttfColumns = useMemo<ColumnDef<CheckFix>[]>(() => [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module) },
    { accessorKey: "fixed", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => n(row.original.fixed) },
    { accessorKey: "median_days", header: "Typical time", meta: { numeric: true }, cell: ({ row }) => daysText(row.original.median_days) },
    { accessorKey: "p90_days", header: "9 in 10 within", meta: { numeric: true }, cell: ({ row }) => daysText(row.original.p90_days) },
  ], []);

  const recurColumns = useMemo<ColumnDef<CheckRecurrence>[]>(() => [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module), cell: ({ row }) => <DrillLink object={row.original.module} ruleId={row.original.check_id} run={run}>{formatModuleName(row.original.module)}</DrillLink> },
    { accessorKey: "reopened", header: "Came back", meta: { numeric: true }, cell: ({ row }) => n(row.original.reopened) },
    { accessorKey: "issues", header: "Tracked", meta: { numeric: true }, cell: ({ row }) => n(row.original.issues) },
    { accessorKey: "rate_pct", header: "Rate", meta: { numeric: true }, cell: ({ row }) => pct(row.original.rate_pct) },
  ], [run]);

  const systemColumns = useMemo<ColumnDef<SystemRecurrence>[]>(() => [
    { id: "name", header: "System", accessorFn: (r) => r.name ?? r.scope, cell: ({ row }) => row.original.name ?? <Mono>{row.original.scope}</Mono> },
    { accessorKey: "reopened", header: "Came back", meta: { numeric: true }, cell: ({ row }) => n(row.original.reopened) },
    { accessorKey: "issues", header: "Tracked", meta: { numeric: true }, cell: ({ row }) => n(row.original.issues) },
    { accessorKey: "rate_pct", header: "Rate", meta: { numeric: true }, cell: ({ row }) => pct(row.original.rate_pct) },
  ], []);

  const rootColumns = useMemo<ColumnDef<RootCauseValue>[]>(() => [
    { accessorKey: "value", header: "Value", cell: ({ row }) => <Mono>{row.original.value}</Mono> },
    { accessorKey: "records", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => n(row.original.records) },
    { accessorKey: "open", header: "Still to fix", meta: { numeric: true }, cell: ({ row }) => n(row.original.open) },
    { accessorKey: "critical", header: "Critical", meta: { numeric: true }, cell: ({ row }) => n(row.original.critical) },
    { accessorKey: "share_pct", header: "Share of run", meta: { numeric: true }, cell: ({ row }) => pct(row.original.share_pct) },
  ], []);

  const sourceColumns = useMemo<ColumnDef<ProposalSourceStat>[]>(() => [
    { id: "source", header: "Where the value came from", accessorFn: (r) => sourceLabel(r.source) },
    { accessorKey: "proposed", header: "Proposed", meta: { numeric: true }, cell: ({ row }) => n(row.original.proposed) },
    { accessorKey: "approval_rate_pct", header: "Approved", meta: { numeric: true }, cell: ({ row }) => `${n(row.original.approved)} (${pct(row.original.approval_rate_pct)})` },
    { accessorKey: "exported", header: "Sent to SAP", meta: { numeric: true }, cell: ({ row }) => n(row.original.exported) },
    { accessorKey: "fixed", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => n(row.original.fixed) },
    { accessorKey: "still_failing", header: "Still failing", meta: { numeric: true }, cell: ({ row }) => n(row.original.still_failing) },
    { accessorKey: "fix_rate_pct", header: "Fix rate", meta: { numeric: true }, cell: ({ row }) => pct(row.original.fix_rate_pct) },
  ], []);

  const changeColumns = useMemo<ColumnDef<RunChangeObject>[]>(() => [
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module), cell: ({ row }) => <DrillLink object={row.original.module} run={run}>{formatModuleName(row.original.module)}</DrillLink> },
    { accessorKey: "new", header: "New", meta: { numeric: true }, cell: ({ row }) => (row.original.new ? <span className="m-ink-critical">{n(row.original.new)}</span> : "0") },
    { accessorKey: "fixed", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => n(row.original.fixed) },
    { accessorKey: "still_failing", header: "Still failing", meta: { numeric: true }, cell: ({ row }) => n(row.original.still_failing) },
    { accessorKey: "not_comparable_checks", header: "Rules not in both runs", meta: { numeric: true }, cell: ({ row }) => n(row.original.not_comparable_checks) },
    { id: "action", header: "", enableSorting: false, cell: ({ row }) => <Link href={withScope(`/objects/${row.original.module}`, { run })} className={linkClass}>Open</Link> },
  ], [run]);

  // ── the four sentences and the KPI strip ───────────────────────────────────
  const slowest = ttf.data?.by_object[0];
  const overall = ttf.data?.overall;
  const neverRan = !!b && !b.version_id && b.days.every((d) => d.open === 0 && d.opened === 0);
  const state: "loading" | "empty" | "error" | undefined = resolving || burn.isLoading || dayOne.status === "loading"
    ? "loading"
    : burn.isError ? "error" : neverRan ? "empty" : undefined;
  const openLabel = b?.open_records != null ? "Open records" : "Open issues";
  const openValue = b ? (b.open_records ?? b.open_now) : "—";

  const [dim, setDim] = useState<string>("");
  const dims = roots.data?.dimensions ?? [];
  const activeDim = dims.find((d) => d.field === dim) ?? dims[0];

  return (
    <InsightFrame
      title="Progress"
      scope
      meta={PURPOSE}
      run={run}
      module={module}
      exportOptions={run ? [
        { format: "pdf", label: "Proof of progress (PDF)", run: () => downloadAuthenticated(getComparisonReportUrl(run), `progress_${run}.pdf`) },
        { format: "xlsx", label: "Comparison workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(run, { module }), `comparison_${run}.xlsx`) },
      ] : []}
      insight={{
        hero: true,
        stats: [
          { label: openLabel, value: openValue, hint: b && b.open_records != null ? `${n(b.open_now)} open issues` : undefined, to: fixHref },
          { label: "Fixed this week", value: b?.fixed_7d ?? "—", tone: b?.fixed_7d ? "go" : undefined, hint: "Last 7 days", to: fixHref },
          { label: "Median time to fix", value: overall ? daysText(overall.median_days) : "—", hint: overall?.fixed ? `Over ${plural(overall.fixed, "fix", "fixes")}` : undefined },
          { label: "Projected finish", value: b?.projected_finish ? formatDate(b.projected_finish) : b && b.open_now === 0 ? "Done" : "No date yet", tone: b?.projected_finish ? "go" : b && b.open_now > 0 ? "at-risk" : undefined, hint: b ? `At the last ${b.pace_window_days} days' pace` : undefined },
        ],
        situation: { sentence: b ? (b.open_now ? `${plural(b.open_now, "issue")} open across ${b.open_records != null ? plural(b.open_records, "record") : "the tracked records"}` : "Nothing is open") : "—", tone: b && b.open_now === 0 ? "go" : undefined },
        changed: { sentence: b ? `${plural(b.fixed_7d, "issue")} fixed in the last 7 days; ${b.pace_per_day >= 0 ? `${b.pace_per_day.toLocaleString()} a day net closed` : `${Math.abs(b.pace_per_day).toLocaleString()} a day net added`} over ${b.pace_window_days} days` : "—" },
        why: { sentence: slowest ? `${formatModuleName(slowest.module)} takes longest to fix: typically ${daysText(slowest.median_days)}` : "No fixes recorded yet, so no fix times", href: slowest ? withScope(`/objects/${slowest.module}`, { run }) : undefined },
        next: b && b.projected_finish
          ? { sentence: finishSentence(b), tone: "go", action: { label: "Open fix list", href: fixHref } }
          : { sentence: b ? finishSentence(b) : "—", tone: b && b.open_now > 0 ? "at-risk" : undefined, action: { label: "Open fix list", href: fixHref } },
      }}
      state={state}
      skeleton={<><CardSkeleton height={280} /><CardSkeleton height={240} /><CardSkeleton height={240} /></>}
      emptyProps={{
        title: "Nothing to track yet",
        detail: dayOne.step?.detail ?? "Progress appears once a finished run has found failing records.",
        ghost: "chart",
        action: <DayOneAction step={dayOne.step} fallbackHref={runsHref} fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: apiErrorMessage(burn.error), onRetry: () => void burn.refetch() }}
    >
      <Card
        title="Burn-down"
        meta={b && chart ? `Open issues per day over the last 90 days, at most ${n(chart.peak)}. ${finishSentence(b)}` : undefined}
        actions={<Link href={fixHref} className={linkClass}>Open fix list</Link>}
      >
        {b && chart && b.days.some((d) => d.open > 0) ? (
          <div className="flex flex-col gap-4">
            <Line series={chart.series} data={[]} xDomain={chart.xDomain} height={260} counts label="Open issues per day" />
            {b.runs.length > 1 && (
              <div>
                <p className="m-text-meta m-ink-3">Failing record checks in each run of this system</p>
                <Bar data={b.runs.map((r) => ({ x: r.version_id, y: r.issues, label: r.label || formatDate(r.run_at, "datetime") }))} height={Math.max(120, b.runs.length * 28)} label="Failing record checks per run" />
              </div>
            )}
          </div>
        ) : (
          <EmptyState variant="inline" title="No open issues in the last 90 days" action={<Link href={runsHref} className={linkClass}>Open runs</Link>} />
        )}
      </Card>

      <Section title="Decisions by person" height={240} query={thr} meta={thr.data ? `${plural(thr.data.totals.total, "decision")} in the last ${thr.data.window_days} days` : undefined}>
        {thr.data && thr.data.people.length ? (
          <div className="flex flex-col gap-4">
            <Bar data={thr.data.people.slice(0, 12).map((p) => ({ x: p.person, y: p.total }))} height={Math.max(120, Math.min(12, thr.data.people.length) * 32)} label="Decisions per person, last 30 days" />
            <DataTable columns={peopleColumns} data={thr.data.people} getRowId={(r) => r.person} hideToolbar dense height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="No decisions in the last 30 days" action={<Link href={fixHref} className={linkClass}>Start fixing</Link>} />
        )}
        {thr.data && thr.data.workload.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="m-text-meta m-ink-3">Open work per person</p>
            <DataTable columns={workloadColumns} data={thr.data.workload} getRowId={(r) => r.assignee_id ?? "unassigned"} hideToolbar dense height="auto" />
          </div>
        )}
      </Section>

      <Section title="Time to fix" height={240} query={ttf} meta={overall?.fixed ? `Typically ${daysText(overall.median_days)} from first seen to fixed; 9 in 10 within ${daysText(overall.p90_days)}. ${plural(overall.fixed, "fix", "fixes")} in the last ${ttf.data?.window_days ?? 180} days` : undefined}>
        {ttf.data && ttf.data.by_object.length ? (
          <div className="flex flex-col gap-4">
            <Bar data={ttf.data.by_object.map((o) => ({ x: o.module, y: o.median_days ?? 0, label: formatModuleName(o.module) }))} height={Math.max(120, ttf.data.by_object.length * 32)} label="Typical days to fix per object" />
            {ttf.data.by_severity.length > 0 && (
              <p className="m-text-body m-ink-2 flex flex-wrap items-center gap-3">
                {ttf.data.by_severity.map((s) => (
                  <span key={s.severity} className="inline-flex items-center gap-1"><Status kind="severity" value={s.severity} /> {daysText(s.median_days)}</span>
                ))}
              </p>
            )}
            <DataTable columns={ttfColumns} data={ttf.data.by_check} getRowId={(r) => `${r.module}:${r.check_id}`} hideToolbar dense height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="Nothing fixed yet" detail="Fix times appear once a run shows a record passing" action={<Link href={fixHref} className={linkClass}>Open fix list</Link>} />
        )}
      </Section>

      <Section title="Problems that come back" height={200} query={rec} meta={rec.data?.totals.reopened ? `${plural(rec.data.totals.reopened, "issue")} failed again after a fix: ${pct(rec.data.totals.rate_pct)} of ${n(rec.data.totals.issues)} tracked` : undefined}>
        {rec.data && rec.data.by_check.length ? (
          <div className="flex flex-col gap-4">
            <DataTable columns={recurColumns} data={rec.data.by_check} getRowId={(r) => `${r.module}:${r.check_id}`} hideToolbar dense height="auto" />
            {rec.data.by_system.length > 0 && <DataTable columns={systemColumns} data={rec.data.by_system} getRowId={(r) => r.scope} hideToolbar dense height="auto" />}
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
            <Pareto data={activeDim.top.map((v) => ({ x: v.value, y: v.records }))} label={`Failing records by ${activeDim.label.toLowerCase()}`} />
            <p className="m-text-meta m-ink-3">Read from the record key: <Mono>{activeDim.field}</Mono></p>
            <DataTable columns={rootColumns} data={activeDim.top} getRowId={(r) => r.value} hideToolbar dense height="auto" />
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
            ]} />
            <DataTable columns={sourceColumns} data={prop.data.sources.filter((s) => s.proposed || s.fixed || s.still_failing)} getRowId={(r) => r.source} hideToolbar dense height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="No values proposed yet" action={<Link href={fixHref} className={linkClass}>Open fix list</Link>} />
        )}
      </Section>

      <Section
        title="Change since the previous run"
        height={200}
        query={change}
        meta={change.data?.previous ? `Compared with ${change.data.previous.label || formatDate(change.data.previous.run_at, "datetime")}: ${n(change.data.totals.fixed)} fixed, ${n(change.data.totals.new)} new, ${n(change.data.totals.still_failing)} still failing${change.data.not_comparable_checks ? `; ${plural(change.data.not_comparable_checks, "rule")} not in both runs left out` : ""}` : undefined}
      >
        {change.data?.previous ? (
          change.data.objects.length ? <DataTable columns={changeColumns} data={change.data.objects} getRowId={(r) => r.module} hideToolbar dense height="auto" />
            : <EmptyState variant="inline" title="No object failed in either run" action={<Link href={runsHref} className={linkClass}>Open runs</Link>} />
        ) : (
          <EmptyState variant="inline" title="No earlier run of this system to compare with" detail="The change appears after the next run" action={<Link href={runsHref} className={linkClass}>Open runs</Link>} />
        )}
      </Section>
    </InsightFrame>
  );
}

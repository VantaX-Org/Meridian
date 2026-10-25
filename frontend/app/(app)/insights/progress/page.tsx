"use client";

/** Insights > Progress: what moved since the baseline, and why. Every delta is attributable. */

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { Version } from "@/types/api";
import { toast } from "sonner";
import { Button, Card, DataTable, Delta, DrillLink, HelpHint, Mono, Select, Sparkline, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { compareRecords, compareVersions, pinBaseline, type RecordDiffCheck } from "@/lib/api/versions";
import { getScoreHistory } from "@/lib/api/findings";
import { downloadAuthenticated } from "@/lib/api/download";
import { getComparisonReportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { apiErrorMessage, apiErrorReason, isListFailure, isNotFound } from "@/lib/error";
import { formatDate, formatModuleName, plural, runOptionLabels } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { lineageOf, SCORE_HISTORY_LIMIT } from "@/lib/runs";
import { runScopeLabel } from "@/lib/run-scope";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { Section } from "../_components/Section";
import { useFindingOpener } from "../_components/FindingOpener";
import { useInsightScope, withScope } from "../_components/useInsightScope";

const round1 = (n: number) => Math.round(n * 10) / 10;

interface ObjectRow { module: string; now: number; before: number; change: number; series: number[] }

export default function ProgressPage() {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const dayOne = useDayOne();
  const { can } = useRole();
  const qc = useQueryClient();
  const { run, module, runs, resolving } = useInsightScope();
  const baseline = search.get("baseline") ?? undefined;
  const finding = useFindingOpener(run);

  // Without a chosen baseline the API resolves the previous run of the same system itself (no v1), and answers
  // 404 {"detail": {"reason": "no_baseline"}} when this is the first run.
  const cmp = useQuery({ queryKey: ["versions", "compare", run, baseline, module], queryFn: () => compareVersions(baseline, run ?? "", module), enabled: !!run, retry: false });
  const recs = useQuery({ queryKey: ["versions", "compare-records", run, baseline, module], queryFn: () => compareRecords(run ?? "", baseline, module), enabled: !!run });
  const history = useQuery({ queryKey: ["scores", "history"], queryFn: () => getScoreHistory({ limit: SCORE_HISTORY_LIMIT }) });

  const pin = useMutation({
    mutationFn: () => pinBaseline(run ?? ""),
    onSuccess: () => { toast.success("Pinned as baseline. Later runs compare against it."); void qc.invalidateQueries({ queryKey: queryKeys.run("list") }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const v1 = cmp.data?.v1;
  const v2 = cmp.data?.v2;
  // The compare response carries both runs, so their labels never depend on the run list.
  const label = (v?: { label: string | null; run_at: string; metadata?: Version["metadata"]; dqs_summary?: Version["dqs_summary"] } | null) => (v ? runScopeLabel(v) : "the baseline");
  const composite = (v?: { dqs_summary: Record<string, { composite_score: number | null }> | null } | null) => {
    const s = v?.dqs_summary;
    const scores = s ? Object.values(s).map((d) => d.composite_score).filter((x): x is number => typeof x === "number") : [];
    return scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  };
  const before = composite(v1);
  const now = composite(v2);
  const dqsDelta = before != null && now != null ? round1(now - before) : null;

  const rows = useMemo<ObjectRow[]>(() => {
    const series = history.data?.modules ?? {};
    return Object.entries(cmp.data?.delta ?? {})
      .map(([m, d]) => ({ module: m, now: d.v2_score, before: d.v1_score, change: d.dqs_change, series: (series[m] ?? []).map((p) => p.composite) }))
      .sort((a, b) => a.change - b.change);
  }, [cmp.data, history.data]);

  const objectColumns = useMemo<ColumnDef<ObjectRow>[]>(() => [
    { accessorKey: "module", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module} run={run}>{formatModuleName(row.original.module)}</DrillLink> },
    { accessorKey: "before", header: "Baseline", meta: { numeric: true }, cell: ({ row }) => round1(row.original.before) },
    { accessorKey: "now", header: "Now", meta: { numeric: true }, cell: ({ row }) => round1(row.original.now) },
    { accessorKey: "change", header: "Change", meta: { numeric: true }, cell: ({ row }) => <Delta value={round1(row.original.change)} /> },
    { id: "series", header: "All runs", enableSorting: false, cell: ({ row }) => (row.original.series.length > 1 ? <Sparkline data={row.original.series.map((y, i) => ({ x: String(i), y }))} width={96} height={20} /> : "—") },
    { id: "action", header: "", enableSorting: false, cell: ({ row }) => <Link href={withScope(`/objects/${row.original.module}`, { run })} className="m-ink-accent underline-offset-2 hover:underline">Open</Link> },
  ], [run]);

  // Only rules evaluated in both runs can be said to have moved; the rest are counted, not listed.
  const comparable = useMemo(() => (recs.data?.checks ?? []).filter((c) => c.comparable), [recs.data]);
  const notInBoth = (recs.data?.checks.length ?? 0) - comparable.length;
  const moved = useMemo(() => [...comparable].filter((c) => c.new || c.resolved).sort((a, b) => (b.new + b.resolved) - (a.new + a.resolved)).slice(0, 25), [comparable]);
  const movedColumns = useMemo<ColumnDef<RecordDiffCheck>[]>(() => [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module) },
    { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
    { accessorKey: "resolved", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => row.original.resolved.toLocaleString() },
    { accessorKey: "new", header: "New", meta: { numeric: true }, cell: ({ row }) => row.original.new.toLocaleString() },
    { accessorKey: "persisting", header: "Still failing", meta: { numeric: true }, cell: ({ row }) => row.original.persisting.toLocaleString() },
    {
      id: "action", header: "", enableSorting: false,
      cell: ({ row }) => <Link href={withScope(`/objects/${row.original.module}`, { run, tab: "rules", check: row.original.check_id })} onClick={(e) => e.stopPropagation()} className="m-ink-accent underline-offset-2 hover:underline">Open</Link>,
    },
  ], [run]);

  const t = recs.data?.totals;
  const noEarlier = cmp.isError && (apiErrorReason(cmp.error) === "no_baseline" || (isNotFound(cmp.error) && !baseline) || /earlier run|different systems/i.test(apiErrorMessage(cmp.error)));
  // "Compare with" offers runs of the current run's own lineage: the same system, or uploads of the same objects.
  const current = runs.find((r) => r.id === run);
  const comparableRuns = current ? runs.filter((r) => r.id !== run && lineageOf(r) === lineageOf(current)) : runs.filter((r) => r.id !== run);
  // Runs that share a label ("controlling_1k" ten times) are told apart by date and time.
  const optionLabels = runOptionLabels(comparableRuns);
  const state: "loading" | "empty" | "error" | undefined = resolving || cmp.isLoading || dayOne.status === "loading"
    ? "loading"
    : noEarlier || !run ? "empty"
      : isListFailure(cmp) ? "error" : undefined;

  const improved = rows.filter((r) => r.change > 0).length;
  const slipped = rows.filter((r) => r.change < 0).length;
  const worst = rows[0];

  return (
    <InsightFrame
      title="Since baseline"
      scope
      meta={v1 && v2 ? `compared with ${label(v1)}` : undefined}
      toolbar={
        <>
          <span className="inline-flex items-center gap-1">
            <Select
              label="Compare with"
              value={baseline ?? ""}
              onValueChange={(id) => router.replace(withScope(path, { run, module, baseline: id || undefined }))}
              options={[{ value: "", label: "Pinned baseline or previous run" }, ...comparableRuns.map((r) => ({ value: r.id, label: `${optionLabels.get(r.id) ?? formatDate(r.run_at, "datetime")}${r.metadata?.baseline ? " (baseline)" : ""}` }))]}
            />
            <HelpHint term="baseline" />
          </span>
          {can("analyse") && run ? <Button variant="secondary" onClick={() => pin.mutate()} pending={pin.isPending}>Pin as baseline</Button> : null}
        </>
      }
      exportOptions={run ? [
        { format: "pdf", label: "Progress report (PDF)", run: () => downloadAuthenticated(getComparisonReportUrl(run, baseline), `progress_${run}.pdf`) },
        { format: "xlsx", label: "Comparison workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(run, { module, compare: baseline }), `comparison_${run}.xlsx`) },
      ] : []}
      insight={{
        hero: true,
        stats: [
          { label: "DQS now", value: now ?? "—", decimals: 1, tone: dqsDelta == null ? undefined : dqsDelta >= 0 ? "go" : "at-risk", hint: dqsDelta == null ? undefined : dqsDelta === 0 ? "Unchanged since baseline" : `${dqsDelta > 0 ? "+" : ""}${dqsDelta} since baseline`, to: withScope("/insights/trends", { run }) },
          { label: "Records fixed", value: t?.resolved ?? "—", tone: t?.resolved ? "go" : undefined, to: withScope("/fix", { run }) },
          { label: "New failures", value: t?.new ?? "—", tone: t?.new ? "no-go" : "go", to: withScope("/insights/rules", { run }) },
          { label: "Still failing", value: t?.persisting ?? "—", to: withScope("/insights/rules", { run }) },
        ],
        situation: { sentence: dqsDelta == null ? "Not enough scored runs to compare" : dqsDelta === 0 ? `DQS unchanged since ${label(v1)}` : `DQS ${dqsDelta > 0 ? "up" : "down"} ${Math.abs(dqsDelta)} since ${label(v1)}`, tone: dqsDelta == null ? undefined : dqsDelta >= 0 ? "go" : "at-risk" },
        changed: { sentence: t ? `${plural(t.resolved, "record")} fixed, ${plural(t.new, "new failure")}, ${t.persisting.toLocaleString()} still failing${notInBoth ? `; ${plural(notInBoth, "rule")} not in both runs` : ""}` : "—" },
        why: { sentence: rows.length ? `${plural(improved, "object")} improved, ${slipped} slipped` : "—", href: withScope("/objects", { run }) },
        next: worst && worst.change < 0
          ? { sentence: `${formatModuleName(worst.module)} slipped most, start there`, action: { label: "Open object", href: withScope(`/objects/${worst.module}`, { run }) } }
          : { sentence: t?.persisting ? "Clear what is still failing" : "Hold the line, share the proof", action: t?.persisting ? { label: "Review fixes", href: withScope("/fix", { run }) } : { label: "Open reports", href: withScope("/insights/reports", { run }) } },
      }}
      state={state}
      skeleton={<><CardSkeleton height={240} /><CardSkeleton height={240} /></>}
      emptyProps={{
        title: "Nothing to compare yet",
        detail: noEarlier ? "This is the first finished run of its system, so there is nothing earlier to compare with. Progress appears after the next run." : dayOne.step?.detail ?? "Progress appears after the second finished run of a system.",
        ghost: "chart",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: apiErrorMessage(cmp.error), onRetry: () => { void cmp.refetch(); void recs.refetch(); } }}
    >
      <Card title="Objects since baseline" meta={rows.length ? plural(rows.length, "object") : undefined} actions={<Link href={withScope("/objects", { run })} className="m-text-body underline-offset-2 hover:underline">Open objects</Link>}>
        {rows.length === 0 ? <p className="m-text-body m-ink-3">No object is scored in both runs.</p>
          : <DataTable columns={objectColumns} data={rows} getRowId={(r) => r.module} hideToolbar dense height="auto" />}
      </Card>
      <Section title="Rules that moved" height={240} query={recs} meta={`${cmp.data ? `${plural(cmp.data.checks.newly_failing.length, "rule")} newly failing, ${cmp.data.checks.fixed.length.toLocaleString()} fixed. ` : ""}Worst movers first${notInBoth ? `. ${plural(notInBoth, "rule was", "rules were")} not evaluated in both runs and ${notInBoth === 1 ? "is" : "are"} left out` : ""}`}>
        {moved.length === 0 ? <p className="m-text-body m-ink-3">No rule changed its failing records.</p>
          : <DataTable columns={movedColumns} data={moved} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />}
      </Section>
      {finding.drawer}
    </InsightFrame>
  );
}

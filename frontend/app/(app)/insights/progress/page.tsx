"use client";

/** Insights > Progress: what moved since the baseline, and why. Every delta is attributable. */

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, DataTable, Delta, DrillLink, Mono, Pill, Select, Sparkline, Stat, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { compareRecords, compareVersions, pinBaseline, type RecordDiffCheck } from "@/lib/api/versions";
import { getScoreHistory } from "@/lib/api/findings";
import { downloadAuthenticated } from "@/lib/api/download";
import { getComparisonReportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { InsightActions } from "../_components/InsightActions";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { Section } from "../_components/Section";
import { useFindingOpener } from "../_components/FindingOpener";
import { useInsightScope, withScope } from "../_components/useInsightScope";

const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "at-risk", medium: "at-risk" };
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

  const recs = useQuery({ queryKey: ["versions", "compare-records", run, baseline, module], queryFn: () => compareRecords(run ?? "", baseline, module), enabled: !!run });
  // /versions/compare needs v1; the records diff resolves the pinned baseline or previous run for us.
  const v1Id = baseline ?? recs.data?.v1;
  const cmp = useQuery({ queryKey: ["versions", "compare", run, v1Id, module], queryFn: () => compareVersions(v1Id, run ?? "", module), enabled: !!run && !!v1Id });
  const history = useQuery({ queryKey: ["scores", "history"], queryFn: () => getScoreHistory({ limit: 24 }) });

  const pin = useMutation({
    mutationFn: () => pinBaseline(run ?? ""),
    onSuccess: () => { toast.success("Pinned as baseline. Later runs compare against it."); void qc.invalidateQueries({ queryKey: queryKeys.run("list") }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const label = (id?: string | null) => { const v = runs.find((r) => r.id === id); return v ? v.label || formatDate(v.run_at, "datetime") : "the previous run"; };
  const v1 = cmp.data?.v1;
  const v2 = cmp.data?.v2;
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
  ], [run]);

  const moved = useMemo(() => [...(recs.data?.checks ?? [])].filter((c) => c.new || c.resolved).sort((a, b) => (b.new + b.resolved) - (a.new + a.resolved)).slice(0, 25), [recs.data]);
  const movedColumns = useMemo<ColumnDef<RecordDiffCheck>[]>(() => [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Object", accessorFn: (r) => formatModuleName(r.module) },
    { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"} variant="solid">{labelOf(row.original.severity)}</Pill> },
    { accessorKey: "resolved", header: "Fixed", meta: { numeric: true }, cell: ({ row }) => row.original.resolved.toLocaleString() },
    { accessorKey: "new", header: "New", meta: { numeric: true }, cell: ({ row }) => row.original.new.toLocaleString() },
    { accessorKey: "persisting", header: "Still failing", meta: { numeric: true }, cell: ({ row }) => row.original.persisting.toLocaleString() },
    { id: "comparable", header: "", enableSorting: false, cell: ({ row }) => (row.original.comparable ? null : <Pill tone="info">Partial</Pill>) },
  ], []);

  const t = recs.data?.totals;
  const cmpError = recs.isError ? recs.error : cmp.error;
  const noEarlier = !!cmpError && /earlier run|different systems/i.test(apiErrorMessage(cmpError));
  const state: "loading" | "empty" | "error" | undefined = resolving || recs.isLoading || (!!v1Id && cmp.isLoading) || dayOne.status === "loading"
    ? "loading"
    : noEarlier || !run ? "empty"
      : isListFailure(recs) || isListFailure(cmp) ? "error" : undefined;

  const improved = rows.filter((r) => r.change > 0).length;
  const slipped = rows.filter((r) => r.change < 0).length;
  const worst = rows[0];

  return (
    <InsightFrame
      title="Progress"
      meta={v1 && v2 ? `${label(v2.id)} compared with ${label(v1.id)}` : undefined}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            label="Compare with"
            value={baseline ?? ""}
            onValueChange={(id) => router.replace(withScope(path, { run, module, baseline: id || undefined }))}
            options={[{ value: "", label: "Pinned baseline or previous run" }, ...runs.filter((r) => r.id !== run).map((r) => ({ value: r.id, label: `${r.label || formatDate(r.run_at, "datetime")}${r.metadata?.baseline ? " (baseline)" : ""}` }))]}
          />
          {can("analyse") && run ? <Button variant="secondary" onClick={() => pin.mutate()} pending={pin.isPending}>Pin as baseline</Button> : null}
          <InsightActions
            run={run}
            module={module}
            options={run ? [
              { format: "pdf", label: "Proof of progress (PDF)", run: () => downloadAuthenticated(getComparisonReportUrl(run, baseline), `progress_${run}.pdf`) },
              { format: "xlsx", label: "Comparison workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(run, { module, compare: baseline }), `comparison_${run}.xlsx`) },
            ] : []}
          />
        </div>
      }
      insight={{
        hero: true,
        stats: [
          { label: "DQS now", value: now ?? "—", decimals: 1, tone: dqsDelta == null ? undefined : dqsDelta >= 0 ? "go" : "at-risk", hint: dqsDelta == null ? undefined : `${dqsDelta > 0 ? "+" : ""}${dqsDelta} since baseline`, to: withScope("/insights/trends", { run }) },
          { label: "Records fixed", value: t?.resolved ?? "—", tone: t?.resolved ? "go" : undefined, to: withScope("/fix", { run }) },
          { label: "New failures", value: t?.new ?? "—", tone: t?.new ? "no-go" : "go", to: withScope("/insights/rules", { run }) },
          { label: "Still failing", value: t?.persisting ?? "—", to: withScope("/insights/rules", { run }) },
        ],
        situation: { sentence: dqsDelta == null ? "Not enough scored runs to compare" : `DQS ${dqsDelta >= 0 ? "up" : "down"} ${Math.abs(dqsDelta)} since ${label(v1?.id)}`, tone: dqsDelta == null ? undefined : dqsDelta >= 0 ? "go" : "at-risk" },
        changed: { sentence: t ? `${t.resolved.toLocaleString()} records fixed, ${t.new.toLocaleString()} new failures, ${t.persisting.toLocaleString()} still failing` : "—" },
        why: { sentence: rows.length ? `${improved} objects improved, ${slipped} slipped` : "—", href: withScope("/objects", { run }) },
        next: worst && worst.change < 0
          ? { sentence: `${formatModuleName(worst.module)} slipped most, start there`, action: { label: "Open object", href: withScope(`/objects/${worst.module}`, { run }) } }
          : { sentence: t?.persisting ? "Clear what is still failing" : "Hold the line, share the proof", action: t?.persisting ? { label: "Auto clean", href: withScope("/fix", { run }) } : { label: "Open reports", href: withScope("/insights/reports", { run }) } },
      }}
      state={state}
      skeleton={<><CardSkeleton height={240} /><CardSkeleton height={240} /></>}
      emptyProps={{
        title: "Nothing to compare yet",
        detail: noEarlier ? apiErrorMessage(cmpError) : dayOne.step?.detail ?? "Progress appears after the second finished run of a system.",
        ghost: "chart",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: apiErrorMessage(cmpError), onRetry: () => { void cmp.refetch(); void recs.refetch(); } }}
    >
      <Card title="Objects since baseline" meta={rows.length ? `${rows.length} objects` : undefined} actions={<Link href={withScope("/objects", { run })} className="m-text-body underline-offset-2 hover:underline">Open objects</Link>}>
        {rows.length === 0 ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No object is scored in both runs.</p>
          : <DataTable columns={objectColumns} data={rows} getRowId={(r) => r.module} hideToolbar dense height="auto" />}
      </Card>
      <Section title="Rules that moved" height={240} query={recs} meta="Fixed, new and still-failing records per rule, worst movers first">
        {moved.length === 0 ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No rule changed its failing records.</p>
          : <DataTable columns={movedColumns} data={moved} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />}
      </Section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Newly failing rules" value={cmp.data?.checks.newly_failing.length ?? "—"} tone={cmp.data?.checks.newly_failing.length ? "no-go" : "go"} href={withScope("/insights/rules", { run })} />
        <Stat label="Rules fixed" value={cmp.data?.checks.fixed.length ?? "—"} tone={cmp.data?.checks.fixed.length ? "go" : undefined} href={withScope("/insights/rules", { run })} />
      </div>
      {finding.drawer}
    </InsightFrame>
  );
}

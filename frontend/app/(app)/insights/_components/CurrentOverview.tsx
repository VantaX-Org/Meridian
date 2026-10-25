"use client";

// The Insights overview without `?run=` or `?module=`: the current state across objects, every object at the latest
// finished run of its lineage (lib/current-state.ts), the same set the homes and /objects summarise. Every number
// here is computed from those runs' scores or read from an endpoint that answers the current state itself: root
// causes, S/4 migration, the cleansing funnel, auto-fixable records and value at risk come from the `scope=current`
// endpoints, which take each object once from the newest run that measured it. The Runs card opens one run.
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, buildDrillHref, Card, DataTable, Delta, Heatmap, Line, Mono, Radar, Score, Stat, Status } from "@/design";
import { getFindings } from "@/lib/api/findings";
import { getCurrentCleansing, getCurrentOverview, getCurrentRootCauses, l1Label } from "@/lib/api/insights";
import { getCurrentS4Readiness } from "@/lib/api/migration";
import { getObjects } from "@/lib/api/v1/objects";
import { blockingTotal, runObjectsName, stateDqs, stateObjects, stateRows, stateSeries, stateSummary, tierOf } from "@/lib/current-state";
import { DIMENSIONS, dimensionHeatmapCells, runCap, runDimensions, worstObjectsFirst } from "@/lib/home-metrics";
import { verdictSentence } from "@/lib/home-narrative";
import { deltaSentence, formatModuleName, plural, round1, trendSentence } from "@/lib/format";
import { previousInLineage } from "@/lib/runs";
import { runScopeLabel } from "@/lib/run-scope";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import type { Finding } from "@/types/api";
import { InsightFrame, formatMoney } from "./InsightFrame";
import { CleansingFunnel, RootCauseList, S4Chart, s4Totals } from "./RunAnalyses";
import { InsightActions } from "./InsightActions";
import { Section } from "./Section";
import { useCurrentState } from "./useCurrentState";
import { withScope } from "./useInsightScope";

const VERDICT = { pass: "Go", warn: "At risk", fail: "No-go" } as const;
const TONE = { pass: "go", warn: "at-risk", fail: "no-go" } as const;

const findingColumns: ColumnDef<Finding>[] = [
  { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
  { id: "module", header: "Object", accessorFn: (f) => formatModuleName(f.module) },
  { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  { accessorKey: "affected_count", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => row.original.affected_count.toLocaleString() },
  {
    id: "action", header: "", enableSorting: false,
    cell: ({ row }) => (
      <Link href={buildDrillHref({ object: row.original.module, ruleId: row.original.check_id, run: row.original.version_id })} onClick={(e) => e.stopPropagation()} className="m-ink-accent underline-offset-2 hover:underline">Open</Link>
    ),
  },
];

export function CurrentOverview() {
  const router = useRouter();
  const dayOne = useDayOne();
  const { finished, runs, objects, newest, modules, loading: listLoading } = useCurrentState();
  // The tenant's score bands; the same request (and cache entry) as the homes' objects list.
  const bandsQ = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  const bands = bandsQ.data?.thresholds;
  // Without version_id the API answers the current state (the latest run of every lineage); same key as the homes.
  const findingsQ = useQuery({
    queryKey: ["home-top-findings", "current"],
    queryFn: () => getFindings({ sort: "impact", limit: 100 }),
    enabled: !!newest,
  });

  // The analyses the API computes per run, asked for the current state (`scope=current`): the same runs, each object
  // once from the newest run that measured it, as `stateObjects` takes them here.
  const ovQ = useQuery({ queryKey: queryKeys.insights("overview", "current"), queryFn: () => getCurrentOverview(), enabled: !!newest });
  const causesQ = useQuery({ queryKey: queryKeys.insights("root-causes", "current"), queryFn: () => getCurrentRootCauses(), enabled: !!newest });
  const cleanseQ = useQuery({ queryKey: queryKeys.insights("cleansing", "current"), queryFn: () => getCurrentCleansing(), enabled: !!newest });
  const s4Q = useQuery({ queryKey: queryKeys.insights("s4-readiness", "current"), queryFn: () => getCurrentS4Readiness(), enabled: !!newest });
  const ov = ovQ.data;
  const s4 = s4Totals(s4Q.data?.areas ?? []);
  // A module-scoped user sees only in-scope objects, as everywhere on this page.
  const clusters = (causesQ.data?.clusters ?? []).filter((c) => !modules || modules.has(c.module));

  const merged = stateSummary(objects);
  const rows = stateRows(objects, bands, null, finished);
  const dqs = stateDqs(objects);
  const tier = tierOf(dqs, bands);
  // The change the newest run made: the newest run swapped for the one before it in its own lineage.
  const previous = newest ? previousInLineage(newest, finished) : null;
  const previousDqs = previous && newest ? stateDqs(stateObjects(runs.map((r) => (r.id === newest.id ? previous : r)), modules)) : null;
  const delta = dqs != null && previousDqs != null ? round1(dqs - previousDqs) : null;
  const cap = runCap(merged);
  const measured = objects.filter((o) => o.summary.composite_score != null).length;
  const capped = objects.filter((o) => o.summary.composite_score != null && o.summary.capped).length;
  const blocking = blockingTotal(objects);
  const withBlocking = objects.filter((o) => o.summary.critical_count + o.summary.high_count > 0).length;
  const notReady = rows.filter((r) => r.readiness === "fail");
  const worst = worstObjectsFirst(rows)[0];
  const runOf = new Map(objects.map((o) => [o.module, o.run.id]));
  const objectsHref = (q: Record<string, string> = {}) => withScope("/objects", q);
  const worstHref = worst ? withScope(`/objects/${worst.module}`, { run: worst.run_id }) : objectsHref();

  const series = useMemo(() => stateSeries(finished, modules), [finished, modules]);
  const trendNote = series.length > 1 ? trendSentence(series[0].y, series[series.length - 1].y, series.length, "Score of all objects") : undefined;
  const dimScores = runDimensions(merged);
  const dims = DIMENSIONS.flatMap((d) => (dimScores?.[d] == null ? [] : [{ x: formatModuleName(d), y: dimScores[d] as number, dimension: d }]));
  const heatRows = [...rows].sort((a, b) => a.label.localeCompare(b.label));
  const heatCells = dimensionHeatmapCells(heatRows, merged, bands);
  const heatTone = new Map(heatCells.map((c) => [`${c.row}:${c.col}`, c.tone]));

  // Each object's findings from its own current run only, highest impact first.
  const fixFirst = (findingsQ.data?.findings ?? [])
    .filter((f) => (!modules || modules.has(f.module)) && f.version_id === runOf.get(f.module))
    .slice(0, 10);

  // The runs behind the current state, worst object first, for the analyses that are computed per run.
  const perRun = runs
    .map((run) => {
      const own = objects.filter((o) => o.run.id === run.id);
      const scores = own.flatMap((o) => (o.summary.composite_score == null ? [] : [o.summary.composite_score]));
      return { run, own, worstScore: scores.length ? Math.min(...scores) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.worstScore - b.worstScore);

  const state: "loading" | "empty" | undefined =
    listLoading || dayOne.status === "loading" ? "loading" : !newest || objects.length === 0 ? "empty" : undefined;
  const loading = state === "loading";
  const verdict = tier ? VERDICT[tier] : loading ? "Scoring" : "Not scored yet";
  const tone = tier ? TONE[tier] : undefined;
  const hint = cap ? `Capped at ${cap.cap}` : capped ? `${capped} of ${plural(measured, "object")} capped` : undefined;
  const blockingLine = `${plural(blocking, "blocking finding")}${withBlocking ? ` in ${plural(withBlocking, "object")}` : ""}`;

  return (
    <InsightFrame
      title="Insights"
      scope
      actions={<InsightActions current />}
      insight={{
        hero: true,
        loading,
        lead: (
          <div className="m-hero-lead">
            <Score
              size="hero"
              loading={loading}
              value={dqs}
              versionId={newest?.id}
              href={objectsHref()}
              tone={tone}
              hint={hint}
              delta={delta != null ? <Delta value={delta} /> : undefined}
            />
            <div className="m-hero-verdict" data-testid="hero-verdict">
              <span className="font-semibold m-text-verdict-line m-ink [letter-spacing:var(--m-tracking-title)]">{verdict}</span>
              <span className="m-text-body m-ink-2">{newest ? blockingLine : " "}</span>
            </div>
          </div>
        ),
        stats: [
          { label: "Blocking findings", value: newest ? blocking : "—", hint: blocking ? "critical and high" : "none", tone: newest ? (blocking ? "no-go" : "go") : undefined, to: objectsHref({ readiness: "fail" }), versionId: newest?.id },
          { label: "Objects not ready", value: newest ? notReady.length : "—", hint: `of ${rows.length}`, tone: newest ? (notReady.length ? "no-go" : "go") : undefined, to: objectsHref({ readiness: "fail" }), versionId: newest?.id },
          { label: "Worst object", value: worst?.composite_score != null ? worst.composite_score.toFixed(1) : "—", hint: worst?.label, to: worstHref },
          {
            label: "Auto-fixable records",
            value: ov ? ov.auto_fixable.records : "—",
            hint: ov?.auto_fixable.pct != null ? `${Math.round(ov.auto_fixable.pct)}% of failing records` : undefined,
            to: withScope("/fix", { source: "rule", confidence: "high" }),
          },
        ],
        situation: {
          sentence: dqs != null ? `DQS ${dqs.toFixed(1)} across ${plural(measured, "object")}${tier ? `, ${VERDICT[tier].toLowerCase()}` : ""}` : loading ? "Loading" : "—",
          tone,
          href: objectsHref(),
        },
        changed: { sentence: delta != null ? deltaSentence(delta, "with the latest run") : newest ? `First run of ${runObjectsName(newest)}` : "—" },
        why: { sentence: newest ? verdictSentence(rows) : "—", href: objectsHref({ readiness: "fail" }) },
        next: {
          sentence: worst ? `Start with ${worst.label}` : "Open the objects list",
          action: { label: worst ? "Open worst object" : "Open objects", href: worstHref },
        },
      }}
      state={state}
      emptyProps={{
        title: "No insights yet",
        detail: dayOne.step?.detail ?? "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: apiErrorMessage(bandsQ.error) }}
    >
      <div className="flex flex-col [gap:var(--m-section-gap)]" data-testid="insights-overview">
        {/* The ledger: the failing rules ranked by impact, each object at its latest run, each with its one action. */}
        <Section
          title="Fix first" height={264} query={findingsQ}
          meta="Highest-impact failing rules, each object at its latest run"
          actions={<Link href={objectsHref()} className="m-text-body underline-offset-2 hover:underline">Open objects</Link>}
        >
          <DataTable
            columns={findingColumns}
            data={fixFirst}
            getRowId={(f) => f.id}
            onRowClick={(f) => router.push(buildDrillHref({ object: f.module, ruleId: f.check_id, run: f.version_id }))}
            hideToolbar dense height="auto"
          />
        </Section>

        <div className="grid gap-4 @5xl:grid-cols-12">
          <div className="@5xl:col-span-8">
            <Card title="Trend" meta={trendNote}>
              {series.length < 2 ? <p className="m-text-body m-ink-3">A trend needs at least two scored runs.</p> : (
                <Line data={series} label="DQS of all objects over runs" dqsThreshold={bands?.target} height={180} />
              )}
            </Card>
          </div>
          <div className="@5xl:col-span-4">
            <Card title="Dimensions" meta="Mean over the objects">
              {dims.length === 0 ? <p className="m-text-body m-ink-3">No dimension scores yet.</p>
                : dims.length < 3 ? <Bar data={dims} label="Dimension scores, all objects" height={140} />
                : <Radar data={dims} label="Dimension scores, all objects" height={200} />}
            </Card>
          </div>

          <div className="@5xl:col-span-4">
            <Section
              title="Root causes" height={200} query={causesQ}
              meta={causesQ.data ? `${Math.min(5, clusters.length)} of ${clusters.length}, each object at its latest run` : undefined}
            >
              <RootCauseList clusters={clusters} empty="No failing fields in any object's latest run." />
            </Section>
          </div>
          <div className="@5xl:col-span-4">
            <Section title="S/4 migration" height={200} query={s4Q} meta={s4Q.data ? `${s4.blocking.toLocaleString()} blocking, ${s4.warning.toLocaleString()} warning` : undefined}>
              <S4Chart areas={s4Q.data?.areas ?? []} />
            </Section>
          </div>
          <div className="@5xl:col-span-4">
            <Section title="Cleansing opportunity" height={200} query={cleanseQ} meta="Each object at its latest run">
              <CleansingFunnel steps={cleanseQ.data?.steps ?? []} />
            </Section>
          </div>

          <div className="@5xl:col-span-6">
            <Section title="Value at risk" height={120} query={ovQ} meta="Worst L1 process; never summed across L1s">
              {ov?.value_at_risk.worst_l1 ? (
                <div className="grid grid-cols-2 gap-3" data-testid="current-value-at-risk">
                  <Stat
                    label={`Worst L1, ${l1Label(ov.value_at_risk.worst_l1)}`}
                    value={formatMoney(ov.value_at_risk.worst_l1_amount, ov.value_at_risk.currency)}
                    href="/insights/impact"
                  />
                  <Stat label="Features blocked" value={ov.value_at_risk.features_blocked} href="/insights/impact" />
                </div>
              ) : (
                <p className="m-text-body m-ink-3">No priced feature is affected.</p>
              )}
            </Section>
          </div>
          <div className="@5xl:col-span-6">
            <Card title="Runs" meta="One run's analysis">
              <ul className="flex flex-col gap-2" data-testid="per-run-list">
                {perRun.slice(0, 6).map(({ run, own }) => (
                  <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-x-3 m-text-body">
                    <Link href={withScope("/insights", { run: run.id })} className="underline-offset-2 hover:underline">{runScopeLabel(run)}</Link>
                    <span className="m-text-meta m-ink-3">{own.length === 1 ? formatModuleName(own[0].module) : plural(own.length, "object")}</span>
                  </li>
                ))}
              </ul>
              {perRun.length > 6 && (
                <p className="mt-2 m-text-meta m-ink-3">{`${plural(perRun.length - 6, "more run")} in the Showing picker above.`}</p>
              )}
            </Card>
          </div>

          <div className="@5xl:col-span-12">
            <Card title="Object heatmap" meta="Each object at its latest run">
              {heatCells.length === 0 ? <p className="m-text-body m-ink-3">No object scores yet.</p> : (
                <div role="region" aria-label="Object scores by dimension" tabIndex={0} className="overflow-x-auto">
                  <Heatmap
                    rows={heatRows.map((r) => r.label)}
                    cols={DIMENSIONS.map(formatModuleName)}
                    cells={heatCells.map((c) => ({ row: c.row, col: c.col, value: c.value }))}
                    tone={(c) => heatTone.get(`${c.row}:${c.col}`)}
                    cellSize={32}
                    rowHref={(row) => {
                      const r = heatRows.find((x) => x.label === row);
                      return r ? withScope(`/objects/${r.module}`, { run: r.run_id }) : "/objects";
                    }}
                    onPointClick={(cell) => {
                      const r = heatRows.find((x) => x.label === cell.row);
                      const d = DIMENSIONS.find((x) => formatModuleName(x) === cell.col);
                      if (r) router.push(buildDrillHref({ object: r.module, dimension: d, run: r.run_id }));
                    }}
                  />
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </InsightFrame>
  );
}

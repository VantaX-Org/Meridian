"use client";

// The Insights overview without `?run=` or `?module=`: the current state across objects, every object at the latest
// finished run of its lineage (lib/current-state.ts), the same set the homes and /objects summarise. Every number
// here is computed from those runs' scores or read from an endpoint that answers the current state itself: root
// causes, S/4 migration, the cleansing funnel, auto-fixable records and value at risk come from the `scope=current`
// endpoints, which take each object once from the newest run that measured it. The Runs card opens one run.
import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { buildDrillHref, Card, DataTable, Delta, DimensionBars, Heatmap, Line, Mono, Score, Stat, Status } from "@/design";
import { getFindings } from "@/lib/api/findings";
import { getCurrentCleansing, getCurrentOverview, getCurrentRootCauses, l1Label } from "@/lib/api/insights";
import { getCurrentS4Readiness } from "@/lib/api/migration";
import { getObjects } from "@/lib/api/v1/objects";
import { criticalHighHref, criticalHighTotal, runObjectsName, stateDelta, stateDqs, stateRows, stateSeries, stateSummary, tierOf, type StateObject } from "@/lib/current-state";
import { BELOW_TARGET, DIMENSIONS, dimensionHeatmapCells, isBelowTarget, runCap, runDimensions, worstObjectsFirst } from "@/lib/home-metrics";
import { verdictSentence } from "@/lib/home-narrative";
import { checkClassLabel, deltaSentence, formatModuleName, plural, trendSentence } from "@/lib/format";
import { runScopeLabel } from "@/lib/run-scope";
import { drillLabel, fixHref } from "@/lib/drill";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { COST_AT_RISK, useCostAtRisk } from "@/hooks/use-cost-at-risk";
import { doNext } from "@/lib/do-next";
import type { Finding } from "@/types/api";
import { DrillCount } from "./DrillCount";
import { InsightFrame, formatMoneyCompact } from "./InsightFrame";
import { CleansingFunnel, RootCauseList, S4Chart, s4Totals } from "./RunAnalyses";
import { InsightActions } from "./InsightActions";
import { PAGE_PURPOSE } from "./InsightViews";
import { Section } from "./Section";
import { useCurrentState } from "./useCurrentState";
import { withScope } from "./useInsightScope";

const VERDICT = { pass: "Go", warn: "At risk", fail: "No-go" } as const;
const TONE = { pass: "go", warn: "at-risk", fail: "no-go" } as const;

/** A finding's failing records in Fix work, in the run that found them. */
const findingRecords = (f: Finding) => fixHref({ run: f.version_id, module: f.module, check: f.check_id });

/**
 * Fix first of the current state: each object's findings from its own current run only (a finding of an older run
 * of the same object is dropped), in the order given (highest impact first), at most `limit`.
 */
export function currentFixFirst(findings: readonly Finding[], objects: readonly StateObject[], modules: ReadonlySet<string> | null, limit: number): Finding[] {
  const runOf = new Map(objects.map((o) => [o.module, o.run.id]));
  return findings.filter((f) => (!modules || modules.has(f.module)) && f.version_id === runOf.get(f.module)).slice(0, limit);
}

/** The Fix first ledger's columns over current-state findings (Insights overview and executive summary). */
export const currentFindingColumns: ColumnDef<Finding>[] = [
  {
    accessorKey: "check_id", header: "Rule",
    // Plain words first (the finding's message, else the kind of check), the check id under them.
    cell: ({ row }) => {
      const words = row.original.details?.message || (row.original.check_class ? checkClassLabel(row.original.check_class) : null);
      return (
        <span className="flex flex-col [min-width:14rem]">
          {words ? <span className="line-clamp-2" title={words}>{words}</span> : null}
          <span className={words ? "m-text-meta m-ink-3" : undefined}>
            <DrillCount href={findingRecords(row.original)} label={drillLabel({ what: "failing records", check: row.original.check_id, module: row.original.module })}><Mono>{row.original.check_id}</Mono></DrillCount>
          </span>
        </span>
      );
    },
  },
  {
    id: "module", header: "Object", accessorFn: (f) => formatModuleName(f.module),
    cell: ({ row }) => <DrillCount href={fixHref({ run: row.original.version_id, module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module })}>{formatModuleName(row.original.module)}</DrillCount>,
  },
  { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  { accessorKey: "affected_count", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => (
    <DrillCount href={findingRecords(row.original)} count={row.original.affected_count} label={drillLabel({ count: row.original.affected_count, what: "failing records", check: row.original.check_id, module: row.original.module })}>{row.original.affected_count.toLocaleString()}</DrillCount>
  ) },
  {
    id: "action", header: "", enableSorting: false,
    cell: ({ row }) => (
      <Link href={buildDrillHref({ object: row.original.module, ruleId: row.original.check_id, run: row.original.version_id })} onClick={(e) => e.stopPropagation()} aria-label={`Open rule ${row.original.check_id} on ${formatModuleName(row.original.module)}`} className="m-ink-accent underline underline-offset-2">Open</Link>
    ),
  },
];

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

/** `?severity=critical,high`: the Fix first ledger's severities, in rank order; null for every severity. */
export function severityFilterOf(param: string | null | undefined): string[] | null {
  const wanted = new Set((param ?? "").split(",").map((s) => s.trim().toLowerCase()));
  const out = SEVERITY_ORDER.filter((s) => wanted.has(s));
  return out.length ? out : null;
}

/** "Critical and high" for a severity filter. */
function severityFilterLabel(severities: readonly string[]): string {
  const words = severities.map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
}

/** The API's page size cap for GET /findings. */
const FILTERED_LIMIT = 200;

export function CurrentOverview() {
  const router = useRouter();
  const search = useSearchParams();
  // `?severity=` (the Critical and high tile's drill) narrows the Fix first ledger to those severities, every row.
  const severities = severityFilterOf(search?.get("severity"));
  const severityKey = severities?.join(",");
  const dayOne = useDayOne();
  const { finished, runs, objects, newest, modules, loading: listLoading, error: listError, refetch: refetchList } = useCurrentState();
  // The run list (or the day-one sources) failing is an error, never "No insights yet".
  const loadError = listError ?? (dayOne.status === "error" ? dayOne.error : null);
  // The tenant's score bands; the same request (and cache entry) as the homes' objects list.
  const bandsQ = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  const bands = bandsQ.data?.thresholds;
  // Without version_id the API answers the current state (the latest run of every lineage); same key as the homes.
  const findingsQ = useQuery({
    queryKey: ["home-top-findings", "current"],
    queryFn: () => getFindings({ sort: "impact", limit: 100 }),
    enabled: !!newest,
  });
  const filteredQ = useQuery({
    queryKey: ["current-findings", severityKey],
    queryFn: () => getFindings({ severity: severityKey, sort: "impact", limit: FILTERED_LIMIT }),
    enabled: !!newest && !!severityKey,
  });
  const ledgerQ = severityKey ? filteredQ : findingsQ;

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
  const delta = stateDelta(runs, finished, modules);
  const cap = runCap(merged);
  const measured = objects.filter((o) => o.summary.composite_score != null).length;
  const capped = objects.filter((o) => o.summary.composite_score != null && o.summary.capped).length;
  // Failing critical and high checks; "blocking" is the run overview's set (critical or S/4-blocking rules).
  const criticalHigh = criticalHighTotal(objects);
  // Below target: at risk or no-go (go only at the target), the same objects `/objects?readiness=warn,fail` lists.
  const belowTarget = rows.filter(isBelowTarget);
  const belowTargetTone = rows.some((r) => r.readiness === "fail") ? "no-go" : belowTarget.length ? "at-risk" : "go";
  const worst = worstObjectsFirst(rows)[0];
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
  const fixFirst = currentFixFirst(ledgerQ.data?.findings ?? [], objects, modules, severityKey ? FILTERED_LIMIT : 10);

  // The runs behind the current state, worst object first, for the analyses that are computed per run.
  const perRun = runs
    .map((run) => {
      const own = objects.filter((o) => o.run.id === run.id);
      const scores = own.flatMap((o) => (o.summary.composite_score == null ? [] : [o.summary.composite_score]));
      return { run, own, worstScore: scores.length ? Math.min(...scores) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.worstScore - b.worstScore);

  const state: "loading" | "empty" | "error" | undefined =
    listLoading || dayOne.status === "loading" ? "loading" : loadError ? "error" : !newest || objects.length === 0 ? "empty" : undefined;
  const loading = state === "loading";
  const verdict = tier ? VERDICT[tier] : loading ? "Scoring" : "Not scored yet";
  const tone = tier ? TONE[tier] : undefined;
  const hint = cap ? `Capped at ${cap.cap}` : capped ? `${capped} of ${plural(measured, "object")} capped` : undefined;
  // Value at risk opens on the current state too, so the tiles open it as they read.
  const impactHref = "/insights/impact";
  const impactScopeHint = runs.length > 1 ? `Across ${plural(runs.length, "run")}` : runs.length === 1 ? runScopeLabel(runs[0]) : undefined;
  // Do next: the one step of the current state (lib/do-next.ts), the same Home and the summary name.
  const step = doNext(objects);
  const cost = useCostAtRisk(undefined, !!newest);
  // The hero's sub-line compares against the target rather than repeating the Critical and high tile.
  const belowTargetLine = `${belowTarget.length} of ${plural(rows.length, "object")} below target`;

  return (
    <InsightFrame
      title="Insights"
      purpose={PAGE_PURPOSE["/insights"]}
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
              hint={hint}
              delta={delta != null ? <Delta value={delta} /> : undefined}
            />
            <div className="m-hero-verdict" data-testid="hero-verdict">
              <span className="font-semibold m-text-verdict-line m-ink [letter-spacing:var(--m-tracking-title)]">{verdict}</span>
              <span className="m-text-body m-ink-2">{newest ? belowTargetLine : " "}</span>
            </div>
          </div>
        ),
        stats: [
          { label: "Critical and high findings", value: newest ? criticalHigh : "—", hint: criticalHigh ? "failing rules" : "none", tone: newest ? (criticalHigh ? "no-go" : "go") : undefined, to: criticalHighHref(runs), versionId: newest?.id },
          { label: "Objects below target", value: newest ? belowTarget.length : "—", hint: `of ${rows.length}`, tone: newest ? belowTargetTone : undefined, to: objectsHref({ readiness: BELOW_TARGET }), versionId: newest?.id },
          { label: "Worst object", value: worst?.composite_score != null ? worst.composite_score.toFixed(1) : "—", hint: worst?.label, to: worstHref },
          {
            label: "Records with a suggested value",
            value: ov ? ov.auto_fixable.records : "—",
            hint: ov?.auto_fixable.pct != null ? `${Math.round(ov.auto_fixable.pct)}% of failing records` : undefined,
            to: fixHref({ sugg: true }),
          },
        ],
        situation: {
          sentence: dqs != null ? `DQS ${dqs.toFixed(1)} across ${plural(measured, "object")}${tier ? `, ${VERDICT[tier].toLowerCase()}` : ""}` : loading ? "Loading" : "—",
          tone,
          href: objectsHref(),
        },
        changed: { sentence: delta != null ? deltaSentence(delta, "with the latest run") : newest ? `First run of ${runObjectsName(newest)}` : "—" },
        why: { sentence: newest ? verdictSentence(rows) : "—", href: objectsHref({ readiness: "fail" }) },
        next: step
          ? { sentence: step.sentence, action: step.action }
          : { sentence: "Open the objects list", action: { label: "Open objects", href: worstHref } },
      }}
      state={state}
      emptyProps={{
        title: "No insights yet",
        detail: dayOne.step?.detail ?? "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ error: loadError, onRetry: () => { refetchList(); dayOne.refetch(); } }}
    >
      <div className="flex flex-col [gap:var(--m-section-gap)]" data-testid="insights-overview">
        {/* The ledger: the failing rules ranked by impact, each object at its latest run, each with its one action. */}
        <Section
          title="Fix first" height={264} query={ledgerQ}
          meta={severities
            ? `${severityFilterLabel(severities)} failing rules, each object at its latest run, highest impact first${fixFirst.length >= FILTERED_LIMIT ? `; the first ${FILTERED_LIMIT}` : ""}`
            : "Highest-impact failing rules, each object at its latest run"}
          actions={severities
            ? <Link href="/insights" className="m-text-body underline-offset-2 hover:underline" data-testid="fix-first-clear">Every severity</Link>
            : <Link href={objectsHref()} className="m-text-body underline-offset-2 hover:underline">Open objects</Link>}
        >
          <DataTable
            columns={currentFindingColumns}
            data={fixFirst}
            getRowId={(f) => f.id}
            onRowClick={(f) => router.push(buildDrillHref({ object: f.module, ruleId: f.check_id, run: f.version_id }))}
            hideToolbar height="auto"
          />
        </Section>

        <div className="grid gap-4 @5xl:grid-cols-12">
          <div className="@5xl:col-span-8">
            <Card title="Trend" meta={trendNote}>
              {series.length < 2 ? <p className="m-text-body m-ink-3">A trend needs a second scored run. <Link href="/runs" className="m-ink-accent underline underline-offset-2">Open runs</Link></p> : (
                <Line data={series} label="DQS of all objects over runs" dqsThreshold={bands?.target} height={180} />
              )}
            </Card>
          </div>
          <div className="@5xl:col-span-4">
            <Card title="Dimensions" meta="The six measures behind the score, averaged over the objects">
              {dims.length === 0 ? <p className="m-text-body m-ink-3">No object has dimension scores yet. <Link href="/runs" className="m-ink-accent underline underline-offset-2">Open runs</Link></p>
                // The same bars as Home's hero: six rows read faster than a radar, and each opens its objects.
                : <DimensionBars label="Dimension scores, all objects" items={dims.map((d) => ({ key: d.dimension, label: d.x, score: d.y, href: `/objects?dimension=${d.dimension}` }))} />}
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
            <Section title="Value at risk" height={120} query={ovQ} meta="The end-to-end process with the most at risk; processes are never added together">
              {ov?.value_at_risk.worst_l1 ? (
                <>
                  <div className="grid grid-cols-2 gap-3" data-testid="current-value-at-risk">
                    <Stat
                      label={`Most at risk: ${l1Label(ov.value_at_risk.worst_l1)}`}
                      value={formatMoneyCompact(ov.value_at_risk.worst_l1_amount, ov.value_at_risk.currency)}
                      hint={impactScopeHint}
                      href={impactHref}
                    />
                    <Stat label="SAP features blocked" value={ov.value_at_risk.features_blocked} hint={impactScopeHint} href={impactHref} />
                  </div>
                </>
              ) : (
                <p className="m-text-body m-ink-3">
                  No priced SAP feature is blocked.{cost.text ? ` ${COST_AT_RISK} of the failing records: ${cost.text}.` : ""}{" "}
                  <Link href="/insights/impact" className="m-ink-accent underline underline-offset-2">Open value at risk</Link>
                </p>
              )}
            </Section>
          </div>
          <div className="@5xl:col-span-6">
            <Card title="Runs" meta="Open one run to see its numbers alone">
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
            <Card title="Object heatmap" meta="Each object's score per dimension at its latest run; select a cell to open it">
              {heatCells.length === 0 ? <p className="m-text-body m-ink-3">No object is scored yet. <Link href="/runs" className="m-ink-accent underline underline-offset-2">Open runs</Link></p> : (
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

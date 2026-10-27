// frontend/app/(app)/objects/[object]/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, PageHeader, PageFrame, Card, DataTable, Delta, DrillLink, EmptyState, ErrorState, ExportMenu, Line, Mono, Pager, Pill, SeverityDot, Skeleton, Score, Tabs, emptyExportOptions, isSeverity, entityTabs, Status, statusLabel, type CellMeta } from "@/design";
import { RuleCell } from "@/components/fix/rule-cell";
import { OwnerPicker } from "@/components/owners/OwnerPicker";
import { NextBestActionCard } from "@/components/insight/next-best-action";
import { RunScope } from "@/components/run-scope";
import { useRunScope } from "@/hooks/use-run-scope";
import { hrefWithRun, runLacksObject, runScopeLabel } from "@/lib/run-scope";
import { FilterChips } from "../_header";
import { FindingContextPanel } from "./rules/[ruleId]/finding-context-panel";
import { RootCauseSection } from "./rules/[ruleId]/root-cause";
import { Workbench, useRuleDetails } from "./_workbench";
import { FixStrip } from "./_fix";
import { FixWork } from "@/components/work/fix-work";
import { workSummaryQuery } from "../_work";
import { PAGE_SIZE, STALE_MS, fixSheetHref, isBlocking, objectQuery, recordsQuery, useFixShortcut, useRecordColumns } from "./_shared";
import { exportObject, getObject, type ObjectDetail, type ObjectRule, type ObjectSummary } from "@/lib/api/v1/objects";
import { downloadAuthenticated } from "@/lib/api/download";
import { getObjectReportUrl } from "@/lib/api/reports";
import { exportFindingRecords, getScoreHistory } from "@/lib/api/findings";
import { getSettings } from "@/lib/api/settings";
import { SCORE_HISTORY_LIMIT } from "@/lib/runs";
import { getVersion } from "@/lib/api/versions";
import { getProfileByVersion, type ShapeCount, type ValueCount } from "@/lib/api/field-profile";
import { apiErrorState, isNotFound } from "@/lib/error";
import { getRuleHistoryBatch } from "@/lib/api/rules";
import { queryKeys } from "@/lib/query-keys";
import { rankedName, useRuleNames } from "@/lib/rule-name";
import { DIMENSIONS, formatDate, formatModuleName, moduleDescription, passRatePct, plural, shortCapReason } from "@/lib/format";

const RULE_HISTORY_RUNS = 8;
/** The tabs in view, keyed 1 to 4; Related, History and Audit sit under the strip's "More" menu. */
const TAB_KEYS = ["fix", "overview", "rules", "fields"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

const historyQuery = (object: string, run: string) => ({
  queryKey: queryKeys.ruleHistoryBatch(run, object),
  queryFn: () => getRuleHistoryBatch({ version_id: run, module: object, limit_runs: RULE_HISTORY_RUNS }),
  enabled: !!run,
  staleTime: STALE_MS,
});

/**
 * The object's DQS as the md ring. Once the object and the tenant's weights have loaded, the ring opens the
 * breakdown (weighted dimensions, costliest rules); until then, or without weights, it is the plain ring.
 */
function ObjectScore({ summary, detail, run }: { summary: ObjectSummary; detail: ObjectDetail | undefined; run: string }) {
  const settings = useQuery({ queryKey: queryKeys.scoringSettings(), queryFn: getSettings, retry: false, meta: { ignoreError: true } });
  const composite = summary.composite_score;
  if (composite == null) return null;
  // A critical failure holds the score at the cap: the ring draws the measured score and fills to the cap, as the
  // run's DQS ring does (components/insight/dqs-score.tsx).
  const cap = detail?.capped ? composite : undefined;
  const score = cap != null ? (detail?.raw_score ?? composite) : composite;
  const weights = settings.data?.dqs_weights as Record<string, number> | undefined;
  const measured = detail && weights ? Object.entries(detail.dimension_scores).filter(([d]) => weights[d] != null) : [];
  if (!detail || !weights || measured.length === 0) return <Score value={score} cap={cap} />;
  const total = measured.reduce((n, [d]) => n + weights[d], 0) || 1;
  const tone = summary.readiness === "pass" ? "go" : summary.readiness === "warn" ? "at-risk" : summary.readiness === "fail" ? "no-go" : "neutral";
  const failing = detail.rules.filter((r) => r.affected_count > 0).sort((a, b) => b.affected_count - a.affected_count).slice(0, 5);
  return (
    <Score
      value={score}
      cap={cap}
      explain={{
        band: { label: tone ? statusLabel("verdict", tone) : "Scored", tone },
        capReason: cap != null ? (detail.cap_reason ? shortCapReason(detail.cap_reason) : "a critical finding is open") : undefined,
        run,
        dimensions: measured.map(([d, v]) => ({ name: DIMENSIONS.find((x) => x.id === d)?.label ?? d, weight: weights[d] / total, score: v })),
        // weight descends with rank so the explainer's recordsFailed * weight sort keeps the records order
        rules: failing.map((r, i, all) => ({ ruleId: r.check_id, object: detail.module, recordsFailed: r.affected_count, weight: (all.length - i) / all.length, passRate: passRatePct(r.pass_rate) })),
        historyHref: `/objects/${detail.module}?${new URLSearchParams({ run, tab: "history" })}`,
        recordsHref: `/objects/${detail.module}?${new URLSearchParams({ run, tab: "fix" })}`,
      }}
    />
  );
}

/** The field's most common value shape (highest share), or "—" when none was profiled. */
function topShape(shapes: ShapeCount[]): string {
  if (shapes.length === 0) return "—";
  const top = shapes.reduce((best, s) => (s.share > best.share ? s : best), shapes[0]);
  return `${top.shape} (${Math.round(top.share * 100)}%)`;
}

/** The field's most common values, joined for display, or "—" when not profiled/eligible. */
function topValues(values: ValueCount[] | null): string {
  if (!values || values.length === 0) return "—";
  return values.slice(0, 3).map((v) => `${v.value} (${v.count})`).join(", ");
}

/**
 * The object's rules, ranked by failing records. Picking a rule opens its failing records beside the list (below it
 * on a narrow screen) on this same tab, `?check_id=` naming the rule, so a rule and its records are read together.
 */
function RulesTab({ object, run, checkId }: { object: string; run: string; checkId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dimension = searchParams.get("dimension");
  const severity = searchParams.get("severity");
  // Blocking = critical or high severity (the same rule the migration export uses). Only "true" filters.
  const blocking = searchParams.get("blocking") === "true";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/objects/${object}?${next.toString()}`, { scroll: false });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams.toString());
    for (const k of ["blocking", "dimension", "severity"]) next.delete(k);
    router.replace(`/objects/${object}?${next.toString()}`, { scroll: false });
  };
  const { data, isLoading, isError, error, refetch } = useQuery(objectQuery(object, run));
  const batch = useQuery(historyQuery(object, run));
  const details = useRuleDetails(object, run);
  // The ranking names the rules it ranks; the catalogue (and the DDIC checks it does not hold) names the rest.
  const catalogueName = useRuleNames(data?.rules.map((r) => r.check_id) ?? []);
  const nameOf = { get: (id: string): string | undefined => catalogueName(id, rankedName(details.data?.rows, id)) };

  const rulesRanked = data
    ? [...data.rules]
        .filter((r) => !dimension || r.dimension === dimension)
        .filter((r) => !severity || r.severity === severity)
        .filter((r) => !blocking || isBlocking(r))
        .sort((a, b) => b.affected_count - a.affected_count)
    : [];

  const delta = (checkId: string): number | null => {
    const runs = batch.data?.history[checkId];
    const [now, before] = [passRatePct(runs?.[0]?.pass_rate), passRatePct(runs?.[1]?.pass_rate)];
    // Points of pass rate between the two newest runs (findings.pass_rate is 0 to 100).
    return now == null || before == null ? null : now - before;
  };
  // The rule's records open on this tab; the filters stay, the older `check` spelling gives way to `check_id`.
  const recordsHref = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("run", run);
    next.set("tab", "rules");
    next.delete("check");
    next.set("check_id", id);
    return `/objects/${object}?${next.toString()}`;
  };
  const selectRule = (id: string) => router.replace(recordsHref(id), { scroll: false });
  const closeRule = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("check");
    next.delete("check_id");
    router.replace(`/objects/${object}?${next.toString()}`, { scroll: false });
  };
  // With a rule open the list is half the width: it keeps the rule, its failing records and its pass rate.
  const compact = !!checkId;

  const allColumns: ColumnDef<ObjectRule>[] = [
    {
      accessorKey: "severity",
      header: "Severity",
      cell: ({ row }) =>
        isSeverity(row.original.severity) ? <SeverityDot severity={row.original.severity} labelled /> : row.original.severity,
    },
    {
      accessorKey: "check_id",
      header: "Rule",
      size: 380,
      // The shared RuleCell: the id on its own line, the words (as `nameOf` ranks them) under it in two lines.
      cell: ({ row }) => <RuleCell id={row.original.check_id} fallback={nameOf.get(row.original.check_id)} className="[min-width:14rem]" />,
    },
    { id: "dimension", accessorKey: "dimension", header: "Dimension", meta: { priority: "low" } satisfies CellMeta, cell: ({ row }) => (row.original.dimension ? formatModuleName(row.original.dimension) : "—") },
    {
      accessorKey: "affected_count",
      header: "Failing records",
      cell: ({ row }) => <DrillLink href={recordsHref(row.original.check_id)}>{row.original.affected_count.toLocaleString()}</DrillLink>,
    },
    {
      accessorKey: "pass_rate",
      header: "Pass rate",
      // pass_rate is already a percentage (0 to 100), as the rules export reads it.
      cell: ({ row }) => (row.original.pass_rate == null ? "—" : `${row.original.pass_rate.toFixed(1)}%`),
    },
    {
      id: "trend",
      header: "Trend",
      meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row }) => {
        const d = delta(row.original.check_id);
        return d == null ? "—" : <Delta value={d} run="previous run" />;
      },
    },
    {
      id: "open",
      header: "Action",
      meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row }) => <Button variant="ghost" size="sm" className="whitespace-nowrap" render={<Link href={recordsHref(row.original.check_id)} scroll={false} onClick={(e) => e.stopPropagation()}>Show records</Link>} />,
    },
  ];
  const columns = compact ? allColumns.filter((c) => !["dimension", "trend", "open"].includes(c.id ?? "")) : allColumns;

  if (isLoading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (isError) return <ErrorState {...apiErrorState(error)} onRetry={() => refetch()} />;
  if (!data || data.rules.length === 0) {
    return (
      <EmptyState
        title="No rules ran for this object"
        ghost="table"
        detail="The run did not include this object's module."
        action={<Button render={<Link href={`/runs/${run}?tab=steps`}>Open run steps</Link>} />}
      />
    );
  }
  if (batch.isError) return <ErrorState {...apiErrorState(batch.error)} onRetry={() => batch.refetch()} />;

  const dimensions = [...new Set(data.rules.map((r) => r.dimension).filter((d): d is string => !!d))].map((d) => ({ value: d, label: formatModuleName(d) }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <FilterChips label="Severity" value={severity} options={SEVERITIES} onChange={(v) => setParam("severity", v)} />
        {dimensions.length > 1 ? <FilterChips label="Dimension" value={dimension} options={dimensions} onChange={(v) => setParam("dimension", v)} /> : null}
        <FilterChips label="Show" value={blocking ? "true" : null} options={[{ value: "true", label: "Critical and high" }]} onChange={(v) => setParam("blocking", v)} />
      </div>
      {rulesRanked.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No rules match"
          detail="No rule fits the current filters."
          action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : (
        <div className={compact ? "grid items-start [gap:var(--m-section-gap)] [grid-template-columns:minmax(0,1fr)] xl:[grid-template-columns:minmax(0,2fr)_minmax(0,3fr)]" : undefined}>
          <DataTable
            columns={columns}
            data={rulesRanked}
            getRowId={(row) => row.check_id}
            dataTour="object-rules"
            label="Rules"
            activeRowId={checkId || null}
            onActiveRowChange={(row) => selectRule(row.check_id)}
            rowHref={(row) => recordsHref(row.check_id)}
            onRowClick={(row) => selectRule(row.check_id)}
          />
          {compact ? (
            <section aria-label="Failing records of the selected rule" className="min-w-0">
              <RuleRecords object={object} run={run} checkId={checkId} onClose={closeRule} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * This object's score across the scored runs of this run's system, oldest first, each as it was scored at the time
 * (as the run page's history does): another system's runs, or today's re-weighting, would not be this object's history.
 */
function HistoryTab({ object, run, systemId }: { object: string; run: string; systemId: string | null | undefined }) {
  const q = useQuery({ queryKey: ["scores", "history"], queryFn: () => getScoreHistory({ limit: SCORE_HISTORY_LIMIT }) });
  const runs = new Map((q.data?.history ?? []).map((h) => [h.version_id, h]));
  // The API lists newest first; the line runs oldest first.
  const series = (q.data?.modules[object] ?? [])
    .filter((p) => (runs.get(p.version_id)?.system_id ?? null) === (systemId ?? null) && p.at_the_time != null)
    .map((p) => ({ version_id: p.version_id, score: p.at_the_time as number }))
    .reverse();
  const points = series.map((p, i) => {
    const h = runs.get(p.version_id);
    return { version_id: p.version_id, x: h?.run_at ? formatDate(h.run_at) : `Run ${i + 1}`, y: Math.round(p.score * 10) / 10, change: i === 0 ? null : Math.round((p.score - series[i - 1].score) * 10) / 10 };
  });
  type Point = (typeof points)[number];
  const columns: ColumnDef<Point>[] = [
    { accessorKey: "x", header: "Run", cell: ({ row }) => <Link href={`/objects/${object}?run=${row.original.version_id}`} className="underline-offset-2 hover:underline">{row.original.x}{row.original.version_id === run ? " (this run)" : ""}</Link> },
    { accessorKey: "y", header: "Score", meta: { numeric: true } },
    { accessorKey: "change", header: "Change", meta: { numeric: true }, cell: ({ row }) => (row.original.change === null ? "—" : <Delta value={row.original.change} />) },
  ];
  if (q.isLoading) return <Skeleton height={240} />;
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  if (points.length < 2) return <EmptyState title="Not enough runs to show a history" detail="The score history appears after the second scored run of this object." action={<Button render={<Link href="/runs">Open runs</Link>} />} />;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Score over time" meta={`${points.length} runs, ${points[0].y} to ${points[points.length - 1].y}`}>
        <Line data={points.map((p) => ({ x: p.x, y: p.y }))} label={`${formatModuleName(object)} composite score per run`} />
      </Card>
      <Card title="Runs">
        <DataTable columns={columns} data={[...points].reverse()} getRowId={(p) => p.version_id} hideToolbar height="auto" />
      </Card>
    </div>
  );
}

const profileQuery = (object: string, run: string) => ({
  queryKey: queryKeys.versionProfileByVersion(run, object),
  queryFn: () => getProfileByVersion(run, object),
  enabled: !!run,
  staleTime: STALE_MS,
});
function FieldsTab({ object, run }: { object: string; run: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery(profileQuery(object, run));

  if (isLoading) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (isError) return <ErrorState {...apiErrorState(error)} onRetry={() => refetch()} />;
  if (!data || data.tables.length === 0) {
    return (
      <EmptyState
        title="No field profile for this object"
        detail="The run did not profile this object's fields."
        action={<Button render={<Link href={`/runs/${run}?tab=steps`}>Open run steps</Link>} />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.tables.map((table) => (
        <Card key={table.table} title={<Mono>{table.table}</Mono>} meta={`${table.fields.length} fields`} padding="sm">
          <DataTable
            columns={[
              {
                id: "field",
                header: "Field",
                cell: ({ row }) => <Mono>{table.table}.{row.original.field}</Mono>,
              },
              { accessorKey: "ddic_type", header: "Type", cell: ({ row }) => row.original.stats.ddic_type ?? "—" },
              {
                id: "blank_pct",
                header: "Blank",
                cell: ({ row }) =>
                  `${row.original.stats.blank} (${Math.round(row.original.stats.blank_pct * 100)}%)`,
              },
              { id: "distinct", header: "Distinct", cell: ({ row }) => String(row.original.stats.distinct) },
              { id: "top_shape", header: "Top shape", cell: ({ row }) => <Mono>{topShape(row.original.stats.shapes)}</Mono> },
              {
                id: "top_values",
                header: "Top values",
                cell: ({ row }) =>
                  row.original.stats.masked ? (
                    <span title={row.original.stats.mask_reason ?? "unknown"}><Pill tone="neutral">Masked</Pill></span>
                  ) : (
                    topValues(row.original.stats.top_values)
                  ),
              },
            ]}
            data={table.fields}
            getRowId={(f) => f.field}
          />
        </Card>
      ))}
    </div>
  );
}

/** The failing records of the rule picked on the Rules tab, with what the rule reads and its likely root cause. */
function RuleRecords({ object, run, checkId, onClose }: { object: string; run: string; checkId: string; onClose: () => void }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery(recordsQuery(run, checkId, page));
  useFixShortcut(object, run, data?.records[0]?.record_key);
  const columns = useRecordColumns(object, run, data?.records);
  const details = useRuleDetails(object, run);
  const catalogueName = useRuleNames([checkId]);
  const ruleName = catalogueName(checkId, rankedName(details.data?.rows, checkId)) ?? null;

  if (isLoading) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (isError) return <ErrorState {...apiErrorState(error)} onRetry={() => refetch()} />;
  if (!data || data.records.length === 0) {
    return (
      <EmptyState
        variant="inline"
        title="All records pass this rule"
        detail="Every record passed this check in this run."
        action={<Button variant="secondary" onClick={onClose}>Close</Button>}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const exportOptions = [{ format: "xlsx" as const, run: () => exportFindingRecords(run, checkId, "xlsx") }];

  return (
    <div className="flex flex-col gap-4">
      <FindingContextPanel
        ruleId={checkId}
        run={run}
        moduleId={data.records[0]?.module ?? ""}
        fields={Object.keys(data.records[0]?.field_values ?? {})}
      />
      <Card
        title={ruleName ?? <Mono>{checkId}</Mono>}
        meta={<>{ruleName ? <><Mono>{checkId}</Mono>, </> : null}{data.total.toLocaleString()} record{data.total === 1 ? "" : "s"}</>}
        actions={
          <>
            <Button render={<Link href={fixSheetHref(object, run, data.records[0].record_key)}>Open record</Link>} />
            <ExportMenu options={exportOptions} />
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </>
        }
      >
        <DataTable
          columns={columns}
          data={data.records}
          getRowId={(row) => row.record_key}
          rowHref={(row) => fixSheetHref(object, run, row.record_key)}
          onRowClick={(row) => router.push(fixSheetHref(object, run, row.record_key))}
        />
        <Pager page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
      </Card>
      <RootCauseSection run={run} ruleId={checkId} />
    </div>
  );
}

export default function ObjectDetailPage() {
  const params = useParams<{ object: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const object = params.object;
  // `?run=` when the URL pins one, else this object's latest finished run; nothing is written onto the URL.
  const scope = useRunScope({ object });
  const run = scope.runId ?? "";
  // Records to fix is the default tab; an older `?rule=` link (no tab) still opens the Overview workbench on that rule.
  // `?tab=records` (the retired Records by rule tab, still in older links) opens Rules with that rule's records beside.
  const rawTab = search.get("tab") ?? (search.get("rule") ? "overview" : "fix");
  const tab = rawTab === "records" ? "rules" : rawTab;
  // `check` is the shared drill parameter (rule tables link with it); `check_id` is the older spelling.
  const checkId = search.get("check") ?? search.get("check_id") ?? "";

  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.push(`/objects/${object}?${params.toString()}`);
  };

  // All detail queries start together at page level; tabs share these keys, so switching tabs never waterfalls.
  const { data, error: objectError } = useQuery(objectQuery(object, run));
  const { data: version } = useQuery({
    queryKey: queryKeys.run(run),
    queryFn: () => getVersion(run),
    enabled: !!run,
  });
  useQuery(historyQuery(object, run));
  useQuery(profileQuery(object, run));
  useQuery(recordsQuery(run, checkId, 1));
  const work = useQuery(workSummaryQuery(run || undefined));
  const workObject = work.data?.objects.find((o) => o.module === object);

  // Header content from the list cache while the detail request is in flight.
  // Seeded by the list on row click (keyed by resolved run id); falls back to the list cache on a direct load.
  const { data: listed } = useQuery({
    queryKey: queryKeys.objectSummary(object, run),
    queryFn: () => getObject(object, run),
    enabled: false,
    initialData: () => queryClient.getQueryData<{ objects: ObjectSummary[] }>(queryKeys.objects(run))?.objects.find((o) => o.module === object),
  });
  const summary = data ?? listed;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable],[role=dialog]")) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) setTab(TAB_KEYS[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [object, search]); // eslint-disable-line react-hooks/exhaustive-deps -- setTab closes over both

  if (!run && scope.resolving) {
    return (
      <PageFrame gap={4} aria-busy="true">
        <PageHeader title={formatModuleName(object)} />
        <Skeleton height={240} />
      </PageFrame>
    );
  }
  if (!run && scope.error) {
    // The run list failed: we cannot tell whether a run measured this object.
    return <ErrorState {...apiErrorState(scope.error)} onRetry={scope.refetch} />;
  }
  if (!run) {
    return (
      <EmptyState
        title="No run has measured this object"
        detail="Run an analysis that includes this object to see its data quality."
        action={<Button render={<Link href="/runs">Open runs</Link>} />}
      />
    );
  }
  // A `?run=` that did not measure this object (its run says so, or the server has no such object in it) is a
  // wrong pairing, not a failure: say so and offer this object's own latest run.
  const shownRun = scope.run ?? version;
  if (scope.explicit && ((shownRun && runLacksObject(shownRun, object)) || isNotFound(objectError))) {
    const name = formatModuleName(object);
    return (
      <PageFrame gap={4}>
        <PageHeader title={name} />
        <EmptyState
          title={`${name} is not in this run`}
          detail={`${shownRun ? runScopeLabel(shownRun) : "The run in the link"} did not measure ${name}.`}
          action={
            scope.latestId && scope.latestId !== scope.explicit ? (
              <Button render={<Link href={hrefWithRun(`/objects/${object}`, search, null)}>Show latest run of {name}</Link>} />
            ) : (
              <Button render={<Link href="/runs">Open runs</Link>} />
            )
          }
        />
      </PageFrame>
    );
  }

  const exportOptions = [
    { format: "xlsx" as const, run: () => exportObject(object, run) },
    {
      format: "pdf" as const,
      label: "PDF analysis",
      run: () =>
        downloadAuthenticated(
          getObjectReportUrl(run, object),
          `meridian-${object}-${version?.label ?? run}.pdf`,
        ),
    },
  ];
  // The header's counts open what they count: the failing rules on the Rules tab, the records on Records to fix.
  const tabHref = (t: string) => `/objects/${object}?${new URLSearchParams({ run, tab: t })}`;
  const name = summary?.label ?? formatModuleName(object);
  const description = moduleDescription(object);
  const meta = (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {description && <span className="block w-full max-w-[72ch] m-ink-2">{description}</span>}
      <RunScope scope={scope} hrefFor={(id) => hrefWithRun(`/objects/${object}`, search, id)} />
      {summary && (
        <span>
          <Link href={tabHref("rules")} aria-label={`Open the ${plural(summary.failing_checks, "failing rule")} of ${name}`} className="m-ink-accent underline underline-offset-2">{plural(summary.failing_checks, "failing rule")}</Link>
          {", "}
          {/* Summed over the rules (a record failing two rules counts twice): rule failures, not records; the Overview strip's "Rule failures" is the same count and opens the same tab. */}
          <Link href={tabHref("fix")} aria-label={`Open the records behind the ${plural(summary.affected_records, "rule failure")} of ${name}`} className="m-ink-accent underline underline-offset-2">{plural(summary.affected_records, "rule failure")}</Link>
        </span>
      )}
    </span>
  );

  return (
    <PageFrame gap={4}>
      <PageHeader
        title={summary?.label ?? formatModuleName(object)}
        meta={meta}
        status={
          summary && (summary.composite_score != null || summary.readiness) ? (
            <span className="inline-flex items-center gap-3">
              {summary.composite_score != null ? <ObjectScore summary={summary} detail={data} run={run} /> : null}
              {summary.readiness ? <Status kind="verdict" value={summary.readiness} /> : null}
            </span>
          ) : null
        }
        actions={
          <>
            <OwnerPicker kind="object" refId={object} />
            <ExportMenu options={data ? exportOptions : emptyExportOptions(exportOptions)} />
          </>
        }
      />
      <p className="m-text-body m-ink-2">Records of {summary?.label ?? formatModuleName(object)} that fail a check in this run, worst first. Pick one and fix it.</p>
      {/* On Records to fix the queue's own tiles count the same records; the strip would say it twice. */}
      {tab === "fix" ? null : <FixStrip object={object} summary={summary} work={workObject} loading={work.isLoading} />}
      {run && <NextBestActionCard run={run} module={object} />}
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          // The same queue as Fix work, with this object and this page's run fixed: one triage surface, not two.
          { value: "fix", label: "Records to fix", count: workObject?.open, content: <FixWork module={object} run={run} /> },
          { value: "overview", label: "Overview", content: <Workbench object={object} run={run} /> },
          { value: "rules", label: "Rules", content: <RulesTab object={object} run={run} checkId={checkId} /> },
          { value: "fields", label: "Fields", content: <FieldsTab object={object} run={run} /> },
          ...entityTabs({ entityType: "objects", entityId: object, auditPath: `/objects/${object}`, overflow: true, history: <HistoryTab object={object} run={run} systemId={version?.metadata?.system_id} /> }),
        ]}
      />
    </PageFrame>
  );
}

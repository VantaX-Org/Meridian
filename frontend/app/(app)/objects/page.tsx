// frontend/app/(app)/objects/page.tsx
"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ColumnDef } from "@tanstack/react-table";
import { buildDrillHref, DataTable, RowAction, DomainChip, useBreadcrumbScope, ExplorerPage, ExportMenu, Mono, ObjectMap, PageHeader, Sparkline, Stat, emptyExportOptions, type CellMeta, type ObjectMapItem, type ScoreBands, Status, Score } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAnalysisReportUrl } from "@/lib/api/reports";
import { exportObjects, getObjects, getObjectsMonitor, type Freshness, type ObjectMonitor, type ObjectSummary } from "@/lib/api/v1/objects";
import { getVersion } from "@/lib/api/versions";
import { isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { criticalHighHref, stateObjects, stateScopeLine } from "@/lib/current-state";
import { fixHref } from "@/lib/drill";
import { RuleName } from "@/components/fix/rule-cell";
import { formatModuleName, plural, relativeTime } from "@/lib/format";
import { DrillCount } from "@/app/(app)/insights/_components/DrillCount";
import { bySeverity } from "../_severity-sort";
import { RunScope } from "@/components/run-scope";
import { useRunScope } from "@/hooks/use-run-scope";
import { hrefWithRun } from "@/lib/run-scope";
import { FilterChips } from "./_header";
import { cappedScore } from "./_cap";
import { useCurrentObjects } from "./_current";
import { toFixHref, workSummaryQuery } from "./_work";
import type { WorkObject } from "@/lib/api/work";
import { BELOW_TARGET } from "@/lib/home-metrics";
import { MINE_PARAM, useObjectOwners, type ObjectOwners } from "@/hooks/use-object-owners";
import { OwnerName } from "@/components/owners/OwnerName";
import { getAssignableUsers } from "@/lib/api/users";
import Link from "next/link";
import { FreshnessPill } from "./_freshness";
import { cadenceText } from "./[object]/_monitor";
import { COUNT_DEFS } from "@/lib/counts";

/**
 * A row of the list. With `?run=` every row is that run's; without it (the current state) each row is its object
 * at its own latest run, and links to the object without `?run=` (the object page opens that run itself).
 * `affected_records` is null only when a current-state row's run could not be read and its records not attributed.
 */
type ObjectRow = Omit<ObjectSummary, "affected_records"> & { affected_records: number | null; run_id?: string; work?: WorkObject | null; monitor?: ObjectMonitor };

/** The score drills to the object's rules tab; `run` undefined drills to the object's own latest run. */
const drill = (o: ObjectRow, run: string | undefined, n: number | string) => (
  <DrillCount href={buildDrillHref({ object: o.module, run: run === "latest" ? undefined : run, filters: { tab: "rules" } })} label={`Open the failing rules of ${o.label}`}>{n}</DrillCount>
);

/** Findings that block a load: failing critical and high checks (absent on older backends, which rank on records alone). */
const blockingOf = (o: ObjectRow) => (o.critical_checks ?? 0) + (o.high_checks ?? 0);
/**
 * The ledger's order, worst first: most critical records to fix, then most records to fix (from the work list, when
 * built), then most blocking findings, then most records affected, then lowest DQS; unscored objects last.
 */
const ranked = (a: ObjectRow, b: ObjectRow) =>
  (b.work?.critical ?? 0) - (a.work?.critical ?? 0) || (b.work?.open ?? 0) - (a.work?.open ?? 0) ||
  blockingOf(b) - blockingOf(a) || (b.affected_records ?? 0) - (a.affected_records ?? 0) || (a.composite_score ?? 101) - (b.composite_score ?? 101);

const MAP_VERDICT = { fail: "no-go", warn: "at-risk", pass: "go" } as const;

const READINESS_FILTER = [
  { value: BELOW_TARGET, label: "Below target" },
  { value: "fail", label: "No-go" },
  { value: "warn", label: "At risk" },
  { value: "pass", label: "Go" },
] as const;
type ReadinessFilter = (typeof READINESS_FILTER)[number]["value"];
const FRESHNESS_FILTER: { value: Freshness; label: string }[] = [
  { value: "stale", label: "Stale" },
  { value: "failed", label: "Failed" },
  { value: "manual", label: "Manual" },
];
/** `?verdict=` is the legacy form of `?readiness=` (ready means pass; not_ready has no equivalent and is ignored). */
const LEGACY_VERDICT: Record<string, ReadinessFilter> = { ready: "pass" };

/** Optional enrichment columns appear only when some row carries the field (older backends omit them). */
const makeColumns = (run: string | undefined, bands: ScoreBands | undefined, objects: ObjectRow[], openHref: (o: ObjectRow) => string, ownerOf: (o: ObjectRow) => string | null, ownerStatus: ObjectOwners["status"], view: ListView): ColumnDef<ObjectRow>[] => {
  const hasTrend = objects.some((o) => (o.trend?.length ?? 0) >= 1);
  const hasBlocking = objects.some((o) => o.blocking_rule_id);
  const hasWork = objects.some((o) => o.work !== undefined);
  const monitoring = view === "monitoring";
  // Owner is a column only when someone owns an object (or it cannot be told): "Not set" on every row says nothing.
  const noOwners = ownerStatus === "ready" && objects.every((o) => !ownerOf(o));
  return allColumns(run, bands, openHref, ownerOf, ownerStatus).filter((c) => {
    const id = c.id ?? "";
    if (id === "owner" && noOwners) return false;
    // The monitoring view is Checked, Cadence, Freshness and Change beside the score; the work columns step aside.
    if (monitoring) return !HIDDEN_WHEN_MONITORING.has(id) && id !== "trend";
    if (MONITOR_ONLY.has(id)) return false;
    return (id !== "trend" || hasTrend) && (id !== "blocking_rule" || hasBlocking) && (!WORK_COLUMNS.has(id) || hasWork);
  });
};

/** `?view=monitoring` swaps the work columns for the monitor's; the default view keeps today's columns plus Freshness. */
type ListView = "work" | "monitoring";
const MONITOR_ONLY = new Set(["checked", "cadence", "change"]);
const HIDDEN_WHEN_MONITORING = new Set(["owner", "blocking_rule", "affected_records", "work_open", "work_critical", "work_proposed", "work_overdue"]);

const WORK_COLUMNS = new Set(["work_open", "work_critical", "work_proposed", "work_overdue"]);

/** A work-list count that opens the object's Records to fix with `filters`; "—" when the run's work list is not built. */
const workCell = (o: ObjectRow, run: string | undefined, pick: (w: WorkObject) => number, what: [one: string, many: string], filters: Record<string, string> = {}) => {
  if (!o.work) return "—";
  const n = pick(o.work);
  if (n === 0) return "0";
  return <DrillCount href={toFixHref(o.module, run, filters)} label={`Open the ${plural(n, what[0], what[1])} of ${o.label}`}>{n.toLocaleString()}</DrillCount>;
};
/** `what` names the column's records in the accessible name, one and many: "Open the 3 critical records of Material master". */
const workColumn = (id: string, header: string, pick: (w: WorkObject) => number, run: string | undefined, what: [one: string, many: string], filters?: Record<string, string>): ColumnDef<ObjectRow> => ({
  id,
  accessorFn: (o) => (o.work ? pick(o.work) : -1),
  header,
  size: 110,
  meta: { numeric: true } satisfies CellMeta,
  cell: ({ row }) => workCell(row.original, run, pick, what, filters),
});

/** Newly failing rules since the baseline as a signed count; the title carries the records behind it. */
function ChangeCell({ m }: { m: ObjectMonitor | undefined }) {
  if (!m || m.baseline.kind == null) return <span className="m-ink-3">First run</span>;
  const { drift } = m;
  const title = `${plural(drift.new_failing, "new failing record")}, ${plural(drift.recovered, "recovered record")} since the baseline`;
  if (drift.newly_failing_rule_count === 0 && drift.recovered_rule_count === 0) return <span className="m-ink-3" title={title}>No change</span>;
  return (
    <span className="whitespace-nowrap" title={title}>
      {drift.newly_failing_rule_count > 0 ? <span className="m-ink-critical m-numeric">{`+${drift.newly_failing_rule_count.toLocaleString()} failing`}</span> : null}
      {drift.newly_failing_rule_count > 0 && drift.recovered_rule_count > 0 ? ", " : null}
      {drift.recovered_rule_count > 0 ? <span className="m-numeric">{`${drift.recovered_rule_count.toLocaleString()} recovered`}</span> : null}
    </span>
  );
}

const allColumns = (run: string | undefined, bands: ScoreBands | undefined, openHref: (o: ObjectRow) => string, ownerOf: (o: ObjectRow) => string | null, ownerStatus: ObjectOwners["status"]): ColumnDef<ObjectRow>[] => [
  { accessorKey: "label", header: "Object", cell: ({ row }) => <DomainChip moduleId={row.original.module} label={row.original.label} /> },
  {
    id: "owner",
    header: "Owner",
    size: 140,
    accessorFn: (o) => ownerOf(o) ?? "",
    cell: ({ row }) => <OwnerName name={ownerOf(row.original)} status={ownerStatus} />,
  },
  workColumn("work_open", "To fix", (w) => w.open, run, ["record to fix", "records to fix"]),
  workColumn("work_critical", "Critical records", (w) => w.critical, run, ["critical record", "critical records"], { sev: "critical" }),
  workColumn("work_proposed", "With a suggested value", (w) => w.proposed, run, ["record with a suggested value", "records with a suggested value"], { suggested: "1" }),
  workColumn("work_overdue", "Overdue", (w) => w.overdue, run, ["overdue record", "overdue records"], { due: "overdue" }),
  {
    // Rule failures sits with the counts, not beside the blocking rule: it is the object's total over every rule.
    id: "affected_records",
    accessorFn: (o) => o.affected_records ?? -1,
    // Summed over the object's failing rules: a record failing two rules counts twice, so this is rule failures, not
    // records (the distinct records are the work list's "To fix").
    header: () => <span title={COUNT_DEFS.rule_failures.hint}>{`${COUNT_DEFS.rule_failures.label} (all rules)`}</span>,
    size: 130,
    meta: { numeric: true } satisfies CellMeta,
    cell: ({ row }) => {
      const n = row.original.affected_records;
      if (n == null) return "—";
      return <DrillCount href={toFixHref(row.original.module, run)} count={n} label={`Open the records behind the ${plural(n, "rule failure")} of ${row.original.label}`}>{n.toLocaleString()}</DrillCount>;
    },
  },
  {
    id: "composite_score",
    // Ranks on the uncapped score, so objects held at the same cap still order.
    accessorFn: (o) => { const c = cappedScore(o); return c ? c.shown : null; },
    header: COUNT_DEFS.score.label,
    size: 150,
    cell: ({ row }) => {
      const c = cappedScore(row.original);
      if (!c) return "—";
      return (
        <span className="inline-flex flex-col" data-testid="score-cell">
          <Score size="sm" value={c.shown} cap={c.cap} bands={bands}>{drill(row.original, run, c.shown.toFixed(1))}</Score>
          {c.cap != null ? <span className="m-text-meta m-ink-3">{`Capped at ${c.cap}`}</span> : null}
        </span>
      );
    },
  },
  {
    id: "readiness",
    // Severity-mapped value drives the row bar; the cell still shows the verdict word.
    accessorFn: (o) => (o.readiness === "fail" ? "critical" : o.readiness === "warn" ? "medium" : o.readiness === "pass" ? "pass" : ""),
    header: COUNT_DEFS.verdict.label,
    sortingFn: bySeverity,
    meta: { severity: true } satisfies CellMeta,
    cell: ({ row }) => {
      const readiness = row.original.readiness;
      if (!readiness) return "—";
      return <Status kind="verdict" value={readiness} variant="solid" />;
    },
  },
  {
    id: "blocking_rule",
    header: "Blocking rule",
    enableSorting: false,
    size: 280,
    cell: ({ row }) => {
      const id = row.original.blocking_rule_id;
      if (!id) return "—";
      const words = row.original.blocking_rule_name;
      return (
        // One line per row: a long check id or name is cut with an ellipsis; the id names the rule in full by its title.
        <span className="block max-w-[280px] truncate whitespace-nowrap" title={id} data-testid="blocking-rule-id">
          <DrillCount href={toFixHref(row.original.module, run, { issue: id })} label={`Open the records of ${row.original.label} failing rule ${id}`}>
            <Mono>{id}</Mono>
          </DrillCount>
          {" "}<RuleName id={id} fallback={words} />
        </span>
      );
    },
  },
  {
    id: "checked",
    header: "Checked",
    size: 130,
    accessorFn: (o) => o.monitor?.last_run_at ?? "",
    cell: ({ row }) => {
      const at = row.original.monitor?.last_run_at;
      return at ? <span className="whitespace-nowrap">{relativeTime(at)}</span> : <span className="m-ink-3">Not checked yet</span>;
    },
  },
  {
    id: "cadence",
    header: "Cadence",
    size: 170,
    accessorFn: (o) => (o.monitor ? cadenceText(o.monitor) : ""),
    cell: ({ row }) => (row.original.monitor ? cadenceText(row.original.monitor) : "—"),
  },
  {
    id: "freshness",
    header: "Freshness",
    size: 110,
    accessorFn: (o) => o.monitor?.freshness ?? "",
    cell: ({ row }) => (row.original.monitor ? <FreshnessPill value={row.original.monitor.freshness} /> : "—"),
  },
  {
    id: "change",
    header: "Change",
    size: 190,
    enableSorting: false,
    cell: ({ row }) => <ChangeCell m={row.original.monitor} />,
  },
  {
    id: "trend",
    header: "Trend",
    size: 96,
    meta: { numeric: true } satisfies CellMeta,
    cell: ({ row }) => {
      const t = row.original.trend ?? [];
      // The object's first scored run in its lineage has no trend yet: say so instead of a dash.
      if (t.length === 1) return <span className="m-text-meta m-ink-3" data-testid="trend-first-run">1 run</span>;
      return t.length >= 2 ? <Sparkline data={t.map((y, x) => ({ x, y }))} /> : "—";
    },
  },
  {
    id: "open",
    header: "Action",
    enableSorting: false,
    size: 72,
    meta: { sticky: "end" },
    cell: ({ row }) => <RowAction href={openHref(row.original)} label={`Open ${row.original.label}`} />,
  },
];

export default function ObjectsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  // With ?run= the list is that one run; without it, the current state: every object at its own latest run.
  const explicitRun = search.get("run");
  const run = explicitRun ?? "latest";
  const current = explicitRun == null;
  const dayOne = useDayOne();
  // Ruling 7: objects outside a module-scoped user's grants are hidden (UI filter; the API enforces scope).
  const { scopeFilter } = usePermissions();
  const owners = useObjectOwners();
  // The owner a row shows: the data_owners row (what the object header's picker sets), else the list's own field.
  const ownerOf = (o: ObjectRow) => owners.nameOf(o.module) ?? o.owner ?? null;
  // Listing users needs the assign permission, so a result means this person may assign owners.
  const assignable = useQuery({ queryKey: queryKeys.usersAssignable(), queryFn: getAssignableUsers, retry: false, meta: { ignoreError: true } });

  const single = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
    enabled: !current,
  });
  const currentQ = useCurrentObjects(current, scopeFilter.modules);
  const data = single.data;
  // Detail links carry the resolved run id so list and detail share one cache key.
  const runId = current ? undefined : data?.run_id ?? (run === "latest" ? undefined : run);

  const { data: version } = useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () => getVersion(runId ?? ""),
    enabled: !!runId,
  });

  const baseRows: ObjectRow[] = current
    ? currentQ.rows
    : (data?.objects ?? []).filter((o) => !scopeFilter.modules || scopeFilter.modules.has(o.module));
  // Objects the run measured that the user's scope hides: an empty list then means "outside your access", not "none".
  const outOfScope = !scopeFilter.modules ? 0 : current
    ? stateObjects(currentQ.runs).filter((o) => !scopeFilter.modules?.has(o.module)).length
    : (data?.objects ?? []).length - baseRows.length;
  // The work list per run the rows come from (one run with ?run=, each lineage's latest run without it). A run whose
  // work list is not built, or could not be read, leaves its rows without counts.
  const workRuns = current ? [...new Set(baseRows.map((o) => o.run_id).filter((id): id is string => !!id))] : runId ? [runId] : [];
  const workQs = useQueries({ queries: workRuns.map((id) => workSummaryQuery(id)) });
  const workByRun = new Map(workRuns.map((id, i) => [id, workQs[i]?.data]));
  // Cadence, freshness and drift of each object's current state, joined by module; a failed read leaves the columns "—".
  const monitorQ = useQuery({ queryKey: queryKeys.objectsMonitor(), queryFn: getObjectsMonitor, retry: false, meta: { ignoreError: true } });
  const monitorOf = new Map((monitorQ.data ?? []).map((m) => [m.module, m]));
  const objects: ObjectRow[] = baseRows.map((withoutMonitor) => {
    const o: ObjectRow = { ...withoutMonitor, monitor: monitorOf.get(withoutMonitor.module) };
    const summary = workByRun.get((current ? o.run_id : runId) ?? "");
    if (!summary?.built) return o;
    return { ...o, work: summary.objects.find((w) => w.module === o.module) ?? { module: o.module, records: 0, open: 0, issues: 0, critical: 0, proposed: 0, overdue: 0, statuses: {} } };
  });
  const isLoading = current ? currentQ.isLoading : single.isLoading;
  const query = current ? { isError: currentQ.isError, error: currentQ.error } : { isError: single.isError, error: single.error };
  const refetch = current ? currentQ.refetch : () => void single.refetch();
  const loaded = current ? !currentQ.isLoading && !currentQ.isError : !!data;
  const newest = currentQ.runs[0];

  useBreadcrumbScope(loaded ? [`${objects.length} ${objects.length === 1 ? "object" : "objects"}`] : []);
  // The header names the run the list belongs to; a ?run= other than the newest finished run offers "Back to latest".
  const { latestId } = useRunScope();
  const runScope = { run: version, choices: [], latestId, pinned: run !== "latest" && !!latestId && run !== latestId };

  let state: "loading" | "empty" | "error" | undefined;
  let emptyProps: { title: string; detail?: string; action?: ReactNode; ghost?: "table" } = { title: "No objects in this run", ghost: "table" };
  const anyRun = current ? !!newest : !!data?.run_id;
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure(query) || (loaded && objects.length === 0 && !anyRun && dayOne.status === "error")) {
    // The list, or (no run yet) the sources the first step is read from, failed: never "No objects measured yet".
    state = "error";
  } else if (loaded && objects.length === 0) {
    state = "empty";
    emptyProps = anyRun && outOfScope > 0
      ? {
          title: `${plural(outOfScope, "object")} ${current ? "measured" : "in this run"} ${outOfScope === 1 ? "is" : "are"} outside your access`,
          detail: "Ask an administrator for access to them.",
          ghost: "table",
        }
      : {
          title: anyRun ? (current ? "No objects measured" : "No objects in this run") : "No objects measured yet",
          detail: anyRun ? "Run an analysis on a connected system." : dayOne.step?.detail ?? "Run an extraction to analyse your first objects.",
          action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
          ghost: "table",
        };
  }

  // The export and the report are per run: without ?run= they are the newest finished run's, and say so.
  const reportRun = current ? newest?.id : data?.run_id; // no run yet: there is no report to download
  const exportOptions = [
    { format: "xlsx" as const, label: current ? "Newest run's objects (.xlsx)" : "Objects (.xlsx)", run: () => exportObjects(run) },
    ...(reportRun
      ? [{
          format: "pdf" as const,
          label: current ? "Newest run's analysis report (PDF)" : "Analysis report (PDF)",
          run: () => downloadAuthenticated(getAnalysisReportUrl(reportRun), `meridian-analysis-${reportRun}.pdf`),
        }]
      : []),
  ];

  const rawReadiness = search.get("readiness") ?? LEGACY_VERDICT[search.get("verdict") ?? ""] ?? null;
  const readiness: ReadinessFilter | null = READINESS_FILTER.find((f) => f.value === rawReadiness)?.value ?? null;
  const dimension = search.get("dimension");
  const owner = search.get("owner");
  const view: ListView = search.get("view") === "monitoring" ? "monitoring" : "work";
  const freshness = FRESHNESS_FILTER.find((f) => f.value === search.get("freshness"))?.value ?? null;
  const mine = search.get(MINE_PARAM) === "1";
  const shownObjs = objects
    .filter((o) => !mine || owners.isMine(o.module))
    .filter((o) => !readiness || (o.readiness != null && readiness.split(",").includes(o.readiness)))
    .filter((o) => !dimension || o.worst_dimension === dimension)
    .filter((o) => !owner || ownerOf(o) === owner)
    .filter((o) => !freshness || o.monitor?.freshness === freshness)
    .sort(ranked);
  const distinct = (pick: (o: ObjectRow) => string | null | undefined, label: (v: string) => string = (v) => v) =>
    [...new Set(objects.map(pick).filter((v): v is string => !!v))].sort().map((v) => ({ value: v, label: label(v) }));
  // Chips name the dimension ("Accuracy"); the URL keeps the raw id (`?dimension=accuracy`).
  const dimensionOptions = distinct((o) => o.worst_dimension, formatModuleName);
  const ownerOptions = distinct(ownerOf);
  const setParam = (key: string, next: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (key === "readiness") params.delete("verdict");
    if (next) params.set(key, next); else params.delete(key);
    router.replace(`/objects?${params.toString()}`);
  };
  const listHref = (params: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(current ? {} : { run }), ...params }).toString();
    return q ? `/objects?${q}` : "/objects";
  };
  const bands = current ? currentQ.bands : data?.thresholds;
  
  const notReady = objects.filter((o) => o.readiness === "fail").length; // matches the ?readiness=fail drill
  // Per run, the API's count; across the current state, each object's failing critical and high checks at its run
  // (the same definition, summed over the objects instead of one run).
  const blockingFindings = current
    ? objects.length > 0 && objects.every((o) => o.critical_checks != null && o.high_checks != null)
      ? objects.reduce((n, o) => n + (o.critical_checks ?? 0) + (o.high_checks ?? 0), 0)
      : undefined
    : data?.blocking_findings_total;
  // The findings behind that count, in both modes: the run's findings tab filtered to critical and high (one run), or
  // the current-state findings on the Insights overview filtered the same way (several runs).
  const criticalHighFindingsHref = current ? criticalHighHref(currentQ.runs) : runId ? criticalHighHref([{ id: runId }]) : undefined;
  const failingChecks = objects.reduce((a, o) => a + o.failing_checks, 0);
  const recordsAffected = objects.reduce((n, o) => n + (o.affected_records ?? 0), 0);
  const atRisk = objects.filter((o) => o.readiness === "warn").length;
  const go = objects.filter((o) => o.readiness === "pass").length;
  // The map already draws the object count, each object's records and its verdict tint, so the stats here carry
  // what it does not: how many objects sit in each verdict, and the totals behind the ledger.
  // Nobody owns any object: the Owner column steps aside and, for someone who may assign owners (the same read the
  // object page's picker makes), one prompt takes its place.
  const assignOwners = objects.length > 0 && owners.status === "ready" && objects.every((o) => !ownerOf(o)) && !!assignable.data;
  const stats = objects.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="m-stat-grid m-motion-stagger">
        <Stat label="Go" value={go} tone={go > 0 ? "go" : undefined} href={listHref({ readiness: "pass" })} />
        <Stat label="At risk" value={atRisk} tone={atRisk > 0 ? "at-risk" : "go"} href={listHref({ readiness: "warn" })} />
        <Stat label="No-go" value={notReady} tone={notReady > 0 ? "no-go" : "go"} href={listHref({ readiness: "fail" })} />
        <Stat label={COUNT_DEFS.failing_rules.label} value={failingChecks.toLocaleString()} hint="per object, generated checks included" href={current ? "/insights/rules" : `/insights/rules?${new URLSearchParams({ run })}`} />
        {blockingFindings != null ? <Stat label={COUNT_DEFS.blocking_rules.label} value={blockingFindings.toLocaleString()} tone={blockingFindings > 0 ? "no-go" : "go"} href={criticalHighFindingsHref} /> : <Stat label={COUNT_DEFS.rule_failures.label} value={recordsAffected.toLocaleString()} hint="records failing a rule, per rule" href={current ? "/insights/rules" : fixHref({ run })} />}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <FilterChips label="View" value={view === "monitoring" ? "monitoring" : null} options={[{ value: "monitoring", label: "Monitoring" }]} onChange={(v) => setParam("view", v)} />
        <FilterChips label="Freshness" value={freshness} options={FRESHNESS_FILTER} onChange={(v) => setParam("freshness", v)} />
        <FilterChips label="Readiness" value={readiness} options={[...READINESS_FILTER]} onChange={(v) => setParam("readiness", v)} />
        {dimensionOptions.length > 1 ? <FilterChips label="Dimension" value={dimension} options={dimensionOptions} onChange={(v) => setParam("dimension", v)} /> : null}
        {owners.hasMine || mine ? <FilterChips label="Show" value={mine ? "1" : null} options={[{ value: "1", label: "My objects" }]} onChange={(v) => setParam(MINE_PARAM, v)} /> : null}
        {ownerOptions.length > 1 ? <FilterChips label="Owner" value={owner} options={ownerOptions} onChange={(v) => setParam("owner", v)} /> : null}
      </div>
      {assignOwners ? (
        <p className="m-text-body m-ink-2" data-testid="assign-owners">
          Nobody owns these objects yet.{" "}
          <Link href={toFixHref((shownObjs[0] ?? objects[0]).module, current ? undefined : runId ?? run)}className="m-ink-accent underline underline-offset-2">Assign owners</Link>
          {" "}from each object&rsquo;s page.
        </p>
      ) : null}
    </div>
  );

  // A row and its "Open" land on the object's Records to fix, worst record first. Current state: the object page
  // without ?run= opens the object's own latest run.
  const openHref = (row: ObjectRow) => toFixHref(row.module, current ? undefined : runId ?? run);
  const objectHref = openHref;
  const columns = makeColumns(current ? undefined : runId, bands, objects, openHref, ownerOf, owners.status, view); // React Compiler memoizes on run and thresholds

  // The map is drawn from the rows the ledger shows: the same filters, the same objects.
  // Tiles are sized by distinct failing records when every shown object's work list is built; otherwise by the
  // summed rule failures, and the map says so.
  const distinctRecords = shownObjs.length > 0 && shownObjs.every((o) => o.work);
  const mapItems: ObjectMapItem[] = shownObjs.map((o) => ({
    id: o.module,
    label: o.label,
    href: openHref(o),
    score: o.composite_score,
    records: distinctRecords ? o.work?.records ?? 0 : o.affected_records ?? 0,
    verdict: o.readiness ? MAP_VERDICT[o.readiness] : "neutral",
    meta: o.blocking_rule_id ?? (distinctRecords && o.work ? plural(o.work.records, "record") : o.affected_records != null ? plural(o.affected_records, "rule failure") : undefined),
  }));
  const map = shownObjs.length > 0 && <ObjectMap items={mapItems} columns={12} rowHeight={44} label={distinctRecords ? undefined : "Objects by rule failures and verdict"} unit={distinctRecords ? "records" : "rule failures"} />;

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Objects"
          meta={current
            ? (newest && objects.length > 0 ? <span data-testid="run-scope">{stateScopeLine(objects.length, newest.run_at)}</span> : undefined)
            : <RunScope scope={runScope} hrefFor={(id) => hrefWithRun("/objects", search, id)} />}
          actions={<ExportMenu options={state === "empty" ? emptyExportOptions(exportOptions) : exportOptions} />}
        />
      }
      summary={map || undefined}
      strip={stats || undefined}
      table={
        <DataTable
          columns={columns}
          data={shownObjs}
          getRowId={(row) => row.module}
          rowHref={objectHref}
          onRowClick={(row) => {
            // Seed the object's summary under the run its numbers come from, so the detail opens without a refetch.
            const target = current ? row.run_id : runId ?? run;
            if (target && row.affected_records != null) queryClient.setQueryData(queryKeys.objectSummary(row.module, target), row);
            router.push(objectHref(row));
          }}
        />
      }
      state={state}
      emptyProps={emptyProps}
      errorProps={{
        error: query.isError ? query.error : dayOne.error,
        onRetry: () => { refetch(); if (dayOne.status === "error") dayOne.refetch(); },
      }}
    />
  );
}

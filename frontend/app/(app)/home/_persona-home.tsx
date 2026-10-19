"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { buildDrillHref, Button, Card, DataTable, DimensionBars, DomainChip, DrillLink, EmptyState, ExportMenu, HomePage, Mono, Pill, Select, Skeleton, Sparkline, Stat, type HeatmapCell, Status, Score } from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { getFindings, getFindingsAggregate } from "@/lib/api/findings";
import { useRunListWith } from "@/hooks/use-run-list";
import { getShellCounts } from "@/lib/api/shell";
import { getSystems } from "@/lib/api/connectivity";
import { usePermissions } from "@/lib/permissions";
import { getConfigLandscape } from "@/lib/api/config-load";
import { getExecutiveReportUrl } from "@/lib/api/reports";
import { downloadAuthenticated } from "@/lib/api/download";
import { useDayOne } from "@/hooks/use-day-one";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { exportFindings } from "@/lib/api/findings";
import { RunAnalysis } from "@/app/(app)/insights/_components/RunAnalysis";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { RouteInsight } from "@/components/insight/route-insight";
import { verdictSentence, type NarrativeInput } from "@/lib/home-narrative";
import {
  runCap, capRuleCount, capRules, cappedReason, dimensionHeatmapCells, objectTrend, runDqs, runDimensions, trend, readinessOf,
  worstObjectsFirst, DIMENSIONS,
} from "@/lib/home-metrics";
import {
  blockingTotal, isScored, latestPerLineage, runObjectsName, stateDqs, stateObjects, stateRows, stateScopeLine, stateSeries, stateSummary,
  type StateRow,
} from "@/lib/current-state";
import { formatDate, formatModuleName, plural, round1, shortCapReason } from "@/lib/format";
import { previousInLineage, runPageHref, sameLineage } from "@/lib/runs";
import { hrefWithRun } from "@/lib/run-scope";
import { RunScope } from "@/components/run-scope";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { openJobTray } from "@/lib/job-tray-bus";
import { queryKeys } from "@/lib/query-keys";
import { PERSONA_OPTIONS } from "@/lib/persona";
import type { Version } from "@/types/api";

const TABLE_ROWS = 8;

// Chart bundles load after first paint; the skeleton has the chart's final height.
const Line = dynamic(() => import("@/design/charts/Line").then((m) => m.Line), { ssr: false, loading: () => <Skeleton height={160} /> });
const Heatmap = dynamic(() => import("@/design/charts/Heatmap").then((m) => m.Heatmap), { ssr: false, loading: () => <Skeleton height={TABLE_ROWS * 28 + 32} /> });

const READINESS_SEVERITY = { fail: "critical", warn: "medium", pass: "pass" } as const;



/** Header label for a run: never a raw id (same formula as the run selector). */
const runLabel = (v: Version) =>
  v.label ?? `${(v.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Latest"}, ${formatDate(v.run_at, "date")}`;

function WorkRow({ children }: { children: ReactNode }) {
  return <div className="m-stat-grid">{children}</div>;
}

/** Failed or degraded: "unknown" means not tested yet, which is not a failure. */
const isFailing = (s: { health_status?: string | null }) => s.health_status != null && s.health_status !== "healthy" && s.health_status !== "unknown";

type ObjectRow = StateRow & { blocking?: string; trend: { x: string; y: number }[] };

/** Shared by the persona pages (lead/steward/basis): fetches every source the home page needs in parallel
 * and hands the derived pieces to the `HomePage` frame. Without `?run=` every number is the current state: each
 * object at the latest finished run of its lineage (lib/current-state.ts); a `?run=` deep link pins one run.
 * `lists` fills the persona-independent list slot
 * (Basis's `LiveSection`, visible even before the first run finishes). */
export function PersonaHomePage({ role, lists = null }: { role: NarrativeInput["role"]; lists?: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const dayOne = useDayOne();
  const { active } = useJobs();
  const { can } = useRole();
  const { scopeFilter } = usePermissions();
  const wantsFindings = role !== "basis";

  // No ?run=: the current state of every object. A ?run= deep link pins one run. The objects list answers the
  // tenant's score bands (and the page's loading and error state).
  const search = useSearchParams();
  const pinnedId = search.get("run");
  const run = pinnedId ?? "latest";
  const objectsQ = useQuery({ queryKey: queryKeys.objects(run), queryFn: () => getObjects(run) });
  const { list: versionsQ, versions: allVersions, resolving } = useRunListWith(pinnedId);
  // Same key as the rail's counts, so this is not a second request; Basis has no inbox tile.
  const shellCountsQ = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts, enabled: wantsFindings });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const landscapeQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });
  const finished = allVersions
    .filter(isScored)
    .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
  const pinned = pinnedId ? finished.find((v) => v.id === pinnedId) : undefined;
  // The runs the page summarises, newest first: the pinned run, or the latest run of every lineage.
  const scopeRuns = pinned ? [pinned] : latestPerLineage(finished);
  const newest = scopeRuns[0];
  // Without version_id both endpoints answer the same current state (the latest run of every lineage).
  const findingsQ = useQuery({
    queryKey: ["home-top-findings", pinned?.id ?? "current"],
    queryFn: () => getFindings({ ...(pinned ? { version_id: pinned.id } : {}), sort: "impact", limit: 100 }),
    enabled: wantsFindings && !!newest,
  });
  const aggregateQ = useQuery({
    queryKey: queryKeys.findingsAggregate(pinned?.id ?? "current"),
    queryFn: () => getFindingsAggregate(pinned?.id),
    enabled: wantsFindings && !!newest,
  });

  // Seed the run-keyed objects list so opening an object from home needs no second fetch.
  const runId = objectsQ.data?.run_id;
  useEffect(() => {
    if (runId && objectsQ.data) qc.setQueryData(queryKeys.objects(runId), objectsQ.data);
  }, [qc, runId, objectsQ.data]);

  const loading = dayOne.status === "loading" || objectsQ.isLoading;
  const erroring = dayOne.status === "error" || isListFailure(objectsQ);

  if (loading) return <HomePage persona={role} state="loading" />;
  if (erroring) {
    return (
      <HomePage
        persona={role}
        state="error"
        error={{ message: apiErrorMessage(objectsQ.error), onRetry: () => { void objectsQ.refetch(); void versionsQ.refetch(); } }}
      />
    );
  }

  if (dayOne.step !== null) {
    const versions = allVersions;
    return (
      <HomePage
        persona={role}
        state="empty"
        journey={{
          systemsConnected: (systemsQ.data ?? []).length > 0,
          configLoaded: (landscapeQ.data?.loaded ?? 0) > 0,
          extracted: versions.length > 0,
          complete: false,
          step: dayOne.step,
        }}
        lists={lists}
        onboarding={<HomeOnboarding />}
        cells={<RouteInsight />}
      />
    );
  }

  // dayOne says a finished run exists but it hasn't landed in this cache yet: treat as loading rather than crash.
  // A ?run= older than the run list is still being read by id: wait for it rather than show the current state.
  if (!newest || (pinnedId && !pinned && resolving)) return <HomePage persona={role} state="loading" />;

  // A module-scoped user sees only in-scope objects (and so only those heatmap rows, scores and counts).
  const state = stateObjects(scopeRuns, scopeFilter.modules);
  const merged = stateSummary(state);
  const runOf = new Map(state.map((o) => [o.module, o.run]));
  const runIdOf = (module: string) => runOf.get(module)?.id ?? newest.id;
  const bands = objectsQ.data?.thresholds;
  const objects = stateRows(state, bands, aggregateQ.data, finished);
  const sentence = verdictSentence(objects);
  // The objects list and its filters: the pinned run, or (no ?run=) the objects page's own latest.
  const objectsHref = (params: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(pinned ? { run: pinned.id } : {}), ...params }).toString();
    return q ? `/objects?${q}` : "/objects";
  };

  // The previous state swaps the newest run for the one before it in its own lineage (same system, or uploads of
  // the same objects), so the delta is the change that run made and never compares one object with another.
  const previous = previousInLineage(newest, finished);
  const dqs = runDqs(merged);
  const previousDqs = previous ? stateDqs(stateObjects(scopeRuns.map((r) => (r.id === newest.id ? previous : r)), scopeFilter.modules)) : null;
  // Pinned: the run's lineage. Current state: every object at its latest run as of each run, so the last step is the delta.
  const trendPoints = pinned ? trend(finished, pinned) : stateSeries(finished, scopeFilter.modules);
  const cap = runCap(merged);
  const findings = (findingsQ.data?.findings ?? []).filter((f) => (!scopeFilter.modules || scopeFilter.modules.has(f.module)) && f.version_id === runOf.get(f.module)?.id);
  const scored = worstObjectsFirst(objects);
  const worst = scored[0];
  const notReady = objects.filter((o) => o.readiness === "fail");
  const systems = systemsQ.data ?? [];
  const activeSystems = systems.filter((s) => s.is_active);

  const action =
    role === "lead"
      ? { label: notReady.length ? "Open objects not ready" : "Open objects", href: objectsHref(notReady.length ? { readiness: "fail" } : {}) }
      : role === "steward"
        ? { label: "Open worst object", href: worst ? `/objects/${worst.module}?run=${worst.run_id}` : objectsHref() }
        : (() => {
            const failed = activeSystems.some(isFailing);
            return { label: failed ? "Open failed system" : "Open systems", href: "/systems" };
          })();

  const capReason = cappedReason(merged);
  const cappedObjects = state.filter((o) => o.summary.composite_score != null && o.summary.capped).length;
  const measuredObjects = state.filter((o) => o.summary.composite_score != null).length;
  // The rules the cap reasons name (else the distinct critical rules of the loaded findings): one list gives both
  // the count and the names, so "by N critical rules: A, B and M more" always adds up.
  const reasonRules = capRules(merged);
  const criticalRules = reasonRules.length
    ? reasonRules
    : [...new Map(findings.filter((f) => f.severity === "critical").map((f) => [f.check_id, { check_id: f.check_id, module: f.module }])).values()];
  // Each capped object counts the rules its reason names, or its critical count when the reason names none, so an
  // unparsable reason never drops rules; "M more" is derived from this one total, so the line always adds up.
  const reasonTotal = capRuleCount(merged);
  const capTotal = reasonTotal || Math.max(cap?.criticals ?? 0, criticalRules.length);
  const namedRules = criticalRules.slice(0, 2);
  const moreRules = capTotal - namedRules.length;
  const capLine = cap || capReason ? (
    <>
      {cap ? (
        <>
          Capped at {cap.cap} by {plural(capTotal, "critical rule")}
          {namedRules.length > 0 && (
            <>
              {": "}
              {namedRules.map((f, i) => (
                <span key={f.check_id}>
                  {i > 0 && ", "}
                  <DrillLink href={buildDrillHref({ object: f.module, ruleId: f.check_id, run: runIdOf(f.module) })}><Mono>{f.check_id}</Mono></DrillLink>
                </span>
              ))}
              {moreRules > 0 && ` and ${moreRules} more`}
            </>
          )}
        </>
      ) : measuredObjects > 1 ? `${cappedObjects} of ${plural(measuredObjects, "object")} capped by critical rules` : `Capped: ${shortCapReason(capReason)}`}
    </>
  ) : undefined;

  const dims = runDimensions(merged);
  const dimensionStrip = (
    <Card title="Dimensions" padding="sm">
      <div data-testid="home-dimensions">
        <DimensionBars
          label="Dimension scores"
          items={DIMENSIONS.map((d) => ({
            key: d,
            label: formatModuleName(d),
            score: dims?.[d] ?? null,
            href: dims?.[d] == null ? undefined : objectsHref({ dimension: d }),
          }))}
        />
      </div>
    </Card>
  );

  // Each object's highest-impact critical finding, else the first rule its cap reason names.
  const blockingByModule = new Map<string, string>();
  for (const f of findings) if (f.severity === "critical" && !blockingByModule.has(f.module)) blockingByModule.set(f.module, f.check_id);
  for (const r of reasonRules) if (!blockingByModule.has(r.module)) blockingByModule.set(r.module, r.check_id);
  const rows: ObjectRow[] = worstObjectsFirst(role === "steward" ? objects.filter((o) => o.failing_checks > 0) : objects)
    .slice(0, TABLE_ROWS)
    .map((o) => {
      const source = runOf.get(o.module);
      return { ...o, blocking: blockingByModule.get(o.module), trend: source ? objectTrend(sameLineage(source, finished), o.module) : [] };
    });

  const columns: ColumnDef<ObjectRow>[] = [
    {
      accessorKey: "label", header: "Object",
      cell: ({ row: { original: o } }) => <span className="inline-flex items-center gap-2">{o.label}<DomainChip moduleId={o.module} /></span>,
    },
    {
      id: "dqs", header: "DQS", meta: { numeric: true },
      accessorFn: (o) => o.composite_score ?? -1,
      cell: ({ row: { original: o } }) => o.composite_score === null ? "—" : (
        <Score size="sm" value={o.composite_score} bands={bands} />
      ),
    },
    {
      id: "readiness", header: "Readiness", meta: { severity: true },
      accessorFn: (o) => (o.readiness ? READINESS_SEVERITY[o.readiness] : ""),
      cell: ({ row: { original: o } }) => {
        return o.readiness ? <Status kind="verdict" value={o.readiness} variant="solid" /> : <Pill>Not analysed</Pill>;
      },
    },
    {
      id: "blocking", header: "Blocking rule", enableSorting: false,
      cell: ({ row: { original: o } }) => o.blocking
        ? <DrillLink href={buildDrillHref({ object: o.module, ruleId: o.blocking, run: o.run_id })}><Mono>{o.blocking}</Mono></DrillLink>
        : "—",
    },
    { accessorKey: "affected_records", header: "Affected", meta: { numeric: true }, cell: ({ row: { original: o } }) => o.affected_records?.toLocaleString() ?? "—" },
    { id: "trend", header: "Trend", enableSorting: false, meta: { numeric: true }, cell: ({ row: { original: o } }) => <span className="flex justify-end"><Sparkline data={o.trend} width={60} height={16}/></span> },
  ];

  const objectsCard = role === "basis" ? undefined : (
    <Card title="Objects, worst first" padding="sm">
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(o) => o.module}
        onRowClick={(o) => router.push(`/objects/${o.module}?run=${o.run_id}`)}
        rowHref={(o) => `/objects/${o.module}?run=${o.run_id}`}
        height="auto"
        dense
        hideToolbar
        tableId="home-objects"
      />
      <div className="m-text-body px-3 pt-2">
        <Link href={objectsHref()} className="m-ink-accent">All objects</Link>
      </div>
    </Card>
  );

  const heatRows = scored.slice(0, TABLE_ROWS);
  const heatCells = dimensionHeatmapCells(heatRows, merged, bands);
  // The grid prints each score and tints it by readiness: the number carries the meaning, the hue repeats it.
  const heatTone = new Map(heatCells.map((c) => [`${c.row}:${c.col}`, c.tone]));
  const trendCard = (
      <Card title="Score over runs" meta={pinned ? "Runs of the same source" : "All objects, each at its latest run by then"}>
        {trendPoints.length < 2 ? (
          <div className="[min-height:160px]"><EmptyState title="The trend starts with the second run" action={can("trigger_sync") ? <Button variant="secondary" render={<Link href="/systems" />}>Run extraction</Button> : undefined} /></div>
        ) : (
          <Line
            data={trendPoints}
            onPointClick={(point) => { if (point.runId) router.push(runPageHref(point.runId)); }}
            height={160}
            dqsThreshold={bands?.target}
            label={pinned ? "DQS over runs" : "DQS of all objects over runs"}
          />
        )}
      </Card>
  );
  const heatmapCard = role !== "basis" && heatCells.length > 0 ? (
        <Card title="Dimensions by object">
          <Heatmap
            rows={heatRows.map((o) => o.label)}
            cols={DIMENSIONS.map(formatModuleName)}
            cells={heatCells.map((c) => ({ row: c.row, col: c.col, value: c.value }))}
            tone={(c) => heatTone.get(`${c.row}:${c.col}`)}
            cellSize={32}
            onPointClick={(cell: HeatmapCell) => {
              const object = heatRows.find((o) => o.label === cell.row);
              const dimension = DIMENSIONS.find((d) => formatModuleName(d) === cell.col);
              if (object) router.push(buildDrillHref({ object: object.module, dimension, run: object.run_id }));
            }}
          />
        </Card>
  ) : undefined;

  const counts = shellCountsQ.data;
  const unhealthy = activeSystems.filter(isFailing).length;
  const notLoaded = Math.max((landscapeQ.data?.total ?? 0) - (landscapeQ.data?.loaded ?? 0), 0);
  // Failing critical and high checks of every object in scope.
  const blocking = blockingTotal(state);
  const countsReady = !!counts;
  const work =
    role === "lead" ? (
      <WorkRow>
        <Stat label="Objects not ready" value={notReady.length} hint={`of ${objects.length}`} tone={notReady.length ? "no-go" : "go"} href={objectsHref({ readiness: "fail" })} />
        <Stat label="Blocking findings" value={blocking.toLocaleString()} hint={blocking ? "critical and high" : "none"} tone={blocking ? "no-go" : "go"} href={objectsHref({ readiness: "fail" })} />
        <Stat label="Open inbox" value={countsReady ? counts.inbox : "—"} hint={countsReady && !counts.inbox ? "clear" : undefined} href="/inbox" />
      </WorkRow>
    ) : role === "steward" ? (
      <WorkRow>
        <Stat label="Open inbox" value={countsReady ? counts.inbox : "—"} hint={countsReady && !counts.inbox ? "clear" : undefined} href="/inbox" />
        <Stat label="Cleaning proposals" value={countsReady ? counts.fix.toLocaleString() : "—"} hint={countsReady && !counts.fix ? "clear" : undefined} href="/fix" />
        <Stat
          label="Worst object"
          value={worst?.composite_score?.toFixed(1) ?? "—"}
          hint={worst?.label}
          tone={worst?.composite_score != null ? readinessOf(worst.composite_score, bands) : undefined}
          href={worst ? `/objects/${worst.module}?run=${worst.run_id}` : undefined}
        />
      </WorkRow>
    ) : (
      <WorkRow>
        <Stat label="Systems unhealthy" value={unhealthy} hint={`of ${activeSystems.length} active`} tone={unhealthy ? "no-go" : "go"} href="/systems" />
        <Stat label="Configuration missing" value={notLoaded} hint={`of ${landscapeQ.data?.total ?? 0} systems`} tone={notLoaded ? "at-risk" : "go"} href="/systems?config=not_loaded" />
        <Stat label="Jobs running" value={active.length} hint={active.length ? undefined : "idle"} onClick={openJobTray} />
      </WorkRow>
    );

  return (
    <HomePage
      persona={role}
      state="ready"
      verdict={{
        dqs,
        delta: dqs != null && previousDqs != null ? round1(dqs - previousDqs) : null,
        previousLabel: previous ? (pinned ? runLabel(previous) : "before the latest run") : undefined,
        firstRun: !previous,
        firstRunLabel: pinned ? undefined : `First run of ${runObjectsName(newest)}`,
        sentence,
        capLine,
        action,
      }}
      run={{ label: pinned ? runLabel(pinned) : stateScopeLine(objects.length, newest.run_at), runAt: newest.run_at }}
      scope={pinned ? (
        <RunScope
          scope={{ run: pinned, choices: [], latestId: undefined, pinned: true }}
          hrefFor={(id) => hrefWithRun(`/home/${role}`, search, id)}
        />
      ) : <span data-testid="run-scope">{stateScopeLine(objects.length, newest.run_at)}</span>}
      dimensions={dimensionStrip}
      objects={objectsCard}
      trend={trendCard}
      heatmap={heatmapCard}
      work={work}
      lists={lists}
      onboarding={<HomeOnboarding />}
      cells={<RouteInsight />}
      headerActions={<>
        <RunAnalysis />
        <Select
          label="View as"
          value={role}
          onValueChange={(r) => router.push(`/home/${r}`)}
          options={PERSONA_OPTIONS}
        />
        {can("export") ? (
          <span data-tour="home-export" className="inline-flex"><ExportMenu
            options={[
              ...(role === "steward" ? [{ format: "xlsx" as const, label: "My failing records (Excel)", run: () => exportFindings("xlsx", { ...(pinned ? { version_id: pinned.id } : {}), sort: "severity" }) }] : []),
              // The executive report is one run's: without ?run= it is the newest run's, and says so.
              {
                format: "pdf",
                label: pinned ? "Executive report (PDF)" : "Executive report, latest run (PDF)",
                run: () => downloadAuthenticated(getExecutiveReportUrl(newest.id), `meridian-executive-${newest.label ?? newest.id}.pdf`),
              },
            ]}
          /></span>
        ) : null}
      </>}
    />
  );
}

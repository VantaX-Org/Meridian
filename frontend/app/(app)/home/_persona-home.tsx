"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  buildDrillHref, Button, Card, DataTable, DrillLink, EmptyState, ExportMenu, HomePage, Mono, Pill, ScoreRing, Skeleton, Sparkline, Stat,
  type HeatmapCell, type PillTone,
} from "@/design";
import { getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { getFindings } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import { getShellCounts } from "@/lib/api/shell";
import { getSystems } from "@/lib/api/connectivity";
import { usePermissions } from "@/lib/permissions";
import { getConfigLandscape } from "@/lib/api/config-load";
import { getExecutiveReportUrl } from "@/lib/api/reports";
import { downloadAuthenticated } from "@/lib/api/download";
import { useDayOne } from "@/hooks/use-day-one";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { verdictSentence, type NarrativeInput } from "@/lib/home-narrative";
import {
  runCap, cappedReason, dimensionHeatmapCells, objectTrend, runDqs, runDimensions, delta as runDelta, trend, readinessOf,
  severityTotals, worstObjectsFirst, DIMENSIONS,
} from "@/lib/home-metrics";
import { formatDate, formatModuleName } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { openJobTray } from "@/lib/job-tray-bus";
import { queryKeys } from "@/lib/query-keys";
import type { Finding, Version } from "@/types/api";

const TABLE_ROWS = 8;

// Chart bundles load after first paint; the skeleton has the chart's final height.
const Line = dynamic(() => import("@/design/charts/Line").then((m) => m.Line), { ssr: false, loading: () => <Skeleton height={200} /> });
const Heatmap = dynamic(() => import("@/design/charts/Heatmap").then((m) => m.Heatmap), { ssr: false, loading: () => <Skeleton height={TABLE_ROWS * 32 + 32} /> });

const READINESS_PILL: Record<NonNullable<ObjectSummary["readiness"]>, { tone: PillTone; label: string }> = {
  pass: { tone: "go", label: "Go" },
  warn: { tone: "at-risk", label: "At risk" },
  fail: { tone: "no-go", label: "No-go" },
};


/** Header label for a run: never a raw id (same formula as the run selector). */
const runLabel = (v: Version) =>
  v.label ?? `${(v.metadata?.modules ?? []).map(formatModuleName).join(", ") || "Latest"}, ${formatDate(v.run_at, "date")}`;

function WorkRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">{children}</div>;
}

/** Failed or degraded: "unknown" means not tested yet, which is not a failure. */
const isFailing = (s: { health_status?: string | null }) => s.health_status != null && s.health_status !== "healthy" && s.health_status !== "unknown";

type ObjectRow = Omit<ObjectSummary, "trend"> & { blocking?: Finding; trend: { x: string; y: number }[] };

/** Shared by the persona pages (lead/steward/basis): fetches every source the home page needs in parallel
 * and hands the derived pieces to the `HomePage` frame. `lists` fills the persona-independent list slot
 * (Basis's `LiveSection`, visible even before the first run finishes). */
export function PersonaHomePage({ role, lists = null }: { role: NarrativeInput["role"]; lists?: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const dayOne = useDayOne();
  const { active } = useJobs();
  const { can } = useRole();
  const { scopeFilter } = usePermissions();
  const wantsFindings = role !== "basis";

  const objectsQ = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  const versionsQ = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  // Same key as the rail's counts, so this is not a second request; Basis has no inbox tile.
  const shellCountsQ = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts, enabled: wantsFindings });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const landscapeQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });
  const finished = (versionsQ.data?.versions ?? [])
    .filter((v) => v.dqs_summary && Object.keys(v.dqs_summary).length > 0)
    .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
  const latest = finished[0];
  // Highest-impact findings of this run: names each object's blocking rule.
  const findingsQ = useQuery({
    queryKey: ["home-top-findings", latest?.id],
    queryFn: () => getFindings({ version_id: latest!.id, sort: "impact", limit: 100 }),
    enabled: wantsFindings && !!latest,
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

  // A module-scoped user sees only in-scope objects (and so only those heatmap rows).
  const objects = (objectsQ.data?.objects ?? []).filter((o) => !scopeFilter.modules || scopeFilter.modules.has(o.module));
  const sentence = verdictSentence(objects);

  if (dayOne.step !== null) {
    const versions = versionsQ.data?.versions ?? [];
    return (
      <HomePage
        persona={role}
        state="no-data"
        journey={{
          systemsConnected: (systemsQ.data ?? []).length > 0,
          configLoaded: (landscapeQ.data?.loaded ?? 0) > 0,
          extracted: versions.length > 0,
          complete: false,
          step: dayOne.step,
        }}
        lists={lists}
      />
    );
  }

  const versions = versionsQ.data?.versions ?? [];
  // dayOne says a finished run exists but it hasn't landed in this cache yet: treat as loading rather than crash.
  if (!latest) return <HomePage persona={role} state="loading" />;

  const previous = finished[1];
  const bands = objectsQ.data?.thresholds;
  const trendPoints = trend(versions);
  const dqs = runDqs(latest);
  const cap = runCap(latest);
  const findings = (findingsQ.data?.findings ?? []).filter((f) => !scopeFilter.modules || scopeFilter.modules.has(f.module));
  const scored = worstObjectsFirst(objects.filter((o) => latest.dqs_summary?.[o.module]));
  const worst = worstObjectsFirst(objects)[0];
  const notReady = objects.filter((o) => o.readiness === "fail");
  const systems = systemsQ.data ?? [];
  const activeSystems = systems.filter((s) => s.is_active);

  const action =
    role === "lead"
      ? { label: notReady.length ? "Open objects not ready" : "Open objects", href: `/objects?run=${latest.id}${notReady.length ? "&readiness=fail" : ""}` }
      : role === "steward"
        ? { label: "Open worst object", href: worst ? `/objects/${worst.module}?run=${latest.id}` : `/objects?run=${latest.id}` }
        : (() => {
            const failed = activeSystems.some(isFailing);
            return { label: failed ? "Open failed system" : "Open systems", href: "/systems" };
          })();

  const capReason = cappedReason(latest);
  // Up to two distinct critical rules from the loaded findings; none until they load.
  const capRules = [...new Map(findings.filter((f) => f.severity === "critical").map((f) => [f.check_id, f])).values()].slice(0, 2);
  const capLine = cap || capReason ? (
    <>
      {cap ? (
        <>
          Capped at {cap.cap} by {cap.criticals} critical {cap.criticals === 1 ? "rule" : "rules"}
          {capRules.length > 0 && (
            <>
              {": "}
              {capRules.map((f, i) => (
                <span key={f.check_id}>
                  {i > 0 && ", "}
                  <DrillLink href={buildDrillHref({ object: f.module, ruleId: f.check_id, run: latest.id })}><Mono>{f.check_id}</Mono></DrillLink>
                </span>
              ))}
            </>
          )}
        </>
      ) : `Capped: ${capReason}`}
    </>
  ) : undefined;

  const dims = runDimensions(latest);
  const dimensionStrip = (
    <div className="flex snap-x gap-4 overflow-x-auto lg:grid lg:grid-cols-6 lg:overflow-visible" data-testid="home-dimensions">
      {DIMENSIONS.map((d) => {
        const score = dims?.[d] ?? null;
        return (
          <div key={d} className="min-w-36 flex-1 snap-start">
            <Stat
              label={formatModuleName(d)}
              value={score === null ? "—" : score.toFixed(1)}
              hint={score === null ? "Not measured" : undefined}
              tone={score === null ? undefined : readinessOf(score, bands)}
              href={score === null ? undefined : `/objects?run=${latest.id}&dimension=${d}`}
            />
          </div>
        );
      })}
    </div>
  );

  const blockingByModule = new Map<string, Finding>();
  for (const f of findings) if (f.severity === "critical" && !blockingByModule.has(f.module)) blockingByModule.set(f.module, f);
  const rows: ObjectRow[] = worstObjectsFirst(role === "steward" ? objects.filter((o) => o.failing_checks > 0) : objects)
    .slice(0, TABLE_ROWS)
    .map((o) => ({ ...o, blocking: blockingByModule.get(o.module), trend: objectTrend(versions, o.module) }));

  const columns: ColumnDef<ObjectRow>[] = [
    { accessorKey: "label", header: "Object" },
    {
      id: "dqs", header: "DQS", meta: { numeric: true },
      accessorFn: (o) => o.composite_score ?? -1,
      cell: ({ row: { original: o } }) => o.composite_score === null ? "—" : (
        <span className="inline-flex items-center gap-2"><ScoreRing score={o.composite_score} size={16} bands={bands} /><span className="m-numeric">{o.composite_score.toFixed(1)}</span></span>
      ),
    },
    {
      id: "readiness", header: "Readiness",
      cell: ({ row: { original: o } }) => {
        const p = o.readiness ? READINESS_PILL[o.readiness] : null;
        return p ? <Pill tone={p.tone}>{p.label}</Pill> : <Pill>Not analysed</Pill>;
      },
    },
    {
      id: "blocking", header: "Blocking rule", enableSorting: false,
      cell: ({ row: { original: o } }) => o.blocking
        ? <DrillLink href={buildDrillHref({ object: o.module, ruleId: o.blocking.check_id, run: latest.id })}><Mono>{o.blocking.check_id}</Mono></DrillLink>
        : "—",
    },
    { accessorKey: "affected_records", header: "Affected", meta: { numeric: true }, cell: ({ row: { original: o } }) => o.affected_records.toLocaleString() },
    { id: "trend", header: "Trend", enableSorting: false, cell: ({ row: { original: o } }) => <Sparkline data={o.trend} width={60} height={16} /> },
  ];

  const objectsCard = role === "basis" ? undefined : (
    <Card title="Objects, worst first" padding="sm">
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(o) => o.module}
        onRowClick={(o) => router.push(`/objects/${o.module}?run=${latest.id}`)}
        rowHref={(o) => `/objects/${o.module}?run=${latest.id}`}
        height="auto"
        dense
        hideToolbar
        tableId="home-objects"
      />
      <div className="m-text-body px-3 pt-2">
        <Link href={`/objects?run=${latest.id}`} style={{ color: "var(--m-accent)" }}>All objects</Link>
      </div>
    </Card>
  );

  const heatRows = scored.slice(0, TABLE_ROWS);
  const heatCells = dimensionHeatmapCells(heatRows, latest, bands);
  const trendCards = (
    <>
      <Card title="Score over runs">
        {trendPoints.length < 2 ? (
          <div style={{ minHeight: 200 }}><EmptyState title="The trend starts with the second run" action={<Button variant="secondary" render={<Link href="/systems" />}>Run extraction</Button>} /></div>
        ) : (
          <Line
            data={trendPoints}
            onPointClick={(point) => router.push(`/runs/${(point as unknown as { runId: string }).runId}`)}
            height={200}
            dqsThreshold={bands?.target}
            label="DQS over runs"
          />
        )}
      </Card>
      {role !== "basis" && heatCells.length > 0 && (
        <Card title="Dimensions by object">
          <Heatmap
            rows={heatRows.map((o) => o.label)}
            cols={DIMENSIONS.map(formatModuleName)}
            cells={heatCells}
            cellSize={32}
            onPointClick={(cell: HeatmapCell) => {
              const object = heatRows.find((o) => o.label === cell.row);
              const dimension = DIMENSIONS.find((d) => formatModuleName(d) === cell.col);
              if (object) router.push(buildDrillHref({ object: object.module, dimension, run: latest.id }));
            }}
          />
        </Card>
      )}
    </>
  );

  const counts = shellCountsQ.data;
  const unhealthy = activeSystems.filter(isFailing).length;
  const notLoaded = Math.max((landscapeQ.data?.total ?? 0) - (landscapeQ.data?.loaded ?? 0), 0);
  const severity = severityTotals(latest);
  const blocking = objectsQ.data?.blocking_findings_total ?? severity.critical + severity.high;
  const countsReady = !!counts;
  const work =
    role === "lead" ? (
      <WorkRow>
        <Stat label="Objects not ready" value={notReady.length} hint={`of ${objects.length}`} tone={notReady.length ? "no-go" : "go"} href={`/objects?run=${latest.id}&readiness=fail`} />
        <Stat label="Blocking findings" value={blocking.toLocaleString()} hint={blocking ? "critical and high" : "none"} tone={blocking ? "no-go" : "go"} href={`/objects?run=${latest.id}&readiness=fail`} />
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
          href={worst ? `/objects/${worst.module}?run=${latest.id}` : undefined}
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
      state="data"
      verdict={{
        dqs,
        delta: runDelta(trendPoints),
        previousLabel: previous ? runLabel(previous) : undefined,
        sentence,
        capLine,
        action,
      }}
      run={{ label: runLabel(latest), runAt: latest.run_at }}
      dimensions={dimensionStrip}
      objects={objectsCard}
      trend={trendCards}
      work={work}
      lists={lists}
      headerActions={
        can("export") ? (
          <ExportMenu
            options={[{
              format: "pdf",
              label: "Executive report (PDF)",
              run: () => downloadAuthenticated(getExecutiveReportUrl(latest.id), `meridian-executive-${latest.label ?? latest.id}.pdf`),
            }]}
          />
        ) : null
      }
    />
  );
}

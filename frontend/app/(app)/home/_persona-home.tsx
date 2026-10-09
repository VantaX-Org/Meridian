"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  HomePage, InstrumentPanel, SeverityDot, Sparkline, type HeatmapCell,
} from "@/design";
import { getObjects } from "@/lib/api/v1/objects";
import { getVersions } from "@/lib/api/versions";
import { getShellCounts } from "@/lib/api/shell";
import { getSystems } from "@/lib/api/connectivity";
import { getConfigLandscape } from "@/lib/api/config-load";
import { useDayOne } from "@/hooks/use-day-one";
import { useJobs } from "@/hooks/use-jobs";
import { buildNarrative, type NarrativeInput } from "@/lib/home-narrative";
import {
  cappedReason, dimensionBarPoints, dimensionHeatmapCells, objectTrend, runDqs, delta as runDelta, trend,
  worstObjectsFirst, DIMENSIONS,
} from "@/lib/home-metrics";
import { formatDate, formatModuleName, relativeTime } from "@/lib/format";
import { openJobTray } from "@/lib/job-tray-bus";
import { queryKeys } from "@/lib/query-keys";

/** `buildNarrative` returns one 3-sentence string; the verdict row wants the
 * headline (sentence 1) separate from the detail (sentences 2-3). The brief
 * doesn't define a split point, so this splits on the first ". ". */
function splitNarrative(narrative: string): { sentence1: string; sentence2?: string } {
  const i = narrative.indexOf(". ");
  return i === -1 ? { sentence1: narrative } : { sentence1: narrative.slice(0, i + 1), sentence2: narrative.slice(i + 2) };
}

function Tile({ label, value, text, href, onClick }: { label: string; value: ReactNode; text?: string; href?: string; onClick?: () => void }) {
  const body = (
    <div className="flex flex-col gap-1 rounded border p-4" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
      <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      <span className="text-[22px] leading-[28px] font-semibold tabular-nums" style={{ color: "var(--m-ink)" }}>{value}</span>
      {text && <span className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{text}</span>}
    </div>
  );
  if (href) return <Link href={href}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="text-left">{body}</button>;
  return body;
}

function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>{children}</div>;
}

/** Shared by the three persona pages (lead/steward/basis). Fetches every data
 * source the home page needs, derives the verdict/instrument-panel/work-tile
 * figures (spec section 7), and hands the result to the `HomePage` template.
 * `lists` fills the persona-independent part of the list slot — Basis's
 * `LiveSection`, which stays visible even before the first run finishes. */
export function PersonaHomePage({ role, lists = null }: { role: NarrativeInput["role"]; lists?: ReactNode }) {
  const router = useRouter();
  const dayOne = useDayOne();
  const { active } = useJobs();

  const objectsQ = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  const versionsQ = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  const shellCountsQ = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const landscapeQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });

  const loading = dayOne.status === "loading" || objectsQ.isLoading;
  const erroring = dayOne.status === "error" || objectsQ.isError;

  if (loading) {
    return <HomePage persona={role} state="loading" />;
  }
  if (erroring) {
    return (
      <HomePage
        persona={role}
        state="error"
        error={{
          message: objectsQ.error instanceof Error ? objectsQ.error.message : "Could not reach the server.",
          onRetry: () => { void objectsQ.refetch(); void versionsQ.refetch(); },
        }}
      />
    );
  }

  const objects = objectsQ.data?.objects ?? [];
  const narrative = splitNarrative(buildNarrative({ role, objects }));

  if (dayOne.step !== null) {
    const systems = systemsQ.data ?? [];
    const landscape = landscapeQ.data;
    const versions = versionsQ.data?.versions ?? [];
    return (
      <HomePage
        persona={role}
        state="no-data"
        verdict={narrative}
        journey={{
          systemsConnected: systems.length > 0,
          configLoaded: (landscape?.loaded ?? 0) > 0,
          extracted: versions.length > 0,
          complete: false,
          step: dayOne.step,
        }}
        lists={lists}
      />
    );
  }

  const versions = versionsQ.data?.versions ?? [];
  const finished = versions
    .filter((v) => v.dqs_summary && Object.keys(v.dqs_summary).length > 0)
    .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
  const latest = finished[0];
  if (!latest) {
    // dayOne says a finished run exists but it hasn't landed in this cache yet — treat as loading rather than crash.
    return <HomePage persona={role} state="loading" />;
  }
  const previous = finished[1];
  const trendPoints = trend(versions);
  const dqs = runDqs(latest);

  const scoredObjects = objects
    .filter((o) => latest.dqs_summary?.[o.module])
    .slice()
    .sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0));
  const heatmapRows = scoredObjects.map((o) => o.label);
  const heatmapCols = DIMENSIONS.map((d) => formatModuleName(d));

  const panel = (
    <InstrumentPanel
      dqs={dqs}
      delta={runDelta(trendPoints)}
      previousLabel={previous ? (previous.label ?? formatDate(previous.run_at)) : undefined}
      severity={Object.values(latest.dqs_summary ?? {}).reduce(
        (acc, m) => ({
          critical: acc.critical + m.critical_count, high: acc.high + m.high_count,
          medium: acc.medium + m.medium_count, low: acc.low + m.low_count,
        }),
        { critical: 0, high: 0, medium: 0, low: 0 },
      )}
      trendPoints={trendPoints}
      dimensionPoints={dimensionBarPoints(latest)}
      heatmapCells={dimensionHeatmapCells(scoredObjects, latest)}
      heatmapRows={heatmapRows}
      heatmapCols={heatmapCols}
      versionId={latest.id}
      onTrendPointClick={(point) => router.push(`/runs/${(point as unknown as { runId: string }).runId}`)}
      onHeatmapCellClick={(cell: HeatmapCell) => {
        const object = scoredObjects.find((o) => o.label === cell.row);
        if (object) router.push(`/objects/${object.module}`);
      }}
    />
  );

  const shellCounts = shellCountsQ.data;
  const worst = worstObjectsFirst(objects)[0];
  const totalAffected = objects.reduce((sum, o) => sum + o.affected_records, 0);

  let tiles: ReactNode;
  if (role === "lead") {
    tiles = (
      <TileGrid>
        <Tile label="Objects not ready" value={objects.filter((o) => o.readiness === "fail").length} href={`/objects?run=${latest.id}&readiness=fail`} />
        <Tile label="Failing checks" value={objects.reduce((sum, o) => sum + o.failing_checks, 0)} href={`/objects?run=${latest.id}`} />
        <Tile label="Affected records" value={totalAffected.toLocaleString()} href={`/objects?run=${latest.id}`} />
        <Tile label="Open inbox" value={shellCounts?.inbox ?? 0} href="/inbox" />
      </TileGrid>
    );
  } else if (role === "steward") {
    tiles = (
      <TileGrid>
        <Tile label="Open inbox" value={shellCounts?.inbox ?? 0} href="/inbox" />
        <Tile label="Cleaning proposals" value={shellCounts?.fix ?? 0} href="/fix" />
        <Tile
          label="Worst object"
          value={worst?.failing_checks ?? 0}
          text={worst?.label ?? "—"}
          href={worst ? `/objects/${worst.module}?run=${latest.id}` : undefined}
        />
        <Tile label="Affected records" value={totalAffected.toLocaleString()} href={`/objects?run=${latest.id}`} />
      </TileGrid>
    );
  } else {
    const systems = systemsQ.data ?? [];
    const healthy = systems.filter((s) => s.health_status === "healthy").length;
    const landscape = landscapeQ.data;
    tiles = (
      <TileGrid>
        <Tile label="Systems healthy" value={healthy} text={`of ${systems.length}`} href="/systems" />
        <Tile label="Configuration loaded" value={landscape?.loaded ?? 0} text={`of ${landscape?.total ?? 0}`} href="/systems?config=not_loaded" />
        <Tile label="Jobs running" value={active.length} onClick={openJobTray} />
        <Tile
          label="Last run"
          value={objects.reduce((sum, o) => sum + o.failing_checks, 0)}
          text={relativeTime(latest.run_at)}
          href={`/runs/${latest.id}`}
        />
      </TileGrid>
    );
  }

  const worstRows = worstObjectsFirst(role === "steward" ? objects.filter((o) => o.failing_checks > 0) : objects).slice(0, 5);
  const objectLists = role === "basis" ? null : (
    <div className="flex flex-col gap-2 rounded border" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
      <p className="px-3 py-2 text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Worst objects</p>
      {worstRows.map((o) => (
        <Link
          key={o.module}
          href={`/objects/${o.module}?run=${latest.id}`}
          className="flex items-center gap-3 border-t px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--m-line)" }}
        >
          {o.readiness && <SeverityDot severity={o.readiness === "fail" ? "critical" : o.readiness === "warn" ? "medium" : "low"} />}
          <span style={{ color: "var(--m-ink)" }}>
            {o.label} · {o.composite_score?.toFixed(1) ?? "—"} · {o.failing_checks} failing · {o.affected_records.toLocaleString()} affected
          </span>
          <Sparkline data={objectTrend(versions, o.module)} width={60} height={16} />
        </Link>
      ))}
    </div>
  );

  return (
    <HomePage
      persona={role}
      state="data"
      verdict={{ ...narrative, cappedReason: cappedReason(latest) }}
      run={{ id: latest.id, label: latest.label, runAt: latest.run_at }}
      panel={panel}
      tiles={tiles}
      lists={<>{objectLists}{lists}</>}
    />
  );
}

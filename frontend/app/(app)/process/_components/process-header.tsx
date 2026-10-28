"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageFrame, Skeleton, Stat } from "@/design";
import { FreshnessPill } from "@/app/(app)/objects/_freshness";
import { presetLabel } from "@/app/(app)/systems/[systemId]/cron-picker";
import { getProcessHealth, processScheduleKeys, type ProcessHealth } from "@/lib/api/process-discovery";
import { relativeTime } from "@/lib/format";

/** The one line under each process page's title: what it shows and what to do with it. */
export const PROCESS_PURPOSE = {
  catalogue: "How each business process really runs on this system, mined from its documents. Open one to see its flow and where it departs from the SAP reference.",
  runs: "Every discovery run on this system and how far it has got. Start a new run to refresh the mined flows.",
  l1: "The as-is flow of this process, mined from its documents. Select a step to drill into it, or compare it with the reference.",
  run: "Progress and result of one discovery run: its stages, the tables it read and any error.",
} as const;

/** Purpose line, then the page's own context line (system, run). */
export function processMeta(purpose: string, context?: ReactNode): ReactNode {
  return (
    <>
      <span className="block m-text-body m-ink-2">{purpose}</span>
      {context ? <span className="mt-1 block">{context}</span> : null}
    </>
  );
}

/** Page frame shared by the process pages: the layout's frame, so the page pads and centres like every other one. */
export function ProcessFrame({ children }: { children: ReactNode }) {
  return <PageFrame>{children}</PageFrame>;
}

export function RowsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="grid gap-1" data-state="pending">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={44} />)}
    </div>
  );
}

/** Under an always-rendered PageHeader: 112px insight strip plus table rows. */
export function BodySkeleton({ rows = 7 }: { rows?: number }) {
  return (<><Skeleton height={112} /><RowsSkeleton rows={rows} /></>);
}

/** The Cadence tile's value: the preset, "Manual only" or "Paused". */
export function cadenceText(h: ProcessHealth): string {
  if (!h.schedule) return "Manual only";
  return h.schedule.active ? presetLabel(h.schedule.cron) : "Paused";
}

/** Fitness is a 0 to 1 ratio; the tile speaks in whole points ("+3 points", "-4 points", "0 points"). */
export function fitnessChange(drift: number): string {
  const pts = Math.round(drift * 100);
  return `${pts > 0 ? "+" : ""}${pts} ${Math.abs(pts) === 1 ? "point" : "points"}`;
}

const pct = (f: number | null) => (f == null ? "—" : `${Math.round(f * 100)}%`);

/**
 * Checked, Cadence, Freshness and Fitness change for one process on one system, from the discovery health route.
 * Nothing renders while the read fails (an older backend): the page stands without the tiles.
 */
export function ProcessHeaderTiles({ systemId, l1 }: { systemId: string; l1: string }) {
  const q = useQuery({
    queryKey: processScheduleKeys.health(systemId), queryFn: () => getProcessHealth(systemId), retry: false, meta: { ignoreError: true },
  });
  if (q.isLoading) return <div aria-busy="true"><Skeleton height={84} /></div>;
  const h = q.data?.find((x) => x.l1 === l1);
  if (!h) return null;
  const finished = h.last_run?.finished_at ?? null;
  const drift = h.fitness_drift;
  const checkedHint = h.last_run?.status === "failed" ? "The last run failed" : undefined;
  return (
    <section aria-label="Process monitor" className="m-stat-grid" data-testid="process-header-tiles">
      {finished ? (
        <Stat label="Checked" value={relativeTime(finished)} hint={checkedHint} href={h.last_run ? `/process/runs/${h.last_run.id}` : undefined} />
      ) : (
        <Stat label="Checked" value="Not checked yet" hint={h.schedule?.active ? "Its schedule has not started a run yet" : undefined} />
      )}
      <Stat label="Cadence" value={cadenceText(h)} hint={h.schedule ? undefined : "Runs when someone starts one"}
        href={`/process/runs?system=${encodeURIComponent(systemId)}`} />
      <Stat label="Freshness" value={<FreshnessPill value={h.freshness} />} />
      {drift == null ? (
        <Stat label="Fitness change" value={h.last_run?.fitness != null ? "First run" : "No result yet"}
          hint={h.last_run?.fitness != null ? "Changes show from the second run" : undefined} />
      ) : (
        <Stat label="Fitness change" value={fitnessChange(drift)} tone={drift > 0 ? "go" : drift < 0 ? "no-go" : undefined}
          hint={`From ${pct(h.previous_fitness)} to ${pct(h.last_run?.fitness ?? null)}`} />
      )}
    </section>
  );
}

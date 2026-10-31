"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem } from "@/lib/api/v2/types";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useCounts, useLandscape } from "@/lib/v2/queries";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { byMeasured, f1, int, moduleSlug, readingText, systemSlug } from "@/lib/v2/score";
import { Ruler } from "../Ruler";
import { Sparkline } from "../charts";
import { useTimeline } from "@/lib/v2/runs-queries";
import { IconChevron } from "../marks";
import { ErrorFrame, Skeleton, V2Link } from "../parts";
import { RunMenu, ScopeMenu } from "./TopBar";
import { t } from "@/lib/v2/i18n";

export function dimsOf(cell: LandscapeCell): (number | null)[] {
  return DIMENSIONS.map((d) => cell.dimensions[d.key] ?? null);
}

/** An object's measured score over the last runs, drawn on its own range (at least 6 points tall); nothing under two points. */
export function ScoreTrend({ trend, label }: { trend: readonly (number | null)[]; label: string }) {
  const known = trend.filter((v): v is number => v != null);
  if (known.length < 2) return null;
  const mid = (Math.min(...known) + Math.max(...known)) / 2;
  const half = Math.max(3, (Math.max(...known) - Math.min(...known)) / 2);
  return (
    <Sparkline
      values={trend}
      width={48}
      height={8}
      domain={[mid - half, mid + half]}
      label={t("{label}, measured score over the last {count} runs: {first} to {last}", { label, count: trend.length, first: f1(known[0]), last: f1(known[known.length - 1]) })}
      testId="map-spark"
    />
  );
}

/** The trend of each object of one system, from the run timeline (the same read the run picker makes). */
export function useTrends(systemId: string, modules: readonly string[]): Map<string, (number | null)[]> {
  const timeline = useTimeline(systemId, 8).data?.runs;
  const key = modules.join(",");
  return useMemo(() => {
    const out = new Map<string, (number | null)[]>();
    for (const m of key.split(",")) out.set(m, (timeline ?? []).map((r) => r.objects[m]?.raw_score ?? r.objects[m]?.score ?? null));
    return out;
  }, [timeline, key]);
}

function ObjectRow({ system, cell, label, current, fixtureRun, trend }: { system: LandscapeSystem; cell: LandscapeCell; label: string; current: boolean; fixtureRun: string | null; trend: readonly (number | null)[] }) {
  const reading = readingText({ label, measured: cell.raw_score, score: cell.score, capped: cell.capped, capLevel: cell.cap_level, breaches: cell.breaches, dims: dimsOf(cell), records: cell.records_checked, rules: cell.rules_measured, coverage: cell.coverage, lowConfidence: cell.low_confidence });
  const href = `/o/${systemSlug(system.name)}/${moduleSlug(cell.module)}${fixtureRun ? `?run=${fixtureRun}` : ""}`;
  return (
    <V2Link href={href} className="m2-orow" aria-current={current ? "page" : undefined} title={reading}>
      <span className="m2-orow-nm">
        <span className="m2-orow-nt">
          {label}
          {cell.low_confidence ? <span className="m2-orow-lc">{t("low coverage")}</span> : null}
        </span>
        {cell.open_work ? <span className="m2-orow-wk">{int(cell.open_work)}</span> : null}
      </span>
      <span className="m2-sc">{f1(cell.score)}</span>
      <span className="m2-orow-r">
        <Ruler
          size={48}
          dims={dimsOf(cell)}
          measured={cell.raw_score}
          score={cell.score}
          capped={cell.capped}
          capLevel={cell.cap_level}
          breaches={cell.breaches}
          label={label}
          records={cell.records_checked}
          rules={cell.rules_measured}
          coverage={cell.coverage}
          lowConfidence={cell.low_confidence}
          showScore={false}
        />
        <ScoreTrend trend={trend} label={label} />
      </span>
    </V2Link>
  );
}

/**
 * The objects of one open system, each with its trend: the measured score over the system's last 8 runs (the same
 * timeline the run picker reads). Each line is drawn on its own range, at least 6 points tall, so the direction reads at
 * 8 pixels; the ruler beside it carries the level.
 */
function SystemObjects({ system, landscape, cells, pathname, run }: { system: LandscapeSystem; landscape: Landscape; cells: LandscapeCell[]; pathname: string; run: string | null }) {
  const trends = useTrends(system.id, cells.map((c) => c.module));
  return (
    <>
      {cells.map((c) => {
        const label = landscape.objects.find((o) => o.module === c.module)?.label ?? c.module;
        const here = pathname.startsWith(`/o/${systemSlug(system.name)}/${moduleSlug(c.module)}`);
        return <ObjectRow key={c.module} system={system} cell={c} label={label} current={here} fixtureRun={run} trend={trends.get(c.module) ?? []} />;
      })}
    </>
  );
}

function SystemStatus({ system, landscape }: { system: LandscapeSystem; landscape: Landscape }) {
  const { hrefFor } = useOpenItem();
  const link = (label: string) => (
    <V2Link href={hrefFor({ kind: "system", id: system.id })}>
      {label}
    </V2Link>
  );
  if (system.state === "analysed") {
    const n = landscape.cells.filter((c) => c.system_id === system.id).length;
    return <>{t("{value}, {n} {n, plural, one {object} other {objects}}", { value: system.last_extracted_at ? formatDate(system.last_extracted_at, "datetime") : t("Analysed"), n })}</>;
  }
  if (system.state === "extracted") return <>{t("Extracted, not analysed.")}{" "}{link(t("Run analysis"))}</>;
  return <>{t("Not extracted yet.")}{" "}{link(t("Extract"))}</>;
}

/**
 * The map: the whole landscape as a tree. Four places at the top (Landscape, Work, Runs, People), then each system
 * with its objects, each object a row with its 48 ruler, its score and the work waiting. A system that was never
 * extracted keeps its row and says so. On a phone it is a bottom sheet.
 */
export function MapPane({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: boolean }) {
  const pathname = usePathname();
  const run = useRunParam();
  const q = useLandscape(run);
  const counts = useCounts();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const current = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const L = q.data;
  const isOpen = (s: LandscapeSystem) => expanded[s.id] ?? s.state === "analysed";
  return (
    <aside
      id="m2-map"
      className={`m2-map${open ? " m2-open" : ""}`}
      aria-label={t("Map")}
      role={phone && open ? "dialog" : undefined}
      aria-modal={phone && open ? true : undefined}
      data-testid="map"
    >
      <div className="m2-map-head">
        <span>{t("Map")}</span>
        <button type="button" className="m2-x" onClick={onClose} aria-label={t("Close map")}>
          <span className="m2-x-t">{t("Close")}</span>
        </button>
      </div>
      {phone ? (
        <div className="m2-map-sw">
          <ScopeMenu compact />
          <RunMenu compact />
        </div>
      ) : null}
      <nav className="m2-mnav" aria-label={t("Places")}>
        <V2Link href="/" className="m2-mi" aria-current={current("/", true) ? "page" : undefined}>
          <span>{t("Landscape")}</span>
          <kbd className="m2-kb">g l</kbd>
        </V2Link>
        <V2Link href="/work" className="m2-mi" aria-current={current("/work") ? "page" : undefined}>
          <span>{t("Work")}</span>
          {counts.data?.fix ? <span className="m2-n">{int(counts.data.fix)}</span> : <kbd className="m2-kb">g w</kbd>}
        </V2Link>
        <V2Link href="/runs" className="m2-mi" aria-current={current("/runs") || current("/run") ? "page" : undefined}>
          <span>{t("Runs")}</span>
          <kbd className="m2-kb">g r</kbd>
        </V2Link>
        <V2Link href="/people" className="m2-mi" aria-current={current("/people") ? "page" : undefined}>
          <span>{t("People")}</span>
          <kbd className="m2-kb">g p</kbd>
        </V2Link>
      </nav>
      <div className="m2-mgrp">{t("Systems")}</div>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The systems could not be read.")}</ErrorFrame>
      ) : !L ? (
        <div className="m2-sys" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="m2-sysrow">
              <span />
              <span>
                <Skeleton width={120} height={14} />
                <br />
                <Skeleton width={180} height={12} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="m2-sys">
          {L.systems.map((s) => {
            const openNow = isOpen(s);
            const cells = byMeasured(L.cells.filter((c) => c.system_id === s.id));
            return (
              <div key={s.id}>
                <button type="button" className="m2-sysrow" aria-expanded={openNow} onClick={() => setExpanded((e) => ({ ...e, [s.id]: !openNow }))}>
                  <IconChevron open={openNow} />
                  <span className="m2-sysrow-nm">{s.name}</span>
                </button>
                <div className="m2-sysrow-st">
                  <SystemStatus system={s} landscape={L} />
                </div>
                {openNow ? <SystemObjects system={s} landscape={L} cells={cells} pathname={pathname} run={run} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

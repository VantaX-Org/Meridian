"use client";

import { formatCompact, formatDuration, formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { JOB_KIND_LABEL, jobObject } from "@/lib/v2/jobs";
import type { Job } from "@/types/jobs";
import type { RunProgress } from "@/lib/api/next/live-runs";
import { Chip, type ChipTone } from "../kit";
import { ProgressRing, SegmentedBar, ThroughputSpark, stateWord, type Segment } from "./LiveCharts";

const CHIP: Record<string, ChipTone> = { running: "accent", stalled: "warn", failed: "bad", completed: "good" };

export const runObject = (r: RunProgress): string => jobObject({ modules: r.modules, label: r.label ?? "" } as unknown as Job);

/** Tables when extraction reads them, else the run's stages; each segment carries its own percent or none. */
export function segmentsOf(r: RunProgress): Segment[] {
  if (r.parts.length) return r.parts.map((p) => ({ id: p.name, label: p.name, pct: p.pct, state: p.state === "running" && r.state === "stalled" ? "stalled" : p.state }));
  return r.stages.map((s, i) => {
    const cur = i === r.stage_index && s.status === "running";
    const state: Segment["state"] = s.status === "done" || s.status === "skipped" || s.status === "failed" || s.status === "queued" ? s.status : r.state === "stalled" ? "stalled" : "running";
    return { id: s.id, label: s.label, pct: s.status === "done" ? 100 : cur ? r.step.pct : s.status === "queued" ? 0 : null, state };
  });
}

/** "Reading tables: 4 of 9 tables", in words, with the unit that is actually counted. */
export function stepText(r: RunProgress): string {
  const stage = r.stage_index != null ? r.stages[r.stage_index]?.label : null;
  const { unit, done, total } = r.step;
  const unitWord = unit === "tables" ? t("tables") : unit === "rules" ? t("rules") : t("rows");
  const count = unit && total != null ? t("{done} of {total} {unit}", { done: formatCompact(done), total: formatCompact(total), unit: unitWord }) : null;
  if (r.state === "queued") return r.queue_position ? t("Waiting, position {n}", { n: formatInt(r.queue_position) }) : t("Waiting to start");
  return [stage, count].filter(Boolean).join(": ") || r.message || stateWord(r.state);
}

export function etaText(r: RunProgress): string | null {
  return r.eta_s != null ? t("About {d} left (estimate)", { d: formatDuration(r.eta_s * 1000) }) : null;
}

export function LiveRunCard({ run, rates, onOpen }: { run: RunProgress; rates: number[]; onOpen: () => void }) {
  const kind = JOB_KIND_LABEL[run.kind] ?? run.kind;
  const obj = runObject(run);
  const eta = etaText(run);
  const segs = segmentsOf(run);
  const name = `${kind}: ${obj}`;
  return (
    <article className="nx-card nx-live-card" data-state={run.state} data-testid="live-run-card">
      <div className="nx-live-visual">
        <ProgressRing pct={run.pct} state={run.state} label={t("{name} progress", { name })} caption={run.stage_count ? t("Stage {i} of {n}", { i: formatInt((run.stage_index ?? 0) + 1), n: formatInt(run.stage_count) }) : undefined} />
        <div className="nx-live-side">
          <SegmentedBar segments={segs} label={t("{name}: {n} parts", { name, n: formatInt(segs.length) })} />
          <ThroughputSpark rates={rates} label={t("Throughput")} />
        </div>
      </div>
      <div className="nx-live-body">
        <header className="nx-live-head">
          <div className="nx-live-title">
            <span className="nx-live-quiet">{kind}</span>
            <strong title={obj}>{obj}</strong>
          </div>
          <Chip tone={CHIP[run.state] ?? "neutral"}>{stateWord(run.state)}</Chip>
        </header>
        <p className="nx-live-step" title={stepText(run)}>{stepText(run)}</p>
        <dl className="nx-live-facts">
          <div><dt>{t("Records")}</dt><dd>{formatCompact(run.rows)}</dd></div>
          <div><dt>{t("Elapsed")}</dt><dd>{formatDuration(run.elapsed_s * 1000)}</dd></div>
          {eta ? <div><dt>{t("Time left")}</dt><dd>{eta}</dd></div> : null}
        </dl>
        {run.state === "failed" && run.error ? <p className="nx-live-error">{run.error}</p> : null}
        <button type="button" className="nx-btn nx-btn-quiet nx-btn-sm" onClick={onOpen}>{t("Details")}</button>
      </div>
    </article>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { getTimeline } from "@/lib/api/v2/runs";
import type { Landscape as LandscapeData, LandscapeSystem } from "@/lib/api/v2/types";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { atlasKey, framesOf, type AtlasFrame } from "@/lib/v2/atlas";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { runKeys } from "@/lib/v2/runs-queries";
import { DASH, f1, int, moduleSlug, systemSlug } from "@/lib/v2/score";
import { Code, LargeTitle } from "../kit";
import { KeepLink, QueryView } from "./states";
import "./landscape.css";

/**
 * The landscape atlas: every object of every system as one tile, sized by the records it checks and shaded by its
 * score, replayed run by run. The strip counts the objects at 85 and up after each run; press a bar or play to watch
 * the landscape move. Scores are the stored run scores; nothing is interpolated between runs.
 */

const RUNS = 12;
const TICK_MS = 900;

/** Score band: 0 is 95 and up, 1 is 85 to 95, 2 is 70 to 85, 3 is below 70. */
function band(v: number | null | undefined): 0 | 1 | 2 | 3 | null {
  if (v == null) return null;
  return v >= 95 ? 0 : v >= 85 ? 1 : v >= 70 ? 2 : 3;
}

function signed(d: number | null): string {
  if (d == null) return DASH;
  const r = Math.round(d * 10) / 10;
  return r > 0 ? `+${f1(r)}` : r < 0 ? `−${f1(-r)}` : f1(0);
}

export function Atlas() {
  const fixture = useFixture();
  const landscape = useLandscape(null);
  const systems = (landscape.data?.systems ?? []).filter((s) => s.latest_run_id);
  const timelines = useQueries({
    queries: systems.map((s) => ({ queryKey: runKeys.timeline(fixture, s.id, RUNS), queryFn: () => getTimeline(s.id, RUNS), staleTime: 30_000 })),
  });
  const frames = framesOf(timelines.map((q) => q.data?.runs ?? []));
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const last = frames.length - 1;
  const idx = at == null ? last : Math.min(at, last);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setAt((i) => {
        const next = (i ?? last) + 1;
        if (next >= last) setPlaying(false);
        return Math.min(next, last);
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, last]);

  const loading = landscape.isPending || timelines.some((q) => q.isPending);
  const l = landscape.data;
  const frame = frames[idx];

  return (
    <div className="nx-body nx-at" data-testid="atlas">
      <LargeTitle title={t("Landscape atlas")} subtitle={t("Replays the system landscape run by run, showing which objects moved up or down after each run.")} />
      <QueryView
        loading={loading}
        error={landscape.isError}
        onRetry={() => void landscape.refetch()}
        empty={!frames.length}
        emptyHeading={t("Landscape atlas")}
        emptyText={t("Run an analysis to see the landscape atlas.")}
        label={t("The landscape could not be read.")}
      >
        {l && frame ? (
          <AtlasBody
            l={l}
            frames={frames}
            frame={frame}
            idx={idx}
            last={last}
            playing={playing}
            onPlay={() => {
              if (idx >= last) setAt(0);
              setPlaying(true);
            }}
            onPause={() => setPlaying(false)}
            onPick={(i) => {
              setPlaying(false);
              setAt(i);
            }}
          />
        ) : null}
      </QueryView>
    </div>
  );
}

function AtlasBody({
  l, frames, frame, idx, last, playing, onPlay, onPause, onPick,
}: {
  l: LandscapeData; frames: AtlasFrame[]; frame: AtlasFrame; idx: number; last: number; playing: boolean;
  onPlay: () => void; onPause: () => void; onPick: (i: number) => void;
}) {
  const scores = [...frame.scores.values()].filter((s): s is number => s != null);
  const ready = scores.filter((s) => s >= 85).length;
  const moves = [...frame.delta.values()];
  const up = moves.filter((d) => d >= 0.05).length;
  const down = moves.filter((d) => d <= -0.05).length;
  const system = l.systems.find((s) => s.id === frame.run.system_id);
  return (
    <>
      <section className="nx-ls-sec nx-at-banner" aria-label={t("Landscape atlas")}>
        <h2 className="nx-at-headline">{t("{ready} of {scored} objects at 85 or above", { ready: int(ready), scored: int(scores.length) })}</h2>
        <p className="nx-sub">
          {t("After the {system} run of {date}: {up} objects moved up, {down} moved down.", {
            system: system?.name ?? DASH, date: formatDate(frame.run.run_at, "datetime"), up: int(up), down: int(down),
          })}
        </p>
        <dl className="nx-at-figs">
          <div><dt>{t("Run")}</dt><dd className="nx-at-fig">{`${int(idx + 1)}/${int(frames.length)}`}</dd><dd className="nx-sub">{formatDate(frame.run.run_at, "date")}</dd></div>
          <div><dt>{t("Records checked")}</dt><dd className="nx-at-fig">{frame.run.records_checked == null ? DASH : int(frame.run.records_checked)}</dd><dd className="nx-sub">{system?.name ?? DASH}</dd></div>
          <div><dt>{t("Capped")}</dt><dd className="nx-at-fig">{int(frame.measured.size)}</dd><dd className="nx-sub">{t("by critical rules")}</dd></div>
        </dl>
        <div className="nx-row">
          {playing ? (
            <button type="button" className="nx-btn nx-btn-secondary" onClick={onPause} data-testid="atlas-pause">{t("Pause")}</button>
          ) : (
            <button type="button" className="nx-btn nx-btn-primary" onClick={onPlay} data-testid="atlas-play">
              {idx >= last ? t("Replay the runs") : t("Play from here")}
            </button>
          )}
          <KeepLink href="/runs" className="nx-btn nx-btn-secondary">{t("Open the runs")}</KeepLink>
        </div>
        <dl className="nx-notes">
          <div className="nx-note"><dt>{t("Run")}</dt><dd>{t("Which run of the series you are looking at.")}</dd></div>
          <div className="nx-note"><dt>{t("Records checked")}</dt><dd>{t("Records the rules looked at in that run.")}</dd></div>
          <div className="nx-note"><dt>{t("Capped")}</dt><dd>{t("Objects whose score a critical rule holds down.")}</dd></div>
        </dl>
        <p className="nx-sub">{t("This screen only reads the latest score of each system.")}</p>
      </section>
      <Strip frames={frames} idx={idx} onPick={onPick} />
      <section className="nx-ls-sec" aria-label={t("Mosaic")}>
        <header className="nx-ls-head">
          <h2>{t("Mosaic")}</h2>
          <span className="nx-at-key" aria-hidden="true">
            <span data-band="0">{t("95 and up")}</span>
            <span data-band="1">{t("85 to 95")}</span>
            <span data-band="2">{t("70 to 85")}</span>
            <span data-band="3">{t("below 70")}</span>
          </span>
        </header>
        <div className="nx-at-mosaic" data-testid="atlas-mosaic">
          {l.systems.map((s) => <SystemBlock key={s.id} system={s} landscape={l} frame={frame} />)}
        </div>
      </section>
    </>
  );
}

/** One bar per run: the objects at 85 and up after it. The bar of the shown run is marked. */
function Strip({ frames, idx, onPick }: { frames: AtlasFrame[]; idx: number; onPick: (i: number) => void }) {
  const counts = frames.map((f) => [...f.scores.values()].filter((s) => s != null && s >= 85).length);
  const max = Math.max(1, ...frames.map((f) => f.scores.size));
  return (
    <section className="nx-ls-sec" aria-label={t("Runs")}>
      <header className="nx-ls-head">
        <h2>{t("Runs")}</h2>
        <span className="nx-sub">{t("Objects at 85 and up after each run. Select a run to see the landscape as it stood.")}</span>
      </header>
      <ol className="nx-at-strip" data-testid="atlas-strip">
        {frames.map((f, i) => (
          <li key={f.run.id}>
            <button
              type="button"
              aria-pressed={i === idx}
              aria-label={t("{date}: {n} objects at 85 and up", { date: formatDate(f.run.run_at, "datetime"), n: int(counts[i]) })}
              onClick={() => onPick(i)}
            >
              <span className="nx-at-bar" style={{ height: `${(counts[i] / max) * 100}%` }}>
                <span className="nx-at-count">{int(counts[i])}</span>
              </span>
            </button>
            <span className="nx-at-date">{formatDate(f.run.run_at, "date")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SystemBlock({ system, landscape, frame }: { system: LandscapeSystem; landscape: LandscapeData; frame: AtlasFrame }) {
  const cells = landscape.cells.filter((c) => c.system_id === system.id);
  if (!cells.length) return null;
  const total = cells.reduce((s, c) => s + (c.records_checked ?? 0), 0) || cells.length;
  const sorted = [...cells].sort((a, b) => (b.records_checked ?? 0) - (a.records_checked ?? 0));
  const label = (m: string) => landscape.objects.find((o) => o.module === m)?.label ?? m;
  return (
    <div className="nx-at-sys" data-ran={frame.run.system_id === system.id}>
      <h3 className="nx-at-sysname">
        {system.name} <span className="nx-sub">{systemTypeText(system.system_type)}</span>
      </h3>
      <div className="nx-at-tiles">
        {sorted.map((c) => {
          const key = atlasKey(system.id, c.module);
          const score = frame.scores.get(key) ?? null;
          const d = frame.delta.get(key) ?? null;
          const raw = frame.measured.get(key);
          const share = (c.records_checked ?? total / cells.length) / total;
          const moved = d == null || Math.abs(d) < 0.05 ? undefined : d > 0 ? "up" : "down";
          return (
            <KeepLink
              key={c.module}
              href={`/o/${systemSlug(system.name)}/${moduleSlug(c.module)}?run=${frame.run.id}`}
              className="nx-at-tile"
              data-testid="atlas-tile"
              data-band={band(score) ?? undefined}
              data-moved={moved}
              style={{ flexGrow: Math.max(1, Math.round(share * 100)), flexBasis: `${Math.max(8, Math.round(share * 60))}rem` }}
              title={t("{object}: {score}, {records} records", { object: label(c.module), score: score == null ? t("not scored") : f1(score), records: c.records_checked == null ? DASH : int(c.records_checked) })}
            >
              <span className="nx-at-name">{label(c.module)}</span>
              <Code code={c.module} />
              <span className="nx-at-score">{score == null ? DASH : f1(score)}</span>
              <span className="nx-at-delta">{moved ? signed(d) : ""}</span>
              {raw != null ? <span className="nx-at-cap">{t("Capped by critical rules, measured {score}", { score: f1(raw) })}</span> : null}
            </KeepLink>
          );
        })}
      </div>
    </div>
  );
}

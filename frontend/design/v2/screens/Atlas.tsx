"use client";

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { getTimeline } from "@/lib/api/v2/runs";
import type { Landscape, LandscapeSystem } from "@/lib/api/v2/types";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { atlasKey, framesOf, type AtlasFrame } from "@/lib/v2/atlas";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { runKeys } from "@/lib/v2/runs-queries";
import { DASH, f1, int, moduleSlug, systemSlug } from "@/lib/v2/score";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { band, signed } from "./Cockpit";
import { CcBanner, CcPage } from "./cc-parts";

/**
 * The landscape atlas: every object of every system as one tile, sized by the records it checks and shaded by its
 * score, replayed run by run. The strip under the mosaic counts the objects at 85 and up after each run; press a bar or
 * play to watch the landscape move. Scores are the stored run scores; nothing is interpolated between runs.
 */

const RUNS = 12;
const TICK_MS = 900;

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

  if (landscape.isPending || timelines.some((q) => q.isPending)) return <CcPage title={t("Landscape atlas")}><Skeleton width="100%" height={320} /></CcPage>;
  if (landscape.isError) return <CcPage title={t("Landscape atlas")}><ErrorFrame onRetry={() => void landscape.refetch()}>{t("The landscape could not be read.")}</ErrorFrame></CcPage>;
  if (!frames.length) return <CcPage title={t("Landscape atlas")}><EmptyFrame>{t("Run an analysis to see the landscape atlas.")}</EmptyFrame></CcPage>;

  const l = landscape.data;
  const frame = frames[idx];
  const scores = [...frame.scores.values()].filter((s): s is number => s != null);
  const ready = scores.filter((s) => s >= 85).length;
  const moves = [...frame.delta.values()];
  const up = moves.filter((d) => d >= 0.05).length;
  const down = moves.filter((d) => d <= -0.05).length;
  const system = l.systems.find((s) => s.id === frame.run.system_id);
  const play = () => {
    if (idx >= last) setAt(0);
    setPlaying(true);
  };

  return (
    <CcPage title={t("Landscape atlas")}>
      <CcBanner
        testId="atlas"
        label={t("Landscape atlas")}
        eyebrow={t("Landscape atlas")}
        headline={t("{ready} of {scored} objects at 85 or above", { ready: int(ready), scored: int(scores.length) })}
        why={t("After the {system} run of {date}: {up} objects moved up, {down} moved down.", { system: system?.name ?? DASH, date: formatDate(frame.run.run_at, "datetime"), up: int(up), down: int(down) })}
        figs={[
          { label: t("Run"), value: `${int(idx + 1)}/${int(frames.length)}`, note: formatDate(frame.run.run_at, "date") },
          { label: t("Records checked"), value: frame.run.records_checked == null ? DASH : int(frame.run.records_checked), note: system?.name },
          { label: t("Below 70"), value: int(scores.filter((s) => s < 70).length), note: t("objects") },
        ]}
        action={
          playing ? (
            <button type="button" className="m2-btn" onClick={() => setPlaying(false)} data-testid="atlas-pause">
              {t("Pause")}
            </button>
          ) : (
            <button type="button" className="m2-btn m2-next" onClick={play} data-testid="atlas-play">
              {idx >= last ? t("Replay the runs") : t("Play from here")}
            </button>
          )
        }
      />
      <Strip frames={frames} idx={idx} onPick={(i) => { setPlaying(false); setAt(i); }} />
      <section className="m2-ck-panel" aria-label={t("Mosaic")}>
        <header className="m2-ck-head">
          <h2 className="m2-h2">{t("Mosaic")}</h2>
          <span className="m2-ck-key" aria-hidden="true">
            <span data-band="0">{t("95 and up")}</span>
            <span data-band="1">{t("85 to 95")}</span>
            <span data-band="2">{t("70 to 85")}</span>
            <span data-band="3">{t("below 70")}</span>
          </span>
        </header>
        <div className="m2-at-mosaic" data-testid="atlas-mosaic">
          {l.systems.map((s) => (
            <SystemBlock key={s.id} system={s} landscape={l} frame={frame} />
          ))}
        </div>
      </section>
    </CcPage>
  );
}

/** One bar per run: the objects at 85 and up after it. The bar of the shown run is marked. */
function Strip({ frames, idx, onPick }: { frames: AtlasFrame[]; idx: number; onPick: (i: number) => void }) {
  const counts = frames.map((f) => [...f.scores.values()].filter((s) => s != null && s >= 85).length);
  const max = Math.max(1, ...frames.map((f) => f.scores.size));
  return (
    <section className="m2-ck-panel" aria-label={t("Runs")}>
      <header className="m2-ck-head">
        <h2 className="m2-h2">{t("Runs")}</h2>
        <span className="m2-meta">{t("Objects at 85 and up after each run. Select a run to see the landscape as it stood.")}</span>
      </header>
      <ol className="m2-at-strip" data-testid="atlas-strip">
        {frames.map((f, i) => (
          <li key={f.run.id}>
            <button
              type="button"
              aria-pressed={i === idx}
              aria-label={t("{date}: {n} objects at 85 and up", { date: formatDate(f.run.run_at, "datetime"), n: int(counts[i]) })}
              onClick={() => onPick(i)}
            >
              <span className="m2-at-bar" style={{ height: `${(counts[i] / max) * 100}%` }}>
                <span className="m2-at-count">{int(counts[i])}</span>
              </span>
            </button>
            <span className="m2-meta">{formatDate(f.run.run_at, "date")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SystemBlock({ system, landscape, frame }: { system: LandscapeSystem; landscape: Landscape; frame: AtlasFrame }) {
  const cells = landscape.cells.filter((c) => c.system_id === system.id);
  if (!cells.length) return null;
  const total = cells.reduce((s, c) => s + (c.records_checked ?? 0), 0) || cells.length;
  const sorted = [...cells].sort((a, b) => (b.records_checked ?? 0) - (a.records_checked ?? 0));
  const label = (m: string) => landscape.objects.find((o) => o.module === m)?.label ?? m;
  return (
    <div className="m2-at-sys" data-ran={frame.run.system_id === system.id}>
      <h3 className="m2-at-sysname">
        {system.name} <span className="m2-meta">{systemTypeText(system.system_type)}</span>
      </h3>
      <div className="m2-at-tiles">
        {sorted.map((c) => {
          const key = atlasKey(system.id, c.module);
          const score = frame.scores.get(key) ?? null;
          const d = frame.delta.get(key) ?? null;
          const share = (c.records_checked ?? total / cells.length) / total;
          const moved = d == null || Math.abs(d) < 0.05 ? undefined : d > 0 ? "up" : "down";
          return (
            <V2Link
              key={c.module}
              href={`/o/${systemSlug(system.name)}/${moduleSlug(c.module)}?run=${frame.run.id}`}
              className="m2-at-tile"
              data-band={band(score) ?? undefined}
              data-moved={moved}
              style={{ flexGrow: Math.max(1, Math.round(share * 100)), flexBasis: `${Math.max(8, Math.round(share * 60))}rem` }}
              title={t("{object}: {score}, {records} records", { object: label(c.module), score: score == null ? t("not scored") : f1(score), records: c.records_checked == null ? DASH : int(c.records_checked) })}
            >
              <span className="m2-at-name">{label(c.module)}</span>
              <Mono className="m2-at-code">{c.module}</Mono>
              <span className="m2-at-score">{score == null ? DASH : f1(score)}</span>
              <span className="m2-at-delta">{moved ? signed(d) : ""}</span>
            </V2Link>
          );
        })}
      </div>
    </div>
  );
}

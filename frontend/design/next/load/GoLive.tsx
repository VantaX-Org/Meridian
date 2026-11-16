"use client";

/**
 * The go-live flight deck, native: every object of the next wave on one runway, its score history, the forecast line
 * from today to the go-live date with its 95% cone, and the wave's target. The forecast is the backend's least-squares
 * line; nothing is drawn past the furthest horizon it stored. The what-if beside it runs the stored simulation for the
 * selected object and never moves the forecast.
 */
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Verdict } from "@/lib/api/v2/types";
import { getForecast, type DqsForecast } from "@/lib/api/v2/analytics";
import { useFixture } from "@/lib/api/v2/fixture";
import { simulateFix } from "@/lib/api/v2/step9";
import { formatDate } from "@/lib/format";
import { useWaves } from "@/lib/v2/admin-queries";
import { bands, courseOf, fitLine, lineAt, maxHorizon, readAt, type GoLiveReading } from "@/lib/v2/forecast";
import { t } from "@/lib/v2/i18n";
import { moduleText, moneyCompactText } from "@/lib/v2/labels";
import { useObjectRules } from "@/lib/v2/queries";
import { DASH, f1, int, moduleSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { useMoney, useTopFixes } from "@/lib/v2/step9-queries";
import { dayFromToday, daysUntil, nextWave } from "@/lib/v2/waves";
import { Button, EmptyState, ErrorState, Skeleton } from "../kit";
import { About, Banner, Panel } from "./parts";

interface Row {
  module: string;
  forecast: DqsForecast | null;
  reading: GoLiveReading | null;
  loading: boolean;
  failed: boolean;
}

const ROW_H = 72;
const PAD_L = 168;
const PAD_R = 16;

const Dash = ({ why }: { why: string }) => <span title={why} aria-label={why}>{DASH}</span>;

/** The width of an element, followed as it resizes. */
function useMeasuredWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW(x); };
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function GoLive() {
  const fixture = useFixture();
  const waves = useWaves();
  const wave = nextWave(waves.data ?? []);
  const target = wave?.min_dqs ?? null;
  // Day 0 of a forecast is the latest run; go-live is counted from there, not from today.
  const sinceRun = Math.max(0, -(daysUntil(wave?.last_completed_at ?? null) ?? 0));
  const toGoLive = daysUntil(wave?.target_date ?? null);
  const goLiveDay = toGoLive == null ? null : Math.max(0, toGoLive) + sinceRun;
  const modules = wave?.modules ?? [];
  const forecasts = useQueries({
    queries: modules.map((m) => ({ queryKey: ["v2", "forecast", fixture, m], queryFn: () => getForecast(m), staleTime: 60_000, retry: false })),
  });
  const money = useMoney("wave", wave?.id ?? null, !!wave).data;
  const [picked, setPicked] = useState<string | null>(null);
  const title = t("Go-live flight deck");

  if (waves.isPending) return <Skeleton lines={6} label={title} />;
  if (waves.isError) return <ErrorState sentence={t("The migration waves could not be read.")} error={waves.error} onRetry={() => void waves.refetch()} />;
  if (!wave) {
    return (
      <div className="nx-ld-step" data-testid="nx-load-go-live">
        <EmptyState heading={title} action={<Link className="nx-btn nx-btn-primary" href="/?view=waves">{t("Plan a wave")}</Link>}>
          {t("Plan a migration wave with a go-live date to see its runway.")}
        </EmptyState>
      </div>
    );
  }

  const rows: Row[] = modules.map((m, i) => {
    const q = forecasts[i];
    const f = q?.data?.forecast ?? null;
    return { module: m, forecast: f, reading: f && goLiveDay != null ? readAt(f, goLiveDay, target) : null, loading: !!q?.isPending, failed: !!q?.isError };
  });
  const settled = rows.every((r) => !r.loading);
  const course = settled && goLiveDay != null ? courseOf(rows.map((r) => r.reading), target) : "unknown";
  const scored = rows.filter((r) => r.reading?.score != null);
  const weakest = scored.length ? scored.reduce((a, b) => ((a.reading?.score ?? 0) <= (b.reading?.score ?? 0) ? a : b)) : null;
  const crossings = rows.map((r) => r.reading?.crossing ?? null);
  const lastCrossing = settled && rows.length && crossings.every((c) => c != null) ? Math.max(...(crossings as number[])) : null;
  const crossDate = lastCrossing == null ? null : dayFromToday(lastCrossing - sinceRun);
  const selected = picked && modules.includes(picked) ? picked : (weakest?.module ?? modules[0] ?? null);
  const cost = money?.totals.opportunity_cost_per_month;

  const headline =
    course === "on"
      ? t("On course for {date}", { date: formatDate(wave.target_date, "date") })
      : course === "off"
        ? t("Off course for {date}", { date: wave.target_date ? formatDate(wave.target_date, "date") : t("go-live") })
        : !wave.target_date
          ? t("No go-live date set")
          : t("Cannot forecast go-live yet");
  const why =
    course === "off" && weakest
      ? t("{object} is forecast at {score} on go-live day, below the target of {target}.", { object: moduleText(weakest.module), score: f1(weakest.reading?.score ?? null), target: int(target ?? 0) })
      : course === "on"
        ? t("Every object is forecast at or above {target} on go-live day.", { target: int(target ?? 0) })
        : !wave.target_date
          ? t("Set a target date on the wave to read the forecast against it.")
          : t("Some objects lack the score history, or go-live lies beyond the furthest forecast.");

  return (
    <div className="nx-ld-step" data-testid="nx-load-go-live">
      <Banner
        testId="flight-deck"
        eyebrow={wave.name}
        headline={headline}
        verdict={course === "on" ? "go" : course === "off" ? "no-go" : undefined}
        why={cost == null ? why : `${why} ${cost === 0 ? t("No costed SAP feature waits on this wave.") : t("Waiting costs {money} a month.", { money: moneyCompactText(cost, money?.currency) })}`}
        figs={[
          { label: t("Days to go-live"), value: toGoLive == null ? DASH : int(Math.max(0, toGoLive)), note: wave.target_date ? formatDate(wave.target_date, "date") : t("no date set") },
          { label: t("Readiness today"), value: wave.last_score == null ? DASH : f1(wave.last_score), note: wave.last_verdict ? VERDICT_LABEL[wave.last_verdict.replace("_", "-") as Verdict] : t("not measured") },
          { label: t("Weakest at go-live"), value: weakest ? f1(weakest.reading?.score ?? null) : DASH, note: weakest ? moduleText(weakest.module) : t("no forecast"), tone: course === "off" ? "bad" : undefined },
          { label: t("Line meets target"), value: crossDate ? formatDate(crossDate, "date") : DASH, note: crossDate ? t("all objects") : t("not within the forecast") },
        ]}
        action={
          weakest && course !== "on" ? (
            <Link href={`/o/_/${moduleSlug(weakest.module)}`} className="nx-btn nx-btn-primary">
              {t("Lift {object}", { object: moduleText(weakest.module) })}
            </Link>
          ) : (
            <Link href="/?view=waves" className="nx-btn nx-btn-secondary">
              {t("Open the wave")}
            </Link>
          )
        }
      />
      <About
        shows={t("Counts down to the go-live date of a migration wave and shows how ready each object is against its target.")}
        means={[
          [t("Readiness today"), t("The latest measured score for the wave.")],
          [t("Weakest at go-live"), t("The lowest forecast score among the objects on the go-live date.")],
          [t("Line meets target"), t("The date the forecast line reaches the target; a dash means it does not within the forecast.")],
        ]}
        next={
          <>
            <Link className="nx-btn nx-btn-secondary" href="/forecast">{t("Open the forecast and plan")}</Link>
            <span className="nx-ld-meta">{t("Lifting an object opens its fix list. Nothing is changed until you approve a fix.")}</span>
          </>
        }
      />
      <div className="nx-ld-fd">
        <Runway rows={rows} target={target} goLiveDay={goLiveDay} sinceRun={sinceRun} selected={selected} onPick={setPicked} />
        {selected ? <WhatIf module={selected} key={selected} /> : null}
      </div>
    </div>
  );
}

function Runway({ rows, target, goLiveDay, sinceRun, selected, onPick }: { rows: Row[]; target: number | null; goLiveDay: number | null; sinceRun: number; selected: string | null; onPick: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref, 720);
  const first = Math.min(-7, ...rows.flatMap((r) => r.forecast?.history.map((h) => h.day) ?? []));
  const last = Math.max(7, goLiveDay ?? 0, ...rows.map((r) => (r.forecast ? (maxHorizon(r.forecast) ?? 0) : 0)));
  const x = (d: number) => PAD_L + ((d - first) / (last - first || 1)) * (width - PAD_L - PAD_R);
  // One score band for every row so the slopes compare: the lowest score drawn, a few points of air, up to 100.
  const lows = rows.flatMap((r) => (r.forecast ? [...r.forecast.history.map((h) => h.score), ...bands(r.forecast).map((b) => b[1])] : []));
  const floor = Math.max(0, Math.floor((Math.min(target ?? 100, ...lows) - 5) / 5) * 5);
  // Today and go-live labels push apart when the two lines nearly touch.
  const close = goLiveDay != null && Math.abs(x(goLiveDay) - x(sinceRun)) < 64;
  return (
    <Panel title={t("Runway")} meta={t("Score history, forecast and 95% cone per object. Select an object to try fixes.")}>
      <div ref={ref} className="nx-ld-fd-runway" data-testid="runway">
        <svg width={width} height={rows.length * ROW_H + 24} role="img" aria-label={t("Forecast runway of {n} objects", { n: rows.length })}>
          <line className="nx-ld-fd-today" x1={x(sinceRun)} x2={x(sinceRun)} y1={0} y2={rows.length * ROW_H} />
          <text className="nx-ld-fd-axis" x={x(sinceRun)} y={rows.length * ROW_H + 16} textAnchor={close ? "end" : "middle"}>{t("Today")}</text>
          {goLiveDay != null ? (
            <>
              <line className="nx-ld-fd-golive" x1={x(goLiveDay)} x2={x(goLiveDay)} y1={0} y2={rows.length * ROW_H} />
              <text className="nx-ld-fd-axis" x={x(goLiveDay)} y={rows.length * ROW_H + 16} textAnchor={close ? "start" : "middle"}>{t("Go-live")}</text>
            </>
          ) : null}
          {rows.map((r, i) => (
            <RunwayRow key={r.module} row={r} top={i * ROW_H} x={x} floor={floor} target={target} goLiveDay={goLiveDay} on={r.module === selected} onPick={onPick} />
          ))}
        </svg>
      </div>
    </Panel>
  );
}

function RunwayRow({ row, top, x, floor, target, goLiveDay, on, onPick }: { row: Row; top: number; x: (d: number) => number; floor: number; target: number | null; goLiveDay: number | null; on: boolean; onPick: (m: string) => void }) {
  const h = ROW_H - 12;
  const y = (s: number) => top + 6 + h - ((Math.max(floor, s) - floor) / (100 - floor || 1)) * h;
  const f = row.forecast;
  const line = f ? fitLine(f.history) : null;
  // The line runs to the furthest stored horizon so the reader sees where it meets the target, past go-live too.
  const end = f ? maxHorizon(f) : null;
  const cone: string[] = [];
  if (f && end != null) {
    const steps = Array.from({ length: 13 }, (_, k) => (k / 12) * end);
    const reads = steps.map((d) => [d, readAt(f, d, null)] as const);
    reads.forEach(([d, r]) => cone.push(`${x(d)},${y(r.high ?? 0)}`));
    [...reads].reverse().forEach(([d, r]) => cone.push(`${x(d)},${y(r.low ?? 0)}`));
  }
  const score = row.reading?.score ?? null;
  const short = score != null && target != null && score < target;
  return (
    <g className="nx-ld-fd-row" data-on={on} data-short={short} data-module={row.module}>
      <foreignObject x={0} y={top + 4} width={PAD_L - 8} height={ROW_H - 8}>
        <div className="nx-ld-fd-name">
          <Button variant={on ? "secondary" : "quiet"} size={32} aria-pressed={on} onClick={() => onPick(row.module)}>{moduleText(row.module)}</Button>
          <span className="nx-ld-meta">{row.loading ? t("Reading forecast") : row.failed ? t("Forecast unavailable") : !f ? t("Too little history") : score == null ? t("Go-live beyond forecast") : t("{score} at go-live", { score: f1(score) })}</span>
        </div>
      </foreignObject>
      {target != null ? <line className="nx-ld-fd-target" x1={x(f?.history[0]?.day ?? 0)} x2={x(Math.max(goLiveDay ?? 0, end ?? 0))} y1={y(target)} y2={y(target)} /> : null}
      {cone.length ? <polygon className="nx-ld-fd-cone" points={cone.join(" ")} /> : null}
      {f ? <polyline className="nx-ld-fd-hist" points={f.history.map((p) => `${x(p.day)},${y(p.score)}`).join(" ")} /> : null}
      {f?.history.map((p) => <circle key={p.day} className="nx-ld-fd-dot" cx={x(p.day)} cy={y(p.score)} r={2} />)}
      {line && end != null ? <line className="nx-ld-fd-fc" x1={x(0)} y1={y(lineAt(line, 0))} x2={x(end)} y2={y(lineAt(line, end))} /> : null}
      {score != null && goLiveDay != null ? <circle className="nx-ld-fd-hit" cx={x(goLiveDay)} cy={y(score)} r={4} /> : null}
    </g>
  );
}

function WhatIf({ module }: { module: string }) {
  const fixture = useFixture();
  const top = useTopFixes(module, null, null);
  const names = useObjectRules(module, null);
  const nameOf = useMemo(() => new Map((names.data ?? []).map((r) => [r.check_id, r.name])), [names.data]);
  const [rules, setRules] = useState<string[]>([]);
  const sim = useQuery({
    queryKey: ["v2", "flight-sim", fixture, module, rules],
    queryFn: () => simulateFix({ module, rules }),
    enabled: rules.length > 0,
    retry: false,
  });
  const toggle = (id: string) => setRules((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  const d = sim.data?.delta;
  return (
    <Panel title={t("What if, for {object}", { object: moduleText(module) })} meta={t("Simulation: nothing is changed in SAP or in Meridian.")} testId="what-if">
      {top.isPending ? (
        <Skeleton lines={3} label={t("What if")} />
      ) : top.isError ? (
        <ErrorState sentence={t("The fixes for this object could not be read.")} error={top.error} onRetry={() => void top.refetch()} />
      ) : !top.data.rules.length ? (
        <p className="nx-ld-meta">{t("No failing rules to try for this object.")}</p>
      ) : (
        <ul className="nx-ld-list">
          {top.data.rules.map((r) => (
            <li key={r.check_id}>
              <label className="nx-load-check">
                <input type="checkbox" checked={rules.includes(r.check_id)} onChange={() => toggle(r.check_id)} />
                <span className="nx-mono">{r.check_id}</span>
                <span>{nameOf.get(r.check_id) ?? DASH}</span>
              </label>
              <span className="nx-ld-meta">{t("{n} failing", { n: int(r.failing) })}, {t("{delta} alone", { delta: `+${f1(r.delta)}` })}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="nx-ld-figs" aria-live="polite">
        <div className="nx-card nx-stat">
          <dt className="nx-stat-label">{t("Score after")}</dt>
          <dd className="nx-stat-value">{!rules.length ? <Dash why={t("Pick a rule to try")} /> : sim.isPending ? DASH : sim.data ? `${f1(sim.data.after.score)} (${(d?.score ?? 0) >= 0 ? "+" : ""}${f1(d?.score ?? null)})` : <Dash why={t("Simulation failed")} />}</dd>
        </div>
        <div className="nx-card nx-stat">
          <dt className="nx-stat-label">{t("Gates opened")}</dt>
          <dd className="nx-stat-value">{d ? (d.gates_opened.length ? d.gates_opened.join(", ") : t("none")) : DASH}</dd>
        </div>
        <div className="nx-card nx-stat">
          <dt className="nx-stat-label">{t("Verdict")}</dt>
          <dd className="nx-stat-value">{sim.data?.after.verdict ? VERDICT_LABEL[sim.data.after.verdict] : DASH}</dd>
        </div>
      </dl>
    </Panel>
  );
}

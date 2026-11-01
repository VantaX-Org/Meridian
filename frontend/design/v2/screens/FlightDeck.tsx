"use client";

import { useMemo, useRef, useState } from "react";
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
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { useMeasuredWidth } from "../RunTimeline";
import { CcBanner, CcPage } from "./cc-parts";

/**
 * The go-live flight deck: every object of the next wave on one runway, its score history, the forecast line from
 * today to the go-live date with its 95% cone, and the wave's target. The forecast is the backend's least-squares
 * line; nothing is drawn past the furthest horizon it stored. The what-if beside it runs the stored simulation for
 * the selected object and never moves the forecast.
 */

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

export function FlightDeck() {
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

  if (waves.isPending) return <CcPage title={t("Go-live flight deck")}><Skeleton width="100%" height={240} /></CcPage>;
  if (waves.isError) return <CcPage title={t("Go-live flight deck")}><ErrorFrame onRetry={() => void waves.refetch()}>{t("The migration waves could not be read.")}</ErrorFrame></CcPage>;
  if (!wave) {
    return (
      <CcPage title={t("Go-live flight deck")}>
        <EmptyFrame action={<V2Link href="/?view=waves" className="m2-btn m2-next">{t("Plan a wave")}</V2Link>}>{t("Plan a migration wave with a go-live date to see its runway.")}</EmptyFrame>
      </CcPage>
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
    <CcPage title={t("Go-live flight deck")}>
      <CcBanner
        testId="flight-deck"
        label={t("Go-live flight deck")}
        eyebrow={wave.name}
        headline={headline}
        verdict={course === "on" ? "go" : course === "off" ? "no-go" : undefined}
        why={cost == null ? why : `${why} ${cost === 0 ? t("No costed SAP feature waits on this wave.") : t("Waiting costs {money} a month.", { money: moneyCompactText(cost, money?.currency) })}`}
        figs={[
          { label: t("Days to go-live"), value: toGoLive == null ? DASH : int(Math.max(0, toGoLive)), note: wave.target_date ? formatDate(wave.target_date, "date") : t("no date set") },
          { label: t("Readiness today"), value: wave.last_score == null ? DASH : f1(wave.last_score), note: wave.last_verdict ? VERDICT_LABEL[wave.last_verdict.replace("_", "-") as Verdict] : t("not measured") },
          { label: t("Weakest at go-live"), value: weakest ? f1(weakest.reading?.score ?? null) : DASH, note: weakest ? moduleText(weakest.module) : t("no forecast") },
          { label: t("Line meets target"), value: crossDate ? formatDate(crossDate, "date") : DASH, note: crossDate ? t("all objects") : t("not within the forecast") },
        ]}
        action={
          weakest && course !== "on" ? (
            <V2Link href={`/o/_/${moduleSlug(weakest.module)}`} className="m2-btn m2-next">
              {t("Lift {object}", { object: moduleText(weakest.module) })}
            </V2Link>
          ) : (
            <V2Link href="/?view=waves" className="m2-btn">
              {t("Open the wave")}
            </V2Link>
          )
        }
      />
      <div className="m2-fd">
        <Runway rows={rows} target={target} goLiveDay={goLiveDay} sinceRun={sinceRun} selected={selected} onPick={setPicked} />
        {selected ? <WhatIf module={selected} key={selected} /> : null}
      </div>
    </CcPage>
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
    <section className="m2-ck-panel" aria-label={t("Runway")}>
      <div className="m2-ck-head">
        <h2 className="m2-h2">{t("Runway")}</h2>
        <span className="m2-meta">{t("Score history, forecast and 95% cone per object. Select an object to try fixes.")}</span>
      </div>
      <div ref={ref} className="m2-fd-runway" data-testid="runway">
        <svg width={width} height={rows.length * ROW_H + 24} role="img" aria-label={t("Forecast runway of {n} objects", { n: rows.length })}>
          <line className="m2-fd-today" x1={x(sinceRun)} x2={x(sinceRun)} y1={0} y2={rows.length * ROW_H} />
          <text className="m2-fd-axis" x={x(sinceRun)} y={rows.length * ROW_H + 16} textAnchor={close ? "end" : "middle"}>{t("Today")}</text>
          {goLiveDay != null ? (
            <>
              <line className="m2-fd-golive" x1={x(goLiveDay)} x2={x(goLiveDay)} y1={0} y2={rows.length * ROW_H} />
              <text className="m2-fd-axis" x={x(goLiveDay)} y={rows.length * ROW_H + 16} textAnchor={close ? "start" : "middle"}>{t("Go-live")}</text>
            </>
          ) : null}
          {rows.map((r, i) => (
            <RunwayRow key={r.module} row={r} top={i * ROW_H} x={x} floor={floor} target={target} goLiveDay={goLiveDay} on={r.module === selected} onPick={onPick} />
          ))}
        </svg>
      </div>
    </section>
  );
}

function RunwayRow({ row, top, x, floor, target, goLiveDay, on, onPick }: { row: Row; top: number; x: (d: number) => number; floor: number; target: number | null; goLiveDay: number | null; on: boolean; onPick: (m: string) => void }) {
  const h = ROW_H - 12;
  const y = (s: number) => top + 6 + h - ((Math.max(floor, s) - floor) / (100 - floor || 1)) * h;
  const f = row.forecast;
  const line = f ? fitLine(f.history) : null;
  const max = f ? maxHorizon(f) : null;
  // The line runs to the furthest stored horizon so the reader sees where it meets the target, past go-live too.
  const end = max;
  const cone: string[] = [];
  if (f && end != null) {
    const steps = Array.from({ length: 13 }, (_, k) => (k / 12) * end);
    const reads = steps.map((d) => [d, readAt(f, d, null)] as const);
    reads.forEach(([d, r]) => cone.push(`${x(d)},${y(r.high ?? 0)}`));
    [...reads].reverse().forEach(([d, r]) => cone.push(`${x(d)},${y(r.low ?? 0)}`));
  }
  const name = moduleText(row.module);
  const score = row.reading?.score ?? null;
  const short = score != null && target != null && score < target;
  return (
    <g className="m2-fd-row" data-on={on} data-short={short} data-module={row.module}>
      <foreignObject x={0} y={top + 4} width={PAD_L - 8} height={ROW_H - 8}>
        <button type="button" className="m2-fd-name" aria-pressed={on} onClick={() => onPick(row.module)}>
          <span>{name}</span>
          <span className="m2-meta">{row.loading ? t("Reading forecast") : row.failed ? t("Forecast unavailable") : !f ? t("Too little history") : score == null ? t("Go-live beyond forecast") : t("{score} at go-live", { score: f1(score) })}</span>
        </button>
      </foreignObject>
      {target != null ? <line className="m2-fd-target" x1={x(f?.history[0]?.day ?? 0)} x2={x(Math.max(goLiveDay ?? 0, end ?? 0))} y1={y(target)} y2={y(target)} /> : null}
      {cone.length ? <polygon className="m2-fd-cone" points={cone.join(" ")} /> : null}
      {f ? <polyline className="m2-fd-hist" points={f.history.map((p) => `${x(p.day)},${y(p.score)}`).join(" ")} /> : null}
      {f?.history.map((p) => <circle key={p.day} className="m2-fd-dot" cx={x(p.day)} cy={y(p.score)} r={2} />)}
      {line && end != null ? <line className="m2-fd-fc" x1={x(0)} y1={y(lineAt(line, 0))} x2={x(end)} y2={y(lineAt(line, end))} /> : null}
      {score != null && goLiveDay != null ? <circle className="m2-fd-hit" cx={x(goLiveDay)} cy={y(score)} r={4} /> : null}
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
    <section className="m2-ck-panel m2-fd-whatif" aria-label={t("What if")} data-testid="what-if">
      <div className="m2-ck-head">
        <h2 className="m2-h2">{t("What if, for {object}", { object: moduleText(module) })}</h2>
        <span className="m2-meta">{t("Simulation: nothing is changed in SAP or in Meridian.")}</span>
      </div>
      {top.isPending ? (
        <Skeleton width="100%" height={96} />
      ) : top.isError ? (
        <ErrorFrame onRetry={() => void top.refetch()}>{t("The fixes for this object could not be read.")}</ErrorFrame>
      ) : !top.data.rules.length ? (
        <p className="m2-meta">{t("No failing rules to try for this object.")}</p>
      ) : (
        <ul className="m2-fd-rules">
          {top.data.rules.map((r) => (
            <li key={r.check_id}>
              <label>
                <input type="checkbox" checked={rules.includes(r.check_id)} onChange={() => toggle(r.check_id)} />
                <span className="m2-mono">{r.check_id}</span>
                <span className="m2-fd-rname">{nameOf.get(r.check_id) ?? DASH}</span>
                <span>{t("{n} failing", { n: int(r.failing) })}</span>
                <span className="m2-meta">{t("{delta} alone", { delta: `+${f1(r.delta)}` })}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <dl className="m2-fd-result" aria-live="polite">
        <div>
          <dt>{t("Score after")}</dt>
          <dd>{!rules.length ? <Dash why={t("Pick a rule to try")} /> : sim.isPending ? DASH : sim.data ? `${f1(sim.data.after.score)} (${(d?.score ?? 0) >= 0 ? "+" : ""}${f1(d?.score ?? null)})` : <Dash why={t("Simulation failed")} />}</dd>
        </div>
        <div>
          <dt>{t("Gates opened")}</dt>
          <dd>{d ? (d.gates_opened.length ? d.gates_opened.join(", ") : t("none")) : DASH}</dd>
        </div>
        <div>
          <dt>{t("Verdict")}</dt>
          <dd>{sim.data?.after.verdict ? VERDICT_LABEL[sim.data.after.verdict] : DASH}</dd>
        </div>
      </dl>
    </section>
  );
}

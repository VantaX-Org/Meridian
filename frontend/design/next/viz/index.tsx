"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon, type IconName } from "@/design/next/Icon";
import { Chip } from "@/design/next/kit";
import type { Viz } from "../shell/pickViz";
import "./viz.css";

/** Shared chart parts for the Story feed cards. Inline SVG, token colours, a native tooltip (<title>) on every mark and an aria label that says the same in words. */

export interface RingProps {
  /** 0 to 100, or null when there is no score yet (an empty ring is drawn). */
  value: number | null;
  size?: number;
  label: string;
  /** Text in the middle; defaults to the one-decimal value. */
  center?: string;
}

export function ScoreRing({ value, size = 120, label, center }: RingProps) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg className="nx-viz-ring" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
      <title>{label}</title>
      <circle className="nx-viz-ring-track" cx="60" cy="60" r={r} fill="none" strokeWidth="10" />
      {value == null ? null : (
        <circle className="nx-viz-ring-arc" cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${((pct / 100) * c).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 60 60)" />
      )}
      <text className="nx-viz-ring-text" x="60" y="66" textAnchor="middle">{center ?? (value == null ? t("No score") : value.toFixed(1))}</text>
    </svg>
  );
}

export interface TrendPoint { label: string; value: number }

/** A 2px line over a soft area. Fewer than two points draws a dashed empty shape with the caption beside it. */
export function AreaTrend({ points, label, height = 72, empty, emphasisLast = false }: { points: TrendPoint[]; label: string; height?: number; empty: string; emphasisLast?: boolean }) {
  const w = 240;
  if (points.length < 2) {
    return (
      <div className="nx-viz-empty" role="img" aria-label={empty}>
        <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true"><line className="nx-viz-dash" x1="4" x2={w - 4} y1={height / 2} y2={height / 2} strokeWidth="2" strokeDasharray="4 6" /></svg>
        <small>{empty}</small>
      </div>
    );
  }
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  const pad = 6;
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - 2 * pad), height - pad - ((p.value - lo) / span) * (height - 2 * pad)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${w - pad},${height - pad}`;
  return (
    <svg className="nx-viz-trend" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      <polygon className="nx-viz-area" points={area} />
      <polyline className="nx-viz-line" points={line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {xy.map(([x, y], i) => (
        <circle key={points[i].label} className={emphasisLast && i === points.length - 1 ? "nx-viz-dot nx-viz-dot-last" : "nx-viz-dot"} cx={x} cy={y} r={emphasisLast && i === points.length - 1 ? 4 : 3}><title>{`${points[i].label}: ${points[i].value.toFixed(1)}`}</title></circle>
      ))}
    </svg>
  );
}

export interface Seg { id: string; label: string; value: number; tone: "good" | "warn" | "bad" | "chart1" | "chart2" | "chart3" | "mute" }

/** One bar split into segments with 4px rounded ends. Zero total draws an empty track. */
export function StackedBar({ segs, label }: { segs: Seg[]; label: string }) {
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  const w = 240;
  let x = 0;
  return (
    <svg className="nx-viz-stack" width="100%" height="20" viewBox={`0 0 ${w} 20`} preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      <rect className="nx-viz-track" x="0" y="0" width={w} height="20" rx="4" />
      {total === 0 ? null : segs.filter((s) => s.value > 0).map((s) => {
        const sw = (s.value / total) * w;
        const x0 = x;
        x += sw;
        return <rect key={s.id} className={`nx-viz-seg nx-viz-${s.tone}`} x={x0} y="0" width={Math.max(sw - 1, 1)} height="20" rx="4"><title>{`${s.label}: ${s.value}`}</title></rect>;
      })}
    </svg>
  );
}

export interface HeatCell { key: string; title: string; value: number | null }

/** Rows by columns; each cell is shaded by value (0 to 100) on one ramp, an empty cell is outlined. */
export function HeatGrid({ rows, cols, cells, label }: { rows: string[]; cols: string[]; cells: Record<string, HeatCell>; label: string }) {
  const cw = 18;
  const ch = 14;
  return (
    <svg className="nx-viz-heat" width="100%" height={rows.length * (ch + 2)} viewBox={`0 0 ${cols.length * (cw + 2)} ${rows.length * (ch + 2)}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      {rows.flatMap((r, ri) => cols.map((c, ci) => {
        const cell = cells[`${r}|${c}`];
        const v = cell?.value;
        const step = v == null ? 0 : Math.min(4, Math.max(1, Math.ceil(v / 25)));
        return <rect key={`${r}|${c}`} className={`nx-viz-cell nx-viz-h${step}`} x={ci * (cw + 2)} y={ri * (ch + 2)} width={cw} height={ch} rx="3"><title>{cell?.title ?? `${r}, ${c}`}</title></rect>;
      }))}
    </svg>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
export { fmt as vizNum, signed as vizSigned };

/** Ranked horizontal bars by magnitude: one emphasised row, the rest quiet. Signed text, bar width is |value|. */
export function RankedBars({ items, label, emphasis = "top" }: { items: { label: string; value: number }[]; label: string; emphasis?: "top" | "first" | "none" }) {
  const max = Math.max(...items.map((d) => Math.abs(d.value)), 0);
  const hot = emphasis === "none" || max === 0 ? -1 : emphasis === "first" ? 0 : items.findIndex((d) => Math.abs(d.value) === max);
  return (
    <ul className="nx-viz-ranked" aria-label={label}>
      {items.map((d, i) => (
        <li key={d.label} data-hot={i === hot ? "1" : undefined} title={`${d.label}: ${fmt(d.value)}`}>
          <span className="nx-viz-ranked-l"><span className="nx-viz-ranked-n" aria-hidden="true">{i + 1}</span>{d.label}</span>
          <span className="nx-viz-ranked-bar" aria-hidden="true"><span style={{ width: `${max ? (Math.abs(d.value) / max) * 100 : 0}%` }} /></span>
          <span className="nx-viz-ranked-v">{fmt(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One or two big figures; with two, the first is the accent and a delta line follows. */
export function Stat({ figures, label, delta }: { figures: { label: string; value: number }[]; label: string; delta?: number }) {
  return (
    <div className="nx-viz-stat" role="img" aria-label={label} title={label}>
      <div className="nx-viz-stat-row">
        {figures.map((f, i) => (
          <div key={f.label} data-accent={i === 0 && figures.length > 1 ? "1" : undefined}>
            <b>{fmt(f.value)}</b>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
      {delta != null && figures.length === 2 ? <small>{`${figures[0].label} \u2212 ${figures[1].label}: ${signed(delta)}`}</small> : null}
    </div>
  );
}

/** Legend under a StackedBar: swatch, label, value and share of the total. */
export function VizLegend({ items }: { items: { label: string; value: number; tone: Seg["tone"]; note: string }[] }) {
  return (
    <ul className="nx-viz-legend">
      {items.map((s) => (
        <li key={s.label}>
          <svg width="8" height="8" aria-hidden="true"><rect width="8" height="8" rx="2" className={`nx-viz-${s.tone}`} /></svg>
          {s.label} <b>{fmt(s.value)}</b> <span>{s.note}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---- Living rail widgets (.nx-wg-*): one component per pickViz kind, fed only from the grounded Viz. ---- */

const TONES = ["chart1", "chart2", "chart3"] as const;
const MAX_SOURCES = 6;

function Wg({ kind, icon, title, children }: { kind: string; icon: IconName; title: string; children: ReactNode }) {
  return (
    <section className={`nx-wg nx-wg-${kind}`} data-viz={kind} aria-label={title}>
      <header className="nx-wg-head"><Icon name={icon} /><h4 className="nx-wg-title">{title}</h4></header>
      {children}
    </section>
  );
}

/** SIGNATURE: the naive read struck through against the true one. Labels are the backend's, never fixed text. */
export function WgCompare({ naive, truth }: { naive: { label: string; value: number }; truth: { label: string; value: number } }) {
  const max = Math.max(Math.abs(naive.value), Math.abs(truth.value)) || 1;
  const label = t("{naive} by simple count, {truth} by Aletheia", { naive: `${naive.label} ${signed(naive.value)}`, truth: `${truth.label} ${signed(truth.value)}` });
  return (
    <Wg kind="compare" icon="columns" title={t("Two ways to read it")}>
      <div className="nx-wg-cmp" role="img" aria-label={label}>
        <div><small>{t("A spreadsheet sees")}</small><b className="nx-wg-cmp-naive">{signed(naive.value)}</b><small>{naive.label}</small></div>
        <div><small>{t("Aletheia sees")}</small><b className="nx-wg-cmp-true">{signed(truth.value)}</b><small>{truth.label}</small></div>
      </div>
      <div className="nx-wg-cmp-track" aria-hidden="true">
        <span className="nx-wg-cmp-ink" data-role="naive" style={{ width: `${(Math.abs(naive.value) / max) * 100}%` }} />
        <span className="nx-wg-cmp-ink" data-role="true" style={{ width: `${(Math.abs(truth.value) / max) * 100}%` }} />
      </div>
    </Wg>
  );
}

export function WgPace({ pct, coverage }: { pct: number; coverage: number }) {
  const tone = pct > 100 ? "good" : pct < 80 ? "warn" : "ink";
  return (
    <Wg kind="pace" icon="refresh" title={t("Pace")}>
      <div className="nx-wg-pace-row">
        <ScoreRing value={coverage * 100} size={56} label={`${t("Pace")} ${fmt(pct)}%`} center=" " />
        <div><b className="nx-wg-pace-pct" data-tone={tone}>{fmt(pct)}%</b><small>{t("of last month's run rate")}</small></div>
      </div>
    </Wg>
  );
}

export function WgLine({ points }: { points: { label: string; value: number }[] }) {
  const label = t("Trend of {label}", { label: points[0].label });
  return (
    <Wg kind="line" icon="history" title={t("Trend")}>
      <span className="nx-wg-line-path"><AreaTrend points={points} label={label} height={96} empty={label} emphasisLast /></span>
      <small className="nx-wg-cap">{t("Now")}</small>
    </Wg>
  );
}

export function WgBars({ items, keepOrder, more }: { items: { label: string; value: number }[]; keepOrder: boolean; more: number }) {
  const zero = items.every((d) => d.value === 0);
  return (
    <Wg kind="bars" icon="columns" title={t("Ranked")}>
      <RankedBars items={items} label={t("Ranked")} emphasis={zero ? "none" : keepOrder ? "first" : "top"} />
      {more > 0 ? <small className="nx-wg-cap">{t("{n} more", { n: more })}</small> : null}
    </Wg>
  );
}

export function WgShare({ segs, total }: { segs: { label: string; value: number }[]; total: number }) {
  const parts = segs.map((s, i) => ({ id: s.label, label: s.label, value: s.value, tone: TONES[i] ?? ("mute" as const) }));
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <Wg kind="share" icon="columns" title={t("Share")}>
      <StackedBar segs={parts} label={t("Share of {label}", { label: segs[0].label })} />
      <VizLegend items={parts.map((s) => ({ ...s, note: t("{p}% of total", { p: pct(s.value) }) }))} />
    </Wg>
  );
}

export function WgStat({ figures, delta }: { figures: { label: string; value: number }[]; delta?: number }) {
  return (
    <Wg kind="stat" icon="info" title={figures[0].label}>
      <Stat figures={figures} label={figures.map((f) => `${f.label} ${fmt(f.value)}`).join(", ")} delta={delta} />
    </Wg>
  );
}

/** Sources grouped as the backend sends them. A row opens the first fact's href when `hrefFor` returns one. */
export function WgSource({ rows, onPick }: { rows: { source: string; checks: string[]; n: number }[]; onPick?: (source: string) => void }) {
  const shown = rows.slice(0, MAX_SOURCES);
  return (
    <Wg kind="source" icon="file" title={t("Where these numbers come from")}>
      <table className="nx-wg-src">
        <tbody>
          {shown.map((r) => (
            <tr key={r.source}>
              <td>{onPick ? <button type="button" className="nx-ask-link" onClick={() => onPick(r.source)}>{r.source}</button> : r.source}</td>
              <td>{r.checks.join(", ")}</td>
              <td>{t("{n} {n, plural, one {fact} other {facts}}", { n: r.n })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? <small className="nx-wg-cap">{t("{n} more sources", { n: rows.length - shown.length })}</small> : null}
    </Wg>
  );
}

export function WgFindings({ items, onAsk }: { items: string[]; onAsk: (q: string) => void }) {
  return (
    <Wg kind="findings" icon="alert" title={t("What needs attention")}>
      <ul className="nx-wg-find">
        {items.map((q) => <li key={q}><span>{q}</span><Chip tone="aletheia" onClick={() => onAsk(q)}>{t("Ask Vera")}</Chip></li>)}
      </ul>
    </Wg>
  );
}

export function WgLedger({ value, unit }: { value: number; unit: string }) {
  return (
    <Wg kind="ledger" icon="check" title={t("Value found")}>
      <b className="nx-wg-big">{unit ? `${unit} ` : ""}{fmt(value)}</b>
      <small>{t("Proof of value in this run")}</small>
    </Wg>
  );
}

/** One widget for one picked Viz. `none` and `map` (gap M1) render nothing. */
export function RailWidget({ viz, onAsk, onPickSource }: { viz: Viz; onAsk: (q: string) => void; onPickSource?: (source: string) => void }) {
  switch (viz.kind) {
    case "pace": return <WgPace pct={viz.pct} coverage={viz.coverage} />;
    case "line": return <WgLine points={viz.points} />;
    case "bars": return <WgBars items={viz.items} keepOrder={viz.keepOrder} more={viz.more} />;
    case "share": return <WgShare segs={viz.segs} total={viz.total} />;
    case "stat": return <WgStat figures={viz.figures} delta={viz.delta} />;
    case "compare": return <WgCompare naive={viz.naive} truth={viz.truth} />;
    case "source": return <WgSource rows={viz.rows} onPick={onPickSource} />;
    case "findings": return <WgFindings items={viz.items} onAsk={onAsk} />;
    case "ledger": return <WgLedger value={viz.value} unit={viz.unit} />;
    default: return null;
  }
}

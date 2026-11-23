export type RulerTone = "go" | "watch" | "stop";
export interface RulerMark {
  id: string;
  label: string;
  /** The score shown (after any cap). */
  shown: number;
  /** The measured score. When it differs from shown the mark is capped: a hollow mark sits at it, tethered. */
  measured?: number | null;
  tone?: RulerTone;
  /** Where the score is projected to land once the proposed fixes apply. Drawn as a diamond. */
  projected?: number | null;
  /** The score measured after the fixes were applied. Drawn as a square. */
  actual?: number | null;
  /** When set, the mark's row is a link to the object. */
  href?: string;
}
export interface RulerLabels {
  /** Gate names, already translated. */
  atRisk: string; go: string; cap70: string; cap85: string;
  /** "Measured 92" style text for a capped mark. */
  measured: (n: number) => string;
  /** "Projected 88" and "Actual 86" style text. Needed only when a mark has projected or actual. */
  projected?: (n: number) => string;
  actual?: (n: number) => string;
}

/** Two markers closer than this (in ruler units, about px at full width) put their labels on opposite sides. */
export const LABEL_GAP = 48;

/**
 * Which side each label sits on, given the marker x positions in row order. A marker starts above;
 * when it is closer than LABEL_GAP to the one before it, it flips to the opposite side of that one.
 */
export function labelSides(xs: number[]): ("up" | "down")[] {
  const out: ("up" | "down")[] = [];
  xs.forEach((x, i) => {
    out.push(i > 0 && Math.abs(x - xs[i - 1]) < LABEL_GAP ? (out[i - 1] === "up" ? "down" : "up") : "up");
  });
  return out;
}

const tone = (s: number): RulerTone => (s >= 85 ? "go" : s >= 70 ? "watch" : "stop");

/**
 * Score ruler: 0 to 100 (or `from` to 100), gates at 70 and 85. A solid mark is the shown score. When the measured score is higher
 * (the score is capped) a hollow mark sits at the measured score, tethered to the solid one. Takes translated strings, no i18n inside.
 */
export function ScoreRuler({ marks, labels, ariaLabel, from = 0, width, zones, first, showName = true }: {
  marks: RulerMark[]; labels: RulerLabels; ariaLabel: string; from?: 0 | 50; width?: number;
  /** Header variant: names the three zones under the axis. */
  zones?: { noGo: string; atRisk: string; go: string };
  /** Header variant: a faint mark at the first run's score, on the first mark's row. */
  first?: { value: number; label: string } | null;
  /** False when the page already names the object (the header ruler). */
  showName?: boolean;
}) {
  const W = width ?? (from === 50 ? 290 : 1000);
  const x = (s: number) => ((Math.min(100, Math.max(from, s)) - from) * W) / (100 - from);
  const rowH = 34, top = 30, bandH = 8;
  const H = top + bandH + 40 + marks.length * rowH + 6;
  const ticks: number[] = [];
  for (let n = from; n <= 100; n += 10) ticks.push(n);
  const fs = from === 50 ? 10 : 11;
  return (
    <svg className="mx-ruler" viewBox={`-20 0 ${W + 40} ${H}`} role={marks.some((m) => m.href) ? "group" : "img"} aria-label={ariaLabel} data-compact={from === 50 ? "" : undefined}>
      <rect className="mx-ruler-z" data-tone="stop" x={x(from)} y={top} width={x(70) - x(from)} height={bandH} />
      <rect className="mx-ruler-z" data-tone="watch" x={x(70)} y={top} width={x(85) - x(70)} height={bandH} />
      <rect className="mx-ruler-z" data-tone="go" x={x(85)} y={top} width={x(100) - x(85)} height={bandH} />
      {[70, 85].map((g) => <line key={g} className="mx-ruler-gate" x1={x(g)} x2={x(g)} y1={top - 8} y2={top + bandH + 8} />)}
      <text className="mx-ruler-t" x={x(70)} y={top - 14} textAnchor="middle" fontSize={fs}>{labels.cap70}</text>
      <text className="mx-ruler-t" x={x(85)} y={top - 14} textAnchor="middle" fontSize={fs}>{labels.cap85}</text>
      {ticks.map((n) => <text key={n} className="mx-ruler-ax" x={x(n)} y={top + bandH + 20} textAnchor="middle" fontSize={fs}>{n}</text>)}
      {zones ? ([[from, 70, zones.noGo, "stop"], [70, 85, zones.atRisk, "watch"], [85, 100, zones.go, "go"]] as const).map(([a, b, name, k]) => (
        <text key={k} className="mx-ruler-zone" data-zone={k} x={(x(a) + x(b)) / 2} y={top + bandH + 36} textAnchor="middle" fontSize={fs}>{name}</text>
      )) : null}
      {marks.map((m, i) => {
        const cy = top + bandH + 54 + i * rowH;
        const capped = m.measured != null && m.measured > m.shown;
        const t = m.tone ?? tone(m.shown);
        const sx = x(m.shown);
        // Label sides for projected and actual: order every marker by x, then apply the collision rule.
        const extra = ([["projected", m.projected], ["actual", m.actual]] as const).filter(([, v]) => v != null) as ["projected" | "actual", number][];
        const order = [{ k: "shown", x: sx }, ...(capped ? [{ k: "measured", x: x(m.measured as number) }] : []), ...extra.map(([k, v]) => ({ k, x: x(v) }))].sort((a, b) => a.x - b.x);
        const sides = labelSides(order.map((o) => o.x));
        const sideOf = (k: string) => sides[order.findIndex((o) => o.k === k)];
        const row = (
          <g key={m.id} data-mark={m.id} data-capped={capped ? "" : undefined}>
            {capped ? (
              <>
                <line className="mx-ruler-tether" x1={sx} x2={x(m.measured as number)} y1={cy} y2={cy} data-testid="ruler-tether" />
                <circle className="mx-ruler-hollow" data-testid="ruler-hollow" cx={x(m.measured as number)} cy={cy} r={5} />
                <text className="mx-ruler-t" x={x(m.measured as number) + 10} y={cy + 4} fontSize={fs}>{labels.measured(Math.round(m.measured as number))}</text>
                <rect className="mx-ruler-solid" x={sx - 38} y={cy - 11} width={38} height={22} rx={5} />
                <text className="mx-ruler-solid-t" x={sx - 19} y={cy + 4} textAnchor="middle" fontSize={fs + 1}>{Math.round(m.shown)}</text>
              </>
            ) : (
              <>
                <circle className="mx-ruler-dot" data-tone={t} data-testid="ruler-solid" cx={sx} cy={cy} r={6} />
                <text className="mx-ruler-t" x={sx + 12} y={cy + 4} fontSize={fs}>{Math.round(m.shown)}</text>
              </>
            )}
            {extra.map(([k, v]) => {
              const label = labels[k];
              const up = sideOf(k) === "up";
              return (
                <g key={k} className="mx-ruler-mk" data-testid={`ruler-${k}`} data-side={up ? "up" : "down"} style={{ transform: `translateX(${x(v)}px)` }}>
                  {k === "projected"
                    ? <polygon className="mx-ruler-proj" points="0,-7 7,0 0,7 -7,0" />
                    : <rect className="mx-ruler-act" x={-5} y={-5} width={10} height={10} />}
                  {label ? <text className="mx-ruler-t" x={0} y={cy + (up ? -12 : 22)} textAnchor="middle" fontSize={fs}>{label(Math.round(v))}</text> : null}
                </g>
              );
            })}
            {first && i === 0 && first.value >= from ? (
              <g data-testid="ruler-first">
                <circle className="mx-ruler-first" cx={x(first.value)} cy={cy} r={4} />
                <text className="mx-ruler-ax" x={x(first.value)} y={cy + 20} textAnchor="middle" fontSize={fs}>{first.label}</text>
              </g>
            ) : null}
            {showName ? <text className="mx-ruler-name" x={x(from)} y={cy - 14} fontSize={fs}>{m.label}</text> : null}
          </g>
        );
        return m.href ? <a key={m.id} href={m.href} className="mx-ruler-link" aria-label={m.label}>{row}</a> : row;
      })}
    </svg>
  );
}

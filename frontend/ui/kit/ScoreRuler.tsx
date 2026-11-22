export type RulerTone = "go" | "watch" | "stop";
export interface RulerMark {
  id: string;
  label: string;
  /** The score shown (after any cap). */
  shown: number;
  /** The measured score. When it differs from shown the mark is capped: a hollow mark sits at it, tethered. */
  measured?: number | null;
  tone?: RulerTone;
}
export interface RulerLabels {
  /** Gate names, already translated. */
  atRisk: string; go: string; cap70: string; cap85: string;
  /** "Measured 92" style text for a capped mark. */
  measured: (n: number) => string;
}

const tone = (s: number): RulerTone => (s >= 85 ? "go" : s >= 70 ? "watch" : "stop");

/**
 * Score ruler: 0 to 100 (or `from` to 100), gates at 70 and 85. A solid mark is the shown score. When the measured score is higher
 * (the score is capped) a hollow mark sits at the measured score, tethered to the solid one. Takes translated strings, no i18n inside.
 */
export function ScoreRuler({ marks, labels, ariaLabel, from = 0, width }: { marks: RulerMark[]; labels: RulerLabels; ariaLabel: string; from?: 0 | 50; width?: number }) {
  const W = width ?? (from === 50 ? 290 : 1000);
  const x = (s: number) => ((Math.min(100, Math.max(from, s)) - from) * W) / (100 - from);
  const rowH = 34, top = 30, bandH = 8;
  const H = top + bandH + 40 + marks.length * rowH + 6;
  const ticks: number[] = [];
  for (let n = from; n <= 100; n += 10) ticks.push(n);
  const fs = from === 50 ? 10 : 11;
  return (
    <svg className="mx-ruler" viewBox={`-20 0 ${W + 40} ${H}`} role="img" aria-label={ariaLabel} data-compact={from === 50 ? "" : undefined}>
      <rect className="mx-ruler-z" data-tone="stop" x={x(from)} y={top} width={x(70) - x(from)} height={bandH} />
      <rect className="mx-ruler-z" data-tone="watch" x={x(70)} y={top} width={x(85) - x(70)} height={bandH} />
      <rect className="mx-ruler-z" data-tone="go" x={x(85)} y={top} width={x(100) - x(85)} height={bandH} />
      {[70, 85].map((g) => <line key={g} className="mx-ruler-gate" x1={x(g)} x2={x(g)} y1={top - 8} y2={top + bandH + 8} />)}
      <text className="mx-ruler-t" x={x(70)} y={top - 14} textAnchor="middle" fontSize={fs}>{labels.cap70}</text>
      <text className="mx-ruler-t" x={x(85)} y={top - 14} textAnchor="middle" fontSize={fs}>{labels.cap85}</text>
      {ticks.map((n) => <text key={n} className="mx-ruler-ax" x={x(n)} y={top + bandH + 20} textAnchor="middle" fontSize={fs}>{n}</text>)}
      {marks.map((m, i) => {
        const cy = top + bandH + 54 + i * rowH;
        const capped = m.measured != null && m.measured > m.shown;
        const t = m.tone ?? tone(m.shown);
        const sx = x(m.shown);
        return (
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
            <text className="mx-ruler-name" x={x(from)} y={cy - 14} fontSize={fs}>{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

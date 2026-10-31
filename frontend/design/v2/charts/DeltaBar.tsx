/**
 * A change either side of a zero line, inside a table row: a rise to the right in the pass hue, a fall to the left in
 * the stop red, the length proportional to the change and capped at the half width. Never colour alone: the signed
 * number and its mark sit beside it in the row, so the bar itself is hidden from assistive technology.
 */
export function DeltaBar({ d, width = 110, scale = 17 }: { d: number | null; width?: number; scale?: number }) {
  const mid = width / 2;
  const len = d == null ? 0 : Math.min(Math.abs(d) * scale, mid - 2);
  const x = d != null && d >= 0 ? mid : mid - len;
  return (
    <svg className="m2-dbar" width={width} height={12} viewBox={`0 0 ${width} 12`} aria-hidden="true" data-testid="dbar">
      <line className="m2-z" x1={mid} x2={mid} y1={0} y2={12} />
      {d != null && d !== 0 ? <rect className={d > 0 ? "m2-up" : "m2-dn"} x={x} y={3} width={len} height={6} rx={1} /> : null}
    </svg>
  );
}

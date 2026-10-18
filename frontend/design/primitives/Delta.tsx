import { clsx } from "clsx";

/**
 * Delta chip. Colour follows good or bad, not up or down: `invert` makes a falling number good
 * (open findings).
 */
export function Delta({ value, run, invert = false }: { value: number; run?: string; invert?: boolean }) {
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const good = invert ? value < 0 : value > 0;
  const bad = invert ? value > 0 : value < 0;
  const tone = good ? "good" : bad ? "bad" : "zero";
  const sign = dir === "down" ? "-" : dir === "up" ? "+" : "";
  return (
    <span
      className={clsx("m-delta m-numeric", `m-delta-${dir}`, `m-delta-${tone}`)}
      title={run ? `vs ${run}` : undefined}
    >
      <span className="m-delta-arrow" aria-hidden="true" />
      {sign}
      {Math.abs(value).toFixed(1)}
    </span>
  );
}

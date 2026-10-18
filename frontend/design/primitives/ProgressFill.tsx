import { clsx } from "clsx";

/**
 * The accent fill of a progress track, `value` percent wide (clamped to 0 to 100). The caller owns the track (its
 * height, tint, radius and `role="progressbar"`); the fill takes the track's full height. `animate` eases width changes.
 * Pages never set a width inline: this is where a computed percentage becomes a style.
 */
export function ProgressFill({ value, animate = false }: { value: number; animate?: boolean }) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return <span aria-hidden className={clsx("m-progress-fill", animate && "m-motion-width")} style={{ width: `${pct}%` }} />;
}

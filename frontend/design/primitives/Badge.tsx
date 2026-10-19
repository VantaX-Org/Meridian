import { clsx } from "clsx";
import type { SeverityLevel } from "./Status";

export function Badge({
  count,
  inverted = false,
  tone,
}: {
  count: number;
  /** Active Rail row: accent-ink fill on soft text. */
  inverted?: boolean;
  /** A count only, never a status. `critical` (the severity value) marks counts of failing items (the Fix queue), solid critical fill. */
  tone?: "neutral" | Extract<SeverityLevel, "critical">;
}) {
  if (count <= 0) return null;
  return (
    <span className={clsx("m-badge", inverted && "m-badge-inverted", tone === "neutral" && "m-badge-neutral", tone === "critical" && "m-badge-critical")}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

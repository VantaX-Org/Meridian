import { clsx } from "clsx";

export function Badge({ count, inverted = false, tone }: { count: number; /** Active Rail row: accent-ink fill on soft text. */ inverted?: boolean; tone?: "neutral" }) {
  if (count <= 0) return null;
  return (
    <span className={clsx("m-badge", inverted && "m-badge-inverted", tone === "neutral" && "m-badge-neutral")}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

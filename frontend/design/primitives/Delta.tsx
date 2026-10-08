import { mColor } from "../tokens";

export function Delta({ value, run }: { value: number; run?: string }) {
  const up = value >= 0;
  const color = up ? mColor.pass : mColor.critical;
  return (
    <span style={{ color }} title={run ? `vs ${run}` : undefined}>
      {up ? "+" : ""}
      {value}
    </span>
  );
}

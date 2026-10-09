import { mColor } from "../tokens";

export function Delta({ value, run }: { value: number; run?: string }) {
  const color = value > 0 ? mColor.pass : value < 0 ? mColor.critical : mColor.ink2;
  return (
    <span style={{ color, fontVariantNumeric: "tabular-nums" }} title={run ? `vs ${run}` : undefined}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}
    </span>
  );
}

import { mColor } from "../tokens";

export function Delta({ value, run }: { value: number; run?: string }) {
  const color = value > 0 ? mColor.pass : value < 0 ? mColor.critical : mColor.ink2;
  return (
    <span className="m-numeric text-[12px] leading-4 font-medium" style={{ color }} title={run ? `vs ${run}` : undefined}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}
    </span>
  );
}

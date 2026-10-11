// frontend/design/charts/Tooltip.tsx
import type { ReactNode } from "react";
import { chartTheme } from "./theme";

interface Entry {
  name?: string | number;
  value?: ReactNode;
  color?: string;
}

/** Custom recharts tooltip shared by every chart (spec 7.12): inverted panel, no arrow. */
export function ChartTooltip({
  active, payload, label,
}: { active?: boolean; payload?: ReadonlyArray<Entry>; label?: ReactNode }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      data-chart-tooltip
      className="text-[12px] leading-4"
      style={{
        background: chartTheme.tooltipBg,
        color: chartTheme.tooltipInk,
        borderRadius: "var(--m-radius-control)",
        padding: "8px 10px",
      }}
    >
      {label != null && label !== "" && <div>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          {p.name != null && <span>{p.name}</span>}
          <span className="m-numeric font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

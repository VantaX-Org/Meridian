// frontend/design/charts/Tooltip.tsx
import type { ReactNode } from "react";
import { chartTheme } from "./theme";

interface Entry {
  name?: string | number;
  value?: ReactNode;
  color?: string;
}

/** Custom recharts tooltip shared by every chart (inverted panel, no arrow, 8px square swatch per series). */
export function ChartTooltip({
  active, payload, label,
}: { active?: boolean; payload?: ReadonlyArray<Entry>; label?: ReactNode }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      data-chart-tooltip
      role="status"
      aria-live="polite"
      className="m-text-meta"
      style={{
        background: chartTheme.tooltipBg,
        color: chartTheme.tooltipInk,
        borderRadius: "var(--m-radius-control)",
        padding: "8px 10px",
        boxShadow: "var(--m-elev-2)",
      }}
    >
      {label != null && label !== "" && <div>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          {p.color && <span aria-hidden style={{ width: 8, height: 8, flexShrink: 0, background: p.color }} />}
          {p.name != null && <span>{p.name}</span>}
          <span className="m-numeric font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

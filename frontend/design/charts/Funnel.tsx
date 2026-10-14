"use client";

// frontend/design/charts/Funnel.tsx
import { chartTheme } from "./theme";
import { rampStep } from "../tokens";

export interface FunnelStage {
  label: string;
  value: number;
}

/** Stage-to-stage drop-off as proportional bars, each stage one step darker on the sequential ramp. Plain DOM so it is accessible and prints. */
export function Funnel({ stages, onStageClick }: { stages: FunnelStage[]; onStageClick?: (stage: FunnelStage) => void }) {
  const top = Math.max(1, ...stages.map((s) => s.value));
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--m-space-2)" }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const kept = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label}>
            <button
              type="button"
              disabled={!onStageClick}
              onClick={() => onStageClick?.(s)}
              aria-label={`${s.label}: ${s.value.toLocaleString()}${kept !== null ? `, ${kept}% of previous stage` : ""}`}
              style={{ all: "unset", display: "grid", gridTemplateColumns: "10rem 1fr 4rem", alignItems: "center", gap: "var(--m-space-3)", width: "100%", cursor: onStageClick ? "pointer" : "default" }}
            >
              <span style={{ color: "var(--m-ink-2)", fontSize: "var(--m-text-meta)" }}>{s.label}</span>
              <span style={{ background: "var(--m-line)", height: "1.25rem", display: "block" }}>
                <span style={{ display: "block", height: "100%", width: `${(s.value / top) * 100}%`, background: chartTheme.seq[Math.max(2, rampStep(i, 0, Math.max(1, stages.length - 1))) - 1] }} />
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{kept !== null ? `${kept}%` : s.value.toLocaleString()}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

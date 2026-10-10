"use client";

import { Pill } from "../primitives/Pill";
import { Tooltip } from "../primitives/Tooltip";
import { Heatmap } from "../charts/Heatmap";

const DIMENSIONS = ["Completeness", "Accuracy", "Consistency", "Timeliness", "Uniqueness", "Validity"];

/**
 * A muted preview of the 7.1 instrument panel, shown before the first run
 * finishes (spec 9.2). Every shape here is decorative — `aria-hidden`,
 * `pointer-events: none`, outlined in `var(--m-line)` only.
 */
export function GhostPanel() {
  return (
    <div
      aria-hidden
      style={{ pointerEvents: "none", position: "relative", border: "1px solid var(--m-line)", borderRadius: "var(--m-radius-sheet)", padding: "var(--m-space-6)" }}
    >
      <div className="absolute top-4 right-4" style={{ pointerEvents: "auto" }}>
        <Tooltip label="This fills in when the first run completes.">
          <Pill tone="neutral">Preview</Pill>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-6">
        {/* Hero DQS: three score blocks + four severity placeholders */}
        <div className="flex items-center gap-6">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 40, height: 64, border: "1px solid var(--m-line)", borderRadius: "var(--m-radius-control)" }} />
          ))}
          <div className="flex gap-3">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{ width: 16, height: 16, border: "1px solid var(--m-line)", borderRadius: i % 2 === 0 ? "50%" : 2 }} />
            ))}
          </div>
        </div>

        {/* DQS-over-runs line ghost */}
        <svg width="100%" height={160}>
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1="0" x2="100%" y1={i * 40} y2={i * 40} stroke="var(--m-line)" />
          ))}
          <line x1="0" x2="100%" y1="96" y2="96" stroke="var(--m-line)" strokeDasharray="4 4" />
        </svg>

        {/* Six dimensions, each an empty 20px track */}
        <div className="flex flex-col gap-2">
          {DIMENSIONS.map((d) => (
            <div key={d} className="flex items-center gap-3">
              <span className="text-[12px]" style={{ width: 96, color: "var(--m-ink-3)" }}>{d}</span>
              <span className="flex-1" style={{ height: 20, border: "1px solid var(--m-line)", borderRadius: "var(--m-radius-control)" }} />
            </div>
          ))}
        </div>

        {/* Objects by dimension heatmap, blank */}
        <Heatmap rows={["", "", ""]} cols={["", "", ""]} cells={[]} />
      </div>
    </div>
  );
}

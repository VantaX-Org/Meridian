"use client";

import { Card } from "../primitives/Card";
import { Pill } from "../primitives/Pill";
import { Tooltip } from "../primitives/Tooltip";
import { Heatmap } from "../charts/Heatmap";

const DIMENSIONS = [
  "Completeness",
  "Accuracy",
  "Consistency",
  "Timeliness",
  "Uniqueness",
  "Validity",
];

const RING = 160;
const STROKE = 16;

/**
 * A muted preview of the home hero, shown before the first run finishes
 * (screens.md 3.1 empty): a 160px ring track with no value, a ghost line,
 * six empty dimension tracks and a blank heatmap. Every shape is decorative:
 * `aria-hidden`, `pointer-events: none`, drawn in `--m-sheet-sunken`. The Preview pill sits outside the
 * hidden subtree so its tooltip stays reachable. (EmptyState's `ring` ghost is a fixed 96px, clipped, fading shape, so the
 * hero keeps its own 160px ring.)
 */
export function GhostPanel() {
  const r = (RING - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative" }}>
      <div className="absolute top-4 right-4" style={{ zIndex: 1 }}>
        <Tooltip label="This fills in when the first run completes.">
          <Pill tone="neutral">Preview</Pill>
        </Tooltip>
      </div>

      <div aria-hidden style={{ pointerEvents: "none" }}>
        <Card padding="lg">
          <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
            <div className="flex justify-center lg:col-span-3">
              <svg
                data-ghost="ring"
                width={RING}
                height={RING}
                viewBox={`0 0 ${RING} ${RING}`}
              >
                <circle
                  cx={RING / 2}
                  cy={RING / 2}
                  r={r}
                  fill="none"
                  stroke="var(--m-sheet-sunken)"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${circ * 0.75} ${circ}`}
                  transform={`rotate(-45 ${RING / 2} ${RING / 2})`}
                />
                <line
                  x1={RING / 2}
                  x2={RING / 2}
                  y1={STROKE / 2}
                  y2={RING - STROKE / 2}
                  stroke="var(--m-line-strong)"
                  strokeDasharray="3 3"
                />
              </svg>
            </div>

            <div className="lg:col-span-6">
              <svg data-ghost="line" width="100%" height={160}>
                {[0, 1, 2, 3].map((i) => (
                  <line
                    key={i}
                    x1="0"
                    x2="100%"
                    y1={i * 40}
                    y2={i * 40}
                    stroke="var(--m-sheet-sunken)"
                  />
                ))}
                <line
                  x1="0"
                  x2="100%"
                  y1="96"
                  y2="96"
                  stroke="var(--m-line-strong)"
                  strokeDasharray="4 4"
                />
              </svg>
            </div>

            <div className="flex flex-col gap-2 lg:col-span-3">
              {DIMENSIONS.map((d) => (
                <div key={d} className="flex items-center gap-3">
                  <span
                    className="text-[12px]"
                    style={{ width: 88, color: "var(--m-ink-3)" }}
                  >
                    {d}
                  </span>
                  <span
                    data-ghost="track"
                    className="flex-1"
                    style={{
                      height: 12,
                      background: "var(--m-sheet-sunken)",
                      borderRadius: "var(--m-radius-control)",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div style={{ marginTop: "var(--m-space-6)" }}>
          <Card title="Object readiness by dimension">
            <Heatmap rows={["", "", ""]} cols={["", "", ""]} cells={[]} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Aurora <Stat> + <KpiRail> — WS3.
 *
 * `Stat` is a single metric surface: eyebrow + value (display-lg, tabular)
 * + delta pill + optional inline sparkline. Used inline in verdict cards,
 * drawers, and as the atom of `KpiRail`.
 *
 * `KpiRail` is a horizontal row of `Stat`s. Lives at the top of every
 * Workbench list and every Process page. Capped at 6 stats per §6.4 —
 * overflow is a code smell; split into a second rail instead.
 */

import type { ReactNode } from "react";
import { Stack, Text } from "../primitives";
import { clsx } from "../primitives/internal";

export type DeltaDirection = "up" | "down" | "flat";

export type StatTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface StatDelta {
  /** Signed number, e.g. +0.8 or -1.2. Formatted with one decimal. */
  value: number;
  /** Suffix shown after the delta. Defaults to `%`. */
  unit?: string;
  /** Up = green, Down = red, Flat = neutral. A green decrease (e.g. fewer
     criticals) passes `direction="down"` + `semantic="success"`. */
  direction: DeltaDirection;
  /** Override the semantic colour when the delta direction is decoupled
     from a good/bad meaning. */
  semantic?: "success" | "danger" | "neutral";
}

export interface StatProps {
  /** Short label above the value, e.g. "Readiness · three-way match". */
  label: ReactNode;
  /** The metric itself. Formatted by the caller. */
  value: ReactNode;
  /** Unit suffix rendered smaller to the right of the value. */
  unit?: ReactNode;
  /** Delta pill rendered below the value. */
  delta?: StatDelta;
  /** Sparkline slot — any ReactNode, typically `<AuroraSparkline />`. */
  sparkline?: ReactNode;
  /** Tone tints the eyebrow — keep `neutral` unless the stat itself conveys status. */
  tone?: StatTone;
  className?: string;
}

export function Stat({
  label,
  value,
  unit,
  delta,
  sparkline,
  tone = "neutral",
  className,
}: StatProps) {
  return (
    <div
      className={clsx("aurora-stat", className)}
      data-tone={tone === "neutral" ? undefined : tone}
    >
      <Text variant="text-micro" tone="tertiary" className="aurora-stat__label">
        {label}
      </Text>
      <div className="aurora-stat__value-row">
        <span className="aurora-stat__value">
          <Text variant="display-lg" numeric as="span">
            {value}
          </Text>
          {unit !== undefined ? (
            <Text
              variant="text-lead"
              tone="secondary"
              className="aurora-stat__unit"
              as="span"
            >
              {unit}
            </Text>
          ) : null}
        </span>
      </div>
      {delta || sparkline ? (
        <Stack direction="row" gap={3} align="center" className="aurora-stat__foot">
          {delta ? <DeltaPill delta={delta} /> : null}
          {sparkline ? (
            <span className="aurora-stat__sparkline">{sparkline}</span>
          ) : null}
        </Stack>
      ) : null}
    </div>
  );
}

function DeltaPill({ delta }: { delta: StatDelta }) {
  const semantic =
    delta.semantic ??
    (delta.direction === "up"
      ? "success"
      : delta.direction === "down"
        ? "danger"
        : "neutral");
  const unit = delta.unit ?? "%";
  const formatted = formatDelta(delta.value);
  return (
    <span
      className="aurora-delta-pill"
      data-semantic={semantic === "neutral" ? undefined : semantic}
      data-direction={delta.direction}
    >
      <DeltaGlyph direction={delta.direction} />
      <span>
        {formatted}
        {unit}
      </span>
    </span>
  );
}

function DeltaGlyph({ direction }: { direction: DeltaDirection }) {
  if (direction === "flat") {
    return (
      <svg
        viewBox="0 0 10 10"
        width="10"
        height="10"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M1 5h8" />
      </svg>
    );
  }
  const path =
    direction === "up" ? "M1 6.5L5 2.5L9 6.5" : "M1 3.5L5 7.5L9 3.5";
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

/* ------------------------------------------------------------------ KpiRail */

export interface KpiRailProps {
  children: ReactNode;
  className?: string;
}

export function KpiRail({ children, className }: KpiRailProps) {
  return (
    <div className={clsx("aurora-kpi-rail", className)} role="group">
      {children}
    </div>
  );
}

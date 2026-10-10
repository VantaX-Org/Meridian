// frontend/design/templates/HomePage.tsx
import type { ReactNode } from "react";
import { Counter } from "../primitives/Counter";
import { Delta } from "../primitives/Delta";
import { Pill } from "../primitives/Pill";
import { Skeleton } from "../primitives/Skeleton";
import { ErrorState } from "../primitives/ErrorState";
import { SeverityDot } from "../primitives/SeverityDot";
import { Bar } from "../charts/Bar";
import { Line } from "../charts/Line";
import { Heatmap, type HeatmapCell } from "../charts/Heatmap";
import type { ChartPoint } from "../charts/theme";
import { JourneyStepper } from "./JourneyStepper";
import { GhostPanel } from "./GhostPanel";
import type { DayOneStep } from "../../hooks/use-day-one";
import { formatDate } from "../../lib/format";
import type { SeverityTotals } from "../../lib/home-metrics";

export interface HomeVerdict {
  /** The narrative's first sentence (the headline verdict). */
  sentence1: string;
  /** The narrative's remaining sentences (the worst object + the persona's next action). */
  sentence2?: string;
  cappedReason?: string | null;
}

export interface HomeRunInfo {
  id: string;
  label: string | null;
  runAt: string;
}

export interface HomeJourney {
  systemsConnected: boolean;
  configLoaded: boolean;
  extracted: boolean;
  complete: boolean;
  step: DayOneStep | null;
}

/**
 * Spec 7: the home page's layout shell. A verdict row, then — depending on
 * `state` — the instrument panel (real, ghost preview, skeleton or error),
 * work tiles and the persona's list slot. Callers (`_persona-home.tsx`)
 * supply every persona- and data-specific piece; this component places it.
 *
 * Deviations from the brief's literal prop list, decided here: `progress`
 * had no defined shape in the brief text, so it is not used; the error
 * case instead takes an explicit `error` prop. `journey`'s booleans and
 * `step` together stand in for the brief's bare `step`, since the
 * `JourneyStepper` this renders needs all four. Work tiles have no prop in
 * the brief's list at all, so a `tiles` slot was added — the alternative
 * (folding them into `panel`) would have forced every caller to duplicate
 * this component's grid/skeleton logic.
 */
export function HomePage({
  state,
  verdict,
  run,
  journey,
  error,
  panel,
  tiles,
  lists,
  headerActions,
}: {
  persona: string;
  state: "loading" | "no-data" | "data" | "error";
  verdict?: HomeVerdict;
  run?: HomeRunInfo | null;
  journey?: HomeJourney;
  error?: { message: string; onRetry: () => void };
  panel?: ReactNode;
  tiles?: ReactNode;
  lists?: ReactNode;
  /** Right-aligned header content (e.g. an `ExportMenu`) shown next to the run label when `state === "data"`. */
  headerActions?: ReactNode;
}) {
  if (state === "error") {
    return (
      <div className="p-6">
        <ErrorState message={error?.message ?? "Could not reach the server."} onRetry={error?.onRetry} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex flex-col" style={{ padding: "var(--m-space-6)", gap: "var(--m-space-6)", maxWidth: 1280 }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {state === "loading" ? (
            <Skeleton height={28} width={420} />
          ) : (
            <>
              <p className="text-[20px] leading-[26px] font-semibold" style={{ color: "var(--m-ink)" }}>
                {verdict?.sentence1}
              </p>
              {verdict?.sentence2 && (
                <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{verdict.sentence2}</p>
              )}
            </>
          )}
        </div>
        {state === "data" && run && (
          <div className="flex items-center gap-3 text-[12px] leading-[16px]" style={{ color: "var(--m-ink-3)" }}>
            <span>{run.label ?? run.id} · {formatDate(run.runAt)}</span>
            {verdict?.cappedReason && <Pill tone="at-risk">Capped: {verdict.cappedReason}</Pill>}
            {headerActions}
          </div>
        )}
      </div>

      {state === "no-data" && journey && (
        <JourneyStepper
          systemsConnected={journey.systemsConnected}
          configLoaded={journey.configLoaded}
          extracted={journey.extracted}
          complete={journey.complete}
          step={journey.step}
        />
      )}

      {state === "no-data" && <GhostPanel />}
      {state === "loading" && <Skeleton height={360} />}
      {state === "data" && panel}
      {state === "data" && tiles}
      {lists}
    </div>
  );
}

export interface InstrumentPanelData {
  dqs: number | null;
  delta: number | null;
  previousLabel?: string;
  severity: SeverityTotals;
  trendPoints: ChartPoint[];
  dimensionPoints: ChartPoint[];
  heatmapCells: HeatmapCell[];
  heatmapRows: string[];
  heatmapCols: string[];
  versionId: string;
  onTrendPointClick?: (point: ChartPoint) => void;
  onHeatmapCellClick?: (cell: HeatmapCell) => void;
}

const SEVERITY_ORDER: (keyof SeverityTotals)[] = ["critical", "high", "medium", "low"];

/** Spec 7.1's instrument panel: Hero DQS, DQS-over-runs, six dimensions, object readiness grid. */
export function InstrumentPanel({
  dqs, delta: dqsDelta, previousLabel, severity, trendPoints, dimensionPoints, heatmapCells, heatmapRows, heatmapCols,
  versionId, onTrendPointClick, onHeatmapCellClick,
}: InstrumentPanelData) {
  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--m-space-6)", padding: "var(--m-space-6)", border: "1px solid var(--m-line)", borderRadius: "var(--m-radius-sheet)", background: "var(--m-sheet)" }}
    >
      <div className="flex items-center gap-6">
        <Counter value={dqs} versionId={versionId} decimals={1} size={56} />
        {dqsDelta !== null && dqsDelta !== undefined && <Delta value={dqsDelta} run={previousLabel} />}
        <div className="flex gap-4">
          {SEVERITY_ORDER.filter((k) => severity[k] > 0).map((k) => (
            <span key={k} className="flex items-center gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
              <SeverityDot severity={k} /> {severity[k]}
            </span>
          ))}
        </div>
      </div>

      {trendPoints.length > 0 && <Line data={trendPoints} onPointClick={onTrendPointClick} height={160} draw />}

      {dimensionPoints.length > 0 && <Bar data={dimensionPoints} height={200} dqsThreshold={60} draw />}

      {heatmapCells.length > 0 && (
        <Heatmap rows={heatmapRows} cols={heatmapCols} cells={heatmapCells} onPointClick={onHeatmapCellClick} cellSize={24} draw />
      )}
    </div>
  );
}

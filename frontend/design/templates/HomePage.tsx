// frontend/design/templates/HomePage.tsx
import type { ReactNode } from "react";
import { Card } from "../primitives/Card";
import { Delta } from "../primitives/Delta";
import { DEFAULT_SCORE_BANDS, ScoreRing, type ScoreBands } from "../primitives/ScoreRing";
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

/** Situation sentence for a fresh install (screens.md 3.1). */
const NO_DATA_VERDICT =
  "No analysis yet. Connect a system and run the first extraction.";

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
        <ErrorState
          message={error?.message ?? "Could not reach the server."}
          onRetry={error?.onRetry}
        />
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex flex-col"
      style={{
        padding: "var(--m-page-pad)",
        gap: "var(--m-space-6)",
        maxWidth: "var(--m-page-max)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {state === "loading" ? (
            <div className="m-motion-stagger flex w-full flex-col gap-2">
              <div style={{ width: "min(520px, 100%)" }}>
                <Skeleton height={34} width="100%" />
              </div>
              <div style={{ width: "min(360px, 80%)" }}>
                <Skeleton height={18} width="100%" />
              </div>
            </div>
          ) : (
            <>
              <p
                data-testid="home-verdict"
                style={{
                  fontFamily: "var(--m-font-ui)",
                  fontSize: "var(--m-text-verdict)",
                  lineHeight: "var(--m-leading-verdict)",
                  color:
                    state === "no-data" ? "var(--m-ink-3)" : "var(--m-ink)",
                }}
              >
                {state === "no-data" ? NO_DATA_VERDICT : verdict?.sentence1}
              </p>
              {state === "data" && verdict?.sentence2 && (
                <p
                  className="text-[13px] leading-[18px]"
                  style={{ color: "var(--m-ink-2)" }}
                >
                  {verdict.sentence2}
                </p>
              )}
            </>
          )}
        </div>
        {state === "data" && run && (
          <div
            className="flex items-center gap-3 text-[12px] leading-[16px]"
            style={{ color: "var(--m-ink-3)" }}
          >
            <span>
              {run.label ?? run.id} · {formatDate(run.runAt)}
            </span>
            {verdict?.cappedReason && (
              <Pill tone="at-risk">Capped: {verdict.cappedReason}</Pill>
            )}
            {headerActions}
          </div>
        )}
      </div>

      {state === "no-data" && journey && (
        <Card title="Get to your first score">
          <JourneyStepper
            systemsConnected={journey.systemsConnected}
            configLoaded={journey.configLoaded}
            extracted={journey.extracted}
            complete={journey.complete}
            step={journey.step}
          />
        </Card>
      )}

      {state === "no-data" && <GhostPanel />}
      {state === "loading" && (
        <div
          className="m-motion-stagger flex flex-col gap-4"
          data-testid="home-loading"
        >
          <span
            className="inline-flex overflow-hidden"
            style={{ width: 160, height: 160, borderRadius: "50%" }}
          >
            <Skeleton width={160} height={160} />
          </span>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Skeleton height={96} />
            <Skeleton height={96} />
            <Skeleton height={96} />
          </div>
        </div>
      )}
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
  /** The run-level severity cap (e.g. 70), drawn as a tick on the ring. Omit unless every module is capped. */
  cap?: number | null;
  /** Critical findings behind the cap; only meaningful with `cap`. */
  criticals?: number;
  trendPoints: ChartPoint[];
  dimensionPoints: ChartPoint[];
  /** Dimensions no module measured in this run; listed under the bar instead of drawn at 100. */
  unmeasured?: string[];
  heatmapCells: HeatmapCell[];
  heatmapRows: string[];
  heatmapCols: string[];
  versionId: string;
  /** The tenant's configured DQS thresholds; defaults apply until they load. */
  bands?: ScoreBands;
  onTrendPointClick?: (point: ChartPoint) => void;
  onHeatmapCellClick?: (cell: HeatmapCell) => void;
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-center text-[13px] leading-[18px]"
      style={{ color: "var(--m-ink-3)" }}
    >
      {children}
    </p>
  );
}

const SEVERITY_ORDER: (keyof SeverityTotals)[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/** Spec 3.1 hero: 12-col grid in a large card (ring 3 / trend 6 / dimensions 3), then the object readiness heatmap card. */
export function InstrumentPanel({
  dqs,
  delta: dqsDelta,
  previousLabel,
  severity,
  cap,
  criticals,
  trendPoints,
  dimensionPoints,
  unmeasured = [],
  heatmapCells,
  heatmapRows,
  heatmapCols,
  versionId,
  bands = DEFAULT_SCORE_BANDS,
  onTrendPointClick,
  onHeatmapCellClick,
}: InstrumentPanelData) {
  return (
    <div
      data-version={versionId}
      className="flex flex-col"
      style={{ gap: "var(--m-space-6)" }}
    >
      <Card padding="lg">
        <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
          <div className="flex flex-col items-center gap-3 lg:col-span-3">
            {dqs !== null ? (
              <ScoreRing
                score={dqs}
                size={160}
                cap={cap ?? undefined}
                criticals={criticals}
                bands={bands}
              />
            ) : (
              <Placeholder>No score for this run.</Placeholder>
            )}
            {dqsDelta !== null && dqsDelta !== undefined && (
              <Delta value={dqsDelta} run={previousLabel} />
            )}
            <div className="flex flex-wrap justify-center gap-3">
              {SEVERITY_ORDER.filter((k) => severity[k] > 0).map((k) => (
                <span
                  key={k}
                  className="flex items-center gap-1 text-[12px]"
                  style={{ color: "var(--m-ink-2)" }}
                >
                  <SeverityDot severity={k} /> {severity[k]}
                </span>
              ))}
            </div>
          </div>
          <div className="lg:col-span-6">
            {trendPoints.length < 2 ? (
              <Placeholder>Trend appears after the second run.</Placeholder>
            ) : (
              <Line
                data={trendPoints}
                onPointClick={onTrendPointClick}
                height={200}
                draw
                dqsThreshold={bands.target}
                label="DQS over runs"
              />
            )}
          </div>
          <div className="lg:col-span-3">
            {dimensionPoints.length === 0 ? (
              <Placeholder>No dimension scores for this run.</Placeholder>
            ) : (
              <Bar
                data={dimensionPoints}
                height={200}
                dqsThreshold={bands.critical}
                draw
                label="Score by dimension"
              />
            )}
            {unmeasured.length > 0 && (
              <p className="mt-2 text-[12px]" style={{ color: "var(--m-ink-3)" }}>
                Not measured: {unmeasured.join(", ")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {heatmapCells.length > 0 && (
        <Card title="Object readiness by dimension">
          <Heatmap
            rows={heatmapRows}
            cols={heatmapCols}
            cells={heatmapCells}
            onPointClick={onHeatmapCellClick}
            cellSize={32}
            draw
          />
        </Card>
      )}
    </div>
  );
}

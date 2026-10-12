// frontend/design/templates/HomePage.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";
import { Delta } from "../primitives/Delta";
import { PageHeader } from "../primitives/PageHeader";
import { Pill, type PillTone } from "../primitives/Pill";
import { Skeleton } from "../primitives/Skeleton";
import { ErrorState } from "../primitives/ErrorState";
import { JourneyStepper } from "./JourneyStepper";
import type { DayOneStep } from "../../hooks/use-day-one";
import { relativeTime } from "../../lib/format";

/** Situation sentence for a fresh install. */
const NO_DATA_VERDICT = "No analysis yet. Connect a system and run the first extraction.";

export interface HomeVerdict {
  /** Run-level DQS; null when no module is scored. */
  dqs: number | null;
  delta?: number | null;
  /** "vs {previous label}" next to the delta. */
  previousLabel?: string;
  status?: { tone: PillTone; label: string };
  /** The narrative's first sentence: the verdict with the number that caused it. */
  sentence: string;
  /** "Capped at 70 by 3 critical rules ...", with DrillLinks; omitted when not capped. */
  capLine?: ReactNode;
  /** The one next action. */
  action?: { label: string; href: string };
}

export interface HomeRunInfo {
  /** Display label, never a raw id. */
  label: string;
  runAt: string;
}

export interface HomeJourney {
  systemsConnected: boolean;
  configLoaded: boolean;
  extracted: boolean;
  complete: boolean;
  step: DayOneStep | null;
}

const row36 = Array.from({ length: 8 }, (_, i) => i);

/**
 * The home page frame: header, verdict row, dimension strip, objects table beside the trend,
 * a work row and the persona's extra lists. Callers supply every data-specific piece; this
 * component places it and owns the loading, no-data and error geometry.
 */
export function HomePage({
  state, verdict, run, journey, error, dimensions, objects, trend, work, lists, headerActions,
}: {
  persona: string;
  state: "loading" | "no-data" | "data" | "error";
  verdict?: HomeVerdict;
  run?: HomeRunInfo | null;
  journey?: HomeJourney;
  error?: { message: string; onRetry: () => void };
  /** Six dimension `Stat`s. */
  dimensions?: ReactNode;
  /** Left column (7/12): the worst-objects table. */
  objects?: ReactNode;
  /** Right column (5/12): the trend line and heatmap. */
  trend?: ReactNode;
  /** The persona's work row of `Stat`s. */
  work?: ReactNode;
  lists?: ReactNode;
  headerActions?: ReactNode;
}) {
  const header = (
    <PageHeader
      title="Home"
      meta={state === "data" && run ? `Run ${run.label} · ${relativeTime(run.runAt)}` : undefined}
      actions={state === "data" ? headerActions : undefined}
    />
  );

  return (
    <div
      className="mx-auto flex flex-col"
      style={{ padding: "var(--m-page-pad)", gap: "var(--m-space-6)", maxWidth: "var(--m-page-max)" }}
    >
      {header}

      {state === "error" && (
        <ErrorState message={error?.message ?? "Could not reach the server."} onRetry={error?.onRetry} />
      )}

      {state === "loading" && (
        <div className="flex flex-col" style={{ gap: "var(--m-space-6)" }} data-testid="home-loading">
          <Card padding="lg"><Skeleton height={48} width="min(420px, 100%)" /></Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={88} />)}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="flex flex-col gap-1 lg:col-span-7">{row36.map((i) => <Skeleton key={i} height={36} />)}</div>
            <div className="lg:col-span-5"><Skeleton height={200} /></div>
          </div>
        </div>
      )}

      {state === "no-data" && (
        <Card padding="lg" title="Get to your first score">
          <div className="flex flex-col gap-4">
            <p data-testid="home-verdict" className="text-[15px] leading-5" style={{ color: "var(--m-ink-2)" }}>{NO_DATA_VERDICT}</p>
            {journey && (
              <JourneyStepper
                systemsConnected={journey.systemsConnected}
                configLoaded={journey.configLoaded}
                extracted={journey.extracted}
                complete={journey.complete}
                step={journey.step}
              />
            )}
          </div>
        </Card>
      )}

      {state === "data" && verdict && (
        <section className="m-card m-card-lg flex flex-wrap items-start justify-between gap-6" data-testid="home-verdict-row">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <span
                className="m-numeric font-semibold"
                data-testid="home-dqs"
                style={{ fontSize: 44, lineHeight: "48px", minWidth: "4ch", color: "var(--m-ink)" }}
              >
                {verdict.dqs === null ? "—" : verdict.dqs.toFixed(1)}
              </span>
              {verdict.delta != null && (
                <span className="flex items-baseline gap-1">
                  <Delta value={verdict.delta} />
                  {verdict.previousLabel && <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>vs {verdict.previousLabel}</span>}
                </span>
              )}
              {verdict.status && <Pill tone={verdict.status.tone}>{verdict.status.label}</Pill>}
            </div>
            <p data-testid="home-verdict" className="text-[15px] leading-5" style={{ color: "var(--m-ink)" }}>{verdict.sentence}</p>
            {verdict.capLine && <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{verdict.capLine}</p>}
          </div>
          {verdict.action && <Button render={<Link href={verdict.action.href}>{verdict.action.label}</Link>} />}
        </section>
      )}

      {state === "data" && dimensions}
      {state === "data" && (objects || trend) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {objects && <div className="min-w-0 lg:col-span-7">{objects}</div>}
          <div className={`flex min-w-0 flex-col gap-6 ${objects ? "lg:col-span-5" : "lg:col-span-12"}`}>{trend}</div>
        </div>
      )}
      {state === "data" && work}
      {lists}
    </div>
  );
}

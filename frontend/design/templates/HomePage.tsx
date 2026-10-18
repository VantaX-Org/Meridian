// frontend/design/templates/HomePage.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";
import { Delta } from "../primitives/Delta";
import { Score } from "../primitives/Score";
import { PageHeader } from "../primitives/PageHeader";
import { Skeleton, StatSkeleton } from "../primitives/Skeleton";
import { Async, type AsyncState } from "../primitives/Async";
import { PageFrame } from "./PageFrame";
import { JourneyStepper } from "./JourneyStepper";
import type { DayOneStep } from "../../hooks/use-day-one";

/** Situation sentence for a fresh install. */
const NO_DATA_VERDICT = "No analysis yet. Connect a system and run the first extraction.";

export interface HomeVerdict {
  /** Run-level DQS; null when no module is scored. */
  dqs: number | null;
  delta?: number | null;
  /** "vs {previous label}" next to the delta. */
  previousLabel?: string;
  /** No earlier run in this run's lineage: the hint says so instead of comparing with another object. */
  firstRun?: boolean;
  /** The hint with `firstRun`; defaults to "First run for this object". */
  firstRunLabel?: string;
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

/** Hero, trend and dimensions, the work row, heatmap and objects: the data state's geometry. */
const loadingSkeleton = (
  <div className="flex flex-col gap-4" data-testid="home-loading">
    <div className="m-hero"><Skeleton height={112} hero /></div>
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
      <div className="@5xl:col-span-7"><Skeleton height={200} /></div>
      <div className="@5xl:col-span-5"><Skeleton height={200} /></div>
    </div>
    <div className="m-stat-grid">{Array.from({ length: 6 }, (_, i) => <StatSkeleton key={i} />)}</div>
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
      <div className="@5xl:col-span-7"><Skeleton height={232} /></div>
      <div className="flex flex-col gap-1 @5xl:col-span-5">{row36.map((i) => <Skeleton key={i} height={30} />)}</div>
    </div>
  </div>
);

/**
 * The home page frame: header, verdict row, dimension strip, objects table beside the trend,
 * a work row and the persona's extra lists. Callers supply every data-specific piece; this
 * component places it and owns the loading, no-data and error geometry.
 */
export function HomePage({
  state, verdict, run, scope, journey, error, dimensions, objects, trend, heatmap, work, lists, headerActions, onboarding,
}: {
  persona: string;
  /** "empty" is a fresh install (no analysis yet): the journey to a first score. */
  state: AsyncState;
  verdict?: HomeVerdict;
  run?: HomeRunInfo | null;
  /** Header meta in the data state: what the page's numbers belong to ("As of ..." or "Current state of ..."). */
  scope?: ReactNode;
  journey?: HomeJourney;
  error?: { message: string; onRetry: () => void };
  /** Right of the trend (5/12): the dimension inline bars. */
  dimensions?: ReactNode;
  /** Right column of the lower panel (5/12): the worst-objects table. */
  objects?: ReactNode;
  /** Left of the first panel (7/12): the score trend line. */
  trend?: ReactNode;
  /** Left of the lower panel (7/12): the dimension-by-object heatmap. */
  heatmap?: ReactNode;
  /** The persona's work row of `Stat`s. */
  work?: ReactNode;
  lists?: ReactNode;
  headerActions?: ReactNode;
  /** First-run tour offer and setup checklist (components/help/home-onboarding.tsx); shown once the page has loaded. */
  onboarding?: ReactNode;
}) {
  const header = (
    <PageHeader
      title="Home"
      meta={state === "ready" ? scope : undefined}
      actions={state === "ready" ? headerActions : undefined}
    />
  );

  return (
    <PageFrame gap={4}>
      {header}
      {(state === "empty" || state === "ready") && onboarding}

      {/* Loading and error go through Async; empty (the journey) and ready are this template's own geometry. */}
      {(state === "error" || state === "loading") && (
        <Async state={state} error={{ message: error?.message ?? "Could not reach the server.", onRetry: error?.onRetry }} skeleton={loadingSkeleton}>
          {null}
        </Async>
      )}

      {state === "empty" && (
        <Card padding="lg" title="Get to your first score">
          <div className="flex flex-col gap-4">
            <p data-testid="home-verdict" className="m-text-h" style={{ color: "var(--m-ink-2)" }}>{NO_DATA_VERDICT}</p>
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

      {state === "ready" && verdict && (
        <section className="m-hero grid items-end gap-x-10 gap-y-6 md:grid-cols-[auto_1fr]" data-testid="home-verdict-row" data-tour="home-verdict">
          <div data-testid="home-dqs" data-tour="home-score">
            <Score
              size="hero"
              value={verdict.dqs}
              versionId={run?.label}
              hint={verdict.firstRun ? verdict.firstRunLabel ?? "First run for this object" : verdict.delta != null && verdict.previousLabel ? `vs ${verdict.previousLabel}` : undefined}
              delta={verdict.delta != null ? <Delta value={verdict.delta} /> : undefined}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2" style={{ maxWidth: "64ch" }}>
            <p data-testid="home-verdict" className="font-semibold" style={{ fontSize: "var(--m-text-verdict)", lineHeight: "var(--m-leading-verdict)", color: "var(--m-hero-ink)" }}>{verdict.sentence}</p>
            {verdict.capLine && <p className="m-text-body" style={{ color: "var(--m-hero-ink-2)" }}>{verdict.capLine}</p>}
            {verdict.action && (
              <div className="pt-2">
                <Button variant="secondary" render={<Link href={verdict.action.href}>{verdict.action.label}</Link>} />
              </div>
            )}
          </div>
        </section>
      )}

      {state === "ready" && (trend || dimensions) && (
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
          {trend && <div data-tour="home-trend" className={`min-w-0 ${dimensions ? "@5xl:col-span-7" : "@5xl:col-span-12"}`}>{trend}</div>}
          {dimensions && <div className={`min-w-0 ${trend ? "@5xl:col-span-5" : "@5xl:col-span-12"}`}>{dimensions}</div>}
        </div>
      )}
      {state === "ready" && work}
      {state === "ready" && (heatmap || objects) && (
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
          {heatmap && <div className={`min-w-0 ${objects ? "@5xl:col-span-7" : "@5xl:col-span-12"}`}>{heatmap}</div>}
          {objects && <div className={`min-w-0 ${heatmap ? "@5xl:col-span-5" : "@5xl:col-span-12"}`}>{objects}</div>}
        </div>
      )}
      {lists}
    </PageFrame>
  );
}

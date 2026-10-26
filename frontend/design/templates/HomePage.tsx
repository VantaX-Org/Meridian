// frontend/design/templates/HomePage.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";
import { Delta } from "../primitives/Delta";
import { Score, type ScoreBands, type ScoreExplanation } from "../primitives/Score";
import { PageHeader } from "../primitives/PageHeader";
import { Skeleton, StatSkeleton } from "../primitives/Skeleton";
import { Async, type AsyncError, type AsyncState } from "../primitives/Async";
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
  /** The cap a critical rule put on the score, so the hero's ruler marks it; omitted when not capped. */
  cap?: number;
  /** Critical findings behind the cap. */
  criticals?: number;
  /** The tenant's score bands (the objects list's thresholds); the ruler's target tick. */
  bands?: ScoreBands;
  /** "Capped at 70 by 3 critical rules ...", with DrillLinks; omitted when not capped. */
  capLine?: ReactNode;
  /** The one next action. */
  action?: { label: string; href: string };
}

export interface HomeRunInfo {
  /** The run id: keys the score's count-up, never printed. */
  id: string;
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

/** Hero, four sentences, ledger, work row, trend and heatmap: the data state's geometry. */
const loadingSkeleton = (
  <div className="flex flex-col gap-4" data-testid="home-loading">
    <div className="m-hero grid grid-cols-1 gap-6 @4xl:grid-cols-12">
      <div className="@4xl:col-span-7"><Skeleton height={176} hero /></div>
      <div className="@4xl:col-span-5"><Skeleton height={176} /></div>
    </div>
    <Skeleton height={96} />
    <div className="flex flex-col gap-1">{row36.map((i) => <Skeleton key={i} height={30} />)}</div>
    <div className="m-stat-grid">{Array.from({ length: 3 }, (_, i) => <StatSkeleton key={i} />)}</div>
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
      <div className="@5xl:col-span-6"><Skeleton height={160} /></div>
      <div className="@5xl:col-span-6"><Skeleton height={160} /></div>
    </div>
  </div>
);

/**
 * The home page frame, "the Brief": one hero sheet (the score and its verdict left, the object map and the
 * dimension bars right), the four sentences under it, the ledger of what moves the score, one compact onboarding
 * row, the persona's work row, then the trend and the heatmap side by side, smaller. Callers supply every
 * data-specific piece; this component places it and owns the loading, no-data and error geometry.
 */
export function HomePage({
  state, verdict, run, scope, journey, error, aside, dimensions, objects, trend, heatmap, work, lists, headerActions, emptyActions, onboarding, cells, explain, workFirst, nextAction,
}: {
  persona: string;
  /** "empty" is a fresh install (no analysis yet): the journey to a first score. */
  state: AsyncState;
  verdict?: HomeVerdict;
  run?: HomeRunInfo | null;
  /** Header meta in the data state: what the page's numbers belong to ("As of ..." or "Current state of ..."). */
  scope?: ReactNode;
  journey?: HomeJourney;
  /** The failed request as `error` (read through `apiErrorState`), or an explicit title and message; Retry runs `onRetry`. */
  error?: AsyncError;
  /** Right of the score in the hero (5/12): the object map. */
  aside?: ReactNode;
  /** Under `aside` in the hero: the dimension bars, compact. */
  dimensions?: ReactNode;
  /** The ledger, full width under the four sentences: what moves the score, ranked by records affected. */
  objects?: ReactNode;
  /** Left of the closing panel: the score trend line. */
  trend?: ReactNode;
  /** Right of the closing panel: the dimension-by-object heatmap. */
  heatmap?: ReactNode;
  /** The persona's work row of `Stat`s. */
  work?: ReactNode;
  lists?: ReactNode;
  headerActions?: ReactNode;
  /** Header actions on a fresh install (state "empty"): the other ways to start a run, beside the journey's step. */
  emptyActions?: ReactNode;
  /** First-run tour offer and setup checklist, one compact row (components/help/home-onboarding.tsx); shown once the page has loaded. */
  onboarding?: ReactNode;
  /** The four sentences (situation, what changed, why, do next), set under the hero. */
  cells?: ReactNode;
  /** The breakdown behind the hero score, opened from its label ("Data quality score ⓘ"); never a second ring. */
  explain?: ScoreExplanation;
  /** The persona works a queue (the steward): the work row leads, the score hero follows. */
  workFirst?: boolean;
  /** Under the hero: the one top-ranked action of the run, its reason and where to act (`NextBestAction`). */
  nextAction?: ReactNode;
}) {
  const header = (
    <PageHeader
      title="Home"
      meta={state === "ready" ? scope : undefined}
      actions={state === "ready" ? headerActions : state === "empty" ? emptyActions : undefined}
    />
  );
  const hasAside = !!(aside || dimensions);

  return (
    <PageFrame gap={4}>
      {header}
      <div className="flex flex-col" style={{ gap: "var(--m-space-4)" }}>

      {/* Loading and error go through Async; empty (the journey) and ready are this template's own geometry. */}
      {(state === "error" || state === "loading") && (
        <Async state={state} error={error ?? { error: undefined }} skeleton={loadingSkeleton}>
          {null}
        </Async>
      )}

      {state === "empty" && (
        <Card padding="lg" title="Get to your first score">
          <div className="flex flex-col gap-6">
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
      {state === "empty" && onboarding}

      {state === "ready" && workFirst && work}
      {state === "ready" && verdict && (
        <section className="m-hero grid grid-cols-1 items-start gap-x-10 gap-y-6 @4xl:grid-cols-12" data-testid="home-verdict-row" data-tour="home-verdict">
          <div className={`flex min-w-0 flex-col gap-6 ${hasAside ? "@4xl:col-span-7" : "@4xl:col-span-12"}`}>
            <div data-testid="home-dqs" data-tour="home-score">
              <Score
                size="hero"
                value={verdict.dqs}
                cap={verdict.cap}
                criticals={verdict.criticals}
                bands={verdict.bands}
                versionId={run?.id}
                explain={explain}
                hint={verdict.firstRun ? verdict.firstRunLabel ?? "First run for this object" : verdict.delta != null && verdict.previousLabel ? `vs ${verdict.previousLabel}` : undefined}
                delta={verdict.delta != null ? <Delta value={verdict.delta} /> : undefined}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2" style={{ maxWidth: "64ch" }}>
              <p data-testid="home-verdict" className="font-semibold" style={{ fontSize: "var(--m-text-verdict)", lineHeight: "var(--m-leading-verdict)", color: "var(--m-hero-ink)" }}>{verdict.sentence}</p>
              {verdict.capLine && <p className="m-text-body" style={{ color: "var(--m-hero-ink-2)" }}>{verdict.capLine}</p>}
              {verdict.action && (
                <div className="pt-2">
                  {/* The verdict's next step is the home's one primary action; Run analysis in the header is secondary. */}
                  <Button render={<Link href={verdict.action.href}>{verdict.action.label}</Link>} />
                </div>
              )}
            </div>
          </div>
          {hasAside && (
            <div className="flex min-w-0 flex-col gap-5 @4xl:col-span-5" data-testid="home-hero-aside">
              {aside}
              {dimensions}
            </div>
          )}
        </section>
      )}
      {state === "ready" && nextAction}
      {state === "ready" && cells}
      {state === "ready" && objects}
      {state === "ready" && onboarding}
      {state === "ready" && !workFirst && work}
      {state === "ready" && (trend || heatmap) && (
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
          {trend && <div data-testid="home-trend" data-tour="home-trend" className={`min-w-0 ${heatmap ? "@5xl:col-span-6" : "@5xl:col-span-12"}`}>{trend}</div>}
          {heatmap && <div className={`min-w-0 ${trend ? "@5xl:col-span-6" : "@5xl:col-span-12"}`}>{heatmap}</div>}
        </div>
      )}
      {lists}
      </div>
    </PageFrame>
  );
}

"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Stepper, type StepState } from "../kit";

/**
 * The page head the v2 Fix screens shared (design/v2/FixParts and screens/cc-parts), natively: the banner with one
 * sentence of state, its figures and the one action; the lede with what each figure means; the steps of the work;
 * the consequence of the action said before it is taken; and detail kept one click away.
 */

export interface BannerFig {
  label: string;
  value: ReactNode;
  note?: string;
}

export function Banner({ eyebrow, headline, why, figs = [], action, testId, label }: { eyebrow: string; headline: ReactNode; why?: ReactNode; figs?: BannerFig[]; action?: ReactNode; testId: string; label: string }) {
  return (
    <section className="nx-card nx-wp-banner" aria-label={label} data-testid={testId}>
      <div className="nx-wp-state">
        <span className="nx-wp-eyebrow">{eyebrow}</span>
        <h2 className="nx-wp-headline">{headline}</h2>
        {why ? <p className="nx-wp-why">{why}</p> : null}
      </div>
      {figs.length ? (
        <dl className="nx-wp-figs">
          {figs.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
              {f.note ? <dd className="nx-wp-note">{f.note}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}
      {action ? <div className="nx-wp-act">{action}</div> : null}
    </section>
  );
}

/** Lede plus what each figure means, closed until asked. */
export function FixHead({ lede, means }: { lede: ReactNode; means: [string, string][] }) {
  return (
    <div className="nx-wp-head">
      <p className="nx-wp-lede" data-testid="lede">{lede}</p>
      <details className="nx-wp-more" data-testid="means">
        <summary>{t("What the figures mean")}</summary>
        <dl className="nx-wp-means">
          {means.map(([term, meaning]) => (
            <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export type FlowStepItem = { label: string; hint?: string; count?: string };

/** Multi-step work: the step the user is on and what follows, as the kit stepper. */
export function FlowSteps({ steps, current, label, testId = "flow-steps" }: { steps: FlowStepItem[]; current: number; label: string; testId?: string }) {
  const state = (i: number): StepState => (i < current ? "done" : i === current ? "current" : "future");
  return (
    <div data-testid={testId}>
      <Stepper
        label={label}
        steps={steps.map((s, i) => ({
          id: `${i}`,
          label: s.label,
          state: state(i),
          detail: s.count || s.hint ? <>{s.count ? <b>{s.count} </b> : null}{s.hint}</> : undefined,
        }))}
      />
    </div>
  );
}

/** What will happen if the user takes the action beside it, said before they take it. */
export function Consequence({ children }: { children: ReactNode }) {
  return <p className="nx-wp-conseq" data-testid="consequence">{children}</p>;
}

/** Detail kept one click away. Content stays in the page; nothing is removed. */
export function MoreDetail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="nx-wp-more" data-testid="more-detail">
      <summary>{title}</summary>
      <div className="nx-wp-more-body">{children}</div>
    </details>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { isAxiosError } from "axios";
import { t } from "@/lib/v2/i18n";
import { relTime, v2Locale, whole } from "@/lib/v2/format";
import { Button } from "../kit";

/** Every state a card's figures can be in. Each one is drawn, none is a blank box. */
export type CardState = "loading" | "ready" | "empty" | "failed" | "stale" | "denied";

interface Query { isLoading: boolean; error: unknown; data?: unknown; dataUpdatedAt?: number }

/** The state of a card from its query: denied on 403 or when the caller may not read it, stale when a refresh failed over older figures. */
export function cardState(q: Query, empty: boolean, allowed = true): CardState {
  if (!allowed || (isAxiosError(q.error) && q.error.response?.status === 403)) return "denied";
  if (q.isLoading) return "loading";
  if (q.error) return q.data === undefined ? "failed" : "stale";
  return empty ? "empty" : "ready";
}

/** A count that stays short at any size: 1,234,567 becomes 1.2M. The exact number goes in the tooltip through `whole`. */
export const compact = (n: number): string =>
  Math.abs(n) < 10000 ? whole(n) : new Intl.NumberFormat(v2Locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** The chart's own empty shape: five grey bars, never a made-up number. */
function Shape({ busy }: { busy?: boolean }) {
  return (
    <div className="nx-chartcard-shape" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={busy ? "nx-skeleton-bar" : undefined} />)}
    </div>
  );
}

/**
 * A card that leads with its chart. The chart takes the top two fifths of the card or more; the title, the one figure
 * and the way in sit under it. Loading, empty, failed, stale and denied each draw the chart's shape with one line.
 */
export function ChartCard({ title, state, chart, figure, figureTitle, line, emptyLine, href, onRetry, updatedAt, testId, children }: {
  title: string;
  state: CardState;
  chart: ReactNode;
  /** The headline number, already short; its exact value goes in `figureTitle`. */
  figure?: string;
  figureTitle?: string;
  line?: ReactNode;
  emptyLine: string;
  href?: string;
  onRetry?: () => void;
  updatedAt?: number;
  testId?: string;
  children?: ReactNode;
}) {
  const shows = state === "ready" || state === "stale";
  const note =
    state === "loading" ? t("Loading the figures")
      : state === "empty" ? emptyLine
        : state === "failed" ? t("These figures could not be loaded.")
          : state === "denied" ? t("You do not have access to these figures.")
            : null;
  const head = href ? <Link className="nx-link nx-chartcard-title" href={href}>{title}</Link> : <span className="nx-chartcard-title">{title}</span>;
  return (
    <article className="nx-chartcard" data-state={state} data-testid={testId} aria-busy={state === "loading" || undefined}>
      <div className="nx-chartcard-viz">
        {shows ? chart : (
          <figure className="nx-chartcard-empty" role={state === "loading" ? "status" : undefined} aria-label={note ?? title}>
            <Shape busy={state === "loading"} />
            <figcaption className="nx-sub">{note}</figcaption>
          </figure>
        )}
      </div>
      <div className="nx-chartcard-body">
        <h2>{head}</h2>
        {shows && figure ? <p className="nx-chartcard-figure" title={figureTitle}>{figure}</p> : null}
        {shows && line ? <p className="nx-sub nx-chartcard-line">{line}</p> : null}
        {state === "stale" ? (
          <p className="nx-sub" role="status" data-testid="stale">
            {updatedAt ? t("Figures from {when}. The latest refresh failed.", { when: relTime(new Date(updatedAt).toISOString()) }) : t("Older figures. The latest refresh failed.")}
          </p>
        ) : null}
        {state === "failed" || state === "stale" ? onRetry ? <Button size={32} onClick={onRetry}>{t("Try again")}</Button> : null : null}
        {children}
      </div>
    </article>
  );
}

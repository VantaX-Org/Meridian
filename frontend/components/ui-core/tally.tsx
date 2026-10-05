"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCountUp } from "@/lib/aurora/use-count-up";

export interface TallyFigureProps {
  label: string;
  value: number | string | null;
  unit?: string;
  verdict: ReactNode;
  href: string;
  tone?: "danger" | "high" | "warning" | "success";
  /** Change since the last run. `good` names the direction that is an improvement. */
  delta?: { value: number; unit?: string; good: "up" | "down" };
  loading?: boolean;
  error?: { retry: () => void };
}

export function TallyFigure({ label, value, unit, verdict, href, tone, delta, loading, error }: TallyFigureProps) {
  const counted = useCountUp(typeof value === "number" ? value : null);
  const shown = typeof value === "number" ? counted : value;
  const text = error || shown === null ? "—" : typeof shown === "number" ? shown.toLocaleString() : shown;
  const deltaText = !delta ? null
    : delta.value === 0 ? "no change since last run"
    : `${delta.value > 0 ? "up" : "down"} ${Math.abs(delta.value).toLocaleString()}${delta.unit ?? ""} since last run`;
  const body = (
    <>
      <span className="ui-tally__label">{label}</span>
      <span className="ui-tally__value">
        {loading ? <span className="ui-tally__skeleton" aria-hidden /> : text}
        {!loading && !error && shown !== null && unit ? <span className="ui-tally__unit">{unit}</span> : null}
      </span>
      <span className="ui-tally__verdict">
        {error ? (
          <>Could not load. <button type="button" className="ui-tally__retry" onClick={error.retry}>Retry</button></>
        ) : loading ? null : verdict}
      </span>
      {deltaText && !loading && !error ? (
        <span className="ui-tally__delta" data-good={delta && delta.value !== 0 ? (delta.value > 0) === (delta.good === "up") : undefined}>
          {deltaText}
        </span>
      ) : null}
    </>
  );
  // On error the figure is not a link: a retry button inside an anchor is invalid.
  return error ? (
    <div className="ui-tally__figure" data-tone={tone}>{body}</div>
  ) : (
    <Link href={href} className="ui-tally__figure aurora-focus-ring" data-tone={tone}>{body}</Link>
  );
}

export interface TallyProps {
  level: 1 | 2 | 3 | 4;
  figures: TallyFigureProps[];
  as_of?: string;
  label?: string;
}

/** A row of large figures over a hairline rule. The one bold element on a page. */
export function Tally({ level, figures, as_of, label }: TallyProps) {
  return (
    <div className="ui-tally" data-level={level} role="group" aria-label={label}>
      {figures.map((f) => <TallyFigure key={f.label} {...f} />)}
      {as_of ? <p className="ui-tally__asof">{as_of}</p> : null}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import type { GlossaryKey } from "@/lib/help/glossary";
import { ScoreRing, DEFAULT_SCORE_BANDS as BANDS, type ScoreBands } from "./ScoreRing";
import { Rule } from "./Rule";
import { ScoreExplainer, type ScoreExplanation } from "./ScoreExplainer";
import { Stat } from "./Stat";
import type { Verdict } from "./Status";

export { DEFAULT_SCORE_BANDS, type ScoreBands } from "./ScoreRing";
export type { ScoreDimension, ScoreRule, ScoreExplanation } from "./ScoreExplainer";

export type ScoreSize = "sm" | "md" | "hero";

export interface ScoreProps {
  /**
   * The score shown (0 to 100); null or undefined reads as "—". At sm and md, with `cap`, the measured value
   * before the cap. At hero size it is the numeral: pass the capped composite and the uncapped value as `measured`.
   */
  value: number | null | undefined;
  /** hero only: the measured value before the cap, drawn as the ghost beyond the cap tick; never the numeral. */
  measured?: number | null;
  /**
   * sm: a 16px ring and the number, for a table cell or a line of text.
   * md: the 48px ring that carries the number, for a detail header or a stat tile; with `explain` it opens the explainer.
   * hero: the large number and one bar, for the one score sheet of a page (Home, Insights, Executive summary).
   */
  size?: ScoreSize;
  /** The cap a critical finding put on the score. sm and md fill the ring to it and say "Capped at"; hero says it under the bar. */
  cap?: number;
  /** Critical findings behind the cap, named in the cap line. */
  criticals?: number;
  bands?: ScoreBands;
  /** md only: the formula, inputs, cap reason and costliest rules behind the score, in a popover on the ring. */
  explain?: ScoreExplanation;
  /** sm only: the numeral, when it is a link (a `DrillLink` to the rows behind it). */
  children?: ReactNode;
  /** hero only: the label above the number; default "Data quality score". */
  label?: string;
  /** hero only: glossary term for the label; default "dqs". */
  help?: GlossaryKey;
  /** hero only: the `<Delta>` beside the number. */
  delta?: ReactNode;
  /** hero only: the line under the bar (what the delta compares with, or the cap reason); default "Capped at {cap}" when capped. */
  hint?: ReactNode;
  /** hero only: the route the number opens. */
  href?: string;
  /** hero only: the verdict that colours the bar; without it the bar takes the DQS band. */
  tone?: Verdict;
  /** hero only: count-up runs once per version id. */
  versionId?: string;
  /** hero only: skeleton in the number slot at the final height. */
  loading?: boolean;
}

/** The one way to draw a score. A block shows a score once, at one size. */
export function Score({ value, measured, size = "md", cap, criticals, bands, explain, children, label, help, delta, hint, href, tone, versionId, loading }: ScoreProps) {
  if (size === "hero") {
    // The ruler runs to the measured value so the ghost beyond the cap tick shows what the cap held down;
    // the numeral is always `value`, the score every other page shows.
    const ruled = measured ?? value;
    const capped = ruled != null && cap != null && ruled > cap;
    return (
      <div className="m-score-hero" data-testid="score-hero">
        <Stat
          hero
          label={label ?? "Data quality score"}
          help={help ?? "dqs"}
          value={value ?? "—"}
          bar={ruled ?? undefined}
          rule={{ target: (bands ?? BANDS).target, cap: capped ? cap : undefined }}
          decimals={1}
          versionId={versionId}
          loading={loading}
          href={href}
          tone={tone}
          hint={hint ?? (capped ? `Capped at ${cap}${criticals ? `, ${criticals} critical` : ""}` : undefined)}
          delta={delta}
        />
      </div>
    );
  }
  if (value == null) return <span className="m-numeric">—</span>;
  if (size === "sm") {
    return (
      <span className="inline-flex items-center gap-2">
        <Rule size="inline" value={value} cap={cap} bands={bands} />
        <span className="m-numeric">{children ?? value.toFixed(1)}</span>
      </span>
    );
  }
  if (explain) return <ScoreExplainer score={value} cap={cap} {...explain} />;
  return <ScoreRing score={value} size={48} cap={cap} criticals={criticals} bands={bands} />;
}

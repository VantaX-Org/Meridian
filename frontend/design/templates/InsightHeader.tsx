"use client";

// frontend/design/templates/InsightHeader.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "../primitives/Button";
import { Skeleton } from "../primitives/Skeleton";
import { AiSummary, type AiSummaryProps } from "../primitives/AiSummary";
import type { PillTone } from "../primitives/Pill";
import { Stat, type StatProps } from "../primitives/Stat";

export interface InsightCell {
  sentence: ReactNode;
  href?: string;
  tone?: PillTone;
}

export interface InsightHeaderProps {
  situation: InsightCell;
  changed: InsightCell;
  why: InsightCell;
  next: InsightCell & { action?: { label: string; href?: string; onClick?: () => void; impact?: string } };
  /** When given, the AI summary replaces the four cells; the sentences are never shown twice. */
  aiSummary?: AiSummaryProps;
  loading?: boolean;
  /** Opt-in hero zone: a white score sheet with up to four stats above the sentences. One per page. */
  hero?: boolean;
  /** `to` is the route the stat opens. */
  stats?: (Pick<StatProps, "label" | "value" | "hint" | "tone" | "decimals" | "versionId"> & { to?: string })[];
  /** Hero only: the verdict (typographic score and sentence) that leads the band; the stats sit beside it. */
  lead?: ReactNode;
  /** Inside another sheet (the Home hero): the four cells under a hairline, no border or background of their own. */
  embedded?: boolean;
  /** Hero only: the score band alone, without the four cells (they are set in the page's margin instead). */
  bare?: boolean;
}

const HERO_TONE: Record<PillTone, string> = {
  neutral: "var(--m-hero-ink-3)",
  go: "var(--m-hero-tone-pass)",
  "at-risk": "var(--m-hero-tone-medium)",
  "no-go": "var(--m-hero-tone-critical)",
  info: "var(--m-hero-ink-2)",
};

/** Stat columns beside a lead: a row of their own while stacked, three abreast once the lead sits beside them. */
const HERO_STAT_COLS: Record<number, string> = {
  3: "@3xl:grid-cols-3",
  4: "@3xl:grid-cols-4 @7xl:grid-cols-2",
};

const TONE: Record<PillTone, string> = {
  neutral: "var(--m-ink-3)",
  go: "var(--m-go)",
  "at-risk": "var(--m-medium)",
  "no-go": "var(--m-no-go)",
  info: "var(--m-info)",
};

function Cell({ label, cell, loading, hero, children }: { label: string; cell: InsightCell; loading?: boolean; hero?: boolean; children?: ReactNode }) {
  const body = loading ? <Skeleton height={16} hero={hero} /> : cell.sentence;
  const ink = hero ? "var(--m-hero-ink)" : "var(--m-ink)";
  return (
    <div className="grid content-start gap-1 py-2 pl-3 pr-2 @5xl:min-h-9" style={{ borderLeft: `2px solid ${(hero ? HERO_TONE : TONE)[cell.tone ?? "neutral"]}` }}>
      <span className="m-text-meta shrink-0 font-medium" style={{ color: hero ? "var(--m-hero-ink-3)" : "var(--m-ink-3)" }}>{label}</span>
      {cell.href && !loading ? (
        <Link href={cell.href} className="m-text-body underline-offset-2 hover:underline" style={{ color: ink }}>{body}</Link>
      ) : (
        <span className="m-text-body" style={{ color: ink }}>{body}</span>
      )}
      {children}
    </div>
  );
}

export function InsightHeader({ situation, changed, why, next, aiSummary, loading, hero, stats, lead, embedded, bare }: InsightHeaderProps) {
  const a = next.action;
  if (aiSummary && !bare) {
    return (
      <section aria-label="Insight" className={embedded ? "m-hero-cells" : "m-motion-rise"} style={embedded ? undefined : { background: "var(--m-sheet)", borderTop: "1px solid var(--m-line-strong)", borderBottom: "1px solid var(--m-line)", padding: "var(--m-space-3) 0" }}>
        <AiSummary {...aiSummary} />
      </section>
    );
  }
  return (
    <section
      aria-label="Insight"
      className={hero ? "m-hero m-motion-rise" : embedded ? "m-hero-cells" : "m-motion-rise"}
      style={hero || embedded ? undefined : { background: "var(--m-sheet)", border: "1px solid var(--m-line)", borderRadius: "var(--m-radius-sheet)", padding: "var(--m-space-3) var(--m-space-4)" }}
    >
      {hero && (lead || (stats && stats.length > 0)) && (
        // Lead and stats sit side by side only where both fit (a wide container); below it they stack, the lead
        // on its own row, so the verdict never paints over a stat or wraps into a narrow column.
        <div className={lead ? `${bare ? "" : "mb-6 "}grid gap-8 @7xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @7xl:items-end` : bare ? "" : "mb-6"}>
          {lead && <div data-testid="insight-hero-lead" className="min-w-0">{lead}</div>}
          {stats && stats.length > 0 && (
            <div className={`m-motion-stagger grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 ${lead ? HERO_STAT_COLS[Math.min(stats.length, 4)] ?? "" : "md:grid-cols-4"}`} data-testid="insight-hero-stats">
              {/* Only the lead score is set large; these sit at stat size and carry thousands separators, as the sentences under them do. */}
              {stats.slice(0, 4).map(({ to, ...x }) => <Stat key={x.label} countUp loading={loading} href={to} {...x} />)}
            </div>
          )}
        </div>
      )}
      {!bare && <div className="m-motion-stagger grid gap-4 md:grid-cols-4 @5xl:grid-cols-4">
        <Cell label="Situation" cell={situation} loading={loading} hero={hero} />
        <Cell label="What changed" cell={changed} loading={loading} hero={hero} />
        <Cell label="Why it matters" cell={why} loading={loading} hero={hero} />
        <Cell label="Do next" cell={next} loading={loading} hero={hero}>
          {a && !loading && (
            <span className="mt-1 inline-flex shrink-0 items-center gap-2 @5xl:basis-full">
              {a.href ? (
                <Button size="sm" render={<Link href={a.href}>{a.label}</Link>} />
              ) : (
                <Button size="sm" onClick={a.onClick}>{a.label}</Button>
              )}
              {a.impact && <span className="m-text-meta" style={{ color: hero ? "var(--m-hero-ink-3)" : "var(--m-ink-3)" }}>{a.impact}</span>}
            </span>
          )}
        </Cell>
      </div>}
    </section>
  );
}

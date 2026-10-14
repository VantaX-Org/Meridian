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
  aiSummary?: AiSummaryProps;
  loading?: boolean;
  /** Opt-in hero zone: dark band with up to four hero stats above the sentences. One per page. */
  hero?: boolean;
  /** `to` is the route the stat opens. */
  stats?: (Pick<StatProps, "label" | "value" | "hint" | "tone" | "decimals" | "versionId"> & { to?: string })[];
  /** Hero only: the verdict (score ring and sentence) that leads the band; the stats sit beside it. */
  lead?: ReactNode;
}

const HERO_TONE: Record<PillTone, string> = {
  neutral: "var(--m-hero-ink-3)",
  go: "var(--m-hero-tone-pass)",
  "at-risk": "var(--m-hero-tone-medium)",
  "no-go": "var(--m-hero-tone-critical)",
  info: "var(--m-hero-ink-2)",
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
    <div className="grid content-start gap-1 p-3 @5xl:flex @5xl:min-h-9 @5xl:flex-wrap @5xl:items-center @5xl:gap-x-2 @5xl:gap-y-1 @5xl:px-3 @5xl:py-1" style={{ borderTop: `2px solid ${(hero ? HERO_TONE : TONE)[cell.tone ?? "neutral"]}` }}>
      <span className="m-text-meta shrink-0 font-medium @5xl:text-[11px]" style={{ color: hero ? "var(--m-hero-ink-3)" : "var(--m-ink-3)" }}>{label}</span>
      {cell.href && !loading ? (
        <Link href={cell.href} className="m-text-body underline-offset-2 hover:underline" style={{ color: ink }}>{body}</Link>
      ) : (
        <span className="m-text-body" style={{ color: ink }}>{body}</span>
      )}
      {children}
    </div>
  );
}

export function InsightHeader({ situation, changed, why, next, aiSummary, loading, hero, stats, lead }: InsightHeaderProps) {
  const a = next.action;
  return (
    <section
      aria-label="Insight"
      className={hero ? "m-hero m-motion-rise" : "m-motion-rise rounded"}
      style={hero ? undefined : { background: "var(--m-sheet)", boxShadow: "var(--m-elev-1)", borderRadius: "var(--m-radius-sheet)" }}
    >
      {hero && (lead || (stats && stats.length > 0)) && (
        <div className={lead ? "mb-4 grid gap-6 @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @5xl:items-center" : "mb-4"}>
          {lead && <div data-testid="insight-hero-lead">{lead}</div>}
          {stats && stats.length > 0 && (
            <div className={`m-motion-stagger grid grid-cols-2 gap-4 ${lead ? "" : "md:grid-cols-4"}`} data-testid="insight-hero-stats">
              {stats.slice(0, 4).map(({ to, ...x }) => <Stat key={x.label} hero loading={loading} href={to} {...x} />)}
            </div>
          )}
        </div>
      )}
      <div className="grid gap-px md:grid-cols-4 @5xl:grid-cols-4">
        <Cell label="Situation" cell={situation} loading={loading} hero={hero} />
        <Cell label="What changed" cell={changed} loading={loading} hero={hero} />
        <Cell label="Why it matters" cell={why} loading={loading} hero={hero} />
        <Cell label="Do next" cell={next} loading={loading} hero={hero}>
          {a && !loading && (
            <span className="mt-1 inline-flex shrink-0 items-center gap-2 @5xl:basis-full">
              {a.href ? (
                <Button variant={hero ? "secondary" : undefined} render={<Link href={a.href}>{a.label}</Link>} />
              ) : (
                <Button variant={hero ? "secondary" : undefined} onClick={a.onClick}>{a.label}</Button>
              )}
              {a.impact && <span className="m-text-meta" style={{ color: hero ? "var(--m-hero-ink-3)" : "var(--m-ink-3)" }}>{a.impact}</span>}
            </span>
          )}
        </Cell>
      </div>
      {aiSummary && (
        <div className="px-3 pb-3 pt-2">
          {hero ? <div className="p-3" style={{ background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)" }}><AiSummary {...aiSummary} /></div> : <AiSummary {...aiSummary} />}
        </div>
      )}
    </section>
  );
}

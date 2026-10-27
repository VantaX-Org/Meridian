"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Skeleton } from "./Skeleton";
import { Counter } from "./Counter";
import { HelpHint } from "./HelpHint";
import type { GlossaryKey } from "@/lib/help/glossary";
import { Sparkline } from "../charts/Sparkline";
import { Rule } from "./Rule";
import { usePrefetch } from "../hooks/usePrefetch";
import { dqsBand, type DomainKey } from "../tokens";
import type { Verdict } from "./Status";

export type StatTone = Verdict;

/** Tone to the hero tone token (aliases of the status scale; the hero is a white sheet). */
const HERO_TONE: Record<StatTone, string> = {
  go: "var(--m-hero-tone-pass)",
  "at-risk": "var(--m-hero-tone-medium)",
  "no-go": "var(--m-hero-tone-critical)",
};

/** Verdict tone to the bar-fill tone key. */
const BAR_TONE: Record<StatTone, "pass" | "medium" | "critical"> = { go: "pass", "at-risk": "medium", "no-go": "critical" };
/** Default DQS bands (tokens.css --m-dqs-*), used to colour the score bar when no `tone` is given. */
const DQS_BANDS = { target: 90, warning: 75, critical: 60 };

export interface StatProps {
  label: string;
  value: ReactNode;
  /** A ReactNode so legacy string call sites keep working. Sits right of the value; use `<Delta>`. */
  delta?: ReactNode;
  hint?: ReactNode;
  /** Renders a Link and prefetches the route on hover or focus. */
  href?: string;
  /** Renders a `<button className="m-stat m-stat-link">`. Ignored when `href` is set. */
  onClick?: () => void;
  /** 2px left rule in the status tone. Wins over `domain`. */
  tone?: StatTone;
  /** 2px left rule in the domain solid, when no `tone` is set. */
  domain?: DomainKey;
  /** Hero mode: ruled column inside `.m-hero`, hero-size numeral, count-up on by default. */
  hero?: boolean;
  /** Score bar: one horizontal bar under the value, filled to this percent (0 to 100), in the `tone` or the DQS band hue. */
  bar?: number;
  /** With `bar`: draw the Rule (target and cap ticks, 0 to 100 labels) instead of the plain bar. */
  rule?: { target?: number; cap?: number };
  /** Sparkline under the value, drawn when at least 3 points. */
  spark?: number[];
  /** Count the value up from 0. Needs a numeric `value`. Default on for `hero`, off otherwise. */
  countUp?: boolean;
  /** Count-up runs once per version id, so a refetch of the same run does not replay it. */
  versionId?: string;
  /** Decimals for the count-up value. */
  decimals?: 0 | 1;
  /** Glossary term for the label: renders a `HelpHint` beside it (see lib/help/glossary.ts). */
  help?: GlossaryKey;
  /** Shows a skeleton in the value slot. The tile is a fixed 84px (112px hero) height. */
  loading?: boolean;
}

/** KPI tile. */
export function Stat({ label, value, delta, hint, href, onClick, tone, domain, hero = false, bar, rule, spark, countUp, versionId, decimals = 0, loading, help }: StatProps) {
  const prefetch = usePrefetch(href);
  const edge = tone ? (hero ? HERO_TONE[tone] : `var(--m-${tone})`) : domain ? `var(--m-dom-${domain})` : undefined;
  const animate = (countUp ?? hero) && typeof value === "number";
  const sparkColor = hero ? "var(--m-hero-ink-2)" : tone ? `var(--m-${tone})` : "var(--m-accent)";
  const interactive = Boolean(href || onClick);
  // A text value wraps only between words; a single token too wide for the tile truncates (full text in its title).
  const textValue = typeof value === "string" && !loading;
  // Money ("ZAR 4.79 m", "ZAR 1,234") is one token too: currency, figure and scale never wrap apart.
  const moneyValue = textValue && /^[A-Z]{3}\s[-\d.,\s]+(?:\s(?:k|m|bn|tn))?$/.test(value as string);
  const wordValue = textValue && (!/\s/.test(value) || moneyValue);
  const body = (
    <>
      <span
        aria-hidden
        className="m-stat-edge"
        data-tone={tone}
        data-domain={tone ? undefined : domain}
        style={edge ? { background: edge } : undefined}
      />
      {help && !interactive ? (
        <span className="flex items-center gap-1" style={{ minWidth: 0 }}>
          <span className="m-text-meta m-stat-label" style={{ color: hero ? "var(--m-hero-ink-2)" : "var(--m-ink-3)" }}>{label}</span>
          <HelpHint term={help} onHero={hero} />
        </span>
      ) : (
        <span className="m-text-meta m-stat-label" style={{ color: hero ? "var(--m-hero-ink-2)" : "var(--m-ink-3)" }}>{label}</span>
      )}
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {/* Text never breaks mid-word ("Unreachabl" / "e"). */}
        <span
          className={clsx("m-numeric font-semibold", wordValue && "min-w-0 max-w-full truncate whitespace-nowrap")}
          title={wordValue ? value : undefined}
          style={{
            minWidth: wordValue ? undefined : "4ch",
            overflowWrap: textValue ? "normal" : "break-word",
            hyphens: "none",
            // A long word ("Unreachable") steps down to the verdict size so it fits a phone or tablet tile whole.
            fontSize: hero ? "var(--m-text-hero)" : wordValue && (value as string).length > 8 ? "var(--m-text-verdict)" : "var(--m-text-stat)",
            lineHeight: hero ? "var(--m-leading-hero)" : "var(--m-leading-stat)",
            letterSpacing: "var(--m-tracking-tight)",
            color: hero ? "var(--m-hero-ink)" : "var(--m-ink)",
          }}
        >
          {loading ? <Skeleton width="4ch" height={hero ? 76 : 30} hero={hero} /> : animate ? <Counter value={value as number} versionId={versionId} decimals={decimals} size="inherit" onHero={hero} /> : typeof value === "number" ? value.toLocaleString("en-US") : value}
        </span>
        {delta != null && !loading && <span>{delta}</span>}
      </span>
      {spark && spark.length >= 3 && !loading && (
        <span className="absolute" style={{ top: 8, right: 0 }}>
          <Sparkline data={spark.map((y, x) => ({ x: String(x), y }))} width={60} height={16} color={sparkColor} />
        </span>
      )}
      {bar != null && rule && !loading && (
        <span className="block" style={{ margin: hero ? "var(--m-space-3) 0 var(--m-space-1)" : "var(--m-space-2) 0 0" }}>
          <Rule size={hero ? "hero" : "row"} width={hero ? undefined : "100%"} value={bar} target={rule.target} cap={rule.cap} tone={tone ? BAR_TONE[tone] : undefined} label={label} />
        </span>
      )}
      {bar != null && !rule && !loading && (
        <span aria-hidden className="m-score-bar" style={{ margin: "var(--m-space-2) 0 var(--m-space-1)" }}>
          <span className="m-bar-fill" data-tone={tone ? BAR_TONE[tone] : dqsBand(bar, DQS_BANDS)} style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </span>
      )}
      {hint != null && (
        <span className="truncate" style={{ fontSize: "var(--m-text-micro)", lineHeight: "var(--m-leading-micro)", color: hero ? "var(--m-hero-ink-3)" : "var(--m-ink-3)" }}>{hint}</span>
      )}
    </>
  );
  const cls = clsx("m-stat relative flex flex-col overflow-hidden", hero && "m-stat-hero", !hero && rule && bar != null && "m-stat-ruled", interactive && "m-stat-link m-motion-colors");
  const minHeight = undefined;
  const tile = href
    ? <Link href={href} className={cls} style={{ minHeight }} {...prefetch}>{body}</Link>
    : onClick
      ? <button type="button" className={cls} style={{ minHeight }} onClick={onClick}>{body}</button>
      : <div className={cls} style={{ minHeight }}>{body}</div>;
  // A link or button tile cannot hold the hint's button (nested interactive), so the hint sits over its top-right corner as a sibling.
  if (help && interactive) {
    return (
      <div className="relative" style={{ minWidth: 0 }}>
        {tile}
        <span className="absolute" style={{ top: 4, right: spark && spark.length >= 3 ? 68 : 0 }}><HelpHint term={help} /></span>
      </div>
    );
  }
  return tile;
}

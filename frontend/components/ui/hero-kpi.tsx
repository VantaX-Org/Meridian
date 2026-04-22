"use client";

import Link from "next/link";
import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { AnnotatedSparkline } from "@/components/charts/annotated-sparkline";
import { cn } from "@/lib/utils";

export type HeroKpiTone = "pos" | "neg" | "neutral" | "warn";

export interface HeroKpiProps {
  /** Short eyebrow label above the value ("DQS", "Open findings"). */
  label: string;
  /** Main value — caller pre-formats. */
  value: ReactNode;
  /** Optional unit suffix (e.g. "%", "/ 100", " pts"). Rendered small next to value. */
  suffix?: string;
  /** Delta vs previous period. */
  delta?: number;
  /** Delta unit, defaults to "%". */
  deltaLabel?: string;
  /** Force tone; otherwise inferred. */
  tone?: HeroKpiTone;
  /** One-line context sentence under the value ("vs last sync", "since Jan 1"). */
  caption?: string;
  /** Time-series for the sparkline (oldest → newest). */
  spark?: ReadonlyArray<number | null>;
  /** Optional lower/upper band for annotated sparkline. */
  threshold?: { lower?: number; upper?: number };
  /** Optional drill-through link. */
  href?: string;
  className?: string;
}

function inferTone(delta: number | undefined, tone: HeroKpiTone | undefined): HeroKpiTone {
  if (tone) return tone;
  if (delta === undefined) return "neutral";
  if (delta > 0) return "pos";
  if (delta < 0) return "neg";
  return "neutral";
}

function toneText(tone: HeroKpiTone): string {
  switch (tone) {
    case "pos":
      return "text-[#256F3A]";
    case "neg":
      return "text-[#BB0000]";
    case "warn":
      return "text-[#E76500]";
    default:
      return "text-muted-foreground";
  }
}

function toneStroke(tone: HeroKpiTone): string {
  switch (tone) {
    case "neg":
      return "#BB0000";
    case "warn":
      return "#E76500";
    case "pos":
      return "#256F3A";
    default:
      return "#0070F2";
  }
}

/**
 * Hero KPI tile — the single dominant metric at the top of a dashboard page.
 * Designed to anchor the KpiRail (which holds the supporting 4–7 metrics to
 * the right of this tile). Visually heavier: 40px display value, animated
 * count-up, 60-pt sparkline with anomaly annotations, primary-toned delta
 * pill.
 */
export function HeroKpi({
  label,
  value,
  suffix,
  delta,
  deltaLabel,
  tone: toneProp,
  caption,
  spark,
  threshold,
  href,
  className,
}: HeroKpiProps) {
  const tone = inferTone(delta, toneProp);
  const Icon = delta === undefined ? null : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaText =
    delta === undefined ? null : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}${deltaLabel ?? "%"}`;

  const inner = (
    <div
      className={cn(
        "vx-glass-elevated relative flex h-full flex-col gap-3 rounded-2xl p-5",
        "motion-safe:animate-[vx-fade-in_0.4s_ease-out_both]",
        href && "cursor-pointer transition-transform hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="vx-eyebrow">{label}</span>
        {href ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="vx-hero-value text-foreground">
          {value}
        </span>
        {suffix ? (
          <span className="text-base font-medium text-muted-foreground vx-num">
            {suffix}
          </span>
        ) : null}
        {deltaText ? (
          <span
            className={cn(
              "ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold vx-num",
              tone === "pos" && "border-[#256F3A]/20 bg-[#256F3A]/10 text-[#256F3A]",
              tone === "neg" && "border-[#BB0000]/20 bg-[#BB0000]/10 text-[#BB0000]",
              tone === "warn" && "border-[#E76500]/20 bg-[#E76500]/10 text-[#E76500]",
              tone === "neutral" && "border-border bg-muted text-muted-foreground",
            )}
          >
            {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
            {deltaText}
          </span>
        ) : null}
      </div>

      {caption ? (
        <p className={cn("text-xs", toneText(tone))}>{caption}</p>
      ) : null}

      {spark && spark.length > 1 ? (
        <div className="mt-auto -mx-1">
          <AnnotatedSparkline
            data={spark}
            stroke={toneStroke(tone)}
            height={60}
            threshold={threshold}
          />
        </div>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AnnotatedSparkline } from "@/components/charts/annotated-sparkline";

export type KpiTone = "pos" | "neg" | "neutral" | "warn";

export interface KpiItem {
  /** Short, sentence-case label ("DQS", "Critical", "Systems"). */
  label: string;
  /** Pre-formatted display value; pass strings so callers keep full control. */
  value: ReactNode;
  /** Optional delta (absolute or %). Omit if not relevant. */
  delta?: number;
  /** Delta unit — defaults to "%". Use " pts" for DQS, "" for plain counts. */
  deltaLabel?: string;
  /** Optional spark series (oldest → newest). Rendered at the bottom of the tile. */
  spark?: ReadonlyArray<number | null>;
  /** Force a tone; otherwise inferred from the sign of `delta`. */
  tone?: KpiTone;
  /** When set, the tile becomes a clickable drill-through link. */
  href?: string;
  /** Tooltip / aria-label body for context. */
  hint?: string;
}

export interface KpiRailProps {
  items: ReadonlyArray<KpiItem>;
  /** Force the number of columns on wide screens. Defaults to `items.length`. */
  columns?: 4 | 5 | 6 | 7 | 8;
  className?: string;
}

const COL_CLASSES: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
  7: "lg:grid-cols-7",
  8: "lg:grid-cols-8",
};

function toneColor(tone: KpiTone): string {
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

function inferTone(delta: number | undefined, tone: KpiTone | undefined): KpiTone {
  if (tone) return tone;
  if (delta === undefined) return "neutral";
  if (delta > 0) return "pos";
  if (delta < 0) return "neg";
  return "neutral";
}

function DeltaPill({ delta, deltaLabel, tone }: { delta?: number; deltaLabel?: string; tone: KpiTone }) {
  if (delta === undefined) return null;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const sign = delta > 0 ? "+" : "";
  const unit = deltaLabel ?? "%";
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-semibold tabular-nums", toneColor(tone))}>
      <Icon className="h-3 w-3" aria-hidden />
      {sign}
      {delta.toFixed(1)}
      {unit}
    </span>
  );
}

/**
 * Horizontal rail of compact KPI tiles. Designed to sit at the top of every
 * dashboard page — 4 to 8 tiles on wide screens, collapsing to 2 columns on
 * mobile and 3 on tablet. Tiles are ~80px tall so they never dominate the
 * page; all detail lives below in the primary panel.
 */
export function KpiRail({ items, columns, className }: KpiRailProps) {
  const colClass = COL_CLASSES[columns ?? (items.length as 4 | 5 | 6 | 7 | 8)] ?? "lg:grid-cols-6";

  return (
    <div
      role="group"
      aria-label="Key performance indicators"
      className={cn("vx-stagger grid grid-cols-2 gap-3 sm:grid-cols-3", colClass, className)}
    >
      {items.map((item, i) => {
        const tone = inferTone(item.delta, item.tone);
        const content = (
          <div
            className={cn(
              "vx-glass-elevated flex h-full flex-col justify-between gap-1.5 rounded-xl px-3.5 py-3",
              item.href && "cursor-pointer transition-transform hover:-translate-y-0.5",
            )}
            title={item.hint}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="vx-eyebrow truncate">{item.label}</p>
              {item.href ? <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="vx-num font-display text-[22px] font-semibold leading-none text-foreground">
                {item.value}
              </span>
              <DeltaPill delta={item.delta} deltaLabel={item.deltaLabel} tone={tone} />
            </div>
            {item.spark && item.spark.length > 1 ? (
              <AnnotatedSparkline
                data={item.spark}
                stroke={tone === "neg" ? "#BB0000" : tone === "warn" ? "#E76500" : "#0070F2"}
                height={18}
                annotated={false}
              />
            ) : (
              <div style={{ height: 18 }} aria-hidden />
            )}
          </div>
        );
        return item.href ? (
          <Link href={item.href} key={i} className="block">
            {content}
          </Link>
        ) : (
          <div key={i}>{content}</div>
        );
      })}
    </div>
  );
}

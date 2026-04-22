"use client";

import Link from "next/link";
import { ArrowRight, Sparkles, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NarrativeTone = "pos" | "neg" | "warn" | "info";

export interface NarrativeStripProps {
  /** One-sentence "what happened". */
  headline: ReactNode;
  /** Optional second sentence — "why it matters, next step". */
  detail?: ReactNode;
  tone?: NarrativeTone;
  /** Optional call-to-action link — renders on the right. */
  cta?: { label: string; href: string } | null;
  className?: string;
}

const TONE_CONFIG: Record<NarrativeTone, { icon: typeof Info; border: string; accent: string; iconColor: string }> = {
  pos: {
    icon: CheckCircle2,
    border: "border-[#256F3A]/20",
    accent: "bg-[#256F3A]/5",
    iconColor: "text-[#256F3A]",
  },
  neg: {
    icon: AlertTriangle,
    border: "border-[#BB0000]/20",
    accent: "bg-[#BB0000]/5",
    iconColor: "text-[#BB0000]",
  },
  warn: {
    icon: AlertTriangle,
    border: "border-[#E76500]/20",
    accent: "bg-[#E76500]/5",
    iconColor: "text-[#E76500]",
  },
  info: {
    icon: Sparkles,
    border: "border-primary/20",
    accent: "bg-primary/5",
    iconColor: "text-primary",
  },
};

/**
 * Thin glass strip that answers "what happened · why it matters · what next"
 * in a single line. Sits directly below `KpiRail` on every page.
 *
 * Narratives are composed client-side from the same data that feeds the KPI
 * rail — they do not require a new backend endpoint.
 */
export function NarrativeStrip({
  headline,
  detail,
  tone = "info",
  cta,
  className,
}: NarrativeStripProps) {
  const cfg = TONE_CONFIG[tone];
  const Icon = cfg.icon;

  return (
    <div
      role="note"
      aria-label="Narrative summary"
      className={cn(
        "vx-glass flex items-start gap-3 rounded-xl border px-4 py-2.5",
        cfg.border,
        cfg.accent,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.iconColor)} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{headline}</p>
        {detail ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      {cta ? (
        <Link
          href={cta.href}
          className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          {cta.label}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

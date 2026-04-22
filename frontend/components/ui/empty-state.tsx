"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type EmptyIllustration = "findings" | "data" | "search" | "clean" | "activity" | "generic";

export interface EmptyStateProps {
  illustration?: EmptyIllustration;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?:
    | { label: string; href: string; external?: boolean }
    | { label: string; onClick: () => void };
  className?: string;
  /** Compact variant — smaller illustration, tighter padding. */
  compact?: boolean;
}

function Illustration({ kind, size }: { kind: EmptyIllustration; size: number }) {
  const s = size;
  const common = {
    width: s,
    height: s,
    viewBox: "0 0 80 80",
    fill: "none" as const,
    "aria-hidden": true,
  };

  switch (kind) {
    case "findings":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="emf1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0070F2" stopOpacity="0.18" />
              <stop offset="1" stopColor="#0070F2" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <rect x="10" y="14" width="60" height="52" rx="10" fill="url(#emf1)" />
          <rect x="10" y="14" width="60" height="52" rx="10" stroke="#0070F2" strokeOpacity=".28" />
          <path d="M22 34h36M22 42h28M22 50h22" stroke="#0070F2" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
          <circle cx="58" cy="22" r="6" fill="#256F3A" />
          <path d="M55.5 22l2 2 4-4" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "data":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="emd1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7858FF" stopOpacity="0.16" />
              <stop offset="1" stopColor="#7858FF" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <ellipse cx="40" cy="20" rx="22" ry="6" fill="url(#emd1)" stroke="#7858FF" strokeOpacity=".35" />
          <path d="M18 20v18c0 3.3 9.9 6 22 6s22-2.7 22-6V20" stroke="#7858FF" strokeOpacity=".55" />
          <path d="M18 38v18c0 3.3 9.9 6 22 6s22-2.7 22-6V38" stroke="#7858FF" strokeOpacity=".55" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="34" cy="34" r="18" stroke="#0070F2" strokeOpacity=".55" strokeWidth="2" fill="#0070F2" fillOpacity=".08" />
          <path d="M48 48l14 14" stroke="#0070F2" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
          <path d="M26 34h16M34 26v16" stroke="#0070F2" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "clean":
      return (
        <svg {...common}>
          <path
            d="M24 56l8-30 16 6-8 30z"
            fill="#0070F2"
            fillOpacity=".12"
            stroke="#0070F2"
            strokeOpacity=".55"
          />
          <path d="M40 20l4-8 8 2-4 8" stroke="#0070F2" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="56" cy="22" r="2" fill="#256F3A" />
          <circle cx="60" cy="30" r="1.5" fill="#E76500" />
          <circle cx="50" cy="12" r="1.5" fill="#7858FF" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path
            d="M8 56l12-16 10 8 14-22 12 10 16-14"
            stroke="#0070F2"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="56" cy="30" r="3" fill="#0070F2" />
          <circle cx="44" cy="34" r="2" fill="#256F3A" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="10" y="18" width="60" height="44" rx="10" fill="#0070F2" fillOpacity=".08" stroke="#0070F2" strokeOpacity=".25" />
          <circle cx="40" cy="40" r="10" fill="#FFFFFF" stroke="#0070F2" strokeOpacity=".45" />
        </svg>
      );
  }
}

export function EmptyState({
  illustration = "generic",
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-white/50 text-center",
        compact ? "px-5 py-6" : "px-6 py-10",
        className,
      )}
    >
      <Illustration kind={illustration} size={compact ? 56 : 80} />
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? (
        "href" in action ? (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-[#0057D2]"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-[#0057D2]"
          >
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}

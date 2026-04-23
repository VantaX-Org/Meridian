"use client";

import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

/**
 * Legacy-page banner — part of the Aurora hard cutover (spec §14.4).
 *
 * Shown at the top of each legacy dashboard page that has an Aurora
 * equivalent. Tells the user "this works, but there's a nicer home
 * for this now" and deep-links them. Dismissible via localStorage
 * so repeat visitors aren't nagged.
 *
 * Scope: the 4 Aurora workspaces (/command-centre, /workbench,
 * /process, /admin) are the canonical destinations. Legacy pages
 * whose function maps to one of those should render this banner.
 */
export interface LegacyPageBannerProps {
  /** Aurora URL to redirect to. */
  auroraHref: string;
  /** Short label for the Aurora destination — e.g. "Workbench". */
  auroraLabel: string;
  /** One-line explanation of what's new in the Aurora version. */
  note?: string;
}

export function LegacyPageBanner({
  auroraHref,
  auroraLabel,
  note,
}: LegacyPageBannerProps) {
  const storageKey = `meridian.legacy-banner-dismissed.${auroraHref}`;
  // Server-side render doesn't have localStorage, so we default to
  // shown and hide client-side if previously dismissed.
  const dismissed =
    typeof window !== "undefined" &&
    window.localStorage.getItem(storageKey) === "1";
  if (dismissed) return null;

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
      style={{
        background:
          "color-mix(in srgb, var(--aurora-accent-500) 8%, var(--card))",
        borderColor:
          "color-mix(in srgb, var(--aurora-accent-500) 30%, var(--border))",
      }}
      role="status"
    >
      <Sparkles
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color: "var(--aurora-accent-500)" }}
        aria-hidden
      />
      <div className="flex-1">
        <div className="font-medium text-foreground">
          Aurora now has a purpose-built {auroraLabel.toLowerCase()} workspace
        </div>
        {note ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
        ) : null}
      </div>
      <Link
        href={auroraHref}
        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
        style={{
          background: "var(--aurora-accent-500)",
          color: "white",
        }}
      >
        Open {auroraLabel}
        <ArrowRight className="h-3 w-3" />
      </Link>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem(storageKey, "1");
          // Force a re-render — simplest cheap way
          window.location.reload();
        }}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Dismiss banner"
      >
        ×
      </button>
    </div>
  );
}

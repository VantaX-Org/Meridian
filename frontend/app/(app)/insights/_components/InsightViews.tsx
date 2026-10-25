"use client";

// Five views, one spine. Every insight page shows the tabs of the view it belongs to.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withScope } from "./useInsightScope";

export interface InsightView { id: string; label: string; question: string; tabs: [href: string, label: string][] }

export const VIEWS: InsightView[] = [
  { id: "summary", label: "Summary", question: "How are we, since when, what next", tabs: [["/insights/exec", "Executive summary"], ["/insights", "Overview"], ["/insights/reports", "Reports"]] },
  { id: "progress", label: "Progress", question: "Did it get better, and why", tabs: [["/insights/progress", "Progress"], ["/insights/trends", "Trends"], ["/insights/forecast", "Forecast"]] },
  { id: "explore", label: "Explore", question: "Where exactly is it, from every angle", tabs: [["/insights/rules", "Failing rules"], ["/insights/impact", "Value at risk"], ["/insights/lineage", "Lineage"], ["/insights/mining", "Patterns"], ["/insights/duplicates", "Duplicates"]] },
  { id: "readiness", label: "Readiness", question: "Can we load, can we run the process", tabs: [["/insights/readiness", "Waves"], ["/insights/process", "Processes"], ["/migration", "Migration cockpit"]] },
  { id: "operate", label: "Operate", question: "Who does what today", tabs: [["/insights/owners", "Owners"], ["/insights/operations", "Operations"], ["/runs", "Runs"], ["/fix", "Fix work"], ["/rules/contracts", "Data contracts"]] },
];

/**
 * The one line under each insight page's title: what the page shows and what to do with it, in plain words.
 * Pages pass it to `InsightFrame purpose`.
 */
export const PAGE_PURPOSE = {
  "/insights": "Where your SAP data stands, what holds the score down, and which failing rules to fix first.",
  "/insights/exec": "The one-page view for leadership: score, readiness by wave, value at risk and owners. Download the board pack to share it.",
  "/insights/reports": "Ready-made reports for the selected run. Pick a report, check the preview, then download it or copy a link.",
  "/insights/trends": "How the score moved from run to run for the same system or upload, and which rules drove the change.",
  "/insights/forecast": "Where each object's score is heading over the next 7, 30 and 90 days. It uses every run so far, not only the selected one.",
  "/insights/rules": "Which checks cost the most, and where to start. Group them by object, field or dimension to see the pattern.",
  "/insights/impact": "What the failing records are worth in blocked SAP features, and which rules to fix to release them.",
  "/insights/lineage": "Follow a field through configuration, process steps and SAP features to see which business KPIs a failing rule reaches.",
  "/insights/mining": "Links between records and patterns found in your data, such as likely rules, anomalies and drift. Mine the selected run to refresh them.",
  "/insights/duplicates": "Records that describe the same thing. Look up one record to see its duplicates, choose the one to keep, then propose the merge.",
  "/insights/readiness": "Which objects can load in each migration wave, and what blocks the rest.",
  "/insights/process": "How ready each business process is to run on this data: the steps blocked by failing fields, and what to clear first.",
  "/insights/owners": "How each data owner's open issues are trending, so you know whom to follow up with. Live, not tied to one run.",
  "/insights/operations": "How the cleaning team is keeping up: work in flight, where items wait longest, and capacity. Live, not tied to one run.",
} as const satisfies Record<string, string>;

export function viewOf(pathname: string): InsightView | undefined {
  return VIEWS.find((v) => v.tabs.some(([href]) => href === pathname));
}

/**
 * Link strip under the page header: the tabs of the current view, the pinned run carried to the other insight tabs
 * only. A page outside the five views that belongs to one (a run compared with its baseline) names its `view`
 * and the run its tabs should carry.
 */
export function InsightTabs({ view: viewId, run: runId }: { view?: string; run?: string } = {}) {
  // Both hooks return null outside the App Router (unit tests, static export).
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const run = runId ?? search?.get("run") ?? undefined;
  const view = viewId ? VIEWS.find((v) => v.id === viewId) : viewOf(pathname);
  if (!view || search?.get("present") === "1") return null;
  return (
    <nav aria-label={`${view.label} views`} data-tour="insight-views" className="flex flex-wrap items-center gap-1 border-b [border-color:var(--m-line)]">
      {view.tabs.map(([href, label]) => {
        const current = href === pathname;
        return (
          <Link
            key={href}
            href={href.startsWith("/insights") ? withScope(href, { run }) : href}
            aria-current={current ? "page" : undefined}
            className="m-motion-colors -mb-px flex h-9 items-center px-3 m-text-body font-medium m-ink-3 [border-bottom:2px_solid_transparent] aria-[current=page]:[color:var(--m-ink)] aria-[current=page]:[border-bottom-color:var(--m-accent)]"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

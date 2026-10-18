"use client";

// Five views, one spine. Every insight page shows the tabs of the view it belongs to.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withScope } from "./useInsightScope";

export interface InsightView { id: string; label: string; question: string; tabs: [href: string, label: string][] }

export const VIEWS: InsightView[] = [
  { id: "summary", label: "Summary", question: "How are we, since when, what next", tabs: [["/insights/exec", "Summary"], ["/insights", "Overview"], ["/insights/reports", "Reports"]] },
  { id: "progress", label: "Progress", question: "Did it get better, and why", tabs: [["/insights/progress", "Since baseline"], ["/insights/trends", "Trends"], ["/insights/forecast", "Forecast"]] },
  { id: "explore", label: "Explore", question: "Where exactly is it, from every angle", tabs: [["/insights/rules", "Rules"], ["/insights/impact", "Value at risk"], ["/insights/lineage", "Lineage"], ["/insights/mining", "Patterns"], ["/insights/duplicates", "Duplicates"]] },
  { id: "readiness", label: "Readiness", question: "Can we load, can we run the process", tabs: [["/insights/readiness", "Waves"], ["/insights/process", "Processes"], ["/migration", "Migration cockpit"]] },
  { id: "operate", label: "Operate", question: "Who does what today", tabs: [["/insights/owners", "Owners"], ["/insights/operations", "Operations"], ["/runs", "Runs"], ["/fix", "Fix queue"], ["/rules/contracts", "Data contracts"]] },
];

export function viewOf(pathname: string): InsightView | undefined {
  return VIEWS.find((v) => v.tabs.some(([href]) => href === pathname));
}

/** Link strip under the page header: the tabs of the current view, the pinned run carried to the other insight tabs only. */
export function InsightTabs() {
  // Both hooks return null outside the App Router (unit tests, static export).
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const run = search?.get("run") ?? undefined;
  const view = viewOf(pathname);
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

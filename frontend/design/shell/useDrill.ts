// frontend/design/shell/useDrill.ts
"use client";

import { usePathname, useSearchParams } from "next/navigation";

export interface Crumb {
  label: string;
  href: string;
}

/**
 * Reads the current /objects/[object]/rules/[ruleId] (etc.) URL and returns
 * breadcrumb crumbs, each carrying the search params active right now — so
 * navigating back to an ancestor restores the filters that were active when
 * it was visited (spec section 5).
 */
export function useDrill(): { crumbs: Crumb[]; up: Crumb | null; next: (path: string) => string } {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : "";

  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  // /objects/[object] -> crumb "object" at /objects/[object]
  // /objects/[object]/rules/[ruleId] -> + crumb "ruleId" at /objects/[object]/rules/[ruleId]
  if (segments[0] === "objects" && segments[1]) {
    crumbs.push({ label: segments[1], href: `/objects/${segments[1]}${suffix}` });
    if (segments[2] === "rules" && segments[3]) {
      crumbs.push({ label: segments[3], href: `/objects/${segments[1]}/rules/${segments[3]}${suffix}` });
    }
    if (segments[2] === "records" && segments[3]) {
      crumbs.push({ label: decodeURIComponent(segments[3]), href: `/objects/${segments[1]}/records/${segments[3]}${suffix}` });
    }
  }

  const up = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const next = (path: string) => `${path}${suffix}`;
  return { crumbs, up, next };
}

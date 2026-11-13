/** The five tabs of the Story feed, in order. */
export const PATHS = {
  home: "/",
  work: "/work",
  load: "/load",
  runs: "/runs",
  more: "/more",
} as const;
export type DestId = keyof typeof PATHS;
export const TABS: readonly DestId[] = ["home", "work", "load", "runs", "more"];

/** Exact old addresses and where they live now. A segment target travels as ?tab=<segment>. */
export const REDIRECTS: Readonly<Record<string, string>> = {
  // Legacy interface
  "/attention": "/work",
  "/fix-drafts": "/work/drafts",
  "/cleansing": "/work/approvals",
  "/requests": "/work/requests",
  "/requests/new": "/work/requests",
  "/requests/analytics": "/work/requests",
  "/people": "/more/people",
  "/rules": "/more/rules",
  "/rule-promotion": "/more/rules?tab=promotion",
  "/anomaly-rules": "/more/rules?tab=learned",
  "/migration": "/load",
  "/s4": "/load?tab=s4-readiness",
  "/go-live": "/load?tab=go-live",
  "/forecast": "/more/insights?tab=forecast",
  "/insights": "/more/insights",
  "/score": "/more/insights?tab=scores",
  "/value": "/more/insights?tab=value",
  "/atlas": "/more/atlas",
  "/issues": "/more/master-data?tab=issues",
  "/links": "/more/master-data?tab=links",
  "/mdm": "/more/master-data",
  "/mining": "/more/master-data?tab=mining",
  "/processes": "/more/master-data?tab=processes",
  "/config": "/more/systems?tab=configuration",
  "/s": "/more/systems",
  "/s/new": "/more/systems?sheet=connect",
  "/reports": "/more/reports",
  // Preview interface
  "/portfolio": "/",
  "/next/objects": "/",
  "/next/work": "/work",
  "/monitor": "/work/monitor",
  "/next/kit": "/more/kit",
};

/** Old address families: prefix, then the new prefix. The rest of the path carries over. */
const PREFIXES: readonly (readonly [string, string])[] = [
  ["/r/", "/more/rules/"],
  ["/s/", "/more/systems/"],
  ["/next/work/", "/work/"],
  ["/load/", "/load?tab="],
];

/** The new address for an old one, or null when the screen stays where it is. */
export function redirectFor(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const hit = REDIRECTS[p];
  if (hit && hit !== p) return hit;
  for (const [from, to] of PREFIXES) {
    if (p.startsWith(from) && p.length > from.length) {
      const rest = p.slice(from.length);
      if (from === "/load/") return rest.includes("/") ? "/load" : `${to}${rest}`;
      return `${to}${rest}`;
    }
  }
  return null;
}

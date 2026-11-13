import type { V2Persona } from "@/lib/v2/hooks";

/** Where each destination lives. Work sits under /next because /work is the old interface's address. */
export const PATHS = {
  portfolio: "/portfolio",
  objects: "/next/objects",
  work: "/next/work",
  monitor: "/monitor",
  load: "/load",
  more: "/more",
} as const;
export type DestId = keyof typeof PATHS;

type Group = "business" | "steward" | "lead" | "admin";
const GROUP: Record<V2Persona, Group> = {
  owner: "business", analyst: "business", viewer: "business",
  steward: "steward",
  lead: "lead", process: "lead",
  admin: "admin", basis: "admin", auditor: "admin",
};

/** The five destinations in the order this role works through them. Admin and Basis lead with More and drop Load. */
export function railOrder(persona: V2Persona, canExport: boolean): DestId[] {
  switch (GROUP[persona]) {
    case "business": return canExport ? ["portfolio", "objects", "work", "monitor", "load"] : ["portfolio", "objects", "work", "monitor"];
    case "steward": return ["portfolio", "work", "objects", "monitor", "load"];
    case "lead": return ["portfolio", "load", "objects", "monitor", "work"];
    case "admin": return ["portfolio", "more", "objects", "monitor", "work"];
  }
}

/** More is a quiet entry below the divider, except for the roles that carry it in the five. */
export const moreInFive = (order: DestId[]) => order.includes("more");

/** The old address of a screen and where it lives now. Exact matches only; nothing here touches /o, /run or /s/[id]. */
export const REDIRECTS: Readonly<Record<string, string>> = {
  "/": "/portfolio",
  "/objects": "/next/objects",
  "/work": "/next/work",
  "/attention": "/next/work",
  "/fix-drafts": "/next/work/fix-drafts",
  "/data-requests": "/next/work/data-requests",
  "/cleansing": "/next/work/approve",
  "/requests": "/next/work/requests",
  "/requests/new": "/next/work/requests/new",
  "/requests/analytics": "/next/work/requests/analytics",
  "/people": "/next/work/people",
  "/work/monitor": "/monitor",
  "/monitors": "/monitor?tab=learned",
  "/rules": "/more/rules",
  "/rule-promotion": "/more/rules?tab=promotion",
  "/rule-dry-run": "/more/rules?tab=dry-run",
  "/anomaly-rules": "/more/rules?tab=anomaly",
  "/aletheia/evidence": "/more/aletheia?tab=evidence",
  "/aletheia/foresight": "/more/aletheia?tab=foresight",
  "/aletheia/reason": "/more/aletheia?tab=reason",
  "/aletheia-survivorship": "/more/aletheia?tab=survivorship",
  "/mdm": "/more/master-data",
  "/entry-gate": "/more/master-data?tab=entry-gate",
  "/reference-data": "/more/master-data?tab=reference",
  "/links": "/more/master-data?tab=links",
  "/catalogue": "/more/master-data?tab=catalogue",
  "/issues": "/more/master-data?tab=issues",
  "/mining": "/more/master-data?tab=mining",
  "/processes": "/more/master-data?tab=processes",
  "/score": "/more/insights",
  "/insights": "/more/insights?tab=insights",
  "/forecast": "/more/insights?tab=forecast",
  "/value": "/more/insights?tab=value",
  "/config": "/more/systems/config",
  "/s": "/more/systems",
  "/runs": "/more/runs",
  "/reports": "/more/reports",
  "/atlas": "/more/atlas",
  "/admin": "/more/admin",
};

/** The new address for an old one, or null when the screen stays where it is. */
export function redirectFor(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (REDIRECTS[p]) return REDIRECTS[p];
  if (p.startsWith("/admin/")) return `/more${p}`;
  return null;
}

/**
 * The five workspaces, organised by the job someone comes to do. Each tab is
 * a page the product already has (its legacy route stays live for deep links);
 * role and licence gating comes from the matching nav entry in lib/nav.ts,
 * so a tab is never shown here and hidden there. Pages without a nav entry
 * carry their own `anyOf`.
 *
 *   ⌘1 Command Centre — what is happening (managers, viewers, auditors)
 *   ⌘2 Data           — systems, downloads, imports, analyses (analysts)
 *   ⌘3 Workbench      — fix and govern records (stewards, approvers)
 *   ⌘4 Process        — process and configuration impact
 *   ⌘5 Admin          — users, settings, licence
 */
import type { Role } from "@/hooks/use-role";
import { allowed, flattenNav, NAV_GROUPS, SETTINGS_PERMISSIONS, type NavGate } from "@/lib/nav";

export type WorkspaceId = "command-centre" | "data" | "workbench" | "process" | "admin";

export interface WorkspaceTab {
  id: string;
  label: string;
  /** The page this tab shows — also its deep-link route. */
  href: string;
  /** Only for pages that have no nav entry. */
  anyOf?: readonly string[];
  /** A full page under the workspace (deep-linked, not a tab button). */
  hidden?: boolean;
}

export interface Workspace {
  id: WorkspaceId;
  label: string;
  href: string;
  shortcut: string;
  tabs: readonly WorkspaceTab[];
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id: "command-centre", label: "Command Centre", href: "/", shortcut: "⌘1",
    tabs: [
      { id: "overview", label: "Overview", href: "/" },
      { id: "report", label: "Executive report", href: "/executive-report" },
      { id: "live", label: "Live operations", href: "/command-centre" },
      { id: "analytics", label: "Trends", href: "/analytics" },
      { id: "findings", label: "Findings", href: "/findings" },
      { id: "notifications", label: "Notifications", href: "/notifications" },
    ],
  },
  {
    id: "data", label: "Data", href: "/data", shortcut: "⌘2",
    tabs: [
      { id: "systems", label: "Systems", href: "/systems" },
      { id: "runs", label: "Runs", href: "/sync" },
      { id: "import", label: "Import", href: "/upload" },
      { id: "analyses", label: "Analyses", href: "/versions" },
      { id: "connectivity", label: "Connectivity", href: "/connectivity", anyOf: ["trigger_sync"] },
      { id: "run-sync", label: "Re-run modules", href: "/run-sync", anyOf: ["trigger_sync"] },
      { id: "migration", label: "Migration", href: "/migration" },
    ],
  },
  {
    id: "workbench", label: "Workbench", href: "/workbench", shortcut: "⌘3",
    tabs: [
      { id: "triage", label: "Triage", href: "/issues" },
      { id: "record", label: "Record report", href: "/workbench/report", hidden: true },
      { id: "queue", label: "My queue", href: "/workbench" },
      { id: "team", label: "Team workload", href: "/stewardship" },
      { id: "metrics", label: "Steward metrics", href: "/stewardship/metrics", anyOf: ["assign"] },
      { id: "cleaning", label: "Cleaning", href: "/cleaning" },
      { id: "exceptions", label: "Exceptions", href: "/exceptions" },
      { id: "dedup", label: "Duplicates", href: "/dedup" },
      { id: "ai-rules", label: "AI rule review", href: "/ai/rules" },
      { id: "golden", label: "Golden records", href: "/golden-records" },
      { id: "glossary", label: "Glossary", href: "/glossary" },
      { id: "match-rules", label: "Match rules", href: "/match-rules" },
      { id: "reports", label: "Reports", href: "/reports" },
    ],
  },
  {
    id: "process", label: "Process", href: "/process", shortcut: "⌘4",
    tabs: [
      { id: "map", label: "Process map", href: "/process" },
      { id: "readiness", label: "Readiness", href: "/business-process" },
      { id: "config-impact", label: "Config impact", href: "/config-impact" },
      { id: "relationships", label: "Relationships & patterns", href: "/relationships" },
    ],
  },
  {
    id: "admin", label: "Admin", href: "/admin", shortcut: "⌘5",
    tabs: [
      { id: "users", label: "Users & audit", href: "/admin" },
      { id: "settings", label: "Settings", href: "/settings" },
      { id: "scoring", label: "Scoring & alerts", href: "/settings/scoring", anyOf: ["view"] },
      { id: "rules", label: "Rules", href: "/settings/rules" },
      { id: "field-mapping", label: "Field mapping", href: "/settings/field-mapping" },
      { id: "ai", label: "AI", href: "/settings/ai" },
      { id: "licence", label: "Licence", href: "/settings/licence" },
      { id: "contracts", label: "Contracts", href: "/contracts" },
    ],
  },
];

export const HUB_ROUTES: ReadonlySet<string> = new Set(WORKSPACES.map((w) => w.href).concat("/command-centre"));

/** Non-hub pages built on Aurora — rendered on the canvas, not in the light sheet. */
export const AURORA_PAGES: readonly string[] = ["/workbench/report"];

/** Where each role lands after sign-in — the workspace built for their job. */
export const LANDING: Readonly<Record<Role, string>> = {
  admin: "/", manager: "/", viewer: "/", auditor: "/",
  analyst: "/data",
  steward: "/workbench", approver: "/workbench", ai_reviewer: "/workbench",
};

const NAV_BY_HREF = new Map(flattenNav(NAV_GROUPS.flatMap((g) => g.items)).map((i) => [i.href, i]));

export function isTabVisible(tab: WorkspaceTab, gate: NavGate): boolean {
  const nav = NAV_BY_HREF.get(tab.href);
  if (nav?.licenceKey && !gate.isMenuItemEnabled(nav.licenceKey)) return false;
  return allowed(tab.anyOf ?? nav?.anyOf, gate.can);
}

/** Workspaces with the tabs this user may open; a workspace with none is dropped. */
export function visibleWorkspaces(gate: NavGate): Workspace[] {
  return WORKSPACES.map((w) => ({ ...w, tabs: w.tabs.filter((t) => isTabVisible(t, gate)) }))
    .filter((w) => w.tabs.length > 0 && (w.id !== "admin" || allowed([...SETTINGS_PERMISSIONS, "manage_users"], gate.can)));
}

/** The workspace (and tab) a pathname belongs to, for the rail highlight and breadcrumb. */
export function locate(pathname: string): { workspace: Workspace; tab?: WorkspaceTab } | null {
  for (const w of WORKSPACES) {
    const tab = w.tabs.find((t) => t.href === pathname) ??
      w.tabs.find((t) => t.href !== "/" && pathname.startsWith(t.href + "/"));
    if (tab || w.href === pathname) return { workspace: w, tab };
  }
  return null;
}

/**
 * The workspaces, in the order work happens: connect SAP and load data,
 * analyse it, fix what the analysis found, then see the process impact.
 * Each tab is a page the product already has (its legacy route stays live
 * for deep links); role and licence gating comes from the matching nav entry
 * in lib/nav.ts, so a tab is never shown here and hidden there. Pages without
 * a nav entry carry their own `anyOf`.
 *
 *   ⌘1 Home            — where things stand
 *   ⌘2 Connect and load  — systems, extractions, imports
 *   ⌘3 Analyse         — findings and the runs behind them
 *   ⌘4 Fix             — work the records
 *   ⌘5 Process         — process and configuration impact
 *   ⌘6 Admin           — users, rules, reference setup, licence
 */
import type { Role } from "@/hooks/use-role";
import { allowed, flattenNav, NAV_GROUPS, SETTINGS_PERMISSIONS, type NavGate } from "@/lib/nav";

export type WorkspaceId = "command-centre" | "data" | "analyse" | "workbench" | "process" | "admin";

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
  /** One line under the label in the sidebar: what you do here. */
  hint: string;
  href: string;
  shortcut: string;
  tabs: readonly WorkspaceTab[];
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id: "command-centre", label: "Home", hint: "Where things stand", href: "/", shortcut: "⌘1",
    tabs: [
      { id: "overview", label: "Overview", href: "/" },
      { id: "report", label: "Executive report", href: "/executive-report" },
      { id: "live", label: "Live activity", href: "/command-centre" },
      { id: "notifications", label: "Notifications", href: "/notifications" },
    ],
  },
  {
    id: "data", label: "Connect and load", hint: "Bring SAP data in", href: "/data", shortcut: "⌘2",
    tabs: [
      { id: "systems", label: "Systems", href: "/systems" },
      { id: "runs", label: "Jobs", href: "/sync" },
      { id: "import", label: "Import files", href: "/upload" },
      { id: "migration", label: "Migration", href: "/migration" },
    ],
  },
  {
    id: "analyse", label: "Analyse", hint: "See what is wrong", href: "/analyse", shortcut: "⌘3",
    tabs: [
      { id: "findings", label: "Findings", href: "/findings" },
      { id: "records", label: "Failing records", href: "/issues" },
      { id: "analyses", label: "Analysis runs", href: "/versions" },
      { id: "reports", label: "Reports", href: "/reports" },
      { id: "finding", label: "Finding", href: "/analyse/finding", hidden: true },
      { id: "object", label: "Object", href: "/analyse/object", hidden: true },
    ],
  },
  {
    id: "workbench", label: "Fix", hint: "Work the records", href: "/workbench", shortcut: "⌘4",
    tabs: [
      { id: "queue", label: "Steward inbox", href: "/workbench" },
      { id: "my-queue", label: "My queue", href: "/workbench/triage" },
      { id: "progress", label: "Progress", href: "/workbench/progress", anyOf: ["approve", "apply", "assign"] },
      { id: "record", label: "Record report", href: "/workbench/record", hidden: true },
      { id: "dedup", label: "Duplicates", href: "/dedup" },
      { id: "cleaning", label: "Cleaning", href: "/cleaning" },
      { id: "exceptions", label: "Exceptions", href: "/exceptions" },
      { id: "golden", label: "Golden records", href: "/golden-records" },
      { id: "ai-rules", label: "AI rule review", href: "/ai/rules" },
      { id: "glossary", label: "Glossary", href: "/glossary" },
    ],
  },
  {
    id: "process", label: "Process", hint: "Impact on SAP processes", href: "/process", shortcut: "⌘5",
    tabs: [
      { id: "map", label: "Process map", href: "/process" },
      { id: "readiness", label: "Readiness", href: "/business-process" },
      { id: "lineage", label: "Lineage", href: "/lineage" },
      { id: "relationships", label: "Relationships", href: "/relationships" },
    ],
  },
  {
    id: "admin", label: "Admin", hint: "Users, rules, licence", href: "/admin", shortcut: "⌘6",
    tabs: [
      { id: "users", label: "Users and audit", href: "/admin" },
      { id: "settings", label: "Settings", href: "/settings" },
      { id: "rules", label: "Check rules", href: "/settings/rules" },
      { id: "scoring", label: "Scoring and alerts", href: "/settings/scoring", anyOf: ["view"] },
      { id: "triage", label: "Triage routing", href: "/admin/triage" },
      { id: "exception-rules", label: "Exception rules", href: "/exceptions/rules", anyOf: ["approve", "assign", "manage_rules"] },
      { id: "match-rules", label: "Match rules", href: "/match-rules" },
      { id: "field-mapping", label: "Field mapping", href: "/settings/field-mapping" },
      { id: "ai", label: "AI", href: "/settings/ai" },
      { id: "contracts", label: "Data contracts", href: "/contracts" },
      { id: "licence", label: "Licence", href: "/settings/licence" },
      { id: "exception-billing", label: "Exception billing", href: "/settings/exception-billing", anyOf: ["view"] },
    ],
  },
];

/** The hub URL that shows a tab: the workspace route, plus ?tab= past the first tab. */
export function tabHref(w: Workspace, t: WorkspaceTab): string {
  return t.id === w.tabs.find((x) => !x.hidden)?.id ? w.href : `${w.href}?tab=${t.id}`;
}

export const HUB_ROUTES: ReadonlySet<string> = new Set(WORKSPACES.map((w) => w.href).concat("/command-centre"));

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

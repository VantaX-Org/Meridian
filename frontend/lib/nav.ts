/**
 * Single navigation definition for the sidebar, the ⌘K command palette and
 * the header page titles. Both surfaces filter it with `visibleNav()`, so a
 * role or licence never sees a page in one place and not the other.
 *
 * Ten sections, each href appearing exactly once (enforced by a Rail test).
 * `children` collapse under their parent and only render expanded, or in
 * the collapsed flyout and tooltip. Routes removed from the nav stay
 * routable — their titles live in `OFF_NAV_TITLES` or come from the
 * surviving entry for the same href.
 *
 * Gating (`anyOf`) uses the permission names from api/services/rbac.py; the
 * API enforces the same names, so hiding an item only removes a dead end.
 * Every item also carries `requires`, a (resource, action) pair checked
 * against /me/permissions.resources (rbac.md §5); an item shows only when
 * both pass. Each `requires` is a pair every legacy role holding the item's
 * `anyOf` also holds, so legacy roles see the same nav as before (proved by
 * nav-identity.test.ts); the pair only narrows custom and persona roles.
 */
import type { CSSProperties, JSX } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ChevronRight,
  Eraser,
  History,
  Home,
  Inbox as InboxIcon,
  ListChecks,
  ShieldAlert,
  Sliders,
  UserCog,
  Workflow,
} from "lucide-react";
import {
  BookIcon,
  ContractIcon,
  DatabaseIcon,
  ServerIcon,
  SettingsIcon,
  UploadIcon,
} from "@/components/meridian/nav-icons";
import type { Role } from "@/hooks/use-role";
import { homeHrefForRole } from "@/lib/persona";

export { homeHrefForRole };

export type NavIcon =
  | LucideIcon
  | ((props: { size?: number; className?: string; style?: CSSProperties }) => JSX.Element);

/** A (resource, action) pair from rbac.py RESOURCES × ACTIONS. */
export interface Requirement {
  resource: string;
  action: string;
}

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Shown only when /me/permissions.resources grants this pair, or one of these pairs (and `anyOf` passes). */
  requires: Requirement | readonly Requirement[];
  /** Shown when the user holds at least one of these permissions. */
  anyOf?: readonly string[];
  /** Licence manifest menu key (enabled_menu_items). */
  licenceKey?: string;
  /** Extra words the command palette matches on. */
  keywords?: string;
  shortcut?: string;
  /** Key into the shell-counts response (`getShellCounts`) for this item's live badge count. */
  badgeKey?: "fix" | "inbox";
  /** Sub-pages collapsed under this item. */
  children?: readonly NavItem[];
  /** Other paths this item stays highlighted for (tabs of a view that are not nav entries of their own). */
  aliases?: readonly string[];
}

export interface NavGroup {
  group: string;
  /** Hide the whole group unless the user holds one of these permissions. */
  anyOf?: readonly string[];
  /** Hide the whole group unless /me/permissions grants one of these pairs. */
  requiresAny?: readonly Requirement[];
  items: readonly NavItem[];
}

const req = (resource: string, action: string): Requirement => ({ resource, action });

/** Any permission that opens at least one settings page or admin tool. */
export const SETTINGS_PERMISSIONS = [
  "manage_rules",
  "manage_field_mappings",
  "manage_llm",
  "manage_settings",
  "manage_system",
] as const;

export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: "/admin/triage", requires: req("rules", "edit"), label: "Triage", icon: ChevronRight, anyOf: ["manage_rules", "manage_settings"], keywords: "teams assignment rules sla business hours holidays" },
  { href: "/admin/mappings", requires: req("extraction", "edit"), label: "Field mapping", icon: ChevronRight, anyOf: ["manage_field_mappings"], licenceKey: "field_mapping", keywords: "sap fields columns" },
  { href: "/admin/ai", requires: req("llm", "admin"), label: "AI settings", icon: ChevronRight, anyOf: ["manage_llm"], keywords: "ollama model provider llm" },
  // rules/edit is here only so the legacy steward keeps Settings › Licence: no legacy role is granted
  // licence/view (it is in NO_VIEW), and the steward reaches Settings through manage_rules alone.
  { href: "/admin/notifications", requires: req("rules", "admin"), label: "Notifications", icon: ChevronRight, anyOf: ["manage_settings"], keywords: "alerts channels slack teams email webhook digest" },
  { href: "/admin/jobs", requires: req("analysis", "view"), label: "Jobs", icon: ChevronRight, anyOf: ["view"], keywords: "history extraction analysis uploads running failed" },
  { href: "/admin/reference", requires: req("systems", "view"), label: "Reference data", icon: ChevronRight, anyOf: ["view"], keywords: "postal codes bic directory lists" },
  { href: "/admin/licence", requires: [req("licence", "view"), req("licence", "admin"), req("rules", "edit")], label: "Licence", icon: ChevronRight, anyOf: ["view"], licenceKey: "licence", keywords: "seats modules tier" },
];

/**
 * A nav item's href, with `/home/*` resolved to the viewer's own persona
 * page. Every surface that renders a nav href (Rail, the command palette,
 * sign-in's post-login redirect) must call this instead of re-deriving the
 * `/home/` check itself — that duplication is how the three surfaces drifted.
 */
export function resolveNavHref(href: string, role: Role): string {
  return href.startsWith("/home/") ? homeHrefForRole(role) : href;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    group: "Home",
    items: [
      { href: "/home/lead", requires: req("analysis", "view"), label: "Home", icon: Home, licenceKey: "dashboard", keywords: "overview home dqs verdict command centre", shortcut: "⌘1" },
    ],
  },
  {
    group: "Systems",
    items: [
      { href: "/systems", requires: req("systems", "view"), label: "Systems", icon: ServerIcon, keywords: "sap connect ecc s4hana discover objects health sync jobs download history schedule" },
      { href: "/import", requires: req("extraction", "create"), label: "Import file", icon: UploadIcon, licenceKey: "import", anyOf: ["upload"], keywords: "upload load data file csv xlsx" },
      { href: "/migration", requires: req("analysis", "run"), label: "Migration", icon: ArrowLeftRight, anyOf: ["analyse"], keywords: "source destination transfer wave cutover readiness" },
    ],
  },
  {
    group: "Objects",
    items: [
      { href: "/objects", requires: req("findings", "view"), label: "Objects", icon: Boxes, licenceKey: "findings", keywords: "checks critical severity findings" },
    ],
  },
  {
    group: "Runs",
    items: [
      { href: "/runs", requires: req("analysis", "view"), label: "Runs", icon: History, licenceKey: "versions", keywords: "compare history snapshots baseline" },
    ],
  },
  {
    group: "Fix",
    anyOf: ["approve", "apply"],
    items: [
      { href: "/fix", requires: req("fixes", "view"), label: "Fix", icon: Eraser, anyOf: ["approve", "apply"], badgeKey: "fix", keywords: "cleaning corrections proposals apply batches",
        children: [
          { href: "/fix/what-if", requires: req("fixes", "view"), label: "What-if", icon: Eraser, anyOf: ["approve", "apply"], keywords: "simulation simulate score before after" },
        ],
      },
    ],
  },
  {
    group: "Inbox",
    anyOf: ["view"],
    items: [
      {
        href: "/inbox",
        requires: req("stewardship", "view"),
        label: "Inbox",
        icon: InboxIcon,
        licenceKey: "findings",
        anyOf: ["view"],
        badgeKey: "inbox",
        keywords: "workbench queue triage tasks stewardship steward team assign sla metrics failing records issues",
        children: [
          { href: "/inbox?kind=exception", requires: req("stewardship", "view"), label: "Exceptions", icon: ShieldAlert, anyOf: ["approve", "assign"], keywords: "escalate sla exception" },
        ],
      },
    ],
  },
  {
    group: "Insights",
    anyOf: ["view"],
    items: [
      {
        href: "/insights",
        requires: req("reports", "view"),
        label: "Insights",
        icon: BarChart3,
        keywords: "readiness impact owners duplicates executive summary forecast process lineage mining",
        children: [
          { href: "/insights/exec", requires: req("reports", "view"), label: "Summary", icon: BarChart3, keywords: "executive summary exec overview narrative board pack reports pdf", aliases: ["/insights/reports"] },
          { href: "/insights/progress", requires: req("reports", "view"), label: "Progress", icon: BarChart3, keywords: "baseline compare movement fixed new trends history forecast predictive", aliases: ["/insights/trends", "/insights/forecast"] },
          { href: "/insights/rules", requires: req("reports", "view"), label: "Explore", icon: BarChart3, keywords: "rule ranking failing impact pareto root cause field value at risk lineage patterns mining duplicates", aliases: ["/insights/impact", "/insights/lineage", "/insights/mining", "/insights/duplicates"] },
          { href: "/insights/readiness", requires: req("reports", "view"), label: "Readiness", icon: BarChart3, keywords: "waves go no-go blockers process l1 l5 ptp otc migration", aliases: ["/insights/process"] },
          { href: "/insights/owners", requires: req("reports", "view"), label: "Operate", icon: BarChart3, keywords: "owners digest steward operations sprints bottlenecks capacity runs fix queue", aliases: ["/insights/operations"] },
        ],
      },
    ],
  },
  {
    group: "Process",
    anyOf: ["view"],
    items: [
      { href: "/process", requires: req("process", "view"), label: "As-is processes", icon: Workflow, keywords: "process discovery mining as-is l1 l5 variants conformance signavio bpmn" },
      { href: "/process/runs", requires: req("process", "view"), label: "Discovery runs", icon: History, keywords: "process discovery run incremental extraction" },
    ],
  },
  {
    group: "MDM",
    items: [
      { href: "/mdm", requires: req("mdm", "view"), label: "Overview", icon: DatabaseIcon, keywords: "mdm health score trend" },
      { href: "/mdm/survivorship", requires: req("mdm", "view"), label: "Survivorship", icon: Sliders, keywords: "survivorship rules golden source precedence" },
      { href: "/mdm/golden", requires: req("mdm", "view"), label: "Golden records", icon: DatabaseIcon, keywords: "master mdm" },
      { href: "/mdm/glossary", requires: req("glossary", "view"), label: "Glossary", icon: BookIcon, keywords: "terms business" },
      { href: "/mdm/match-rules", requires: req("mdm", "view"), label: "Match rules", icon: Sliders, keywords: "tuning constraints" },
    ],
  },
  {
    group: "Rules",
    items: [
      {
        href: "/rules",
        requires: req("rules", "view"),
        label: "Rules",
        icon: ListChecks,
        keywords: "rules checks catalogue yaml contracts scoring alerts",
        children: [
          { href: "/rules/contracts", requires: req("contracts", "view"), label: "Contracts", icon: ContractIcon, licenceKey: "contracts", keywords: "data contracts sla" },
          { href: "/rules/drafts", requires: req("rules", "edit"), label: "Drafts", icon: ListChecks, anyOf: ["manage_rules"], keywords: "rule authoring draft" },
          { href: "/rules/dictionary", requires: req("rules", "view"), label: "Data dictionary", icon: BookIcon, anyOf: ["view"], keywords: "ddic fields dictionary" },
          { href: "/rules/scoring", requires: req("rules", "view"), label: "Scoring and alerts", icon: Sliders, anyOf: ["view"], keywords: "weights thresholds" },
        ],
      },
    ],
  },
  {
    group: "Admin",
    // rbac.md §5: users ★ | llm ★ | licence V | audit V.
    // rules/edit keeps the legacy steward's Admin › Settings nav.
    requiresAny: [req("users", "admin"), req("llm", "admin"), req("licence", "view"), req("audit", "view"), req("rules", "edit")],
    items: [
      { href: "/admin/users", requires: req("users", "admin"), label: "Users and audit", icon: UserCog, anyOf: ["manage_users"], keywords: "admin users roles audit" },
      { href: "/admin/audit", requires: [req("audit", "view"), req("users", "admin")], label: "Audit log", icon: UserCog, anyOf: ["view_audit", "manage_users"], keywords: "audit log ai decisions role changes" },
      { href: "/admin/settings", requires: req("rules", "view"), label: "Settings", icon: SettingsIcon, anyOf: SETTINGS_PERMISSIONS, keywords: "preferences config", children: SETTINGS_ITEMS },
    ],
  },
];

/** Header titles for routes that are not in the nav. */
const OFF_NAV_TITLES: Record<string, string> = {
  "/command-centre": "Live operations",
  "/executive-report": "Executive report",
  "/data": "Connect and load",
  "/admin/billing": "Exception billing",
  "/admin/roles": "Roles and access",
  "/design": "Design library",
  "/workbench/record": "Record report",
  "/workbench/progress": "Progress",
  "/workbench/triage": "My queue",
  "/search": "Search",
  "/docs": "Documentation",
  "/me/preferences": "Preferences",
  "/inbox/notifications": "Notifications",
  // Insight views carry short rail labels; the pages keep their full titles.
  "/insights/exec": "Executive summary",
  "/insights/progress": "Progress",
  "/insights/trends": "Trends",
  "/insights/forecast": "Forecast",
  "/insights/rules": "Explore",
  "/insights/impact": "Value at risk",
  "/insights/lineage": "Lineage and impact",
  "/insights/mining": "Pattern mining",
  "/insights/duplicates": "Duplicate clusters",
  "/insights/readiness": "Readiness",
  "/insights/process": "Process readiness",
  "/insights/process/designer": "Process designer",
  "/insights/owners": "Owner scorecards",
  "/insights/operations": "Operations",
  "/insights/reports": "Report library",
};

/** Items and their sub-pages (Settings tabs, Insights sections, Inbox exceptions) as one flat list. */
export function flattenNav(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flattenNav(i.children ?? [])]);
}

/**
 * Route → title, from the nav labels so the header never drifts from them.
 * First-match-wins: hrefs are unique now, so this is just the labels as given.
 */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  ...flattenNav(NAV_GROUPS.flatMap((g) => g.items)).reduce<Record<string, string>>((acc, i) => {
    const [path] = i.href.split("?");
    if (path && !(path in acc)) acc[path] = i.label;
    return acc;
  }, {}),
  ...OFF_NAV_TITLES,
};

/** Title for a pathname: exact match, else the longest matching parent route. */
export function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/home/")) return "Home";
  const parent = Object.keys(PAGE_TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return parent ? PAGE_TITLES[parent] : "Meridian";
}

export interface NavGate {
  can: (permission: string) => boolean;
  isMenuItemEnabled: (key: string) => boolean;
  /** /me/permissions.resources check; when absent (anyOf-only callers) `requires` is not checked. */
  has?: (resource: string, action: string) => boolean;
}

/** True when the user holds one of `anyOf` (or nothing is required). */
export function allowed(anyOf: readonly string[] | undefined, can: NavGate["can"]): boolean {
  return !anyOf || anyOf.some((p) => can(p));
}

export function isItemVisible(item: NavItem, gate: NavGate): boolean {
  if (item.licenceKey && !gate.isMenuItemEnabled(item.licenceKey)) return false;
  const has = gate.has;
  if (has && ![item.requires].flat().some((r) => has(r.resource, r.action))) return false;
  return allowed(item.anyOf, gate.can);
}

function filterItems(items: readonly NavItem[], gate: NavGate): NavItem[] {
  return items
    .filter((i) => isItemVisible(i, gate))
    .map((i) => (i.children ? { ...i, children: filterItems(i.children, gate) } : i));
}

/** The nav as this user may see it: role and licence filters, empty groups dropped. */
export function visibleNav(gate: NavGate): NavGroup[] {
  const has = gate.has;
  return NAV_GROUPS.filter((g) => allowed(g.anyOf, gate.can))
    .filter((g) => !has || !g.requiresAny || g.requiresAny.some((r) => has(r.resource, r.action)))
    .map((g) => ({ ...g, items: filterItems(g.items, gate) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The single active item's href for a pathname + query string, from a flat
 * (already-visible) item list. See brief section 2.3:
 * 1. Flatten items and children (caller does this — `items` here is flat).
 * 2. Candidates: path part equals pathname, or is a prefix followed by "/".
 * 3. An item with a query wins only when every one of its query pairs is
 *    present in `search`; otherwise it's dropped.
 * 4. Among the rest, the longest path wins; ties favour the one with a query.
 * 5. `/home/*` always resolves to the Home item, whichever persona page.
 */
export function activeHref(pathname: string, search: URLSearchParams, items: readonly NavItem[]): string | null {
  if (pathname.startsWith("/home/")) {
    const home = items.find((i) => i.href.startsWith("/home/"));
    if (home) return home.href;
  }

  type Candidate = { href: string; path: string; queryLen: number };
  const candidates: Candidate[] = [];

  for (const item of items) {
    const [path, query] = item.href.split("?");
    if (!path) continue;
    const pathMatches = [path, ...(item.aliases ?? [])].some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (!pathMatches) continue;

    if (query) {
      const pairs = new URLSearchParams(query);
      const allPresent = [...pairs.entries()].every(([k, v]) => search.get(k) === v);
      if (!allPresent) continue;
      candidates.push({ href: item.href, path, queryLen: [...pairs.entries()].length });
    } else {
      candidates.push({ href: item.href, path, queryLen: 0 });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.path.length - a.path.length || b.queryLen - a.queryLen);
  return candidates[0]!.href;
}

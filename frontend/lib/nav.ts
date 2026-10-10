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
 */
import type { CSSProperties, JSX } from "react";
import type { LucideIcon } from "lucide-react";
import {
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

export type NavIcon =
  | LucideIcon
  | ((props: { size?: number; className?: string; style?: CSSProperties }) => JSX.Element);

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
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
}

export interface NavGroup {
  group: string;
  /** Hide the whole group unless the user holds one of these permissions. */
  anyOf?: readonly string[];
  items: readonly NavItem[];
}

/** Any permission that opens at least one settings page or admin tool. */
export const SETTINGS_PERMISSIONS = [
  "manage_rules",
  "manage_field_mappings",
  "manage_llm",
  "manage_settings",
  "manage_system",
] as const;

export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: "/admin/triage", label: "Triage", icon: ChevronRight, anyOf: ["manage_rules", "manage_settings"], keywords: "teams assignment rules sla business hours holidays" },
  { href: "/admin/mappings", label: "Field mapping", icon: ChevronRight, anyOf: ["manage_field_mappings"], licenceKey: "field_mapping", keywords: "sap fields columns" },
  { href: "/admin/ai", label: "AI settings", icon: ChevronRight, anyOf: ["manage_llm"], keywords: "ollama model provider llm" },
  { href: "/admin/licence", label: "Licence", icon: ChevronRight, anyOf: ["view"], licenceKey: "licence", keywords: "seats modules tier" },
];

/** The home route for this role's persona. Steward gets its own page; every
 * other role (including ones with no dedicated persona page) falls back to
 * lead, not basis — there is no "basis" role. */
export function homeHrefForRole(role: Role): string {
  if (role === "steward") return "/home/steward";
  return "/home/lead";
}

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
      { href: "/home/lead", label: "Home", icon: Home, licenceKey: "dashboard", keywords: "overview home dqs verdict command centre", shortcut: "⌘1" },
    ],
  },
  {
    group: "Systems",
    items: [
      { href: "/systems", label: "Systems", icon: ServerIcon, keywords: "sap connect ecc s4hana discover objects health" },
      { href: "/import", label: "Import file", icon: UploadIcon, licenceKey: "import", anyOf: ["upload"], keywords: "upload load data file csv xlsx" },
    ],
  },
  {
    group: "Objects",
    items: [
      { href: "/objects", label: "Objects", icon: Boxes, licenceKey: "findings", keywords: "checks critical severity findings" },
    ],
  },
  {
    group: "Runs",
    items: [
      { href: "/runs", label: "Runs", icon: History, licenceKey: "versions", keywords: "compare history snapshots baseline" },
    ],
  },
  {
    group: "Fix",
    anyOf: ["approve", "apply"],
    items: [
      { href: "/fix", label: "Fix", icon: Eraser, anyOf: ["approve", "apply"], badgeKey: "fix", keywords: "cleaning corrections proposals apply batches" },
    ],
  },
  {
    group: "Inbox",
    anyOf: ["view"],
    items: [
      {
        href: "/inbox",
        label: "Inbox",
        icon: InboxIcon,
        licenceKey: "findings",
        anyOf: ["view"],
        badgeKey: "inbox",
        keywords: "workbench queue triage tasks stewardship steward team assign sla metrics failing records issues",
        children: [
          { href: "/inbox?kind=exception", label: "Exceptions", icon: ShieldAlert, anyOf: ["approve", "assign"], keywords: "escalate sla exception" },
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
        label: "Insights",
        icon: BarChart3,
        keywords: "readiness impact owners duplicates executive summary forecast process lineage mining",
        children: [
          { href: "/insights/readiness", label: "Readiness", icon: BarChart3, keywords: "waves go no-go blockers" },
          { href: "/insights/impact", label: "Value at risk", icon: BarChart3, keywords: "impact features cost" },
          { href: "/insights/owners", label: "Owner scorecards", icon: BarChart3, keywords: "digest score steward" },
          { href: "/insights/duplicates", label: "Duplicate clusters", icon: BarChart3, keywords: "dedup merge graph cluster" },
          { href: "/insights/exec", label: "Executive summary", icon: BarChart3, keywords: "exec report narrative pdf" },
          { href: "/insights/forecast", label: "Forecast", icon: BarChart3, keywords: "predictive dqs forecast" },
          { href: "/insights/process", label: "Process readiness", icon: BarChart3, keywords: "l1 l5 business process ptp otc process map" },
          { href: "/insights/process/designer", label: "Process designer", icon: BarChart3, keywords: "designer bpmn model edit l1 l5" },
          { href: "/insights/lineage", label: "Lineage and impact", icon: BarChart3, keywords: "lineage downstream kpi blast radius guards" },
          { href: "/insights/mining", label: "Pattern mining", icon: BarChart3, keywords: "patterns clustering relationships graph" },
        ],
      },
    ],
  },
  {
    group: "MDM",
    items: [
      { href: "/mdm/golden", label: "Golden records", icon: DatabaseIcon, keywords: "master mdm" },
      { href: "/mdm/glossary", label: "Glossary", icon: BookIcon, keywords: "terms business" },
      { href: "/mdm/match-rules", label: "Match rules", icon: Sliders, keywords: "tuning constraints" },
    ],
  },
  {
    group: "Rules",
    items: [
      {
        href: "/rules",
        label: "Rules",
        icon: ListChecks,
        keywords: "rules checks catalogue yaml contracts scoring alerts",
        children: [
          { href: "/rules/contracts", label: "Contracts", icon: ContractIcon, licenceKey: "contracts", keywords: "data contracts sla" },
          { href: "/rules/scoring", label: "Scoring and alerts", icon: Sliders, anyOf: ["view"], keywords: "weights thresholds" },
        ],
      },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/admin/users", label: "Users and audit", icon: UserCog, anyOf: ["manage_users"], keywords: "admin users roles audit" },
      { href: "/admin/settings", label: "Settings", icon: SettingsIcon, anyOf: SETTINGS_PERMISSIONS, keywords: "preferences config", children: SETTINGS_ITEMS },
    ],
  },
];

/** Header titles for routes that are not in the nav. */
const OFF_NAV_TITLES: Record<string, string> = {
  "/command-centre": "Live operations",
  "/executive-report": "Executive report",
  "/data": "Connect and load",
  "/admin/billing": "Exception billing",
  "/workbench/record": "Record report",
  "/workbench/progress": "Progress",
  "/workbench/triage": "My queue",
  "/search": "Search",
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
}

/** True when the user holds one of `anyOf` (or nothing is required). */
export function allowed(anyOf: readonly string[] | undefined, can: NavGate["can"]): boolean {
  return !anyOf || anyOf.some((p) => can(p));
}

export function isItemVisible(item: NavItem, gate: NavGate): boolean {
  if (item.licenceKey && !gate.isMenuItemEnabled(item.licenceKey)) return false;
  return allowed(item.anyOf, gate.can);
}

function filterItems(items: readonly NavItem[], gate: NavGate): NavItem[] {
  return items
    .filter((i) => isItemVisible(i, gate))
    .map((i) => (i.children ? { ...i, children: filterItems(i.children, gate) } : i));
}

/** The nav as this user may see it: role and licence filters, empty groups dropped. */
export function visibleNav(gate: NavGate): NavGroup[] {
  return NAV_GROUPS.filter((g) => allowed(g.anyOf, gate.can))
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
    const pathMatches = pathname === path || pathname.startsWith(path + "/");
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

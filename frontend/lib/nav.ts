/**
 * Single navigation definition for the sidebar, the ⌘K command palette and
 * the header page titles. Both surfaces filter it with `visibleNav()`, so a
 * role or licence never sees a page in one place and not the other.
 *
 * Groups follow the user's job, in journey order: connect a system, review
 * quality, fix, govern master data, understand process impact, report, admin.
 * Routes never change here — only labels, grouping and gating.
 *
 * Gating (`anyOf`) uses the permission names from api/services/rbac.py; the
 * API enforces the same names, so hiding an item only removes a dead end.
 * Pages left out of the nav (/command-centre,
 * /notifications) stay routable and are linked from
 * the pages that own them.
 */
import type { CSSProperties, JSX } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Brain,
  Copy,
  Eraser,
  Key,
  ListX,
  Map as MapIcon,
  Network,
  Pickaxe,
  Route,
  ShieldAlert,
  Sliders,
  Timer,
  UserCog,
} from "lucide-react";
import {
  BookIcon,
  ClipboardIcon,
  ContractIcon,
  DatabaseIcon,
  FileTextIcon,
  GitCompareIcon,
  LayoutDashIcon,
  RefreshIcon,
  ServerIcon,
  SettingsIcon,
  SparklesNavIcon,
  UploadIcon,
  AlertIcon,
} from "@/components/meridian/nav-icons";

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
  badge?: number;
  /** Sub-pages shown beneath the item (Settings). */
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
  { href: "/admin/triage", label: "Triage", icon: Timer, anyOf: ["manage_rules", "manage_settings"], keywords: "teams assignment rules sla business hours holidays" },
  { href: "/admin/mappings", label: "Field mapping", icon: MapIcon, anyOf: ["manage_field_mappings"], licenceKey: "field_mapping", keywords: "sap fields columns" },
  { href: "/admin/ai", label: "AI settings", icon: Brain, anyOf: ["manage_llm"], keywords: "ollama model provider llm" },
  { href: "/admin/licence", label: "Licence", icon: Key, anyOf: ["view"], licenceKey: "licence", keywords: "seats modules tier" },
];

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/home/lead", label: "Command Centre", icon: LayoutDashIcon, licenceKey: "dashboard", keywords: "overview home dqs verdict", shortcut: "⌘1" },
    ],
  },
  {
    group: "Systems and data",
    items: [
      { href: "/systems", label: "Systems", icon: ServerIcon, keywords: "sap connect ecc s4hana discover objects" },
      { href: "/import", label: "Import file", icon: UploadIcon, licenceKey: "import", anyOf: ["upload"], keywords: "upload load data file csv xlsx" },
      { href: "/systems", label: "Download history", icon: RefreshIcon, anyOf: ["trigger_sync"], keywords: "sync jobs monitor schedule" },
      { href: "/insights/readiness", label: "Migration", icon: ArrowLeftRight, anyOf: ["analyse"], keywords: "source destination transfer" },
    ],
  },
  {
    group: "Quality",
    items: [
      { href: "/objects", label: "Findings", icon: AlertIcon, licenceKey: "findings", keywords: "checks critical severity" },
      { href: "/inbox", label: "Failing records", icon: ListX, licenceKey: "findings", keywords: "issues records work list assign" },
      { href: "/runs", label: "Runs", icon: GitCompareIcon, licenceKey: "versions", keywords: "compare history snapshots baseline" },
    ],
  },
  {
    group: "Insights",
    anyOf: ["view"],
    items: [
      { href: "/insights", label: "Insights", icon: BarChart3, anyOf: ["view"], keywords: "readiness impact owners duplicates executive summary" },
      { href: "/insights/readiness", label: "Readiness", icon: BarChart3, anyOf: ["view"], keywords: "waves go no-go blockers" },
      { href: "/insights/impact", label: "Value at risk", icon: BarChart3, anyOf: ["view"], keywords: "impact features cost" },
      { href: "/insights/owners", label: "Owner scorecards", icon: BarChart3, anyOf: ["view"], keywords: "digest score steward" },
      { href: "/insights/duplicates", label: "Duplicate clusters", icon: BarChart3, anyOf: ["view"], keywords: "dedup merge graph cluster" },
      { href: "/insights/exec", label: "Executive summary", icon: BarChart3, anyOf: ["view"], keywords: "exec report narrative pdf" },
    ],
  },
  {
    group: "Fix",
    anyOf: ["approve", "apply", "assign", "mdm.write", "review_ai_rules"],
    items: [
      { href: "/inbox", label: "Steward inbox", icon: ClipboardIcon, licenceKey: "stewardship", anyOf: ["approve", "apply", "assign"], keywords: "workbench queue triage tasks stewardship steward team assign sla metrics" },
      { href: "/fix", label: "Cleaning", icon: Eraser, anyOf: ["approve", "apply"], keywords: "corrections proposals apply" },
      { href: "/inbox?kind=exception", label: "Exceptions", icon: ShieldAlert, anyOf: ["approve", "assign"], keywords: "escalate sla" },
      { href: "/insights/duplicates", label: "Duplicates", icon: Copy, anyOf: ["approve", "mdm.write"], keywords: "dedup merge match" },
      { href: "/rules", label: "AI rule review", icon: SparklesNavIcon, anyOf: ["review_ai_rules"], keywords: "ai rules propose" },
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
    group: "Process and impact",
    items: [
      { href: "/insights/process", label: "Process readiness", icon: Route, keywords: "l1 l5 business process ptp otc process map" },
      { href: "/insights/process/designer", label: "Process designer", icon: Route, keywords: "designer bpmn model edit l1 l5" },
      { href: "/insights/lineage", label: "Lineage and impact", icon: Network, keywords: "lineage downstream kpi blast radius guards" },
      { href: "/insights/mining", label: "Pattern mining", icon: Pickaxe, keywords: "patterns clustering relationships graph" },
    ],
  },
  {
    group: "Rules",
    items: [
      { href: "/rules", label: "Rules", icon: Sliders, keywords: "rules checks catalogue yaml" },
      { href: "/rules/contracts", label: "Contracts", icon: ContractIcon, licenceKey: "contracts", keywords: "data contracts sla" },
      { href: "/rules/scoring", label: "Scoring and alerts", icon: Sliders, anyOf: ["view"], keywords: "weights thresholds" },
    ],
  },
  {
    group: "Reports",
    items: [
      { href: "/insights", label: "Reports", icon: FileTextIcon, licenceKey: "reports", keywords: "pdf export" },
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
};

/** Items and their sub-pages (Settings tabs) as one flat list. */
export function flattenNav(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flattenNav(i.children ?? [])]);
}

/**
 * Route → title, from the nav labels so the header never drifts from them.
 * First-match-wins: some hrefs (e.g. "/systems") are shared by more than one
 * nav item, and the first one listed is the page's primary title.
 */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  ...flattenNav(NAV_GROUPS.flatMap((g) => g.items)).reduce<Record<string, string>>((acc, i) => {
    if (!(i.href in acc)) acc[i.href] = i.label;
    return acc;
  }, {}),
  ...OFF_NAV_TITLES,
};

/** Title for a pathname: exact match, else the longest matching parent route. */
export function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
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

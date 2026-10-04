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
 * Pages left out of the nav (/command-centre, /connectivity, /run-sync,
 * /notifications) stay routable and are linked from
 * the pages that own them.
 */
import type { CSSProperties, JSX } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
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
  UserCog,
  Zap,
} from "lucide-react";
import {
  AnalyticsIcon,
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
  WorkflowIcon,
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
  { href: "/settings/rules", label: "Rules engine", icon: Sliders, anyOf: ["manage_rules"], licenceKey: "rules_engine", keywords: "checks triggers schedule" },
  { href: "/settings/field-mapping", label: "Field mapping", icon: MapIcon, anyOf: ["manage_field_mappings"], licenceKey: "field_mapping", keywords: "sap fields columns" },
  { href: "/settings/ai", label: "AI settings", icon: Brain, anyOf: ["manage_llm"], keywords: "ollama model provider llm" },
  { href: "/settings/licence", label: "Licence", icon: Key, anyOf: ["view"], licenceKey: "licence", keywords: "seats modules tier" },
];

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/", label: "Command Centre", icon: LayoutDashIcon, licenceKey: "dashboard", keywords: "overview home dqs verdict", shortcut: "⌘1" },
      { href: "/analytics", label: "Analytics", icon: AnalyticsIcon, licenceKey: "analytics", keywords: "charts metrics forecast" },
    ],
  },
  {
    group: "Systems & data",
    items: [
      { href: "/systems", label: "Systems", icon: ServerIcon, keywords: "sap connect ecc s4hana discover objects" },
      { href: "/upload", label: "Import file", icon: UploadIcon, licenceKey: "import", anyOf: ["upload"], keywords: "upload load data file csv xlsx" },
      { href: "/sync", label: "Download history", icon: RefreshIcon, anyOf: ["trigger_sync"], keywords: "sync jobs monitor schedule" },
      { href: "/migration", label: "Migration", icon: ArrowLeftRight, anyOf: ["analyse"], keywords: "source destination transfer" },
    ],
  },
  {
    group: "Quality",
    items: [
      { href: "/findings", label: "Findings", icon: AlertIcon, licenceKey: "findings", keywords: "checks critical severity" },
      { href: "/issues", label: "Failing records", icon: ListX, licenceKey: "findings", keywords: "issues records work list assign" },
      { href: "/versions", label: "Compare versions", icon: GitCompareIcon, licenceKey: "versions", keywords: "history snapshots baseline" },
    ],
  },
  {
    group: "Fix",
    anyOf: ["approve", "apply", "assign", "mdm.write", "review_ai_rules"],
    items: [
      { href: "/workbench", label: "Steward inbox", icon: ClipboardIcon, licenceKey: "stewardship", anyOf: ["approve", "apply", "assign"], keywords: "workbench queue triage tasks stewardship steward team assign sla metrics" },
      { href: "/cleaning", label: "Cleaning", icon: Eraser, anyOf: ["approve", "apply"], keywords: "corrections proposals apply" },
      { href: "/exceptions", label: "Exceptions", icon: ShieldAlert, anyOf: ["approve", "assign"], keywords: "escalate sla" },
      { href: "/dedup", label: "Duplicates", icon: Copy, anyOf: ["approve", "mdm.write"], keywords: "dedup merge match" },
      { href: "/ai/rules", label: "AI rule review", icon: SparklesNavIcon, anyOf: ["review_ai_rules"], keywords: "ai rules propose" },
    ],
  },
  {
    group: "Master data",
    items: [
      { href: "/golden-records", label: "Golden records", icon: DatabaseIcon, keywords: "master mdm" },
      { href: "/glossary", label: "Glossary", icon: BookIcon, keywords: "terms business" },
      { href: "/contracts", label: "Contracts", icon: ContractIcon, licenceKey: "contracts", keywords: "data contracts sla" },
      { href: "/relationships", label: "Relationships", icon: Network, keywords: "lineage graph" },
    ],
  },
  {
    group: "Process & impact",
    items: [
      { href: "/process", label: "Process map", icon: WorkflowIcon, keywords: "process mining flow" },
      { href: "/business-process", label: "Process readiness", icon: Route, keywords: "l1 l5 business process ptp otc" },
      { href: "/config-impact", label: "Config impact", icon: Zap, keywords: "features blocked degraded" },
      { href: "/mining", label: "Pattern mining", icon: Pickaxe, keywords: "patterns clustering" },
    ],
  },
  {
    group: "Reports",
    items: [
      { href: "/reports", label: "Reports", icon: FileTextIcon, licenceKey: "reports", keywords: "pdf export" },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/admin", label: "Users & audit", icon: UserCog, anyOf: ["manage_users"], keywords: "admin users roles audit" },
      { href: "/settings", label: "Settings", icon: SettingsIcon, anyOf: SETTINGS_PERMISSIONS, keywords: "preferences config", children: SETTINGS_ITEMS },
    ],
  },
];

/** Header titles for routes that are not in the nav. */
const OFF_NAV_TITLES: Record<string, string> = {
  "/command-centre": "Live operations",
  "/executive-report": "Executive report",
  "/match-rules": "Match rules",
  "/settings/scoring": "Scoring & alerts",
  "/workbench/report": "Record report",
  "/connectivity": "Connectivity",
  "/run-sync": "Run Sync",
  "/notifications": "Notifications",
};

/** Items and their sub-pages (Settings tabs) as one flat list. */
export function flattenNav(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flattenNav(i.children ?? [])]);
}

/** Route → title, from the nav labels so the header never drifts from them. */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(flattenNav(NAV_GROUPS.flatMap((g) => g.items)).map((i) => [i.href, i.label])),
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

/**
 * Single navigation definition for the sidebar, the ⌘K command palette and
 * the header page titles. Both surfaces filter it with `visibleNav()`, so a
 * role or licence never sees a page in one place and not the other.
 *
 * Five main entries for everyone (the "Work" group: Fix work, Objects,
 * Processes, Progress, Inbox) and five "More" sections (Analysis, Master data, Rules,
 * Data in, Admin), each href appearing exactly once (enforced by nav and Rail
 * tests). `splitNav()` gives the Rail its pills and its More menu. Routes removed from the nav stay
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
import type { Icon } from "@/design/icons";
import {
  IconActivity, IconBell, IconBook, IconBranch, IconChart, IconCompass, IconContract, IconCube, IconDatabase, IconDraft,
  IconEraser, IconFlag, IconFunnel, IconGauge, IconGear, IconHistory, IconHome, IconImport, IconInbox, IconKey, IconLayers,
  IconList, IconLog, IconMapping, IconMerge, IconMigration, IconModel, IconPeople, IconProcess, IconRules, IconServer,
  IconGrid, IconShieldAlert, IconSliders, IconTrend, IconUserShield,
} from "@/design/icons";
import type { Role } from "@/hooks/use-role";
import { homeHrefForRole } from "@/lib/persona";

export { homeHrefForRole };

export type NavIcon = Icon;

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
  /** A main group: its items are the Rail's pills. Every other group is a section of the "More" menu. */
  main?: boolean;
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
  { href: "/admin/triage", requires: req("rules", "edit"), label: "Triage", icon: IconFunnel, anyOf: ["manage_rules", "manage_settings"], keywords: "teams assignment rules sla business hours holidays" },
  { href: "/admin/mappings", requires: req("extraction", "edit"), label: "Field mapping", icon: IconMapping, anyOf: ["manage_field_mappings"], licenceKey: "field_mapping", keywords: "sap fields columns" },
  { href: "/admin/ai", requires: req("llm", "admin"), label: "AI settings", icon: IconModel, anyOf: ["manage_llm"], keywords: "ollama model provider llm" },
  // rules/edit is here only so the legacy steward keeps Settings › Licence: no legacy role is granted
  // licence/view (it is in NO_VIEW), and the steward reaches Settings through manage_rules alone.
  { href: "/admin/notifications", requires: req("rules", "admin"), label: "Notifications", icon: IconBell, anyOf: ["manage_settings"], keywords: "alerts channels slack teams email webhook digest" },
  { href: "/admin/jobs", requires: req("analysis", "view"), label: "Jobs", icon: IconActivity, anyOf: ["view"], keywords: "history extraction analysis uploads running failed" },
  { href: "/admin/reference", requires: req("systems", "view"), label: "Reference data", icon: IconList, anyOf: ["view"], keywords: "postal codes bic directory lists" },
  { href: "/admin/licence", requires: [req("licence", "view"), req("licence", "admin"), req("rules", "edit")], label: "Licence", icon: IconKey, anyOf: ["view"], licenceKey: "licence", keywords: "seats modules tier" },
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

/** DESIGN.md §1.1: the index bar holds at most this many pills before More (the main group's size). */
export const MAX_PILLS = 5;

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    // The five entries everyone works from; the Rail shows them as pills (at most five: DESIGN.md §1.1). Every other
    // group sits under "More". Processes is here so every persona finds the as-is flows, not only the process analyst.
    group: "Work",
    main: true,
    items: [
      { href: "/fix", requires: req("fixes", "view"), label: "Fix work", icon: IconEraser, anyOf: ["approve", "apply"], badgeKey: "fix", keywords: "fix cleaning corrections proposals apply batches" },
      { href: "/objects", requires: req("findings", "view"), label: "Objects", icon: IconCube, licenceKey: "findings", keywords: "checks critical severity findings records" },
      // Labelled "Processes" on its pill (Rail PILL_LABEL); its page and the palette keep the full name.
      { href: "/process", requires: req("process", "view"), label: "As-is processes", icon: IconProcess, anyOf: ["view"], keywords: "processes process discovery mining as-is l1 l5 ptp otc variants conformance signavio bpmn flow" },
      { href: "/insights/progress", requires: req("reports", "view"), label: "Progress", icon: IconTrend, anyOf: ["view"], keywords: "baseline compare movement fixed new trends history forecast predictive", aliases: ["/insights/trends", "/insights/forecast"] },
      {
        href: "/inbox",
        requires: req("stewardship", "view"),
        label: "Inbox",
        icon: IconInbox,
        licenceKey: "findings",
        anyOf: ["view"],
        badgeKey: "inbox",
        keywords: "workbench queue triage tasks stewardship steward team assign sla metrics failing records issues",
        children: [
          { href: "/inbox?kind=exception", requires: req("stewardship", "view"), label: "Exceptions", icon: IconShieldAlert, anyOf: ["approve", "assign"], keywords: "escalate sla exception" },
        ],
      },
    ],
  },
  {
    group: "Analysis",
    items: [
      { href: "/home/lead", requires: req("analysis", "view"), label: "Home", icon: IconHome, licenceKey: "dashboard", keywords: "overview home dqs verdict command centre", shortcut: "⌘1" },
      {
        href: "/insights",
        requires: req("reports", "view"),
        label: "Insights",
        icon: IconChart,
        anyOf: ["view"],
        keywords: "readiness impact owners duplicates executive summary forecast process lineage mining",
        children: [
          { href: "/insights/exec", requires: req("reports", "view"), label: "Summary", icon: IconGauge, keywords: "executive summary exec overview narrative" },
          { href: "/insights/reports", requires: req("reports", "view"), label: "Reports", icon: IconLog, keywords: "reports board pack pdf excel export download share link" },
          { href: "/insights/rules", requires: req("reports", "view"), label: "Explore", icon: IconCompass, keywords: "rule ranking failing impact pareto root cause field value at risk lineage patterns mining duplicates", aliases: ["/insights/impact", "/insights/lineage", "/insights/mining", "/insights/duplicates"] },
          { href: "/insights/readiness", requires: req("reports", "view"), label: "Readiness", icon: IconFlag, keywords: "waves go no-go blockers migration cutover process readiness process data readiness", aliases: ["/insights/process"] },
          { href: "/insights/owners", requires: req("reports", "view"), label: "Operate", icon: IconPeople, keywords: "owners digest steward operations sprints bottlenecks capacity runs fix queue", aliases: ["/insights/operations"] },
        ],
      },
      { href: "/fix/what-if", requires: req("fixes", "view"), label: "What-if", icon: IconBranch, anyOf: ["approve", "apply"], keywords: "simulation simulate score before after fix" },
      { href: "/runs", requires: req("analysis", "view"), label: "Runs", icon: IconHistory, licenceKey: "versions", keywords: "compare history snapshots baseline" },
      { href: "/insights/process/designer", requires: req("process", "view"), label: "Process designer", icon: IconDraft, anyOf: ["view"], keywords: "bpmn designer model reference l1 l5 signavio export processes" },
      { href: "/process/runs", requires: req("process", "view"), label: "Discovery runs", icon: IconHistory, anyOf: ["view"], keywords: "process discovery run runs processes incremental extraction" },
    ],
  },
  {
    group: "Master data",
    items: [
      { href: "/mdm", requires: req("mdm", "view"), label: "Overview", icon: IconDatabase, keywords: "mdm master data health score trend" },
      { href: "/mdm/survivorship", requires: req("mdm", "view"), label: "Survivorship", icon: IconSliders, keywords: "survivorship rules golden source precedence" },
      { href: "/mdm/golden", requires: req("mdm", "view"), label: "Golden records", icon: IconLayers, keywords: "master mdm" },
      { href: "/mdm/golden/merge", requires: req("mdm", "view"), label: "Match review", icon: IconMerge, keywords: "duplicates match merge pairs survivor not a match" },
      { href: "/mdm/glossary", requires: req("glossary", "view"), label: "Glossary", icon: IconBook, keywords: "terms business" },
      { href: "/mdm/match-rules", requires: req("mdm", "view"), label: "Match rules", icon: IconMerge, keywords: "tuning constraints" },
    ],
  },
  {
    group: "Rules",
    items: [
      {
        href: "/rules",
        requires: req("rules", "view"),
        label: "Rules",
        icon: IconRules,
        keywords: "rules checks catalogue yaml contracts scoring alerts",
        children: [
          { href: "/rules/contracts", requires: req("contracts", "view"), label: "Data contracts", icon: IconContract, licenceKey: "contracts", keywords: "data contracts sla" },
          { href: "/rules/drafts", requires: [req("rules", "edit"), req("rules", "approve")], label: "Rule drafts", icon: IconDraft, anyOf: ["manage_rules", "review_ai_rules"], keywords: "rule authoring draft review ai proposals" },
          { href: "/rules/dictionary", requires: req("rules", "view"), label: "Dictionary", icon: IconBook, anyOf: ["view"], keywords: "ddic data dictionary fields" },
          { href: "/rules/scoring", requires: req("rules", "view"), label: "Scoring and alerts", icon: IconSliders, anyOf: ["view"], keywords: "weights thresholds" },
          { href: "/rules/learned", requires: req("rules", "view"), label: "Learned rules", icon: IconRules, anyOf: ["view"], keywords: "learned mined proposed rules patterns approve reject" },
        ],
      },
    ],
  },
  {
    group: "Data in",
    items: [
      { href: "/systems", requires: req("systems", "view"), label: "Systems", icon: IconServer, keywords: "sap connect ecc s4hana discover objects health sync jobs download history schedule" },
      { href: "/import", requires: req("extraction", "create"), label: "Import file", icon: IconImport, licenceKey: "import", anyOf: ["upload"], keywords: "upload load data file csv xlsx" },
      {
        href: "/migration",
        requires: req("analysis", "run"),
        label: "Migration",
        icon: IconMigration,
        anyOf: ["analyse"],
        keywords: "source destination transfer wave cutover readiness",
        children: [
          { href: "/migration/dry-run", requires: req("analysis", "run"), label: "Migration dry run", icon: IconBranch, anyOf: ["analyse"], keywords: "dry run rehearsal load simulate migration" },
        ],
      },
    ],
  },
  {
    group: "Admin",
    // rbac.md §5: users ★ | llm ★ | licence V | audit V.
    // rules/edit keeps the legacy steward's Admin › Settings nav.
    // extraction/edit lets SAP Basis (manage_field_mappings) reach Settings › Field mapping, Jobs and Reference data.
    requiresAny: [req("users", "admin"), req("llm", "admin"), req("licence", "view"), req("audit", "view"), req("rules", "edit"), req("extraction", "edit")],
    items: [
      { href: "/admin/users", requires: req("users", "admin"), label: "Users", icon: IconUserShield, anyOf: ["manage_users"], keywords: "admin users invite suspend" },
      { href: "/admin/roles", requires: req("users", "admin"), label: "Roles and access", icon: IconKey, anyOf: ["manage_users"], keywords: "roles grants scopes access requests permissions" },
      { href: "/admin/audit", requires: [req("audit", "view"), req("users", "admin")], label: "Audit log", icon: IconLog, anyOf: ["view_audit", "manage_users"], keywords: "audit log ai decisions role changes" },
      { href: "/admin/settings", requires: req("rules", "view"), label: "Settings", icon: IconGear, anyOf: SETTINGS_PERMISSIONS, keywords: "preferences config", children: SETTINGS_ITEMS },
      { href: "/admin/billing", requires: req("rules", "admin"), label: "Exception billing", icon: IconList, anyOf: ["manage_settings"], keywords: "billing tiers resolved exceptions cost invoice month" },
      { href: "/admin/features", requires: req("users", "admin"), label: "All features", icon: IconGrid, anyOf: ["manage_users"], keywords: "all features index every page map sitemap" },
    ],
  },
];

/**
 * Pages opened from inside another page rather than a menu entry: the insight views' tabs, the bell's full list, the
 * help and user menus, the other personas' homes and the design library. The admin's All features index
 * (/admin/features) lists them beside the nav, so every page under app/(app) is one click from the More panel.
 * Gated like nav items; hrefs are never resolved (a persona home here is that persona's page, not the viewer's).
 */
export const INDEX_ONLY_GROUPS: readonly NavGroup[] = [
  {
    group: "Analysis",
    items: [
      { href: "/insights/trends", requires: req("reports", "view"), label: "Trends", icon: IconTrend, anyOf: ["view"] },
      { href: "/insights/forecast", requires: req("reports", "view"), label: "Forecast", icon: IconTrend, anyOf: ["view"] },
      { href: "/insights/impact", requires: req("reports", "view"), label: "Value at risk", icon: IconCompass, anyOf: ["view"] },
      { href: "/insights/lineage", requires: req("reports", "view"), label: "Lineage", icon: IconCompass, anyOf: ["view"] },
      { href: "/insights/mining", requires: req("reports", "view"), label: "Patterns", icon: IconCompass, anyOf: ["view"] },
      { href: "/insights/duplicates", requires: req("reports", "view"), label: "Duplicates", icon: IconMerge, anyOf: ["view"] },
      { href: "/insights/process", requires: req("reports", "view"), label: "Process data readiness", icon: IconFlag, anyOf: ["view"] },
      { href: "/insights/operations", requires: req("reports", "view"), label: "Operations", icon: IconPeople, anyOf: ["view"] },
      { href: "/home/steward", requires: req("analysis", "view"), label: "Steward home", icon: IconHome, anyOf: ["view"] },
      { href: "/home/basis", requires: req("analysis", "view"), label: "SAP Basis home", icon: IconHome, anyOf: ["view"] },
      { href: "/home/process", requires: req("process", "view"), label: "Process home", icon: IconHome, anyOf: ["view"] },
    ],
  },
  {
    group: "Help and account",
    items: [
      { href: "/inbox/notifications", requires: req("analysis", "view"), label: "Notifications", icon: IconBell, anyOf: ["view"] },
      { href: "/search", requires: req("analysis", "view"), label: "Search", icon: IconCompass, anyOf: ["view"] },
      { href: "/docs", requires: req("analysis", "view"), label: "Documentation", icon: IconBook, anyOf: ["view"] },
      { href: "/me/preferences", requires: req("analysis", "view"), label: "Preferences", icon: IconSliders, anyOf: ["view"] },
      { href: "/design", requires: req("users", "admin"), label: "Design library", icon: IconLayers, anyOf: ["manage_users"] },
    ],
  },
];

/**
 * The All features index: every visible nav page (children included, hrefs resolved for the viewer) then every
 * visible index-only page, grouped by section, each href once.
 */
export function featureIndex(
  gate: NavGate,
  resolve: (href: string) => string = (h) => h,
): { group: string; items: NavItem[] }[] {
  const seen = new Set<string>();
  const out = new Map<string, NavItem[]>();
  const push = (group: string, item: NavItem) => {
    if (seen.has(item.href)) return;
    seen.add(item.href);
    out.set(group, [...(out.get(group) ?? []), item]);
  };
  for (const g of visibleNav(gate)) {
    for (const i of flattenNav(g.items)) push(g.group, { ...i, href: resolve(i.href), children: undefined });
  }
  for (const g of filterGroups(INDEX_ONLY_GROUPS, gate)) for (const i of g.items) push(g.group, i);
  return [...out].map(([group, items]) => ({ group, items }));
}

/**
 * The Rail's split of an already-visible nav: the main groups' top-level items (the pills) and every other
 * group under "More", each item followed by its children. A main item's children are not repeated in More:
 * they stay reachable from the item's own page and the command palette. `resolve` maps an href to the one the
 * viewer opens (`resolveNavHref`); an entry whose resolved href is already listed (a persona home that is
 * Fix work) is dropped, so no link appears twice.
 */
export function splitNav(
  groups: readonly NavGroup[],
  resolve: (href: string) => string = (h) => h,
): { main: NavItem[]; more: { group: string; items: NavItem[] }[] } {
  const main = groups.filter((g) => g.main).flatMap((g) => g.items);
  const seen = new Set(main.map((i) => resolve(i.href)));
  const more = groups
    .filter((g) => !g.main)
    .map((g) => ({
      group: g.group,
      items: flattenNav(g.items).filter((i) => {
        const href = resolve(i.href);
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);
  return { main, more };
}

/** Header titles for routes that are not in the nav. */
const OFF_NAV_TITLES: Record<string, string> = {
  "/admin/billing": "Exception billing",
  "/design": "Design library",
  "/search": "Search",
  "/docs": "Documentation",
  "/me/preferences": "Preferences",
  "/rules/learned": "Learned rules",
  "/inbox/notifications": "Notifications",
  // Insight views carry short rail labels; the pages keep their full titles.
  "/insights/exec": "Executive summary",
  "/insights/progress": "Progress",
  "/insights/trends": "Trends",
  "/insights/forecast": "Forecast",
  "/insights/rules": "Failing rules",
  "/insights/impact": "Value at risk",
  "/insights/lineage": "Lineage",
  "/insights/mining": "Patterns",
  "/insights/duplicates": "Duplicates",
  "/insights/readiness": "Waves",
  "/insights/process": "Process data readiness",
  "/insights/owners": "Owners",
  "/insights/operations": "Operations",
  "/insights/reports": "Reports",
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
  return filterGroups(NAV_GROUPS, gate);
}

function filterGroups(groups: readonly NavGroup[], gate: NavGate): NavGroup[] {
  const has = gate.has;
  return groups.filter((g) => allowed(g.anyOf, gate.can))
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

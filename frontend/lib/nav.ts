/**
 * Single navigation definition for the sidebar, the ⌘K command palette and
 * the header page titles. Both surfaces filter it with `visibleNav()`, so a
 * role or licence never sees a page in one place and not the other.
 *
 * Six main entries for everyone (the "Work" group: Fix work, Objects, Runs,
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
  IconShieldAlert, IconSliders, IconTrend, IconUserShield,
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
  // Triage: programme leads set up teams and assignment rules (assign).
  "assign",
] as const;

export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: "/admin/triage", requires: [req("rules", "edit"), req("stewardship", "edit")], label: "Triage", icon: IconFunnel, anyOf: ["manage_rules", "manage_settings", "assign"], keywords: "teams assignment rules sla business hours holidays" },
  { href: "/admin/mappings", requires: req("extraction", "edit"), label: "Field mapping", icon: IconMapping, anyOf: ["manage_field_mappings"], licenceKey: "field_mapping", keywords: "sap fields columns" },
  { href: "/admin/ai", requires: req("llm", "admin"), label: "AI settings", icon: IconModel, anyOf: ["manage_llm"], keywords: "ollama model provider llm" },
  // rules/edit is here only so the legacy steward keeps Settings › Licence: no legacy role is granted
  // licence/view (it is in NO_VIEW), and the steward reaches Settings through manage_rules alone.
  { href: "/admin/notifications", requires: req("rules", "admin"), label: "Notifications", icon: IconBell, anyOf: ["manage_settings"], keywords: "alerts channels slack teams email webhook digest" },
  { href: "/admin/reference", requires: req("systems", "view"), label: "Reference data", icon: IconList, anyOf: ["view"], keywords: "postal codes bic directory lists" },
  { href: "/admin/billing", requires: req("rules", "admin"), label: "Exception billing", icon: IconList, anyOf: ["manage_settings"], keywords: "billing tiers resolved exceptions cost invoice month" },
  { href: "/admin/licence", requires: [req("licence", "view"), req("licence", "admin"), req("rules", "edit"), req("stewardship", "edit")], label: "Licence", icon: IconKey, anyOf: ["view"], licenceKey: "licence", keywords: "seats modules tier" },
];

/**
 * A nav item's href, with `/home/*` resolved to the viewer's own persona
 * page. Every surface that renders a nav href (Rail, the command palette,
 * sign-in's post-login redirect) must call this instead of re-deriving the
 * `/home/` check itself — that duplication is how the three surfaces drifted.
 * Pass the viewer's `can` (and their home role, `useRole().homeRole`): without it a steward who may neither
 * approve nor apply, or a data owner who only approves, is sent to a Fix work page they cannot use.
 */
export function resolveNavHref(href: string, role: Role, can?: (action: string) => boolean): string {
  return href.startsWith("/home/") ? homeHrefForRole(role, can) : href;
}

/** The Settings page: its nav children are tabs of it (`settingsTabs`), so the More menu lists it once. */
export const SETTINGS_HREF = "/admin/settings";

/**
 * The tab strip of Settings and its children, from the visible nav: the Settings page itself (as Overview) and each
 * child the viewer may open. Empty when the viewer cannot see Settings.
 */
export function settingsTabs(groups: readonly NavGroup[]): NavItem[] {
  const settings = flattenNav(groups.flatMap((g) => g.items)).find((i) => i.href === SETTINGS_HREF);
  return settings ? [{ ...settings, label: "Overview", children: undefined }, ...(settings.children ?? [])] : [];
}

/** DESIGN.md §1.1: the index bar holds at most this many pills before More (the main group's size). */
export const MAX_PILLS = 6;

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    // The six entries everyone works from; the Rail shows them as pills (at most six: DESIGN.md §1.1). Every other
    // group sits under "More". Processes is here so every persona finds the as-is flows, not only the process analyst.
    group: "Work",
    main: true,
    items: [
      { href: "/fix", requires: req("fixes", "view"), label: "Fix work", icon: IconEraser, anyOf: ["approve", "apply"], badgeKey: "fix", keywords: "fix cleaning corrections proposals apply batches" },
      { href: "/objects", requires: req("findings", "view"), label: "Objects", icon: IconCube, licenceKey: "findings", keywords: "checks critical severity findings records" },
      { href: "/runs", requires: req("analysis", "view"), label: "Runs", icon: IconHistory, licenceKey: "versions", keywords: "compare history snapshots baseline" },
      // Labelled "Processes" on its pill (Rail PILL_LABEL); its page and the palette keep the full name.
      { href: "/process", requires: req("process", "view"), label: "As-is processes", icon: IconProcess, anyOf: ["view"], keywords: "processes process discovery mining as-is l1 l5 ptp otc variants conformance signavio bpmn flow" },
      { href: "/insights/progress", requires: req("reports", "view"), label: "Progress", icon: IconTrend, anyOf: ["view"], keywords: "baseline compare movement fixed new trends history forecast predictive" },
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
          // Every insight view is its own More entry (owner: a page that is only a tab reads as a missing feature).
          // Reports is gated on export: the page's downloads need it (api/services/rbac.py maps export to reports/export).
          { href: "/insights/reports", requires: req("reports", "export"), label: "Reports", icon: IconLog, anyOf: ["export"], keywords: "reports report library pdf board pack executive workbook xlsx json download export trend owners rule catalogue dictionary extraction cleaning record fix sheet comparison" },
          { href: "/insights/trends", requires: req("reports", "view"), label: "Trends", icon: IconTrend, keywords: "trend score movement run to run history" },
          { href: "/insights/forecast", requires: req("reports", "view"), label: "Forecast", icon: IconTrend, keywords: "forecast predictive projection 7 30 90 days" },
          { href: "/insights/rules", requires: req("reports", "view"), label: "Failing rules", icon: IconCompass, keywords: "explore rule ranking failing pareto root cause field" },
          { href: "/insights/impact", requires: req("reports", "view"), label: "Value at risk", icon: IconCompass, keywords: "impact value at risk blocked degraded sap features opportunity cost" },
          { href: "/insights/lineage", requires: req("reports", "view"), label: "Lineage", icon: IconBranch, keywords: "lineage field config process kpi" },
          { href: "/insights/mining", requires: req("reports", "view"), label: "Patterns", icon: IconCompass, keywords: "mining patterns anomalies drift likely rules" },
          { href: "/insights/duplicates", requires: req("reports", "view"), label: "Duplicates", icon: IconMerge, keywords: "duplicates same record merge" },
          { href: "/insights/readiness", requires: req("reports", "view"), label: "Readiness", icon: IconFlag, keywords: "waves go no-go blockers migration cutover readiness" },
          { href: "/insights/process", requires: req("reports", "view"), label: "Process data readiness", icon: IconFlag, keywords: "process readiness steps blocked failing fields l1 l5" },
          { href: "/insights/owners", requires: req("reports", "view"), label: "Owners", icon: IconPeople, keywords: "owners digest steward follow up" },
          { href: "/insights/operations", requires: req("reports", "view"), label: "Operations", icon: IconPeople, keywords: "operations sprints bottlenecks capacity fix queue" },
        ],
      },
      { href: "/fix?tab=batches", requires: req("fixes", "view"), label: "Approvals", icon: IconLog, anyOf: ["view_audit"], keywords: "approvals four eyes batches evidence approved applied audit" },
      { href: "/fix/what-if", requires: req("fixes", "view"), label: "What-if", icon: IconBranch, anyOf: ["approve", "apply"], keywords: "simulation simulate score before after fix" },
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
        requires: [req("analysis", "run"), req("analysis", "approve")],
        label: "Migration",
        icon: IconMigration,
        anyOf: ["analyse", "approve"],
        keywords: "source destination transfer wave cutover readiness",
        children: [
          { href: "/migration/dry-run", requires: req("analysis", "run"), label: "Migration dry run", icon: IconBranch, anyOf: ["analyse"], keywords: "dry run rehearsal load simulate migration" },
        ],
      },
      { href: "/admin/jobs", requires: req("analysis", "view"), label: "Jobs", icon: IconActivity, anyOf: ["trigger_sync", "analyse"], keywords: "history extraction analysis uploads running failed" },
    ],
  },
  {
    group: "Admin",
    // rbac.md §5: users ★ | llm ★ | licence V | audit V.
    // rules/edit keeps the legacy steward's Admin › Settings nav.
    // stewardship/edit lets a programme lead (assign) reach Settings › Triage.
    // extraction/edit lets SAP Basis (manage_field_mappings) reach Settings › Field mapping, Jobs and Reference data.
    requiresAny: [req("users", "admin"), req("llm", "admin"), req("licence", "view"), req("audit", "view"), req("rules", "edit"), req("extraction", "edit"), req("stewardship", "edit")],
    items: [
      { href: "/admin/users", requires: req("users", "admin"), label: "Users", icon: IconUserShield, anyOf: ["manage_users"], keywords: "admin users invite suspend" },
      { href: "/admin/roles", requires: req("users", "admin"), label: "Roles and access", icon: IconKey, anyOf: ["manage_users"], keywords: "roles grants scopes access requests permissions" },
      { href: "/admin/audit", requires: [req("audit", "view"), req("users", "admin")], label: "Audit log", icon: IconLog, anyOf: ["view_audit", "manage_users"], keywords: "audit log ai decisions role changes" },
      { href: "/admin/settings", requires: req("rules", "view"), label: "Settings", icon: IconGear, anyOf: SETTINGS_PERMISSIONS, keywords: "preferences config", children: SETTINGS_ITEMS },
    ],
  },
];

/**
 * Pages opened from inside another page rather than a menu entry: the bell's full list, the
 * help and user menus, the other personas' homes and the design library. The admin's All features index
 * (/features) lists them beside the nav, so every page under app/(app) is one click from the More panel.
 * Gated like nav items; hrefs are never resolved (a persona home here is that persona's page, not the viewer's).
 */
export const INDEX_ONLY_GROUPS: readonly NavGroup[] = [
  {
    group: "Analysis",
    items: [
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

/** The All features page's areas, in page order. */
export const FEATURE_AREAS = [
  "Work", "Objects and runs", "Insights and reports", "Processes", "MDM", "Rules and contracts", "Systems and import", "Admin",
] as const;
export type FeatureArea = (typeof FEATURE_AREAS)[number];

/** Area of a nav or index-only href; the first matching rule wins (more specific prefixes first). */
const AREA_RULES: readonly [test: (path: string) => boolean, area: FeatureArea][] = [
  [(p) => p === "/insights/process/designer" || p === "/process" || p.startsWith("/process/") || p === "/home/process", "Processes"],
  [(p) => p === "/objects" || p === "/runs", "Objects and runs"],
  [(p) => p.startsWith("/insights"), "Insights and reports"],
  [(p) => p.startsWith("/mdm"), "MDM"],
  [(p) => p.startsWith("/rules"), "Rules and contracts"],
  [(p) => p.startsWith("/systems") || p.startsWith("/import") || p.startsWith("/migration") || p === "/admin/jobs", "Systems and import"],
  [(p) => p.startsWith("/admin") || p === "/design", "Admin"],
];

export function featureArea(href: string): FeatureArea {
  const path = href.split("?")[0] ?? href;
  return AREA_RULES.find(([test]) => test(path))?.[1] ?? "Work";
}

/** One line per page: what you do there. Keyed by the nav href as written (before persona resolution). */
export const FEATURE_DESC: Readonly<Record<string, string>> = {
  "/fix": "Review and apply proposed fixes to failing records, in batches",
  "/fix?tab=batches": "Read-only four-eyes evidence: who approved and applied each fix batch",
  "/fix/what-if": "Simulate a fix and see the score before and after",
  "/inbox": "Work the stewardship queue: assigned issues, due dates and SLAs",
  "/inbox?kind=exception": "Escalated exceptions waiting for a decision",
  "/inbox/notifications": "Every notification sent to you",
  "/home/lead": "Your home: the score, what changed and what to do next",
  "/home/steward": "The steward's home: the queue first, then the score",
  "/home/basis": "The SAP Basis home: systems, connections and live jobs",
  "/home/process": "The process home: discovered processes and their runs",
  "/search": "Find pages, systems, objects, rules, terms and runs",
  "/docs": "The user guide",
  "/me/preferences": "Your density, time zone, theme and notifications",
  "/objects": "Each SAP object's score, failing checks and records",
  "/runs": "Every analysis run: start one, compare two, archive old ones",
  "/insights": "Where the data stands and which failing rules to fix first",
  "/insights/progress": "Did the score get better since the baseline, and why",
  "/insights/exec": "The one-page leadership view and the board pack",
  "/insights/reports": "Download reports: board pack, workbook, owners, rule catalogue and more",
  "/insights/trends": "How the score moved run to run, and which rules drove it",
  "/insights/forecast": "Where each object's score is heading over 7, 30 and 90 days",
  "/insights/rules": "Rank failing rules by cost, by object, field or dimension",
  "/insights/impact": "What failing records cost in blocked or degraded SAP features",
  "/insights/lineage": "Follow a field through configuration and process steps to KPIs",
  "/insights/mining": "Patterns found in the data: likely rules, anomalies and drift",
  "/insights/duplicates": "Find records that describe the same thing and propose merges",
  "/insights/readiness": "Which objects can load in each migration wave",
  "/insights/process": "How ready each business process is to run on this data",
  "/insights/owners": "Each data owner's open issues and their trend",
  "/insights/operations": "How the cleaning team keeps up: flow, waits and capacity",
  "/process": "The as-is process catalogue, L1 to L5, mined from SAP",
  "/process/runs": "Start and follow process discovery runs",
  "/insights/process/designer": "Model or edit a process and export it as BPMN or Signavio",
  "/mdm": "Master data health at a glance",
  "/mdm/survivorship": "Which source wins for each field of a golden record",
  "/mdm/golden": "Browse and edit golden records",
  "/mdm/golden/merge": "Review duplicate pairs: merge or mark as not a match",
  "/mdm/glossary": "Business terms, owners and the fields they govern",
  "/mdm/match-rules": "Tune how records are matched",
  "/rules": "The rule catalogue: every check, its object and severity",
  "/rules/contracts": "Data contracts and their SLAs",
  "/rules/drafts": "Write, review and approve new rules",
  "/rules/dictionary": "SAP tables and fields the rules read",
  "/rules/scoring": "Dimension weights, thresholds and alerts",
  "/rules/learned": "Rules mined from the data, waiting to be approved",
  "/systems": "Connect SAP systems, test them, load configuration and extract data",
  "/import": "Upload a CSV or Excel export and analyse it",
  "/migration": "Plan migration waves from source to destination",
  "/migration/dry-run": "Rehearse a migration load without writing anything",
  "/admin/users": "Invite people, choose their role, suspend access",
  "/admin/roles": "Roles, scoped grants and access requests",
  "/admin/audit": "Who did what, including AI decisions and role changes",
  "/admin/settings": "Licence, alert channels, retention and health checks",
  "/admin/triage": "Teams, assignment rules, SLAs and business hours",
  "/admin/mappings": "Map file columns to SAP fields",
  "/admin/ai": "The language model provider and its settings",
  "/admin/notifications": "Alert channels: email, Slack, Teams and webhooks",
  "/admin/jobs": "Every extraction, analysis and upload job, and why one failed",
  "/admin/reference": "Postal code and bank code lists per system",
  "/admin/licence": "Seats, modules and tier",
  "/admin/billing": "What a month of resolved exceptions costs, by tier",
  "/design": "The component library",
};

export interface FeatureEntry {
  /** The href the viewer opens (a persona home resolved). */
  href: string;
  /** The nav href as written, the key into FEATURE_DESC. */
  source: string;
  label: string;
  icon: NavIcon;
  description: string;
}

/**
 * The All features page (/features): every visible nav page (children included, hrefs resolved for the viewer) and
 * every visible index-only page, grouped by FEATURE_AREAS, each href once. Built from NAV_GROUPS, so it never drifts.
 */
export function featureIndex(
  gate: NavGate,
  resolve: (href: string) => string = (h) => h,
): { area: FeatureArea; items: FeatureEntry[] }[] {
  const seen = new Set<string>();
  const out = new Map<FeatureArea, FeatureEntry[]>();
  const push = (i: NavItem, href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    const area = featureArea(i.href);
    out.set(area, [...(out.get(area) ?? []), { href, source: i.href, label: i.label, icon: i.icon, description: FEATURE_DESC[i.href] ?? "" }]);
  };
  for (const g of visibleNav(gate)) for (const i of flattenNav(g.items)) push(i, resolve(i.href));
  for (const g of filterGroups(INDEX_ONLY_GROUPS, gate)) for (const i of g.items) push(i, i.href);
  return FEATURE_AREAS.filter((a) => out.has(a)).map((area) => ({ area, items: out.get(area)! }));
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
  "/features": "All features",
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

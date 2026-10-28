/**
 * Port of api/services/rbac.py's resource model (RESOURCES, ACTIONS, _NO_VIEW,
 * LEGACY_ACTION_MAP, resource_matrix). Pure (no React) so the e2e fixtures can
 * build /me/permissions payloads from it too.
 */
import type { AccessDenied } from "./api/client";

// ── Port of api/services/rbac.py (RESOURCES, ACTIONS, _NO_VIEW, LEGACY_ACTION_MAP, resource_matrix) ──
// Used to turn a 403's legacy action into a requestable (resource, action) pair, and by the nav
// identity test to build the payload the backend returns for each legacy role.

export const RESOURCES = [
  "systems", "credentials", "extraction", "analysis", "rules", "findings", "fixes", "mdm", "glossary",
  "stewardship", "contracts", "reports", "llm", "users", "licence", "audit", "process",
] as const;
export const ACTIONS = ["view", "create", "edit", "approve", "run", "export", "admin"] as const;
const NO_VIEW = new Set(["audit", "llm", "users", "licence", "credentials"]);
// The legacy `export` action predates `process`; process export is granted only by export_process.
const NO_EXPORT = new Set(["process"]);

type Pair = readonly [resource: string, action: string];
export const LEGACY_ACTION_MAP: Readonly<Record<string, readonly Pair[]>> = {
  view: [["*", "view"]],
  "mdm.read": [["mdm", "view"]],
  "mdm.write": [["mdm", "edit"]],
  view_ai_confidence: [["findings", "view"]],
  upload: [["extraction", "create"]],
  trigger_sync: [["extraction", "run"]],
  analyse: [["analysis", "run"]],
  trigger_ai: [["analysis", "run"], ["llm", "view"]],
  approve: [["fixes", "approve"], ["mdm", "approve"], ["stewardship", "approve"], ["analysis", "approve"]],
  apply: [["fixes", "run"]],
  assign: [["stewardship", "edit"]],
  // Hand one blocking rule to a steward (one new task); every `assign` holder and process_analyst hold it.
  handoff_rule: [["stewardship", "create"]],
  export: [["reports", "export"], ["*", "export"]],
  manage_rules: [["rules", "create"], ["rules", "edit"], ["contracts", "create"], ["contracts", "edit"], ["glossary", "edit"]],
  review_ai_rules: [["rules", "approve"]],
  ai_feedback: [["findings", "edit"]],
  manage_field_mappings: [["extraction", "edit"]],
  manage_systems: [["systems", "create"], ["systems", "edit"], ["systems", "admin"], ["credentials", "edit"]],
  manage_system: [["licence", "admin"]],
  manage_settings: [["analysis", "admin"], ["reports", "admin"], ["rules", "admin"]],
  // Triage teams, assignment rules and SLA policies; business hours and holidays stay manage_settings.
  manage_triage: [["stewardship", "admin"]],
  manage_llm: [["llm", "admin"]],
  manage_users: [["users", "admin"]],
  view_audit: [["audit", "view"], ["audit", "export"]],
  run_process_discovery: [["process", "run"]],
  export_process: [["process", "export"]],
};

/** `resource_matrix(actions)`: the {resource: {action: bool}} a legacy action set implies. */
export function resourceMatrix(actions: Iterable<string>): Record<string, Record<string, boolean>> {
  const granted = new Set<string>();
  for (const a of actions) {
    for (const [r, act] of LEGACY_ACTION_MAP[a] ?? []) {
      const rs = r === "*"
        ? RESOURCES.filter((x) => !(act === "view" && NO_VIEW.has(x)) && !(act === "export" && NO_EXPORT.has(x)))
        : [r];
      rs.forEach((x) => granted.add(`${x}/${act}`));
    }
  }
  return Object.fromEntries(RESOURCES.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, granted.has(`${r}/${a}`)]))]));
}

/** What the user asks for: a (resource, action) pair, optionally at one system and/or module. */
export interface RequestTarget {
  resource: string;
  action: string;
  system_id?: string | null;
  module?: string | null;
  /** Shown instead of the raw system id when the caller knows it. */
  systemLabel?: string;
}

/** Plain words for the (resource, action) pairs people request most; `accessLabel` builds the rest. */
const ACCESS_LABEL: Readonly<Record<string, string>> = {
  "fixes.approve": "Approve fixes",
  "fixes.run": "Apply fixes",
  "fixes.edit": "Edit fixes",
  "analysis.approve": "Sign off analysis",
  "analysis.run": "Run analysis",
  "extraction.run": "Run extraction",
  "extraction.create": "Upload data",
  "mdm.edit": "Edit golden records",
  "stewardship.create": "Hand rules to a steward",
  "process.export_process": "Export process models",
};
const VERB: Readonly<Record<string, string>> = {
  view: "View", create: "Create", edit: "Edit", approve: "Approve", run: "Run", export: "Export", admin: "Administer",
};

/** A permission pair as a person says it ("Approve fixes", "Run extraction"), never the raw keys. */
export function accessLabel(resource: string, action: string): string {
  const known = ACCESS_LABEL[`${resource}.${action}`];
  if (known) return known;
  const verb = VERB[action] ?? action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return resource ? `${verb} ${resource.replace(/_/g, " ")}` : verb;
}

/** A 403 names a legacy action (and sometimes a resource); the access-request API wants a (resource, action) pair. */
export function requestTargetFor(denied: AccessDenied): RequestTarget {
  if (denied.resource && (ACTIONS as readonly string[]).includes(denied.action)) {
    return { resource: denied.resource, action: denied.action };
  }
  const pairs = LEGACY_ACTION_MAP[denied.action] ?? [];
  const pick = pairs.find(([r]) => r === denied.resource) ?? pairs.find(([r]) => r !== "*") ?? pairs[0];
  // Unknown action: send it as-is and let the API's 422 message explain (never pre-hidden).
  if (!pick) return { resource: denied.resource ?? "", action: denied.action };
  return { resource: pick[0] === "*" ? denied.resource ?? "systems" : pick[0], action: pick[1] };
}

/**
 * The GET /me/permissions payload api/services/rbac.py returns for a user holding only a persona role
 * (no other grants): PERSONA_ROLES[role], BUILTIN_NAMES, home_for(role), resource_matrix(actions), no scopes.
 * Each action set is built the way rbac.py builds it, from the legacy sets in legacy-permissions.ts.
 * Keep in step with rbac.py PERSONA_ROLES, ALL_ACTIONS, BUILTIN_NAMES and PERSONA_HOME.
 */
import type { EffectivePermissions } from "../../lib/api/me";
import { resourceMatrix } from "../../lib/rbac";
import { LEGACY_PERMISSIONS } from "./legacy-permissions";

const READ = ["view", "mdm.read", "view_ai_confidence"];

/** rbac.py PERSONA_ROLES before platform_admin is widened to ALL_ACTIONS. */
const PERSONA_BASE = {
  // manage_triage: teams, assignment rules and SLA policies (rbac.py PERSONA_ROLES).
  programme_lead: [...LEGACY_PERMISSIONS.manager, "run_process_discovery", "manage_triage"],
  data_steward: [...LEGACY_PERMISSIONS.steward, "run_process_discovery", "manage_triage"],
  data_owner: [...LEGACY_PERMISSIONS.approver],
  sap_basis: [...LEGACY_PERMISSIONS.analyst, "manage_systems", "trigger_sync", "manage_field_mappings", "upload", "run_process_discovery"],
  platform_admin: [...LEGACY_PERMISSIONS.admin],
  process_analyst: [...READ, "run_process_discovery", "export_process", "handoff_rule"],
} as const satisfies Record<string, readonly string[]>;

/** rbac.py ALL_ACTIONS: every action any built-in (legacy or persona) role holds; platform_admin holds all of them. */
export const ALL_ACTIONS: readonly string[] = [
  ...new Set<string>([...Object.values(LEGACY_PERMISSIONS), ...Object.values(PERSONA_BASE)].flat()),
].sort();

export type PersonaRole = keyof typeof PERSONA_BASE;

export const PERSONA_PERMISSIONS: Record<PersonaRole, readonly string[]> = { ...PERSONA_BASE, platform_admin: ALL_ACTIONS };

export const PERSONA_ROLES = Object.keys(PERSONA_BASE) as PersonaRole[];

/** rbac.py BUILTIN_NAMES. */
const NAMES: Record<PersonaRole, string> = {
  programme_lead: "Programme lead / CIO", data_steward: "Data steward", data_owner: "Data owner / approver",
  sap_basis: "SAP Basis / integration admin", platform_admin: "Platform admin", process_analyst: "Process analyst",
};

/** rbac.py PERSONA_HOME. */
const HOME: Record<PersonaRole, string> = {
  programme_lead: "/home/lead", data_steward: "/home/steward", data_owner: "/home/steward",
  sap_basis: "/home/basis", platform_admin: "/home/lead", process_analyst: "/home/process",
};

/** rbac.py permissions_for(role): the sorted, de-duplicated action list. */
export function personaActions(role: PersonaRole): string[] {
  return [...new Set<string>(PERSONA_PERMISSIONS[role])].sort();
}

export function personaPermissionsPayload(role: PersonaRole): EffectivePermissions {
  const actions = personaActions(role);
  return {
    role,
    roles: [{ key: role, name: NAMES[role], system_id: null, module: null }],
    actions,
    resources: resourceMatrix(actions),
    scopes: [],
    home: HOME[role],
  };
}

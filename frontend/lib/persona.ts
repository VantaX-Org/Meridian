import type { Role } from "@/hooks/use-role";

/** The persona homes, one per "View as" option (rbac.md section 1.1). The analyst persona shares the lead home. */
export type Persona = "lead" | "steward" | "basis" | "process";

/** The home page's "View as" choices: exactly the personas, so no option lacks a persona or vice versa. */
export const PERSONA_OPTIONS: { value: Persona; label: string }[] = [
  { value: "lead", label: "Data lead" }, { value: "steward", label: "Steward" }, { value: "basis", label: "Basis" }, { value: "process", label: "Process owner" },
];

/**
 * The single role -> persona mapping (rbac.md 1.1, rbac.py PERSONA_HOME / home_for). Wave 16 replaces
 * this with `/me/permissions.home`; every caller goes through here so the swap
 * touches one file.
 */
const PERSONA_BY_ROLE: Record<Role, Persona> = {
  admin: "lead",
  manager: "lead",
  auditor: "lead",
  viewer: "lead",
  steward: "steward",
  approver: "steward", // data_owner defaults to the steward home
  analyst: "lead",
  ai_reviewer: "lead",
  process_analyst: "process", // spec process-discovery section 6.1: a persona key, not a legacy role
  sap_basis: "basis", // rbac.md 1.1: SAP Basis / integration admin
  // Persona keys (rbac.py PERSONA_HOME).
  programme_lead: "lead",
  data_steward: "steward",
  data_owner: "steward",
  platform_admin: "lead",
};

export function personaForRole(role: Role): Persona {
  return PERSONA_BY_ROLE[role];
}

/**
 * Which pill strip a role gets (lib/nav.ts PERSONA_PILLS): its persona's, except the data owner (and the legacy
 * approver it maps to), who shares the steward home but whose day is approving, not fixing.
 */
export type PillSet = Persona | "owner";

export function pillSetFor(role: Role): PillSet {
  return role === "data_owner" || role === "approver" ? "owner" : personaForRole(role);
}

/**
 * The role whose persona decides the home. users.role is the tenant-wide baseline (an invite with only
 * scoped grants keeps it at viewer, so the grant never widens to every system), so a scoped steward would
 * otherwise land on the lead home. When users.role maps to the lead persona, the first granted role
 * (`/me/permissions` roles, strongest first as granted) with a non-lead persona decides instead.
 */
export function homeRoleFrom(role: Role, grantKeys: readonly string[]): Role {
  if (personaForRole(role) !== "lead") return role;
  const known = grantKeys.filter((k): k is Role => Object.hasOwn(PERSONA_BY_ROLE, k));
  return known.find((k) => personaForRole(k) !== "lead") ?? role;
}

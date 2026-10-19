import type { Role } from "@/hooks/use-role";

/** The persona homes, one per "View as" option (rbac.md section 1.1). The analyst persona shares the lead home. */
export type Persona = "lead" | "steward" | "basis" | "process";

/** The home page's "View as" choices: exactly the personas, so no option lacks a persona or vice versa. */
export const PERSONA_OPTIONS: { value: Persona; label: string }[] = [
  { value: "lead", label: "Data lead" }, { value: "steward", label: "Steward" }, { value: "basis", label: "Basis" }, { value: "process", label: "Process owner" },
];

/**
 * The single legacy-role -> persona mapping (rbac.md 1.1). Wave 16 replaces
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
};

export function personaForRole(role: Role): Persona {
  return PERSONA_BY_ROLE[role];
}

/** The home route for this role's persona. */
export function homeHrefForRole(role: Role): string {
  return `/home/${personaForRole(role)}`;
}

import type { Role } from "@/hooks/use-role";

/** rbac.md section 1.1 personas. `sap_basis` has no legacy role, so it is never derived here. */
export type Persona = "lead" | "steward" | "analyst";

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
  analyst: "analyst",
  ai_reviewer: "analyst",
};

export function personaForRole(role: Role): Persona {
  return PERSONA_BY_ROLE[role];
}

/** The home route for this role's persona. The analyst persona shares the lead home. */
export function homeHrefForRole(role: Role): string {
  return personaForRole(role) === "steward" ? "/home/steward" : "/home/lead";
}

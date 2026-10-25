"use client";

import { useAuth } from "@/context/auth-context";
import { usePermissionsContext } from "@/lib/permissions";
import { homeRoleFrom } from "@/lib/persona";

// Roles and permissions come from the backend (/api/v1/auth/me →
// api/services/rbac.py). The frontend never keeps its own matrix, so UI
// gating cannot drift from what the API enforces.
//
// Inside the (app) layout's PermissionsProvider, `can` reads the
// /me/permissions action union (every grant, scoped ones included) and
// answers false until it loads, so every existing gate fails closed. Outside
// a provider (component tests) it falls back to /auth/me's permissions.

export type Role =
  | "admin"
  | "manager"
  | "steward"
  | "analyst"
  | "approver"
  | "auditor"
  | "ai_reviewer"
  | "viewer"
  | "process_analyst"
  | "sap_basis"
  | "programme_lead"
  | "data_steward"
  | "data_owner"
  | "platform_admin";

/** Every role key the API can return: rbac.py PERMISSIONS plus PERSONA_ROLES (VALID_ROLES). */
export const ROLES: readonly Role[] = [
  "admin", "manager", "steward", "analyst", "approver", "auditor", "ai_reviewer", "viewer", "process_analyst", "sap_basis",
  "programme_lead", "data_steward", "data_owner", "platform_admin",
];

/** rbac.py PERSONA_ALIAS: persona key -> the legacy key whose special-cased behaviour it inherits. */
const PERSONA_ALIAS: Partial<Record<Role, Role>> = {
  programme_lead: "manager", data_steward: "steward", data_owner: "approver", platform_admin: "admin",
};

/** The legacy key a role behaves as (itself when it is not an aliased persona key). */
export function legacyRole(role: Role): Role {
  return PERSONA_ALIAS[role] ?? role;
}

/** Type guard for an arbitrary string from the API/URL — never trust a bare cast to `Role`. */
export function isRole(x: string): x is Role {
  return (ROLES as readonly string[]).includes(x);
}

export function useRole() {
  const { user } = useAuth();
  const rawRole = user?.role ?? "viewer";
  const role: Role = isRole(rawRole) ? rawRole : "viewer";
  const fromGrants = usePermissionsContext();
  const perms = new Set(user?.permissions ?? []);
  const can = fromGrants ? fromGrants.can : (action: string): boolean => perms.has(action);

  return {
    role,
    /** The role whose persona home the user lands on: a scoped-only grant (users.role stays viewer) decides it. */
    homeRole: homeRoleFrom(role, fromGrants?.data?.roles.map((r) => r.key) ?? []),
    can,
    /** True while the grants are still loading inside the provider; gates should show a skeleton, not a refusal. */
    loading: fromGrants?.loading ?? false,
    isAdmin: legacyRole(role) === "admin",
    // "manager tier" = may change data (approve/apply) — used for coarse nav gating
    isManager: can("approve") || can("apply"),
    isViewer: !can("upload") && !can("approve"),
  };
}

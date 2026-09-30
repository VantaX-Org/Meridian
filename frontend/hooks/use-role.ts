"use client";

import { useAuth } from "@/context/auth-context";

// Roles and permissions come from the backend (/api/v1/auth/me →
// api/services/rbac.py). The frontend never keeps its own matrix, so UI
// gating cannot drift from what the API enforces.

export type Role =
  | "admin"
  | "manager"
  | "steward"
  | "analyst"
  | "approver"
  | "auditor"
  | "ai_reviewer"
  | "viewer";

export const ROLES: readonly Role[] = [
  "admin", "manager", "steward", "analyst", "approver", "auditor", "ai_reviewer", "viewer",
];

export function useRole() {
  const { user } = useAuth();
  const role = (user?.role ?? "viewer") as Role;
  const perms = new Set(user?.permissions ?? []);
  const can = (action: string): boolean => perms.has(action);

  return {
    role,
    can,
    isAdmin: role === "admin",
    // "manager tier" = may change data (approve/apply) — used for coarse nav gating
    isManager: perms.has("approve") || perms.has("apply"),
    isViewer: !perms.has("upload") && !perms.has("approve"),
  };
}

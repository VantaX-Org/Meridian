"use client";

import { useState, useEffect } from "react";

// ── Role definitions ──────────────────────────────────────────────────────────

export type Role =
  | "admin"
  | "manager"
  | "viewer"
  // Legacy roles (backward compat)
  | "steward"
  | "analyst"
  | "approver"
  | "auditor"
  | "ai_reviewer";

// Map any role to its effective tier for permission checks
const ROLE_TIER: Record<Role, "admin" | "manager" | "viewer"> = {
  admin: "admin",
  manager: "manager",
  // Legacy → tier mapping
  steward: "manager",
  analyst: "manager",
  approver: "manager",
  viewer: "viewer",
  auditor: "viewer",
  ai_reviewer: "manager",
};

// Permission matrix matching api/services/rbac.py
const PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set([
    "view",
    "upload",
    "analyse",
    "approve",
    "apply",
    "export",
    "manage_users",
    "manage_rules",
    "manage_field_mappings",
    "ai_feedback",
    "review_ai_rules",
    "trigger_ai",
    "view_ai_confidence",
    "trigger_sync",
  ]),
  manager: new Set([
    "view",
    "upload",
    "analyse",
    "approve",
    "apply",
    "export",
    "ai_feedback",
    "trigger_ai",
    "view_ai_confidence",
    "trigger_sync",
  ]),
  viewer: new Set(["view", "view_ai_confidence"]),
};

export function hasPermission(role: Role, action: string): boolean {
  const tier = ROLE_TIER[role] ?? "viewer";
  return PERMISSIONS[tier]?.has(action) ?? false;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mn_demo_role";
const DEFAULT_ROLE: Role = "admin";

export function useRole() {
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY) as Role | null;
    if (stored && stored in ROLE_TIER) {
      setRole(stored);
    }
  }, []);

  const can = (action: string): boolean => hasPermission(role, action);

  const tier = ROLE_TIER[role] ?? "viewer";

  return {
    role,
    tier,
    can,
    isAdmin: tier === "admin",
    isManager: tier === "admin" || tier === "manager",
    isViewer: tier === "viewer",
  };
}

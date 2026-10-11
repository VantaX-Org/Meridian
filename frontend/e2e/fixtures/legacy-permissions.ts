/**
 * The GET /me/permissions payload api/services/rbac.py returns for a user
 * holding only a legacy role (no grants): PERMISSIONS[role], BUILTIN_NAMES,
 * home_for(role), resource_matrix(actions), no scopes. Shared by the nav
 * identity vitest and the e2e mocks. Keep in step with rbac.py.
 */
import type { EffectivePermissions } from "../../lib/api/me";
import { resourceMatrix } from "../../lib/rbac";

const READ = ["view", "mdm.read", "view_ai_confidence"];

export const LEGACY_PERMISSIONS = {
  admin: [...READ,
    "upload", "analyse", "approve", "apply", "export", "assign",
    "manage_users", "manage_rules", "manage_field_mappings", "manage_llm",
    "manage_system", "manage_systems", "manage_settings", "view_audit",
    "ai_feedback", "review_ai_rules", "trigger_ai", "trigger_sync", "mdm.write"],
  manager: [...READ,
    "upload", "analyse", "approve", "apply", "export", "assign",
    "manage_systems", "view_audit", "ai_feedback", "trigger_ai", "trigger_sync", "mdm.write"],
  steward: [...READ,
    "upload", "analyse", "approve", "apply", "export", "assign",
    "manage_rules", "ai_feedback", "review_ai_rules", "trigger_ai", "trigger_sync", "mdm.write"],
  analyst: [...READ, "upload", "analyse", "export", "trigger_ai", "trigger_sync"],
  approver: [...READ, "approve", "export"],
  auditor: [...READ, "export", "view_audit"],
  ai_reviewer: [...READ, "review_ai_rules", "ai_feedback"],
  viewer: [...READ],
} as const;

export type LegacyRole = keyof typeof LEGACY_PERMISSIONS;
export const LEGACY_ROLES = Object.keys(LEGACY_PERMISSIONS) as LegacyRole[];

const NAMES: Record<LegacyRole, string> = {
  admin: "Admin (legacy)", manager: "Manager (legacy)", steward: "Steward (legacy)",
  analyst: "Analyst", approver: "Approver (legacy)", auditor: "Auditor",
  ai_reviewer: "AI reviewer (legacy)", viewer: "Viewer",
};

// home_for(): legacy keys follow their persona (steward -> data_steward, approver -> data_owner).
const HOME: Partial<Record<LegacyRole, string>> = { steward: "/home/steward", approver: "/home/steward" };

export function permissionsPayload(role: LegacyRole): EffectivePermissions {
  const actions = [...LEGACY_PERMISSIONS[role]].sort();
  return {
    role,
    roles: [{ key: role, name: NAMES[role], system_id: null, module: null }],
    actions,
    resources: resourceMatrix(actions),
    scopes: [],
    home: HOME[role] ?? "/home/lead",
  };
}

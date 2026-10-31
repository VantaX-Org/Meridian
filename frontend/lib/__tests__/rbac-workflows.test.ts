// Mirrors api/services/rbac.py for approval workflows: manage_workflows is the administrator's alone.
import { describe, expect, it } from "vitest";
import roleActions from "../api/v2/fixtures/role-actions.json";
import { LEGACY_ACTION_MAP, requestTargetFor, resourceMatrix } from "../rbac";
import { LEGACY_ROLES, permissionsPayload } from "./legacy-permissions";

const ROLES = (roleActions as { roles: Record<string, string[]> }).roles;

describe("manage_workflows", () => {
  it("is held by admin and platform_admin only, as PERMISSIONS and PERSONA_ROLES say", () => {
    const holders = Object.entries(ROLES)
      .filter(([, actions]) => actions.includes("manage_workflows"))
      .map(([role]) => role)
      .sort();
    expect(holders).toEqual(["admin", "platform_admin"]);
    expect(ROLES.platform_admin).toEqual(ROLES.admin);
  });

  it("maps to fixes admin, like LEGACY_ACTION_MAP in rbac.py", () => {
    expect(LEGACY_ACTION_MAP.manage_workflows).toEqual([["fixes", "admin"]]);
    expect(resourceMatrix(["view", "manage_workflows"]).fixes).toMatchObject({ view: true, admin: true, approve: false });
    expect(resourceMatrix(["view", "approve"]).fixes.admin).toBe(false);
  });

  it("only the legacy admin's payload carries it", () => {
    for (const role of LEGACY_ROLES) {
      const p = permissionsPayload(role);
      expect(p.actions.includes("manage_workflows"), role).toBe(role === "admin");
      expect(p.resources.fixes.admin, role).toBe(role === "admin");
    }
  });

  it("turns a 403 on manage_workflows into a requestable pair", () => {
    expect(requestTargetFor({ resource: null, action: "manage_workflows" })).toEqual({ resource: "fixes", action: "admin" });
  });

  it("every role still reads definitions (view) and the approvers still decide (approve)", () => {
    for (const [role, actions] of Object.entries(ROLES)) expect(actions, role).toContain("view");
    for (const role of ["data_owner", "data_steward", "programme_lead", "platform_admin"]) expect(ROLES[role], role).toContain("approve");
  });
});

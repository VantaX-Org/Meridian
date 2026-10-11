// Mirrors tests/test_rbac_process_discovery.py: the `process` resource in the lib/rbac.ts port.
import { describe, expect, it } from "vitest";
import { RESOURCES, requestTargetFor, resourceMatrix } from "../rbac";
import { permissionsPayload } from "../../e2e/fixtures/legacy-permissions";

describe("process resource", () => {
  it("is the last resource", () => {
    expect(RESOURCES[RESOURCES.length - 1]).toBe("process");
  });

  it("legacy export does not reach process export; view does reach process view", () => {
    const m = resourceMatrix(["view", "export"]).process;
    expect(m).toMatchObject({ view: true, export: false, run: false });
    expect(resourceMatrix(["export_process", "run_process_discovery"]).process).toMatchObject({ export: true, run: true });
  });

  it("matches the backend for the legacy roles", () => {
    expect(permissionsPayload("admin").resources.process).toMatchObject({ view: true, run: true, export: true });
    expect(permissionsPayload("manager").resources.process).toMatchObject({ view: true, run: false, export: true });
    expect(permissionsPayload("analyst").resources.process).toMatchObject({ view: true, run: false, export: false });
  });

  it("turns a 403 on the new actions into a requestable pair", () => {
    expect(requestTargetFor({ resource: null, action: "run_process_discovery" })).toEqual({ resource: "process", action: "run" });
    expect(requestTargetFor({ resource: null, action: "export_process" })).toEqual({ resource: "process", action: "export" });
  });
});

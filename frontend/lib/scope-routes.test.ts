// The scope bar's run and object pickers show, and carry their choice, only on screens that read them.
import { describe, expect, it } from "vitest";
import { isCurrentStateView, isModuleScoped, isRunScoped, opensOnCurrentState } from "./current-state";

describe("isRunScoped", () => {
  it.each(["/objects", "/objects/material_master", "/objects/material_master/rules/MM-001", "/insights", "/insights/rules", "/fix", "/fix/what-if", "/search", "/rules/learned", "/migration/dry-run"])(
    "is true on %s, which reads ?run=",
    (path) => expect(isRunScoped(path)).toBe(true),
  );
  it.each(["/home", "/home/steward", "/runs", "/runs/r1", "/process", "/process/ptp", "/admin/users", "/mdm", "/inbox", "/systems", "/rules", "/fix/proposals/r1", "/insights/lineage", "/insights/process/designer", "/objectsx", "/insights/owners", "/insights/forecast", "/insights/operations"])(
    "is false on %s, which ignores or owns ?run=",
    (path) => expect(isRunScoped(path)).toBe(false),
  );
});

describe("isModuleScoped", () => {
  it.each(["/objects/material_master", "/insights", "/insights/progress", "/fix", "/rules"])(
    "is true on %s, which reads ?module=",
    (path) => expect(isModuleScoped(path)).toBe(true),
  );
  it.each(["/objects", "/home", "/home/lead", "/search", "/rules/learned", "/runs/r1", "/admin/users", "/inbox", "/fix/proposals/r1"])(
    "is false on %s, which ignores ?module=",
    (path) => expect(isModuleScoped(path)).toBe(false),
  );
});

describe("current-state views", () => {
  it("are the homes, the Insights overview, the executive summary, Progress, Value at risk and Process data readiness", () => {
    expect(["/home", "/home/lead", "/insights", "/insights/exec", "/insights/progress", "/insights/impact", "/insights/process"].every(isCurrentStateView)).toBe(true);
    expect(isCurrentStateView("/insights/rules")).toBe(false);
    expect(isCurrentStateView("/insights/process/designer")).toBe(false);
  });

  it("include every cross-object screen that opens on the current state, Fix work and the objects among them", () => {
    expect(["/fix", "/objects", "/objects/material_master", "/insights/progress", "/home/steward"].every(opensOnCurrentState)).toBe(true);
    expect(["/insights/rules", "/insights/trends", "/search", "/fix/what-if"].some(opensOnCurrentState)).toBe(false);
  });
});

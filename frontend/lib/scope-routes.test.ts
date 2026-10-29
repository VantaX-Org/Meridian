// The scope bar's run and object pickers show, and carry their choice, only on screens that read them.
import { describe, expect, it } from "vitest";
import { isCrossObjectView, isCurrentStateView, isModuleScoped, isRunScoped, opensOnCurrentState } from "./current-state";
import { RECORD_ISSUES_HREF } from "@/app/(app)/inbox/task-source";

describe("isRunScoped", () => {
  it.each(["/objects", "/objects/material_master", "/objects/material_master/rules/MM-001", "/insights/exec", "/insights/rules", "/fix", "/fix/what-if", "/search", "/rules/learned", "/migration/dry-run"])(
    "is true on %s, which reads ?run=",
    (path) => expect(isRunScoped(path)).toBe(true),
  );
  it.each(["/home", "/home/steward", "/runs", "/runs/r1", "/process", "/process/ptp", "/admin/users", "/mdm", "/inbox", "/systems", "/rules", "/fix/proposals/r1", "/insights/lineage", "/insights/process/designer", "/objectsx", "/insights/owners", "/insights/forecast"])(
    "is false on %s, which ignores or owns ?run=",
    (path) => expect(isRunScoped(path)).toBe(false),
  );
});

describe("isModuleScoped", () => {
  it.each(["/objects/material_master", "/insights/exec", "/insights/progress", "/fix", "/rules"])(
    "is true on %s, which reads ?module=",
    (path) => expect(isModuleScoped(path)).toBe(true),
  );
  it.each(["/objects", "/home", "/home/lead", "/search", "/rules/learned", "/runs/r1", "/admin/users", "/inbox", "/fix/proposals/r1"])(
    "is false on %s, which ignores ?module=",
    (path) => expect(isModuleScoped(path)).toBe(false),
  );
});

describe("current-state views", () => {
  it("are the homes, the executive summary, Progress, Value at risk and Process data readiness", () => {
    expect(["/home", "/home/lead", "/insights/exec", "/insights/progress", "/insights/impact", "/insights/process"].every(isCurrentStateView)).toBe(true);
    expect(isCurrentStateView("/insights/rules")).toBe(false);
    // /insights itself (the retired overview) only redirects home.
    expect(isCurrentStateView("/insights")).toBe(false);
    expect(isCurrentStateView("/insights/process/designer")).toBe(false);
  });

  it("include every cross-object screen that opens on the current state, Fix work and the objects among them", () => {
    expect(["/fix", "/objects", "/objects/material_master", "/insights/progress", "/home/steward"].every(opensOnCurrentState)).toBe(true);
    expect(["/insights/rules", "/insights/trends", "/search", "/fix/what-if"].some(opensOnCurrentState)).toBe(false);
  });

  it("include Duplicates, which reads every object's own latest run", () => {
    expect(isCurrentStateView("/insights/duplicates")).toBe(true);
  });
});

describe("isCrossObjectView", () => {
  it.each(["/fix", "/objects", "/objects/material_master", "/insights", "/insights/progress", "/insights/impact", "/insights/process", "/insights/duplicates", "/insights/rules", "/insights/trends", "/rules", "/home/lead"])(
    "is true on %s, which opens on the current state unless its link names a run",
    (path) => expect(isCrossObjectView(path)).toBe(true),
  );
  it.each(["/search", "/rules/learned", "/migration/dry-run", "/fix/what-if"])("is false on the one-run screen %s", (path) => expect(isCrossObjectView(path)).toBe(false));
});

describe("the retired Inbox › Issues", () => {
  it("redirects to plain Fix work for my records, with no run or object", () => {
    expect(RECORD_ISSUES_HREF).toBe("/fix?mine=1");
    expect(isCrossObjectView(RECORD_ISSUES_HREF.split("?")[0])).toBe(true);
  });
});

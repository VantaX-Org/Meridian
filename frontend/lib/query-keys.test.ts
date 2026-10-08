import { describe, expect, it } from "vitest";
import { queryKeys } from "./query-keys";

describe("queryKeys", () => {
  it("builds entity-prefixed tuples", () => {
    expect(queryKeys.object("material_master", "r1")).toEqual(["object", "material_master", "r1"]);
    expect(queryKeys.rule("CHK_001", "r1")).toEqual(["rule", "CHK_001", "r1"]);
    expect(queryKeys.records("material_master", { severity: "critical" })).toEqual([
      "records",
      "material_master",
      { severity: "critical" },
    ]);
    expect(queryKeys.run("v1")).toEqual(["run", "v1"]);
    expect(queryKeys.batch("b1")).toEqual(["batch", "b1"]);
    expect(queryKeys.inbox({ owner: "me" })).toEqual(["inbox", { owner: "me" }]);
    expect(queryKeys.systems()).toEqual(["systems"]);
    expect(queryKeys.shellCounts()).toEqual(["shell-counts"]);
    expect(queryKeys.insights("readiness", "v1")).toEqual(["insights", "readiness", "v1"]);
    expect(queryKeys.insights("impact")).toEqual(["insights", "impact"]);
    expect(queryKeys.insights("duplicates", "material_master/000101")).toEqual([
      "insights",
      "duplicates",
      "material_master/000101",
    ]);
    expect(queryKeys.insights("exec")).toEqual(["insights", "exec"]);
  });

  it("normalizes filters so key order and undefined padding do not fragment the cache", () => {
    expect(queryKeys.records("MARA", { b: 1, a: 2 })).toEqual(
      queryKeys.records("MARA", { a: 2, b: 1, c: undefined }),
    );
    expect(queryKeys.inbox({ status: "open", owner: "me" })).toEqual(
      queryKeys.inbox({ owner: "me", status: "open", assignee: undefined }),
    );
  });

  it("every key's first element is a stable string prefix", () => {
    const prefixes = [
      queryKeys.object("a", "b")[0],
      queryKeys.rule("a", "b")[0],
      queryKeys.records("a", {})[0],
      queryKeys.run("a")[0],
      queryKeys.batch("a")[0],
      queryKeys.inbox({})[0],
      queryKeys.systems()[0],
      queryKeys.shellCounts()[0],
      queryKeys.insights("owners")[0],
    ];
    expect(prefixes).toEqual([
      "object", "rule", "records", "run", "batch", "inbox", "systems", "shell-counts", "insights",
    ]);
  });
});

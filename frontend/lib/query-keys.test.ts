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
    ];
    expect(prefixes).toEqual(["object", "rule", "records", "run", "batch", "inbox", "systems", "shell-counts"]);
  });
});

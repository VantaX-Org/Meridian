import { describe, expect, it } from "vitest";
import { fieldDelta, needsTransform } from "./field-delta";

const def = (type: string, length: number, check_table: string | null = null, decimals = 0) => ({ type, length, decimals, check_table, description: null });
const map = (s: ReturnType<typeof def> | null, g: ReturnType<typeof def> | null, dest = true) => ({ dest_table: dest ? "MARA" : null, dest_field: dest ? "X" : null, source_def: s, target_def: g, transform_note: null, value_map: false });

describe("fieldDelta", () => {
  it("names each definition change", () => {
    expect(fieldDelta(map(def("CHAR", 70), def("CHAR", 40)))).toEqual([{ kind: "shorter", from: 70, to: 40 }]);
    expect(fieldDelta(map(def("NUMC", 10, "T001"), def("CHAR", 12, "T001W"))).map((d) => d.kind)).toEqual(["type", "longer", "check_table"]);
    expect(fieldDelta(map(def("CURR", 13, null, 2), def("CURR", 13, null, 3)))).toEqual([{ kind: "decimals", from: 2, to: 3 }]);
    expect(fieldDelta(map(def("CHAR", 4, "T134"), def("CHAR", 4, "T134")))).toEqual([{ kind: "same" }]);
  });

  it("does not guess when a definition or the target is missing", () => {
    expect(fieldDelta(map(def("CHAR", 4), null))).toEqual([{ kind: "unknown" }]);
    expect(fieldDelta(map(def("CHAR", 4), null, false))).toEqual([{ kind: "dropped" }]);
  });

  it("flags a risky change with no transformation", () => {
    expect(needsTransform(map(def("CHAR", 70), def("CHAR", 40)))).toBe(true);
    expect(needsTransform({ ...map(def("CHAR", 70), def("CHAR", 40)), transform_note: "Shorten" })).toBe(false);
    expect(needsTransform(map(def("CHAR", 10), def("CHAR", 40)))).toBe(false);
  });
});

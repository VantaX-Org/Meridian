import { describe, expect, it } from "vitest";
import { formatSheet, parseSheet, popSheet, pushSheet, sheetsOf, stepOf, withSheets } from "../sheet";

describe("sheet addresses", () => {
  it("parses kind and id, ids may hold colons", () => {
    expect(parseSheet("record:MARA:000123")).toEqual({ kind: "record", id: "MARA:000123" });
    expect(parseSheet("command")).toEqual({ kind: "command", id: "" });
    expect(parseSheet("Bad kind:1")).toBeNull();
    expect(parseSheet("")).toBeNull();
    expect(formatSheet({ kind: "run", id: "42" })).toBe("run:42");
  });

  it("reads the stack and the step from the query", () => {
    const sp = new URLSearchParams("sheet=run:1&sheet=record:a:b&step=3");
    expect(sheetsOf(sp)).toEqual([{ kind: "run", id: "1" }, { kind: "record", id: "a:b" }]);
    expect(stepOf(sp)).toBe(3);
    expect(stepOf(new URLSearchParams("step=0"))).toBe(1);
    expect(stepOf(new URLSearchParams("step=x"))).toBe(1);
  });

  it("keeps at most two and lets a third replace the second", () => {
    const a = { kind: "a", id: "" };
    const b = { kind: "b", id: "" };
    const c = { kind: "c", id: "" };
    expect(pushSheet(pushSheet([], a), b)).toEqual([a, b]);
    expect(pushSheet([a, b], c)).toEqual([a, c]);
    expect(pushSheet([a, b], b)).toEqual([a, b]);
    expect(popSheet([a, b])).toEqual([a]);
    expect(sheetsOf(new URLSearchParams("sheet=a&sheet=b&sheet=c"))).toEqual([b, c]);
  });

  it("writes the stack back and keeps other parameters", () => {
    expect(withSheets("run=7&sheet=old&step=2", [{ kind: "ask", id: "" }], 2)).toBe("run=7&sheet=ask&step=2");
    expect(withSheets("run=7&sheet=old&step=2", [])).toBe("run=7");
  });
});

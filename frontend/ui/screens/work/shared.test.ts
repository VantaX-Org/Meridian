import { describe, expect, it } from "vitest";
import { writebackOutcome } from "./shared";

describe("writebackOutcome", () => {
  it("is a plain good sentence when SAP reported no problems", () => {
    expect(writebackOutcome({ applied: 12, errors: [] })).toBe("12 records are written.");
  });
  it("turns bad and names the first problem when SAP reported errors", () => {
    const o = writebackOutcome({ applied: 0, errors: ["RFC connection failed: timeout", "other"] });
    expect(o).toEqual({ text: "0 records are written. 2 problems reported: RFC connection failed: timeout", tone: "bad" });
  });
});

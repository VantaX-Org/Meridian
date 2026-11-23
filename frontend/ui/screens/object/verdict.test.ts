import { describe, expect, it } from "vitest";
import type { LandscapeCell } from "@/lib/api/v2/types";
import { verdictFor } from "./format";

const cell = { run_id: "newest", verdict: "no-go" } as LandscapeCell;

describe("verdictFor", () => {
  it("uses the landscape verdict on the run the cell describes", () => {
    expect(verdictFor(cell, "newest", 82)).toBe("no-go");
  });
  it("follows the shown score of any other run, so 82 is never No-go", () => {
    expect(verdictFor(cell, "older", 82)).toBe("at-risk");
    expect(verdictFor(cell, "older", 90)).toBe("go");
    expect(verdictFor(cell, "older", 60)).toBe("no-go");
    expect(verdictFor(cell, "older", null)).toBeNull();
  });
});

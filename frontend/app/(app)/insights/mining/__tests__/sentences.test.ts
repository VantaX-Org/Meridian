import { describe, expect, it } from "vitest";
import { miningWhy } from "../sentences";

describe("miningWhy", () => {
  it("never reads a zero count out as a fact", () => {
    expect(miningWhy(0, 0, 0)).toBe("Nothing is mined yet");
    expect(miningWhy(0, 0, 5)).toBe("5 patterns are mined");
    expect(miningWhy(12, 0, 5)).toBe("Every link is declared and 5 patterns are mined");
    expect(miningWhy(12, 1, 0)).toBe("1 link is inferred and no pattern is mined yet");
    expect(miningWhy(12, 3, 1)).toBe("3 links are inferred and 1 pattern is mined");
  });
});

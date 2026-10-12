import { describe, expect, it } from "vitest";
import { formatCompact, formatDelta, formatDuration, formatInt, formatPct, formatScore } from "./format";

describe("number helpers", () => {
  it("formatInt groups and dashes null", () => {
    expect(formatInt(12480)).toBe("12,480");
    expect(formatInt(0)).toBe("0");
    expect(formatInt(null)).toBe("—");
    expect(formatInt(Number.NaN)).toBe("—");
  });
  it("formatCompact only compacts from 100,000", () => {
    expect(formatCompact(99_999)).toBe("99,999");
    expect(formatCompact(123_456)).toBe("123.5K");
    expect(formatCompact(1_200_000)).toBe("1.2M");
  });
  it("formatScore keeps one decimal and the trailing zero", () => {
    expect(formatScore(87)).toBe("87.0");
    expect(formatScore(87.44)).toBe("87.4");
    expect(formatScore(undefined)).toBe("—");
  });
  it("formatPct", () => {
    expect(formatPct(96.4)).toBe("96%");
    expect(formatPct(3.44)).toBe("3.4%");
    expect(formatPct(0.04)).toBe("<0.1%");
    expect(formatPct(0)).toBe("0%");
  });
  it("formatDelta uses the real minus sign and explicit plus", () => {
    expect(formatDelta(2.14)).toBe("+2.1");
    expect(formatDelta(-0.8)).toBe("−0.8");
    expect(formatDelta(0)).toBe("0.0");
  });
  it("formatDuration", () => {
    expect(formatDuration(400)).toBe("<1s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(305_000)).toBe("5m 05s");
    expect(formatDuration(3_780_000)).toBe("1h 03m");
    expect(formatDuration(null)).toBe("—");
  });
});

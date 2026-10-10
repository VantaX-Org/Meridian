import { describe, expect, it } from "vitest";
import { etaSeconds, formatDuration, isStalled, STALL_AFTER_S, updatedAgo } from "./job-timing";

describe("job-timing", () => {
  it("estimates ETA only while 0 < percent < 100", () => {
    expect(etaSeconds(25, 1000, 1100)).toBe(300);
    expect(etaSeconds(0, 1000, 1100)).toBeNull();
    expect(etaSeconds(100, 1000, 1100)).toBeNull();
  });
  it("formats durations and updated-ago text", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(7500)).toBe("2 h 5 min");
    expect(updatedAgo(100, 102)).toBe("updated just now");
    expect(updatedAgo(100, 160)).toBe("updated 1 min ago");
  });
  it("flags a stall only for running jobs older than 10 min", () => {
    expect(isStalled("running", 0, STALL_AFTER_S)).toBe(false);
    expect(isStalled("running", 0, STALL_AFTER_S + 1)).toBe(true);
    expect(isStalled("completed", 0, STALL_AFTER_S + 1)).toBe(false);
  });
});

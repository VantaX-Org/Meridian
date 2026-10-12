import { describe, expect, it } from "vitest";
import { bySeverity, severityRank } from "../_severity-sort";

const row = (v: string) => ({ getValue: () => v }) as never;

describe("severity sort", () => {
  it("ranks worst first with unknown last", () => {
    const words = ["pass", "", "low", "critical", "medium", "high"];
    expect([...words].sort((a, b) => bySeverity(row(a), row(b), "x"))).toEqual(["critical", "high", "medium", "low", "pass", ""]);
    expect(severityRank(undefined)).toBe(5);
  });
});

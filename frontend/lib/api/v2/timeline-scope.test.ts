import { describe, expect, it } from "vitest";
import { scoreRunsOnly } from "./timeline-scope";

describe("scoreRunsOnly", () => {
  it("drops discovery runs and keeps every quality run kind, including unstamped", () => {
    const runs = ["scheduled", "manual", "recheck", "upload", null, "process_discovery", "discovery"].map((kind) => ({ kind }));
    const out = scoreRunsOnly({ limit: 8, runs });
    expect(out.runs.map((r) => r.kind)).toEqual(["scheduled", "manual", "recheck", "upload", null]);
    expect(out.limit).toBe(8);
  });
});

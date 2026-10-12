import { describe, expect, it } from "vitest";
import { withScope } from "../useInsightScope";

describe("withScope", () => {
  it("adds params and skips empty ones", () => {
    expect(withScope("/insights/rules", { run: "v1", module: undefined })).toBe("/insights/rules?run=v1");
    expect(withScope("/insights/rules", {})).toBe("/insights/rules");
  });

  it("merges into an existing query string and keeps the hash after it", () => {
    expect(withScope("/insights/rules?sev=high#top", { run: "v1" })).toBe("/insights/rules?sev=high&run=v1#top");
    expect(withScope("/insights/rules#top", { run: "v1" })).toBe("/insights/rules?run=v1#top");
    expect(withScope("/insights/rules#top", {})).toBe("/insights/rules#top");
  });
});

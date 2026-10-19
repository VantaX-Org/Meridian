// recharts does not lay out under jsdom, so the category axis contract is tested on the props Bar gives it:
// every category keeps its label (interval 0), and the axis is as wide as the longest label so none is clipped.
import { describe, expect, it } from "vitest";
import { categoryAxisProps, categoryAxisWidth } from "./Bar";

describe("Bar category axis", () => {
  it("labels every category, never every other one, at the width of the longest label", () => {
    const data = ["Completeness", "Accuracy", "Consistency", "Timeliness", "Uniqueness", "Validity"].map((x, i) => ({ x, y: 60 + i }));
    const axis = categoryAxisProps(data);
    expect(axis.interval).toBe(0);
    expect(axis.width).toBe(categoryAxisWidth(data.map((d) => d.x)));
  });

  it("ticks a point by its label when it has one", () => {
    const axis = categoryAxisProps([{ x: "pending_review", label: "Pending review", y: 4 }]);
    expect(axis.tickFormatter("pending_review")).toBe("Pending review");
    expect(axis.tickFormatter("other")).toBe("other");
    expect(axis.width).toBe(categoryAxisWidth(["Pending review"]));
  });
});

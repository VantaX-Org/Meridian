// recharts does not lay out under jsdom, so the category axis contract is tested on the props Bar gives it:
// every category keeps its label (interval 0), and the axis is as wide as the longest label so none is clipped.
import { describe, expect, it } from "vitest";
import { LABEL_LINE_CHARS, categoryAxisProps, categoryAxisWidth, wrapCategoryLabel } from "./Bar";

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

describe("Bar category labels", () => {
  it("wraps a long name to two whole lines on a wide chart", () => {
    expect(wrapCategoryLabel("Universal Journal / General Ledger")).toEqual(["Universal Journal /", "General Ledger"]);
    expect(wrapCategoryLabel("Business Partner / CVI")).toEqual(["Business Partner / CVI"]);
    const axis = categoryAxisProps([{ x: "Universal Journal / General Ledger", y: 3 }]);
    expect(axis.lines("Universal Journal / General Ledger").join(" ")).toBe("Universal Journal / General Ledger");
    expect(axis.wraps).toBe(true);
  });

  it("cuts with an ellipsis only what two lines cannot hold", () => {
    const lines = wrapCategoryLabel("Purchasing info records and source lists for every plant");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Purchasing info records");
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(LABEL_LINE_CHARS);
  });

  it("keeps to one line with an ellipsis at phone width", () => {
    expect(wrapCategoryLabel("Universal Journal / General Ledger", true)).toEqual(["Universal Journal…"]);
    const axis = categoryAxisProps([{ x: "Universal Journal / General Ledger", y: 3 }], true);
    expect(axis.wraps).toBe(false);
    expect(axis.tickFormatter("Universal Journal / General Ledger")).toBe("Universal Journal…");
  });
});

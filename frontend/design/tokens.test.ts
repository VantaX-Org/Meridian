// frontend/design/tokens.test.ts
import { describe, expect, it } from "vitest";
import { mColor, mSpace, mRadius, mMotion } from "./tokens";

describe("design tokens", () => {
  it("exposes 8 chart series colours as CSS var references", () => {
    expect(mColor.viz).toHaveLength(8);
    for (const v of mColor.viz) expect(v).toMatch(/^var\(--m-viz-\d\)$/);
  });

  it("exposes the 4px space scale", () => {
    expect(mSpace[1]).toBe(4);
    expect(mSpace[6]).toBe(24);
    expect(mSpace[24]).toBe(96);
  });

  it("exposes radius and motion", () => {
    expect(mRadius.control).toBe(4);
    expect(mRadius.sheet).toBe(6);
    expect(mMotion.duration).toBe(120);
    expect(mMotion.ease).toBe("ease-out");
  });
});

// frontend/design/tokens.test.ts
import { describe, expect, it, vi } from "vitest";
import { mColor, mSpace, mRadius, mMotion, reducedMotion } from "./tokens";

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
    expect(mMotion.slow).toBe(320);
    expect(mMotion.draw).toBe(640);
    expect(mMotion.shimmer).toBe(1400);
  });

  it("reducedMotion() reads prefers-reduced-motion from matchMedia", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(reducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    vi.unstubAllGlobals();
  });
});

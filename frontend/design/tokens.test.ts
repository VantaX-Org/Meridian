// frontend/design/tokens.test.ts
import { describe, expect, it, vi } from "vitest";
import { mColor, mSpace, mRadius, mMotion, dqsBand, reducedMotion } from "./tokens";

describe("design tokens", () => {
  it("exposes 10 chart series colours as CSS var references", () => {
    expect(mColor.viz).toHaveLength(10);
    for (const v of mColor.viz) expect(v).toMatch(/^var\(--m-viz-\d+\)$/);
  });

  it("exposes the 4px space scale", () => {
    expect(mSpace[1]).toBe(4);
    expect(mSpace[6]).toBe(24);
    expect(mSpace[24]).toBe(96);
  });

  it("exposes radius and motion", () => {
    expect(mRadius.control).toBe(10);
    expect(mRadius.sheet).toBe(16);
    expect(mRadius.tile).toBe(0);
    expect(mMotion.duration).toBe(120);
    expect(mMotion.ease).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(mMotion.slow).toBe(240);
    expect(mMotion.draw).toBe(480);
    expect(mMotion.shimmer).toBe(1400);
  });

  it("dqsBand picks the colour key by threshold", () => {
    const b = { target: 90, warning: 75, critical: 60 };
    expect([95, 90, 80, 75, 65, 60, 10].map((n) => dqsBand(n, b))).toEqual(["pass", "pass", "medium", "medium", "high", "high", "critical"]);
  });

  it("reducedMotion() reads prefers-reduced-motion from matchMedia", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(reducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    vi.unstubAllGlobals();
  });
});

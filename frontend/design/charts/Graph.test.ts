import { describe, it, expect } from "vitest";
import { edgeBand, edgeColor, edgeWidth, layoutGraph } from "./Graph";

describe("layoutGraph", () => {
  it("is deterministic for the same input", () => {
    const nodes = [{ id: "a", size: 1 }, { id: "b", size: 2 }, { id: "c", size: 1 }];
    const edges = [{ source: "a", target: "b" }];
    const p1 = layoutGraph(nodes, edges, { iterations: 50 });
    const p2 = layoutGraph(nodes, edges, { iterations: 50 });
    expect(p1).toEqual(p2);
  });

  it("keeps all points within bounds", () => {
    const nodes = [{ id: "a", size: 1 }, { id: "b", size: 1 }];
    const edges: { source: string; target: string }[] = [];
    const points = layoutGraph(nodes, edges, { width: 100, height: 80, iterations: 50 });
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(80);
    }
  });

  it("returns one point per node", () => {
    const nodes = [{ id: "a", size: 1 }, { id: "b", size: 1 }, { id: "c", size: 1 }];
    const points = layoutGraph(nodes, [], { iterations: 10 });
    expect(points.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("edge styling", () => {
  it("edgeWidth maps weight 0 to 1 and weight 1 to 5 plus one for the frequent band, clamped", () => {
    expect(edgeWidth(0)).toBe(1);
    expect(edgeWidth(1)).toBe(6);
    expect(edgeWidth(0.5)).toBe(3);
    expect(edgeWidth(-2)).toBe(1);
    expect(edgeWidth(9)).toBe(6);
  });

  it("edgeBand splits at 0.25 and 0.6", () => {
    expect(edgeBand(0.1)).toBe("low");
    expect(edgeBand(0.25)).toBe("mid");
    expect(edgeBand(0.6)).toBe("mid");
    expect(edgeBand(0.61)).toBe("high");
  });

  it("edgeColor puts bottleneck over rework over band", () => {
    expect(edgeColor({ weight: 0.9, bottleneck: true, rework: true })).toBe("var(--m-critical)");
    expect(edgeColor({ weight: 0.9, rework: true })).toBe("var(--m-high)");
    expect(edgeColor({ weight: 0.9 })).toBe("var(--m-ink-2)");
    expect(edgeColor({ weight: 0.1 })).toBe("var(--m-line-strong)");
  });
});

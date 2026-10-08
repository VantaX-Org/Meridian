import { describe, it, expect } from "vitest";
import { layoutGraph } from "./Graph";

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

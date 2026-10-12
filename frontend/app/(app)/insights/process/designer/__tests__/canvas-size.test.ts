import { describe, expect, it } from "vitest";
import type { L4 } from "@/types/process-model";
import { buildNodes } from "../_components/canvas";
import { SIZE } from "../_components/layout";

describe("canvas node dimensions", () => {
  it("match SIZE for every node type", () => {
    const types = Object.keys(SIZE) as (keyof typeof SIZE)[];
    const l4 = {
      activities: [],
      diagram: { nodes: types.map((t) => ({ id: t, type: t })), flows: [] },
    } as unknown as L4;
    const out = buildNodes(l4, null, null, {}, Object.fromEntries(types.map((t) => [t, { x: 0, y: 0 }])));
    expect(out).toHaveLength(types.length);
    for (const n of out) {
      expect(n.width).toBe(SIZE[n.id as keyof typeof SIZE].w);
      expect(n.height).toBe(SIZE[n.id as keyof typeof SIZE].h);
    }
  });
});

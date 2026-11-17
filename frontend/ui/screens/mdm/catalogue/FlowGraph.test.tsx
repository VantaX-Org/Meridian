import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Dfg, NodeStats } from "@/lib/api/v2/discovery";
import { FlowGraph, dqTone, layout } from "./FlowGraph";

const node = (id: string, name: string, dq: number | null = 0, observed = true): NodeStats => ({ id, name, source: "mined", observed, case_count: 10, share: 0.1, median_seconds: null, fitness: null, dq_defects: dq });
const edge = (source: string, target: string, count: number) => ({ source, target, count, median_seconds: null });
const nodes = [node("A", "Create"), node("B", "Approve", 3), node("C", "Pay", null), node("D", "Archive", 0, false)];
const edges = [edge("A", "B", 40), edge("B", "C", 30), edge("C", "B", 5), edge("A", "C", 2), edge("B", "B", 1), edge("X", "A", 9)];
const dfg: Dfg = { level: 2, node: node("P", "Process"), nodes, edges };

describe("flow graph layout", () => {
  it("layers by longest path, keeps loops out of the layering and drops unknown steps", () => {
    const { pos, back, live } = layout(nodes, edges);
    expect(pos.get("A")?.x).toBeLessThan(pos.get("B")?.x ?? 0);
    expect(pos.get("B")?.x).toBeLessThan(pos.get("C")?.x ?? 0);
    expect(back.has("C>B")).toBe(true);
    expect(back.has("A>B")).toBe(false);
    expect(live.some((e) => e.source === "X" || e.source === e.target)).toBe(false);
    expect(pos.get("D")?.x).toBe(pos.get("A")?.x);
  });

  it("colours a step by its data quality", () => {
    expect(nodes.map(dqTone)).toEqual(["pass", "crit", "quiet", "pass"]);
  });
});

describe("flow graph", () => {
  it("lights the picked variant and opens a step", () => {
    const open = vi.fn();
    render(<FlowGraph dfg={dfg} variant={["Create", "Approve"]} onOpen={open} testId="g" />);
    expect(screen.getByTestId("pd-node-A")).toHaveAttribute("data-on", "true");
    expect(screen.getByTestId("pd-node-C")).toHaveAttribute("data-on", "false");
    expect(screen.getByTestId("pd-node-B")).toHaveAttribute("data-tone", "crit");
    expect(screen.getByTestId("pd-node-D")).toHaveTextContent("Not observed");
    expect(screen.getByTestId("g").querySelectorAll("path[marker-end]").length).toBe(4);
    fireEvent.click(screen.getByTestId("pd-node-B"));
    expect(open).toHaveBeenCalledWith(nodes[1]);
  });
});

// frontend/app/(app)/insights/process/designer/__tests__/level-table.test.tsx
// The level table counts activities under the page's own verdict words: No-go and At risk.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DqColour, ProcessModelDocument } from "@/types/process-model";
import { LevelTable } from "../_components/level-table";

const act = (id: string) => ({ id, name: id }) as never;
const DOC = {
  schema_version: 1,
  l1: [{
    id: "PTP", name: "Procure to pay", description: "", order: 0, modules: [],
    l2: [{ id: "L2", name: "Buy", description: "", order: 0, l3: [{ id: "L3", name: "Order", description: "", order: 0, l4: [{
      id: "L4", name: "Create PO", description: "", order: 0, tcode: null, config_dependency: null, diagram: {}, variants: [],
      activities: [act("a1"), act("a2"), act("a3")],
    }] }] }],
  }],
} as unknown as ProcessModelDocument;

const COLOURS: Record<string, DqColour> = { a1: "red", a2: "amber", a3: "amber" };

describe("LevelTable", () => {
  it("heads the counts No-go and At risk, the words of the page's stats", () => {
    render(
      <LevelTable doc={DOC} parent={null} parentLevel={0} colour={(id) => COLOURS[id]}
        actions={{ rename: vi.fn(), add: vi.fn(), remove: vi.fn(), move: vi.fn() }}
        onOpen={vi.fn()} editable onBlocked={vi.fn()} canDesign={false} />,
    );
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Name", "Activities", "No-go", "At risk"]);
    const row = screen.getByRole("button", { name: "Procure to pay" }).closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(1)).toEqual(["3", "1", "2"]);
  });

  it("shows a dash, not zero, when no run is shown on the model", () => {
    render(
      <LevelTable doc={DOC} parent={null} parentLevel={0} colour={() => undefined} hasData={false}
        actions={{ rename: vi.fn(), add: vi.fn(), remove: vi.fn(), move: vi.fn() }}
        onOpen={vi.fn()} editable onBlocked={vi.fn()} canDesign={false} />,
    );
    const row = screen.getByRole("button", { name: "Procure to pay" }).closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent).slice(1)).toEqual(["3", "—", "—"]);
  });
});

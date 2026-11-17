import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import type { ProcessModelDocument } from "@/types/process-model";
import { ProcessDesign, moduleActivities } from "./ProcessDesign";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/o/ecc-production/material-master/design?fixture=1");
});
afterEach(() => undo());

const o = { label: "Material master" } as ObjectRun;
const render = () => renderWithQuery(<AletheiaProvider><ProcessDesign o={o} system="ecc-production" module="material_master" /></AletheiaProvider>);
const leaf = (id: string) => ({ id, name: id, description: "", order: 1, tcode: null, fields: [], check_ids: [], sap_tables: [] });
const l1 = (id: string, modules: string[], acts: string[]) => ({
  id, name: id, description: "", order: 1, modules,
  l2: [{ id: `${id}-2`, name: "", description: "", order: 1, l3: [{ id: `${id}-3`, name: "", description: "", order: 1, l4: [{ id: `${id}-4`, name: "Step", description: "", order: 1, tcode: null, config_dependency: null, activities: acts.map(leaf), variants: [], diagram: { nodes: [], flows: [] } }] }] }],
});

describe("ProcessDesign", () => {
  it("moduleActivities keeps the processes that list the module, or every process when none does", () => {
    const doc = { schema_version: 1, source: "template", l1: [l1("PTP", ["material_master"], ["A1", "A2"]), l1("OTC", ["sd_sales_orders"], ["B1"])] } as unknown as ProcessModelDocument;
    expect(moduleActivities(doc, "material_master").map((r) => r.act.id)).toEqual(["A1", "A2"]);
    expect(moduleActivities(doc, "hcm").map((r) => r.act.id)).toEqual(["A1", "A2", "B1"]);
  });

  it("asks for a name before it creates a model, then creates and opens it", async () => {
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Create model" }));
    expect(await screen.findByText("Give the model a name.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New model name"), { target: { value: "Plant model" } });
    fireEvent.click(screen.getByRole("button", { name: "Create model" }));
    expect(await screen.findByText("Plant model created")).toBeTruthy();
    expect(await screen.findByRole("group", { name: "Activities in Plant model" })).toBeTruthy();
  });

  it("deletes an activity and saves the model as a new version", async () => {
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Open Group process model" }));
    const table = await screen.findByRole("group", { name: "Activities in Group process model" });
    expect((screen.getByRole("button", { name: "Save new version" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(table).getByRole("button", { name: "Delete activity Enter order header" }));
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    expect(await screen.findByText("Saved as version 2")).toBeTruthy();
  });

  it("deletes a model after the confirmation", async () => {
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Plant model" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete model" }));
    expect(await screen.findByText("Plant model deleted. Runs and readiness already computed stay.")).toBeTruthy();
  });
});

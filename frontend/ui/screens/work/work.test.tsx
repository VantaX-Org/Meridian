import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Work } from "./Work";
import { Triage } from "./Triage";
import { Exceptions } from "./Exceptions";
import { WorkAnalytics } from "./WorkAnalytics";
import { DataRequests } from "./DataRequests";
import { Approvals } from "./Approvals";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

const cases: [string, string, () => ReactElement][] = [
  ["Fix records", "/work", () => <Work />],
  ["Triage", "/work/triage", () => <Triage />],
  ["Exceptions", "/work/exceptions", () => <Exceptions />],
  ["Work analytics", "/work/analytics", () => <WorkAnalytics />],
  ["Data requests", "/work/requests", () => <DataRequests />],
  ["Approvals", "/approvals", () => <Approvals />],
];

describe("work screens in fixture mode", () => {
  it.each(cases)("%s shows its title and a data row", async (title, path, el) => {
    window.history.replaceState(null, "", `${path}?fixture=1`);
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close">{el()}</SheetHost></AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: title as string })).toBeTruthy();
    expect((await screen.findAllByRole("row", {}, { timeout: 5000 })).length).toBeGreaterThan(1);
  });
});

describe("Simulate fixing", () => {
  it("rescores the loaded records' object and says nothing changes", async () => {
    window.history.replaceState(null, "", "/work?fixture=1");
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><Work /></SheetHost></AletheiaProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "More tools" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Simulate fixing" }));
    const dialog = await screen.findByRole("dialog", { name: "Simulate fixing" });
    expect(within(dialog).getByText("Simulation: nothing is changed in SAP or in Meridian.")).toBeTruthy();
    expect(await within(dialog).findByTestId("sim-result", {}, { timeout: 5000 })).toBeTruthy();
    expect(within(dialog).getByText("Score after, simulated")).toBeTruthy();
  });
});

describe("work analytics cleaning engine pace", () => {
  it("shows the operational pace, outcome rates and the most cleaned object", async () => {
    window.history.replaceState(null, "", "/work/analytics?fixture=1");
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><WorkAnalytics /></SheetHost></AletheiaProvider>);
    const pace = await screen.findByTestId("cleaning-pace", {}, { timeout: 5000 });
    expect(pace.textContent).toContain("412.5");
    expect(pace.textContent).toContain("7,425");
    expect(pace.textContent).toContain("38%");
    expect(screen.getByRole("list", { name: "Cleaning outcome rates" })).toBeTruthy();
    expect(pace.textContent).toContain("material_master");
  });
});

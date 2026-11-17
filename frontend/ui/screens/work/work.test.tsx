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

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

const cases: [string, string, () => ReactElement][] = [
  ["Work", "/work", () => <Work />],
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
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect((await screen.findAllByRole("row", {}, { timeout: 5000 })).length).toBeGreaterThan(1);
  });
});

describe("Simulate fixing", () => {
  it("rescores the loaded records' object and says nothing changes", async () => {
    window.history.replaceState(null, "", "/work?fixture=1");
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><Work /></SheetHost></AletheiaProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Simulate fixing" }, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog", { name: "Simulate fixing" });
    expect(within(dialog).getByText("Simulation: nothing is changed in SAP or in Meridian.")).toBeTruthy();
    expect(await within(dialog).findByTestId("sim-result", {}, { timeout: 5000 })).toBeTruthy();
    expect(within(dialog).getByText("Score after, simulated")).toBeTruthy();
  });
});

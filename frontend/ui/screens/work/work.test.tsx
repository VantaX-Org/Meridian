import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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

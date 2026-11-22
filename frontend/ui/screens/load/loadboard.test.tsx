import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Load } from "./Load";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/load?fixture=1"); });
afterEach(() => undo());

describe("load board in fixture mode", () => {
  it("shows three scores on one ruler, why they differ and the reconciliation", async () => {
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><Load /></SheetHost></AletheiaProvider>);
    expect(await screen.findByTestId("load-board", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByRole("img", { name: /Source, projected target and actual target/ }, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("Lost in the load", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("MM-MARC-DISMM-004", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Export reconciliation" })).toBeTruthy();
  });
  it("keeps the load order and files below the board", async () => {
    renderWithQuery(<AletheiaProvider><Load /></AletheiaProvider>);
    expect(await screen.findByText("Everything in Load", undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe("reasonText", () => {
  it("reads reconciliation reason codes as text", async () => {
    const { reasonText } = await import("./LoadBoard");
    expect(reasonText("target_extract_partial")).toBe("Target extract was partial");
    expect(reasonText("something_new")).toBe("Not comparable");
    expect(reasonText(null)).toBe("Not comparable");
  });
});

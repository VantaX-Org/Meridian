import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { MonitorBoard } from "./MonitorBoard";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/monitor?fixture=1"); });
afterEach(() => undo());

describe("monitor board in fixture mode", () => {
  it("shows the tiles, the learned monitors with their actions and the quiet breaks", async () => {
    renderWithQuery(<AletheiaProvider><MonitorBoard /></AletheiaProvider>);
    expect(await screen.findByTestId("monitor-board", undefined, { timeout: 5000 })).toBeTruthy();
    expect((await screen.findAllByText("Monitors breaking", undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("MARA.BRGEW", undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Field emptied").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Acknowledge" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Open" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Acknowledge all low" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clean what broke" })).toBeTruthy();
    expect(screen.getByText("Quiet breaks")).toBeTruthy();
    expect(screen.getByText("MM021")).toBeTruthy();
  });
});

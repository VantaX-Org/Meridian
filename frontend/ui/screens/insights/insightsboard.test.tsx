import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { InsightsBoard } from "./InsightsBoard";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/insights?fixture=1"); });
afterEach(() => undo());

describe("insights board in fixture mode", () => {
  it("shows the five sections, the ruler and the evidence", async () => {
    renderWithQuery(<AletheiaProvider><InsightsBoard /></AletheiaProvider>);
    expect(await screen.findByTestId("insights-board", undefined, { timeout: 5000 })).toBeTruthy();
    for (const h of ["Where the score is going", "What moves the next score", "Value at risk", "Anomalies", "Proof of value"]) {
      expect(await screen.findByText(h, undefined, { timeout: 5000 })).toBeTruthy();
    }
    expect(screen.getByRole("img", { name: "Score now on the ruler, gates at 70 and 85" })).toBeTruthy();
  });
});

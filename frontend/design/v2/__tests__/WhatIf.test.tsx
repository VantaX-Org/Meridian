import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { WhatIf } from "../screens/WhatIf";
import { resetSimulationsFixture } from "@/lib/api/v2/fixtures/simulations";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  resetSimulationsFixture();
  resetKeptOutcomes();
  setUrl("/run/v-1?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("WhatIf", () => {
  it("simulates a value map and shows the score change and the side effect", async () => {
    renderWithQuery(<WhatIf run="v-1" canRun />);
    fireEvent.click(screen.getByRole("button", { name: "Add a value map" }));
    fireEvent.change(screen.getByLabelText("Table and field of map 1"), { target: { value: "mara.mtart" } });
    fireEvent.change(screen.getByLabelText("New value of map 1"), { target: { value: "FERT" } });
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    const result = await screen.findByTestId("whatif-result", {}, { timeout: 5000 });
    expect(result.textContent).toContain("Score 71.4 to 78.9 (+7.5)");
    expect(within(screen.getByRole("table", { name: "Side effects" })).getByText("MM205")).toBeTruthy();
  });

  it("blocks an empty request and a key that is not TABLE.FIELD", () => {
    renderWithQuery(<WhatIf run="v-1" canRun />);
    expect((screen.getByRole("button", { name: "Simulate" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add a value map" }));
    fireEvent.change(screen.getByLabelText("Table and field of map 1"), { target: { value: "MTART" } });
    expect(screen.getByRole("alert").textContent).toContain("TABLE.FIELD");
    expect((screen.getByRole("button", { name: "Simulate" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the editor from a role without analyse", () => {
    renderWithQuery(<WhatIf run="v-1" canRun={false} />);
    expect(screen.queryByRole("button", { name: "Simulate" })).toBeNull();
    expect(screen.getByText("Simulating needs the analyse permission.")).toBeTruthy();
  });
});

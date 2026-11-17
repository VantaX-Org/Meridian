import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Material360, cellState, levelText } from "./Material360";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/o/ecc-production/material-master/records/10004711?fixture=1");
});
afterEach(() => undo());

describe("Material 360", () => {
  it("reads levels and marks an existing cell with a failing rule as failing", () => {
    expect(levelText("plant:1000")).toBe("Plant 1000");
    expect(levelText("client")).toBe("Client");
    const failing = new Map([["mrp|plant:1000", [{ check_id: "MM1", message: null, severity: "high", level: "plant:1000", record_key: "k" }]]]);
    expect(cellState("ok", "mrp", "plant:1000", failing)).toBe("failing");
    expect(cellState("ok", "mrp", "plant:2000", failing)).toBe("ok");
    expect(cellState("missing", "mrp", "plant:1000", failing)).toBe("missing");
  });

  it("shows the views matrix, failing rules, follow-up chain and look-alikes for a material", async () => {
    renderWithQuery(<Material360 matnr="10004711" />);
    const views = await screen.findByRole("group", { name: "Views by level" });
    expect(within(views).getByText("Plant 1000")).toBeTruthy();
    expect(await screen.findByRole("group", { name: "Materials that look like it" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Materials that look like it" })).getByText("000000000010006640")).toBeTruthy();
    expect(screen.getByText("Rules failing")).toBeTruthy();
    expect(await screen.findByText("Follow-up chain")).toBeTruthy();
  });

  it("says when the material is not in the material master", async () => {
    renderWithQuery(<Material360 matnr="99999" />);
    expect(await screen.findByText("This material is not in the material master.")).toBeTruthy();
  });
});

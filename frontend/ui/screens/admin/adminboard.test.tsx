import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { ADMIN_SHEETS } from "./sheets";
import { Admin } from "./Admin";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/admin?fixture=1"); });
afterEach(() => undo());

describe("admin board in fixture mode", () => {
  it("shows systems, licence, schedule, people and the audit trail with their actions", async () => {
    renderWithQuery(<AletheiaProvider><SheetHost sheets={ADMIN_SHEETS} closeLabel="Close"><Admin /></SheetHost></AletheiaProvider>);
    expect(await screen.findByTestId("admin-board", undefined, { timeout: 5000 })).toBeTruthy();
    expect((await screen.findAllByTestId("admin-system", undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    for (const name of ["Add a system", "Upload licence file", "Change schedule", "Update now", "Invite a person", "Edit roles"]) {
      expect(await screen.findByRole(name === "Add a system" || name === "Change schedule" || name === "Invite a person" || name === "Edit roles" ? "link" : "button", { name }, { timeout: 5000 })).toBeTruthy();
    }
    expect((await screen.findAllByRole("button", { name: "Test connection" })).length).toBeGreaterThan(0);
    expect(screen.getByText("Audit trail", { selector: "h2, h3, [class*=title]" })).toBeTruthy();
  });
  it("keeps the section links below the board", async () => {
    renderWithQuery(<AletheiaProvider><Admin /></AletheiaProvider>);
    expect(await screen.findByRole("link", { name: /Users/ })).toBeTruthy();
  });
});

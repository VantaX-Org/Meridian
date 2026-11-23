import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { CleaningPlan } from "./CleaningPlan";

const can = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allowed }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  can.allowed = true;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/clean?fixture=1");
});
afterEach(() => undo());

const view = () => renderWithQuery(<AletheiaProvider><ToastHost><CleaningPlan /></ToastHost></AletheiaProvider>);

describe("Cleaning plan", () => {
  it("lists why rules fail and drafts a fix that opens in a sheet", async () => {
    view();
    expect((await screen.findAllByRole("button", { name: "Draft a fix" }, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fix batches").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Draft a fix" })[0]);
    const sheet = within(await screen.findByRole("dialog", { name: "Drafted fix" }));
    expect(await sheet.findByText("Fixed by the draft")).toBeTruthy();
    expect(sheet.getByText(/changes nothing/)).toBeTruthy();
    expect(await screen.findByText("Fix drafted. It waits for a steward.")).toBeTruthy();
  });

  it("disables drafting with a reason without the manage rules permission", async () => {
    can.allowed = false;
    view();
    await screen.findAllByRole("button", { name: "Draft a fix" }, { timeout: 4000 });
    const b = screen.getAllByRole("button", { name: "Draft a fix" })[0] as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe("You need the manage rules permission to draft a fix.");
  });
});

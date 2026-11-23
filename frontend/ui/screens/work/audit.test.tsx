import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { CleaningQueue } from "./CleaningQueue";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

describe("Cleaning queue reject", () => {
  it("keeps the dialog open and asks for a reason when the reason is empty", async () => {
    window.history.replaceState(null, "", "/work/cleaning?fixture=1");
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><CleaningQueue /></SheetHost></AletheiaProvider>);
    fireEvent.click((await screen.findAllByRole("row", {}, { timeout: 5000 }))[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Reject the group" }, { timeout: 5000 }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reject the fix" });
    expect(within(dialog).getByText("A reason is required.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("alertdialog", { name: "Reject the fix" })).toBeTruthy();
  });
});

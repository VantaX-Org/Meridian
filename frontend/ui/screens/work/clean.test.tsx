import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { CleanBoard } from "./CleanBoard";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

const mount = () => {
  window.history.replaceState(null, "", "/work?fixture=1");
  renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><CleanBoard /></SheetHost></AletheiaProvider>);
};

describe("Clean board in fixture mode", () => {
  it("shows the header, the four steps, the score and the empty upload card", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: /Clean cycle/ }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Object" })).toBeTruthy();
    const steps = await screen.findByRole("list", { name: "State of each step" });
    for (const s of ["Pull", "Clean in Excel", "Upload", "New DQS"]) expect(within(steps).getByText(s)).toBeTruthy();
    expect(await screen.findByText("Score and gates")).toBeTruthy();
    expect(screen.getByText("No upload to check yet")).toBeTruthy();
  });

  it("lists the workbook sheets and the auto-cleanse safety note", async () => {
    mount();
    expect(await screen.findByText("Start here", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Fix list")).toBeTruthy();
    expect(screen.getByText("Allowed values")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download workbook again" })).toBeTruthy();
    expect(await screen.findByText("Every fix is logged and can be rolled back.", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Findings and fixes by week")).toBeTruthy();
    expect(screen.getByText("Cycles so far")).toBeTruthy();
  });

  it("checks an uploaded file and offers to apply it", async () => {
    mount();
    const input = await screen.findByLabelText("Choose the cleaned file", {}, { timeout: 5000 });
    fireEvent.change(input, { target: { files: [new File(["x"], "cleaned.xlsx")] } });
    expect(await screen.findByText("Ready to apply", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace file" })).toBeTruthy();
  });
});

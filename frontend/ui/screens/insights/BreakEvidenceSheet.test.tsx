import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { Monitor } from "./Monitor";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/monitor?fixture=1&view=learned"); });
afterEach(() => undo());

describe("break evidence", () => {
  it("shows the baseline behind a learned break", async () => {
    renderWithQuery(<AletheiaProvider><Monitor /></AletheiaProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Evidence" }, { timeout: 5000 }))[0]);
    const sheet = within(await screen.findByRole("dialog", { name: "Break evidence" }));
    expect(await sheet.findByText("Baseline runs", undefined, { timeout: 5000 })).toBeTruthy();
  });
});

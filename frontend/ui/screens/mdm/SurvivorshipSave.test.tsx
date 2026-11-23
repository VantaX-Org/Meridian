import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { Survivorship } from "./Survivorship";

const can = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allowed }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  can.allowed = true;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/mdm/survivorship?fixture=1");
});
afterEach(() => undo());

const open = async () => {
  renderWithQuery(<AletheiaProvider><ToastHost><Survivorship /></ToastHost></AletheiaProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Save rules" }, { timeout: 4000 }));
  return within(await screen.findByRole("dialog", { name: "Check survivorship rules" }));
};

describe("Survivorship save preview", () => {
  it("previews the golden value changes, then saves after a confirm that names the counts", async () => {
    const d = await open();
    expect(await d.findByText("Records that change")).toBeTruthy();
    expect(d.getByText("Fields that change")).toBeTruthy();
    fireEvent.click(d.getByRole("button", { name: "Save rules" }));
    expect(await screen.findByText(/replace the rules in place/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace the rules" }));
    expect(await screen.findByText("Rules saved")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check survivorship rules" })).toBeNull());
  });

  it("disables saving with a reason when the user cannot write master data", async () => {
    can.allowed = false;
    const d = await open();
    await d.findByText("Records that change");
    expect((d.getByRole("button", { name: "Save rules" }) as HTMLButtonElement).disabled).toBe(true);
    expect(d.getAllByText("You need the master data write permission to save rules.").length).toBeGreaterThan(0);
  });

  it("returns to editing without saving", async () => {
    const d = await open();
    await d.findByText("Records that change");
    fireEvent.click(d.getByRole("button", { name: "Back to editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check survivorship rules" })).toBeNull());
  });
});

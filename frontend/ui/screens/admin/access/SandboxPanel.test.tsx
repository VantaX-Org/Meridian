import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ToastHost } from "@/ui/kit";
import { resetStep10Fixture } from "@/lib/api/v2/fixtures/step10";
import { SandboxPanel } from "./SandboxPanel";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
const can = vi.hoisted(() => ({ allow: true }));
vi.mock("../common", () => ({ useCan: () => () => can.allow }));

let undo: () => void = () => undefined;
beforeEach(() => { can.allow = true; resetStep10Fixture(); undo = stubLayout(); window.history.replaceState(null, "", "/admin/settings?fixture=1"); });
afterEach(() => undo());
const mount = () => renderWithQuery(<ToastHost><SandboxPanel /></ToastHost>);

describe("SandboxPanel", () => {
  it("switches on only after a confirm, then lists the copied rows", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review switching it on" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain("latest finished run is copied");
    fireEvent.click(screen.getByRole("button", { name: "Switch it on" }));
    expect(await screen.findByLabelText("Rows copied")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Review switching it off" })).toBeTruthy();
  });

  it("names the discard and the held back count before switching off", async () => {
    window.history.replaceState(null, "", "/admin/settings?fixture=1&sandbox=1");
    resetStep10Fixture();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review switching it off" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain("1 sandbox runs are discarded");
    expect(dlg.textContent).toContain("3 held back deliveries");
    fireEvent.click(screen.getByRole("button", { name: "Discard and switch off" }));
    expect(await screen.findByLabelText("Rows discarded")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review switching it on" })).toBeTruthy());
  });

  it("disables both actions without the role and says why", async () => {
    can.allow = false;
    mount();
    const b = (await screen.findByRole("button", { name: "Review switching it on" })) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(screen.getByText("Only a system administrator can switch sandbox mode.")).toBeTruthy();
  });
});

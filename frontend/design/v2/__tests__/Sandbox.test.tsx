import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse, fixtureWrite, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s10 from "@/lib/api/v2/step10";
import type { StatusStrip } from "@/lib/api/v2/types";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { AdminCanvas } from "../admin/Admin";
import { resetKeptOutcomes } from "../inspector/shared";
import { V2Shell } from "../shell/V2Shell";
import { WorkCanvas } from "../screens/Work";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "steward", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  resetWorkFixture();
  resetActions();
  clearPatches();
  resetKeptOutcomes();
  undo = stubLayout(1400, 600);
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const visit = (url: string) => {
  window.history.pushState({}, "", url);
  setUrl(url);
};
const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("sandbox mode", () => {
  it("the shell carries a banner across every page while the status says sandbox, with since and by", async () => {
    visit("/work?fixture=1&sandbox=1");
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    const banner = await screen.findByTestId("sandbox-banner");
    expect(banner).toHaveTextContent("Sandbox: nothing leaves this deployment.");
    await waitFor(() => expect(norm(banner)).toContain("Since 20 Oct 2026, 07:15, by Demo user."));
    expect(within(banner).getByRole("link", { name: "Sandbox settings" })).toHaveAttribute("href", expect.stringContaining("/admin/settings"));
  });

  it("there is no banner when the tenant is not in sandbox", async () => {
    setUrl("/?fixture=1");
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    await screen.findByRole("heading", { name: "Page" });
    await waitFor(() => expect(fixtureResponse<StatusStrip>("/status", {}).sandbox).toBe(false));
    expect(screen.queryByTestId("sandbox-banner")).toBeNull();
  });

  it("Settings enters sandbox mode with manage_system, shows the run copied, and exits after a confirmation", async () => {
    const enter = vi.spyOn(s10, "enterSandbox");
    const exit = vi.spyOn(s10, "exitSandbox");
    setUrl("/admin/settings?fixture=1");
    renderWithQuery(<AdminCanvas section="settings" />);
    const block = await screen.findByRole("region", { name: "Sandbox mode" });
    await waitFor(() => expect(norm(block)).toContain("StateOff"));
    fireEvent.click(within(block).getByRole("switch", { name: "Enter sandbox mode" }));
    const dlg = await screen.findByRole("dialog", { name: "Enter sandbox mode" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Copy the latest run and enter" }));
    await waitFor(() => expect(enter).toHaveBeenCalledWith(true));
    expect(await within(block).findByText("Sandbox mode is on")).toBeInTheDocument();
    await waitFor(() => expect(norm(block)).toContain("In sandbox"));
    expect(norm(block)).toContain("794 findings");
    expect(within(block).getByRole("link", { name: "sbx-d3229ded" })).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("switch", { name: "Exit sandbox mode" }));
    const out = await screen.findByRole("dialog", { name: "Exit sandbox mode" });
    fireEvent.click(within(out).getByRole("button", { name: "Discard the sandbox and exit" }));
    await waitFor(() => expect(exit).toHaveBeenCalled());
    expect(await within(block).findByText("Sandbox mode is off")).toBeInTheDocument();
  });

  it("without manage_system the state is shown and the buttons are not", async () => {
    h.allowed = ["view", "manage_settings"];
    setUrl("/admin/settings?fixture=1");
    renderWithQuery(<AdminCanvas section="settings" />);
    const block = await screen.findByRole("region", { name: "Sandbox mode" });
    expect(await within(block).findByText("Entering and exiting sandbox mode needs the manage system permission.")).toBeInTheDocument();
    expect(within(block).queryByRole("button", { name: "Enter sandbox mode" })).toBeNull();
  });

  it("a decision on the real run while in sandbox shows the server's 409 reason", async () => {
    visit("/work?fixture=1&sandbox=1&persona=steward");
    expect(() => fixtureWrite("POST", "/work/decide", { items: [] }, {})).toThrow(/Sandbox mode is on/);
    renderWithQuery(<V2Shell><WorkCanvas /></V2Shell>);
    const grid = await screen.findByRole("grid", { name: "Work ledger" });
    const row = (await within(grid).findByTitle("000000000000000100")).closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox"));
    fireEvent.keyDown(document.body, { key: "a" });
    expect(await screen.findByText("Sandbox mode is on: decisions apply to the sandbox run only. Exit the sandbox to work on the real run.")).toBeInTheDocument();
  });

  it("a digest sent in sandbox is held back and counted", () => {
    visit("/admin/digests?fixture=1&sandbox=1");
    const r = fixtureWrite<s10.DigestSend>("POST", "/digests/dg-1/send-now", undefined, {});
    expect(r).toMatchObject({ status: "skipped", reason: "sandbox", delivered: 0 });
    expect(fixtureResponse<s10.SandboxState>("/admin/sandbox", {}).skipped_deliveries).toBe(4);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import "../../shell/sheets";
import { RuleDetail } from "../RuleDetail";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetObjectFixture();
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const show = (url = "/more/rules/MM142?fixture=1") => {
  setUrl(url);
  return renderWithQuery(
    <ToastProvider>
      <SheetHost>
        <RuleDetail id="MM142" />
      </SheetHost>
    </ToastProvider>,
  );
};

describe("rule detail (next)", () => {
  it("holds the layout while the rule loads", () => {
    show();
    expect(screen.getByTestId("rule-detail-loading")).toBeInTheDocument();
  });

  it("names the rule, states the failing count and offers one primary action", async () => {
    show();
    const banner = await screen.findByTestId("rule-banner");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Base unit of measure MEINS must reference a valid entry in T006");
    expect(within(banner).getByRole("button", { name: "Show the failing records" })).toBeInTheDocument();
    expect(screen.getByTestId("rule-stat-line").textContent).not.toBe("");
    expect(screen.getByTestId("rule-tab-hint")).toHaveTextContent("Where the failures are");
  });

  it("moves to the failing records tab from the banner and keeps the URL", async () => {
    const view = show();
    fireEvent.click(await screen.findByRole("button", { name: "Show the failing records" }));
    expect(getUrl()).toContain("tab=failing");
    view.unmount();
    show(getUrl());
    expect(await screen.findByTestId("rule-failing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the work queue for this rule" })).toHaveAttribute("href", expect.stringContaining("rule=MM142"));
  });

  it("links back to the object only for an object path", async () => {
    show("/more/rules/MM142?fixture=1&from=/o/ecc-production/material-master&run=r9");
    const back = await screen.findByTestId("rule-back");
    expect(within(back).getByRole("link", { name: "Back to the object" })).toHaveAttribute("href", "/o/ecc-production/material-master?run=r9&fixture=1");
  });

  it("suppresses from the definition tab through the suppression endpoint", async () => {
    const spy = vi.spyOn(objectApi, "suppressRule").mockResolvedValue({ id: "s1", check_id: "MM142", expires_at: "x" });
    show("/more/rules/MM142?fixture=1&tab=definition");
    const acts = await screen.findByTestId("rule-actions");
    fireEvent.click(within(acts).getByRole("button", { name: "Suppress" }));
    const form = screen.getByRole("form", { name: "Suppress MM142" });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Waiting for the unit table refresh" } });
    fireEvent.click(within(form).getByRole("button", { name: "Suppress rule" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("shows the error with a retry when the rule cannot be read", async () => {
    vi.spyOn(objectApi, "getRuleScope").mockRejectedValue(new Error("boom"));
    show("/more/rules/MM142?fixture=1");
    expect(await screen.findByTestId("rule-detail-error", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the rules library" })).toHaveAttribute("href", "/more/rules?fixture=1");
  });
});

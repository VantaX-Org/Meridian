import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import * as rulelib from "@/lib/api/v2/rulelib";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../../kit";
import { RULE_BODIES, RuleInspectorNative } from "../rule";

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

const show = (id: string, url = "/o/ecc-production/material-master?open=rule:MM142&fixture=1&run=r9") => {
  setUrl(url);
  return renderWithQuery(
    <ToastProvider>
      <RuleInspectorNative id={id} onClose={vi.fn()} />
    </ToastProvider>,
  );
};
const section = (name: string | RegExp) => screen.getAllByRole("heading", { level: 3, name })[0].closest("section") as HTMLElement;

describe("rule inspector body (next)", () => {
  it("registers the rule kind", () => {
    expect(Object.keys(RULE_BODIES)).toEqual(["rule"]);
  });

  it("holds the layout with a skeleton while the rule loads", () => {
    show("MM142");
    expect(screen.getByTestId("rule-loading")).toBeInTheDocument();
  });

  it("names the rule and states its facts", async () => {
    show("MM142");
    expect(await screen.findByTestId("rule-name")).toHaveTextContent("Base unit of measure MEINS must reference a valid entry in T006");
    expect(within(section("Facts")).getByText("Severity")).toBeInTheDocument();
    expect(within(section("Actions")).getByTestId("rule-failing")).toHaveAttribute("href", expect.stringContaining("run=r9"));
  });

  it("disables the rule only after the confirm", async () => {
    const spy = vi.spyOn(rulelib, "setRuleEnabled").mockResolvedValue({} as never);
    show("MM142");
    await screen.findByTestId("rule-name");
    fireEvent.click(within(section("Actions")).getByRole("button", { name: "Disable rule" }));
    expect(spy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Disable rule" }).length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByRole("button", { name: "Disable rule" }).at(-1)!);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("rule-MM142", false));
  });

  it("suppresses with a reason through the suppression endpoint", async () => {
    const spy = vi.spyOn(objectApi, "suppressRule").mockResolvedValue({ id: "s1", check_id: "MM142", expires_at: "x" });
    show("MM142");
    await screen.findByTestId("rule-name");
    fireEvent.click(within(section("Actions")).getByRole("button", { name: "Suppress" }));
    const form = screen.getByRole("form", { name: "Suppress MM142" });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Waiting for the unit table refresh" } });
    fireEvent.click(within(form).getByRole("button", { name: "Suppress rule" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0].slice(0, 2)).toEqual(["MM142", "Waiting for the unit table refresh"]);
  });

  it("downloads the reconciliation workbook from Prove in SAP", async () => {
    const spy = vi.spyOn(objectApi, "downloadReconciliationWorkbook").mockResolvedValue("recon.xlsx");
    show("MM142");
    await screen.findByTestId("rule-prove");
    fireEvent.click(screen.getByRole("button", { name: "Download the reconciliation workbook" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.any(String), 10));
    expect(await screen.findByText("Saved recon.xlsx.")).toBeInTheDocument();
  });

  it("says so when the rule cannot be read, and still offers the rule canvas", async () => {
    show("ZZ999", "/?open=rule:ZZ999&fixture=1");
    expect(await screen.findByRole("link", { name: "Open the rule" }, { timeout: 4000 })).toHaveAttribute("href", expect.stringContaining("/r/ZZ999"));
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

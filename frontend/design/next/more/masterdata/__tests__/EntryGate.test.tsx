import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/dq-firewall";
import { ToastProvider } from "../../../kit";
import { EntryGateNative } from "../EntryGate";

const Q = vi.hoisted(() => ({ can: (() => true) as (p: string) => boolean }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = () => renderWithQuery(<ToastProvider><EntryGateNative /></ToastProvider>);
beforeEach(() => { Q.can = () => true; setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Entry gate (native)", () => {
  it("renders the fixture traffic with the object text beside each code", async () => {
    wrap();
    expect((await screen.findByTestId("entry-gate")).textContent).toMatch(/stopped at entry in the last 7 days/);
    const mods = screen.getByTestId("entry-gate-modules");
    expect(within(mods).getByTestId("entry-gate-module-material_master").textContent).toMatch(/material_master/);
  });

  it("checks the sample records against the gate", async () => {
    const run = vi.spyOn(api, "validateRecords").mockResolvedValue({ verdict: "pass", block_severity: "critical", module: "material_master", rules_run: 3, records: [{ index: 0, verdict: "pass", failures: [] }] });
    wrap();
    fireEvent.click(await screen.findByTestId("entry-gate-run"));
    await waitFor(() => expect(run).toHaveBeenCalledWith("material_master", expect.any(Array), expect.objectContaining({ hold: "off" })));
    expect((await screen.findByTestId("entry-gate-result")).textContent).toMatch(/0 of 1 records blocked/);
  });

  it("hides the check without mdm.write and says a 403 cannot be read", async () => {
    Q.can = (p) => p !== "mdm.write";
    vi.spyOn(api, "getFirewallSummary").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the firewall traffic.")).toBeInTheDocument();
    expect(screen.queryByTestId("entry-gate-run")).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as admin from "@/lib/api/v2/admin";
import * as browser from "@/lib/browser";
import * as triage from "@/lib/api/v2/triage";
import * as inbox from "@/lib/api/v2/inbox";
import * as reports from "@/lib/api/v2/reports";
import * as roles from "@/lib/api/v2/roles";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../../kit";
import { PANELS_BODIES } from "../panels";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined, changePassword: vi.fn() }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetWorkFixture();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const show = (kind: string, id = "") => {
  setUrl("/?fixture=1");
  const Body = PANELS_BODIES[kind];
  return renderWithQuery(<ToastProvider><Body id={id} onClose={vi.fn()} /></ToastProvider>);
};
const press = async (name: string | RegExp) => fireEvent.click((await screen.findAllByRole("button", { name }))[0]);

describe("panel inspector bodies (next)", () => {
  it("registers every panel kind", () => {
    expect(Object.keys(PANELS_BODIES)).toEqual(["preferences", "help", "triage", "inbox", "waves", "away", "balance", "contract", "contracts"]);
  });

  it("preferences: shows the language picker and sends a test message", async () => {
    const send = vi.spyOn(admin, "sendTestNotification");
    show("preferences");
    expect(await screen.findByTestId("language-picker")).toBeInTheDocument();
    expect(screen.getByTestId("change-password")).toBeInTheDocument();
    await press("Send me a test message");
    await waitFor(() => expect(send).toHaveBeenCalled());
  });

  it("help: lists the chapters and copies the diagnostics", async () => {
    const copy = vi.spyOn(browser, "writeClipboard").mockResolvedValue(true);
    show("help");
    expect(await screen.findByText("On this screen")).toBeInTheDocument();
    await press(/^Landscape/);
    expect(await screen.findByTestId("help-chapter")).toBeInTheDocument();
    await press("All of help");
    await press("Copy the diagnostics");
    await waitFor(() => expect(copy).toHaveBeenCalled());
  });

  it("triage: shows the escalation chain and saves working hours", async () => {
    const put = vi.spyOn(triage, "putTriageSettings");
    show("triage");
    expect(await screen.findByTestId("escalation-chain")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Timezone"), { target: { value: "Europe/London" } });
    await press("Save working hours");
    await waitFor(() => expect(put).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Europe/London" })));
  });

  it("inbox: shows next steps and marks all read", async () => {
    const all = vi.spyOn(inbox, "putReadAll");
    show("inbox");
    expect(await screen.findByTestId("next-steps")).toHaveTextContent("waits for your approval");
    await press("Mark all read");
    await waitFor(() => expect(all).toHaveBeenCalled());
  });

  it("waves: shows the gate and cockpit and downloads the report", async () => {
    const dl = vi.spyOn(reports, "downloadWaveReport").mockResolvedValue("wave.xlsx");
    show("waves");
    expect((await screen.findAllByTestId("wave-gate")).length).toBeGreaterThan(0);
    expect((await screen.findAllByTestId("wave-cockpit")).length).toBeGreaterThan(0);
    await press("Download the report as Excel");
    await waitFor(() => expect(dl).toHaveBeenCalledWith(expect.any(String), "xlsx"));
  });

  it("away: shows who you cover for and ends it after a confirm", async () => {
    const revoke = vi.spyOn(roles, "revokeDelegation");
    show("away");
    expect(await screen.findByTestId("away-form")).toBeInTheDocument();
    expect(await screen.findByText("You cover for T. Mokoena.")).toBeInTheDocument();
    await press("End it");
    const ends = await screen.findAllByRole("button", { name: "End it" });
    fireEvent.click(ends[ends.length - 1]);
    await waitFor(() => expect(revoke).toHaveBeenCalled());
  });

  it("balance: proposes a plan", async () => {
    const plan = vi.spyOn(roles, "planBalance");
    show("balance");
    expect(await screen.findByText("Even counts")).toBeInTheDocument();
    await press("Propose a plan");
    await waitFor(() => expect(plan).toHaveBeenCalled());
    expect(await screen.findByTestId("balance-plan")).toBeInTheDocument();
  });

  it("contract: shows the breaches and compliance and revises", async () => {
    const revise = vi.spyOn(roles, "reviseContract");
    show("contract", "ct-1");
    expect(await screen.findByTestId("contract-threshold-breaches")).toHaveTextContent("completeness: 62 against 80");
    const table = await screen.findByTestId("contract-compliance");
    expect(table).toHaveTextContent("Met");
    expect(table).toHaveTextContent("Breached");
    await press("Revise as a new version");
    await waitFor(() => expect(revise).toHaveBeenCalledWith("ct-1"));
  });

  it("contracts: lists contracts and creates a draft", async () => {
    const create = vi.spyOn(roles, "createContract");
    show("contracts");
    expect(await screen.findByTestId("contracts-list")).toHaveTextContent("Material master to S/4HANA");
    const form = screen.getByTestId("contract-form");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Customer data" } });
    fireEvent.change(within(form).getByLabelText("Producer (object)"), { target: { value: "customer_master" } });
    fireEvent.change(within(form).getByLabelText("Consumer"), { target: { value: "CRM" } });
    await press("Create a draft");
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Customer data", producer: "customer_master", consumer: "CRM" })));
  });
});

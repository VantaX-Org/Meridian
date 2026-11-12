import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { connectivityCalls, resetConnectivityFixture } from "@/lib/api/v2/fixtures/connectivity";
import { ConnectivitySection } from "../inspector/connectivity";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const SYS = "a1b2c3d4-0001-4000-8000-000000000001";

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetConnectivityFixture();
  resetKeptOutcomes();
  setUrl("/?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const show = async (canSync = true) => {
  renderWithQuery(<ConnectivitySection systemId={SYS} canSync={canSync} />);
  await screen.findByTestId("connectivity-modules");
};
const btn = (name: RegExp | string) => screen.getByRole("button", { name });

describe("connectivity: modules", () => {
  it("lists modules with last read, rows, preview note and Never for an unread module", async () => {
    await show();
    const tbl = screen.getByTestId("connectivity-modules");
    const rows = within(tbl).getAllByRole("row");
    expect(rows.find((r) => r.textContent?.includes("material_master"))!.textContent).toMatch(/184,220/);
    expect(screen.getByTestId("preview-business_partner").textContent).toMatch(/BUT0ID/);
    expect(rows.find((r) => r.textContent?.includes("fi_gl"))!.textContent).toMatch(/Never/);
  });

  it("shows the pulled configuration of a module with its tables", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("button", { name: /^View configuration of/ })[0]);
    const cfg = await screen.findByTestId("pulled-config");
    expect(cfg.textContent).toMatch(/T134/);
    expect(cfg.textContent).toMatch(/T023/);
    expect(cfg.textContent).toMatch(/Finished product/);
  });
});

describe("connectivity: actions", () => {
  it("pull and extract stay disabled until a module is picked", async () => {
    await show();
    expect(btn("Pull configuration")).toBeDisabled();
    expect(btn("Run extract")).toBeDisabled();
  });

  it("without the sync permission every action is disabled", async () => {
    await show(false);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(btn("Run a health check")).toBeDisabled();
    expect(btn("Pull configuration")).toBeDisabled();
    expect(btn("Run extract")).toBeDisabled();
  });

  it("a configuration pull asks first and queues one job only after the confirm", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(btn("Pull configuration"));
    const dlg = await screen.findByRole("dialog");
    expect(connectivityCalls).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: "Pull configuration" }));
    const done = await screen.findByTestId("action-result");
    expect(done.textContent).toMatch(/Configuration pull queued/);
    expect(done.textContent).toMatch(/Open the job/);
    expect(connectivityCalls).toHaveLength(1);
    expect(connectivityCalls[0].path).toBe("/connectivity/config-sync");
    expect(connectivityCalls[0].body).toEqual({ system_id: SYS, modules: ["material_master"] });
  });

  it("an extract asks first and queues one job only after the confirm", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(btn("Run extract"));
    const dlg = await screen.findByRole("dialog");
    expect(connectivityCalls).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: "Run extract" }));
    const done = await screen.findByTestId("action-result");
    expect(done.textContent).toMatch(/Extraction queued/);
    expect(connectivityCalls).toHaveLength(1);
    expect(connectivityCalls[0].path).toBe("/connectivity/extract");
  });

  it("cancelling the confirm makes no call", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(btn("Run extract"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(connectivityCalls).toHaveLength(0);
  });

  it("the health check queues a job", async () => {
    await show();
    fireEvent.click(btn("Run a health check"));
    const done = await screen.findByTestId("action-result");
    expect(done.textContent).toMatch(/Health check queued/);
    expect(connectivityCalls.map((c) => c.path)).toEqual([`/connectivity/health-check/${SYS}`]);
  });
});

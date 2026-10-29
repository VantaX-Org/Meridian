import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { landscapeFixture, resetAdminFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import * as adminApi from "@/lib/api/v2/admin";
import * as runsApi from "@/lib/api/v2/runs";
import { Inspector } from "../Inspector";
import { AdminCanvas } from "../admin/Admin";
import { resetKeptOutcomes } from "../inspector/shared";
import { SystemCanvas } from "../screens/System";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

const [ECC] = landscapeFixture.systems;
let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetRunsFixture();
  resetAdminFixture();
  resetKeptOutcomes();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("delta extraction", () => {
  it("the System inspector sends delta when 'Changes only since last full download' is ticked", async () => {
    const spy = vi.spyOn(runsApi, "extractObjects");
    setUrl(`/v2?fixture=1&open=system:${ECC.id}`);
    renderWithQuery(<Inspector />);
    fireEvent.click(await screen.findByRole("button", { name: "Extract" }));
    const picker = await screen.findByTestId("extract-picker");
    fireEvent.click((await within(picker).findAllByRole("checkbox"))[0]);
    fireEvent.click(within(picker).getByTestId("extract-delta"));
    expect(picker).toHaveTextContent("tables without change dates are read in full");
    fireEvent.click(within(picker).getByRole("button", { name: /^Extract 1 object/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][5]).toBe(true);
    expect(await within(picker).findByText("Extraction of changes started")).toBeInTheDocument();
  });

  it("Admin runs sends delta from its extraction form", async () => {
    const spy = vi.spyOn(adminApi, "startExtraction");
    setUrl("/v2/admin/runs?fixture=1");
    renderWithQuery(<AdminCanvas section="runs" />);
    const objects = await screen.findByRole("list", { name: "Objects to extract" });
    fireEvent.click((await within(objects).findAllByRole("checkbox"))[0]);
    fireEvent.click(screen.getByTestId("extract-delta"));
    fireEvent.click(screen.getByRole("button", { name: /^Extract 1 object/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][4]).toBe(true);
  });

  it("the Extractions view shows the per-table change log of a delta download", async () => {
    setUrl(`/v2/s/${ECC.id}?fixture=1&tab=extractions`);
    renderWithQuery(<SystemCanvas id={ECC.id} />);
    const log = await screen.findByTestId("change-log");
    expect(await within(log).findByTestId("change-log-line")).toHaveTextContent("Changes only since 9 Oct 2026: 152,280 rows read of 306,150, 7,200 changed.");
    const table = within(log).getByRole("table", { name: "Change log by table" });
    const rows = within(table).getAllByRole("row");
    expect(norm(rows[1])).toContain("MARA");
    expect(norm(rows[1])).toContain("Changes by date");
    expect(norm(rows[2])).toContain("Read in full");
  });

  it("an older full download says it was not compared, with dashes for the counts", async () => {
    setUrl(`/v2/s/${ECC.id}?fixture=1&tab=extractions`);
    renderWithQuery(<SystemCanvas id={ECC.id} />);
    const buttons = await screen.findAllByRole("button", { name: /^Change log of the download/ });
    fireEvent.click(buttons[1]);
    const log = await screen.findByTestId("change-log");
    expect(await within(log).findByTestId("change-log-line")).toHaveTextContent("Full download: 305,730 rows read, not compared with an earlier download.");
    expect(within(log).getAllByText("—").length).toBeGreaterThan(4);
  });
});

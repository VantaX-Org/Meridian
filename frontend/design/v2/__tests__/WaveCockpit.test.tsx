import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { adminFixtureResponse, resetAdminFixture } from "@/lib/api/v2/fixtures/admin";
import type { MigrationWave } from "@/types/api";
import { WaveCockpitBlock } from "../inspector/wave-cockpit";
import { resetKeptOutcomes } from "../inspector/shared";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "Test", email: null, fixture: true, can: () => false }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetKeptOutcomes();
  setUrl("/migration?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const wave = (id: string) => (adminFixtureResponse("/migration/waves", {}) as { waves: MigrationWave[] }).waves.find((w) => w.id === id)!;
const page = (id: string) => renderWithQuery(<ToastProvider><WaveCockpitBlock wave={wave(id)} /></ToastProvider>);

describe("Wave cockpit: source and destination quality score", () => {
  it("shows the source, projected and measured score per object", async () => {
    page("w-2");
    const table = await screen.findByRole("table", { name: "Readiness by object" });
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(["Quality score at source", "Projected in target", "Measured in target"]));
    const first = within(table).getAllByRole("row")[1];
    expect(within(first).getByText("96.0")).toBeInTheDocument();
    expect(within(first).getByText("93.4")).toBeInTheDocument();
    expect(within(first).getByText("91.2")).toBeInTheDocument();
  });

  it("lists the rules and gaps that move the score, each code with its description", async () => {
    page("w-2");
    const moves = await screen.findByRole("table", { name: "Rules and gaps that move the quality score in the target" });
    const rows = within(moves).getAllByRole("row").slice(1);
    expect(rows.length).toBe(4); // two contributors for each of the two objects that are not ready
    expect(within(moves).getAllByText("BP005").length).toBeGreaterThan(0);
    expect(within(moves).getAllByText("BP grouping is required - controls number range and field selection").length).toBeGreaterThan(0);
    expect(within(moves).getAllByText("Business Partner Grouping").length).toBe(4);
    expect(within(moves).getAllByText("Migration gap").length).toBe(2);
  });

  it("shows an empty state for a wave that has not been analysed", async () => {
    page("w-3");
    expect(await screen.findByText(/This wave has not been analysed yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Rules and gaps that move the quality score in the target" })).toBeNull();
  });
});

describe("Wave cockpit: gate evidence and readiness forecast", () => {
  it("shows each gate criterion as actual against threshold", async () => {
    page("w-2");
    const min = await screen.findByTestId("gate-evidence-min_score");
    expect(min.textContent).toMatch(/against 80\.0/);
    expect(within(min).getAllByRole("meter").length).toBeGreaterThan(1); // the lowest score, then one bar per object
    expect(screen.queryByTestId("gate-evidence-contracts_met")).toBeNull(); // this gate does not ask for contracts
  });

  it("counts contracts met against those the gate requires", async () => {
    page("w-1");
    const contracts = await screen.findByTestId("gate-evidence-contracts_met");
    expect(within(contracts).getAllByRole("meter").length).toBe(1);
    expect(contracts.textContent).toMatch(/\d+ against \d+/);
  });

  it("names the top failing critical rules with their field and dictionary text", async () => {
    page("w-2");
    const crit = await screen.findByTestId("gate-evidence-zero_criticals");
    const list = within(crit).getByRole("list", { name: "Top failing critical rules" });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(list).getAllByText(/Material type|Business partner category|Name 1|Valuation Class/).length).toBeGreaterThan(0);
  });

  it("projects the pass date from the trend of blocking findings", async () => {
    page("w-2");
    const f = await screen.findByTestId("gate-forecast");
    expect(f.dataset.status).toBe("projected");
    expect(f.textContent).toMatch(/reach zero by \d{4}-\d{2}-\d{2}, a straight line fitted to 3 runs \(22 in the latest\)/);
  });

  it("says plainly when a wave has no trend to project from", async () => {
    page("w-3");
    expect(await screen.findByText(/This wave has not been analysed yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("gate-forecast")).toBeNull();
  });
});

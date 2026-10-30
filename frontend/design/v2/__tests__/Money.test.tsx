import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s9 from "@/lib/api/v2/step9";
import { ReadinessTab } from "../screens/object/ReadinessTab";
import { LandscapeCanvas } from "../screens/Landscape";
import { ObjectMoney } from "../screens/step9/Money";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
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

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("impact in money", () => {
  it("shows the object's opportunity cost per month and since first blocked, in the response's currency", async () => {
    setUrl("/o/ecc-production/material-master/readiness?fixture=1");
    renderWithQuery(<ReadinessTab system="ecc-production" module="material-master" />);
    const block = await screen.findByTestId("object-money");
    const line = await within(block).findByTestId("money-line");
    expect(norm(line)).toMatch(/^ZAR\s?98,200 a month in opportunity cost from 3 blocked features/);
    const table = within(block).getByRole("table", { name: "What Material master costs in S/4 features" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    const cockpit = rows.find((r) => norm(r).startsWith("Migration cockpit: material load"))!;
    expect(norm(cockpit)).toContain("39,264");
    expect(norm(cockpit)).toContain("14 Aug 2026");
    const degraded = rows.find((r) => norm(r).startsWith("MRP Live"))!;
    expect(within(degraded).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("says there is no cost model rather than inventing a price", async () => {
    vi.spyOn(s9, "getMoney").mockResolvedValue({ scope: "object", id: "material_master", as_of: "2026-10-20T08:00:00Z", currency: null, cost_model: false, features: [{ feature: "MRP Live", system_id: "s", system: "ECC", run_id: "r", status: "blocked", blocking_rules: ["MM078"], modules: ["material_master"], records: 10, value_per_record_month: null, opportunity_cost_per_month: null, first_blocked_at: "2026-09-01T00:00:00Z", months_blocked: 1.6, cumulative_cost: null }], totals: { opportunity_cost_per_month: null, cumulative_cost: null, features_blocked: 1, features_degraded: 0 }, ranking: { waves: [], objects: [] } });
    renderWithQuery(<ObjectMoney module="material_master" label="Material master" />);
    expect(await screen.findByText(/No cost model is set for this tenant/)).toBeInTheDocument();
  });

  it("ranks the waves by the value fixing them unblocks on the Waves view", async () => {
    window.history.pushState({}, "", "/?fixture=1&view=waves");
    setUrl("/?fixture=1&view=waves");
    renderWithQuery(<LandscapeCanvas />);
    const rank = await screen.findByTestId("waves-by-value");
    await waitFor(() => expect(within(rank).getAllByRole("listitem")).toHaveLength(3));
    const items = within(rank).getAllByRole("listitem");
    expect(norm(items[0])).toContain("Wave 2: master data");
    expect(norm(items[0])).toMatch(/ZAR\s?98,200 a month/);
    expect(rank).toHaveTextContent("in ZAR");
  });
});

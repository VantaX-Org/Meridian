import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { simulateFixture } from "@/lib/api/v2/fixtures/step9";
import * as s9 from "@/lib/api/v2/step9";
import type { WorkRow } from "@/lib/api/v2/types";
import { RulesTab } from "../screens/object/RulesTab";
import { BulkActions, type LedgerHandlers } from "../screens/work-parts";
import { SimulationView } from "../screens/step9/Simulation";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2/hooks")>();
  return { ...actual, useV2Session: () => ({ persona: "lead" as const, label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetObjectFixture();
  resetWorkFixture();
  setUrl("/o/ecc-production/material-master?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the simulation fixture", () => {
  it("leaves the receipt as it is when nothing is chosen", () => {
    const r = simulateFixture({ module: "material_master" });
    expect(r.before.score).toBe(70);
    expect(r.after.score).toBe(70);
    expect(r.after.breaches).toEqual(["MM014", "MM031"]);
    expect(r.delta.breaches_cleared).toEqual([]);
  });

  it("clears both caps when both critical rules are fixed, and unblocks every feature they block", () => {
    const r = simulateFixture({ module: "material_master", rules: ["MM014", "MM031"] });
    expect(r.after.cap_level).toBeNull();
    expect(r.after.breaches).toEqual([]);
    expect(r.after.score).toBeGreaterThan(70);
    expect(r.after.score).toBe(r.after.raw_score);
    expect(r.before.features_blocked).toBe(3);
    expect(r.after.features_blocked).toBe(0);
    expect(r.delta.breaches_cleared).toEqual(["MM014", "MM031"]);
    expect(r.landscape?.after.held_under_85).toBe(r.landscape!.before.held_under_85 - 1);
  });

  it("is a 404 for an object with no run", () => {
    expect(() => simulateFixture({ module: "employee_central" })).toThrow(/Object not found/);
  });
});

describe("Simulate fixing on the Rules tab", () => {
  it("opens with the critical rules ticked and shows before and after, labelled as a simulation", async () => {
    const spy = vi.spyOn(s9, "simulateFix");
    renderWithQuery(<RulesTab system="ecc-production" module="material-master" />);
    fireEvent.click(await screen.findByTestId("simulate-rules"));
    const dialog = await screen.findByRole("dialog", { name: "Simulate fixing, Material master" });
    expect(dialog).toHaveTextContent("Simulation: nothing is changed in SAP or in Meridian.");
    const picks = await within(dialog).findAllByRole("checkbox");
    expect(picks.filter((c) => (c as HTMLInputElement).checked)).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "Simulate fixing 2 rules" }));
    const sim = await within(dialog).findByTestId("simulation");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ module: "material_master", rules: ["MM014", "MM031"] }));
    expect(within(sim).getByTestId("sim-before")).toHaveTextContent("Capped at 70 by MM014 and MM031");
    expect(within(sim).getByTestId("sim-after")).toHaveTextContent("No cap: no critical rule over tolerance");
    expect(within(sim).getAllByRole("img").filter((el) => el.getAttribute("data-size") === "240")).toHaveLength(2);
    expect(within(sim).getByTestId("simulation-landscape")).toHaveTextContent("Landscape now: 11 of 15 objects are held under 85");
    expect(within(sim).getByTestId("simulation-landscape")).toHaveTextContent("Landscape after, simulated: 10 of 15 objects");
    expect(norm(within(sim).getByTestId("simulation-sentence"))).toMatch(/^The score would move from 70\.0 to /);
  });

  it("ranks the top fixes by score gained, and simulates one from its row", async () => {
    renderWithQuery(<RulesTab system="ecc-production" module="material-master" />);
    fireEvent.click(await screen.findByRole("button", { name: "Top fixes" }));
    const table = await screen.findByRole("table", { name: "Top fixes for Material master, ranked by score gained" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    const gains = rows.map((r) => Number(norm(r.querySelectorAll("td")[4] as HTMLElement).replace("+", "")));
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    expect(screen.getByTestId("top-fixes")).toHaveTextContent("Simulation: nothing is changed");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /^Simulate fixing / }));
    expect(await screen.findByTestId("simulation")).toBeInTheDocument();
  });
});

describe("Simulate fixing in the Work bulk bar", () => {
  const row = (key: string, checks: string[]): WorkRow => ({ module: "material_master", record_key: key, name: null, issues: checks.length, severity: "critical", checks, proposed: 0, status: "to_fix", top_message: null, top_field: null });
  const h = { can: { apply: true, approve: true, assign: true } } as unknown as LedgerHandlers;

  it("simulates the selected records of one object at once", async () => {
    const spy = vi.spyOn(s9, "simulateFix");
    renderWithQuery(<BulkActions rows={[row("MATNR=000000000000000232", ["MM031"]), row("MATNR=000000000000000211", ["MM014"])]} clear={() => undefined} h={h} onReason={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Simulate fixing" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByTestId("simulation");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ module: "material_master", records: [{ module: "material_master", record_key: "MATNR=000000000000000232" }, { module: "material_master", record_key: "MATNR=000000000000000211" }] }));
    expect(dialog).toHaveTextContent("2 selected records of Material master");
  });
});

describe("the simulation view", () => {
  it("says when the landscape sentence cannot be shown", () => {
    const r = { ...simulateFixture({ module: "material_master", rules: ["MM014"] }), landscape: null };
    renderWithQuery(<SimulationView result={r} label="Material master" />);
    expect(screen.getByText(/The landscape sentence is not shown/)).toBeInTheDocument();
    expect(screen.getByTestId("sim-after")).toHaveTextContent("Wave 2: master data: gate closed");
  });
});

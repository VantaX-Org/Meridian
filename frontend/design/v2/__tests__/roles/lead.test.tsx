import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { lastRolesExport, rolesAudit } from "@/lib/api/v2/fixtures/roles";
import { LandscapeCanvas } from "../../screens/Landscape";
import { WorkCanvas } from "../../screens/Work";
import { PeopleCanvas } from "../../screens/People";
import { stubLayout } from "../layout-stub";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  reset();
  undo = stubLayout();
  Object.assign(window.URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

describe("the programme lead's jobs", () => {
  it("sees each wave's gate on the Waves view of the landscape", async () => {
    visit("/v2?view=waves", "programme_lead");
    mount(<LandscapeCanvas />);
    const marks = await screen.findAllByTestId("gate-mark");
    expect(marks.map(norm)).toEqual(["Gate not passed, 2 of 3 not met", "Gate not passed, 2 of 2 not met"]);
  });

  it("sets a wave's gate criteria in the Waves panel and reads the checks", async () => {
    visit("/v2?open=waves", "programme_lead");
    mount();
    const gates = await screen.findAllByTestId("wave-gate");
    const third = gates[2];
    expect(norm(third)).toContain("No gate yet");
    fireEvent.change(within(third).getByRole("spinbutton", { name: /minimum score/ }), { target: { value: "80" } });
    fireEvent.click(within(third).getByRole("button", { name: "Save the gate" }));
    await waitFor(() => expect(rolesAudit().map((a) => a.action)).toContain("wave_gate.update"));
    await waitFor(() => expect(norm(screen.getAllByTestId("wave-gate")[2])).toContain("Every object at 80.0 or more"));
    expect(norm(screen.getAllByTestId("wave-gate")[2])).toContain("Readiness certificate");
  });

  it("balances work: proposes a plan with before and after, applies it with undo", async () => {
    visit("/v2/people?open=balance", "programme_lead");
    mount(<PeopleCanvas />);
    expect(await screen.findByRole("link", { name: "Balance work" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Propose a plan" }));
    const plan = await screen.findByTestId("balance-plan");
    expect(norm(plan)).toContain("A. Naidoo214");
    expect(norm(plan)).toContain("126 records");
    fireEvent.click(within(plan).getByRole("button", { name: "Apply the plan" }));
    expect((await screen.findAllByText(/^Balanced work: 126 records moved/)).length).toBeGreaterThan(0);
  });

  it("exports the Work grid with the columns on screen", async () => {
    visit("/v2/work", "programme_lead");
    mount(<WorkCanvas />);
    fireEvent.click(await screen.findByRole("button", { name: "Share and export Work" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export to Excel/ }));
    await waitFor(() => expect(lastRolesExport()?.path).toBe("/export/grid"));
    const body = lastRolesExport()?.body as { columns: { key: string }[]; rows: unknown[]; route: string };
    expect(body.route).toBe("work");
    expect(body.columns.length).toBeGreaterThan(3);
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it("opens the data contracts from People", async () => {
    visit("/v2/people?open=contracts", "programme_lead");
    mount(<PeopleCanvas />);
    const list = await screen.findByTestId("contracts-list");
    expect(norm(list)).toContain("Material master to S/4HANA");
    expect(norm(list)).toContain("Breached");
  });
});

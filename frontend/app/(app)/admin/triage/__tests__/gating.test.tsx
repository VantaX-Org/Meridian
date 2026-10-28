import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as triageApi from "@/lib/api/triage";
import * as usersApi from "@/lib/api/users";
import AdminTriagePage from "../page";

const held = vi.hoisted(() => ({ actions: new Set<string>() }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => held.actions.has(a) }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
  vi.spyOn(triageApi, "getTeams").mockResolvedValue([{ id: "t1", name: "Stewards", strategy: "round_robin", lead_user_id: null, member_ids: [], open_items: 0 }]);
  vi.spyOn(triageApi, "getRules").mockResolvedValue([]);
  vi.spyOn(triageApi, "getSlaPolicies").mockResolvedValue([]);
  vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({ timezone: "UTC", work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00", holidays: [], fallback_user_id: null });
});

const hold = (...a: string[]) => { held.actions = new Set(a); };

describe("triage edit gating", () => {
  it("lets a programme lead (manage_triage only) edit teams, rules and deadlines but not the calendar", async () => {
    hold("manage_triage", "assign");
    renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByRole("button", { name: "Add team" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add rule" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add override" })).toBeInTheDocument();
    expect(screen.queryByText(/You can read these settings/)).toBeNull();
    // Business hours and holidays are the tenant clock: manage_settings only.
    expect(await screen.findByText("Changing the calendar needs the manage settings permission.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save calendar" })).toBeNull();
  });

  it("keeps manage_settings and manage_rules holders editing as before", async () => {
    hold("manage_settings");
    const first = renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByRole("button", { name: "Add team" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Save calendar" })).toBeInTheDocument();
    first.unmount();
    hold("manage_rules");
    renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByRole("button", { name: "Add team" })).toBeInTheDocument();
  });

  it("reads only for someone who holds none of them", async () => {
    hold("view");
    renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByText("Stewards")).toBeInTheDocument();
    expect(screen.getByText(/You can read these settings/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add override" })).toBeNull();
  });
});

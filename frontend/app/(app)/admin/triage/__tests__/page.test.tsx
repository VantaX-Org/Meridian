import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as triageApi from "@/lib/api/triage";
import * as usersApi from "@/lib/api/users";
import type { TriageTeam, AssignmentRule, SlaPolicy, TriageSettings } from "@/lib/api/triage";
import AdminTriagePage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const TEAM: TriageTeam = { id: "t1", name: "Stewards", strategy: "round_robin", lead_user_id: null, member_ids: [], open_items: 2 };
const RULE: AssignmentRule = {
  id: "r1", name: "Critical to stewards", position: 0, enabled: true,
  match: {}, assign_user_id: null, assign_team_id: "t1", updated_at: null,
};
const POLICY: SlaPolicy = {
  id: null, is_default: true, severity: "critical", module: null,
  ack_minutes: 30, resolve_minutes: 240, at_risk_pct: 80, business_hours: true,
};
const SETTINGS: TriageSettings = {
  timezone: "UTC", work_days: [1, 2, 3, 4, 5], work_start: "08:00:00", work_end: "17:00:00",
  holidays: [], fallback_user_id: null,
};

function mockAll() {
  vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
  vi.spyOn(triageApi, "getTeams").mockResolvedValue([TEAM]);
  vi.spyOn(triageApi, "getRules").mockResolvedValue([RULE]);
  vi.spyOn(triageApi, "getSlaPolicies").mockResolvedValue([POLICY]);
  vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue(SETTINGS);
}

describe("admin triage page", () => {
  it("renders teams, rules and policies once loaded", async () => {
    mockAll();
    renderWithQuery(<AdminTriagePage />);
    await waitFor(() => expect(screen.getByText("Stewards")).toBeInTheDocument());
    expect(screen.getByText("Critical to stewards")).toBeInTheDocument();
  });

  it("shows a retryable error when teams fail to load", async () => {
    const spy = vi.spyOn(triageApi, "getTeams").mockRejectedValue(new Error("network down"));
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(triageApi, "getRules").mockResolvedValue([RULE]);
    vi.spyOn(triageApi, "getSlaPolicies").mockResolvedValue([POLICY]);
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue(SETTINGS);
    renderWithQuery(<AdminTriagePage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getAllByRole("button", { name: /retry/i })[0];
    spy.mockResolvedValue([TEAM]);
    retry.click();
    await waitFor(() => expect(screen.getByText("Stewards")).toBeInTheDocument());
  });
});

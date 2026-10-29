import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as triageApi from "@/lib/api/triage";
import * as usersApi from "@/lib/api/users";
import type { TriageTeam, AssignmentRule, SlaPolicy, TriageSettings } from "@/lib/api/triage";
import AdminTriagePage, { matchText } from "../page";

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
  it("names a severity-limited rule's severities instead of matching everything", () => {
    expect(matchText({ severity: ["critical", "high"] })).toBe("Severity: Critical, High");
    expect(matchText({ severity: ["critical"], module: ["fi_gl"] })).toBe("Severity: Critical; Objects: FI general ledger");
    expect(matchText({})).toBe("Matches everything");
  });

  it("renders teams, rules and policies once loaded", async () => {
    mockAll();
    renderWithQuery(<AdminTriagePage />);
    await waitFor(() => expect(screen.getByText("Stewards")).toBeInTheDocument());
    expect(screen.getByText("Critical to stewards")).toBeInTheDocument();
  });

  it("names the SLA scope column Object, as every other ledger does", async () => {
    mockAll();
    renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByText("All objects")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Object" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Module" })).toBeNull();
  });

  it("flags a stored time zone that is not an IANA zone and blocks saving", async () => {
    mockAll();
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({ ...SETTINGS, timezone: "Mars/Olympus" });
    renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByText(/Mars\/Olympus is not a recognised time zone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save calendar" })).toBeDisabled();
  });

  it("confirms before a new time zone moves the extraction schedules", async () => {
    mockAll();
    const save = vi.spyOn(triageApi, "saveTriageSettings").mockResolvedValue({ ...SETTINGS, timezone: "Europe/Berlin" });
    const user = userEvent.setup();
    renderWithQuery(<AdminTriagePage />);
    await user.click(await screen.findByRole("combobox", { name: "Time zone" }));
    await user.click(await screen.findByRole("option", { name: "Europe/Berlin" }));
    await user.click(screen.getByRole("button", { name: "Save calendar" }));
    expect(await screen.findByText(/Every extraction schedule will run in Europe\/Berlin instead of UTC/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Change time zone" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Europe/Berlin" })));
  }, 60_000); // the zone list holds ~400 options

  it("shows a retryable error when teams fail to load", async () => {
    const spy = vi.spyOn(triageApi, "getTeams").mockRejectedValue(new Error("network down"));
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(triageApi, "getRules").mockResolvedValue([RULE]);
    vi.spyOn(triageApi, "getSlaPolicies").mockResolvedValue([POLICY]);
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue(SETTINGS);
    renderWithQuery(<AdminTriagePage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getAllByRole("button", { name: /retry/i })[0];
    spy.mockResolvedValue([TEAM]);
    retry.click();
    await waitFor(() => expect(screen.getByText("Stewards")).toBeInTheDocument());
  });

  it("warns that new issues go to nobody when there are no rules and no fallback user, and hides the switched-off tile", async () => {
    mockAll();
    vi.spyOn(triageApi, "getTeams").mockResolvedValue([]);
    vi.spyOn(triageApi, "getRules").mockResolvedValue([]);
    renderWithQuery(<AdminTriagePage />);
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("New issues go to nobody: set a fallback user");
    expect(within(warning).getByRole("link", { name: "Set fallback user" })).toHaveAttribute("href", "#calendar");
    expect(screen.queryByText("Rules switched off")).toBeNull();
  });

  it("shows no warning once a fallback user is set, and the tile returns with rules", async () => {
    mockAll();
    vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({ ...SETTINGS, fallback_user_id: "u1" });
    renderWithQuery(<AdminTriagePage />);
    expect(await screen.findByText("Rules switched off")).toBeInTheDocument();
    expect(screen.queryByText("New issues go to nobody: set a fallback user")).toBeNull();
  });

  it("offers one Add team and one Add rule at a time: the empty state's, then the header's", async () => {
    mockAll();
    vi.spyOn(triageApi, "getTeams").mockResolvedValue([]);
    vi.spyOn(triageApi, "getRules").mockResolvedValue([]);
    const first = renderWithQuery(<AdminTriagePage />);
    await screen.findByText("No teams yet");
    expect(screen.getAllByRole("button", { name: "Add team" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add rule" })).toHaveLength(1);
    first.unmount();
    mockAll();
    renderWithQuery(<AdminTriagePage />);
    await screen.findByText("Stewards");
    expect(screen.getAllByRole("button", { name: "Add team" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add rule" })).toHaveLength(1);
  });

});

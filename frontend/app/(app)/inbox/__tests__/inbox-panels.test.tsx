import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as writeback from "@/lib/api/writeback";
import * as issues from "@/lib/api/issues";
import * as users from "@/lib/api/users";
import { ApprovalsPanel, IssuesPanel } from "../inbox-panels";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => vi.restoreAllMocks());

describe("ApprovalsPanel", () => {
  it("disables Approve and says why when live write-back is off", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [{ id: "a1", finding_id: null, version_id: null, requested_by: "someone", records_updated: 4, sap_host: null, created_at: null }],
      live_enabled: false,
    });
    renderWithQuery(<ApprovalsPanel />);
    await screen.findByText(/live sap write-back is off/i);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("disables Approve on the viewer's own request (4-eyes) and enables it on others'", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [
        { id: "a1", finding_id: null, version_id: null, requested_by: "me", records_updated: 1, sap_host: null, created_at: null },
        { id: "a2", finding_id: null, version_id: null, requested_by: "other", records_updated: 2, sap_host: null, created_at: null },
      ],
      live_enabled: true,
    });
    renderWithQuery(<ApprovalsPanel />);
    const buttons = await screen.findAllByRole("button", { name: "Approve" });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveAttribute("title", expect.stringMatching(/another approver/));
    expect(buttons[1]).toBeEnabled();
  });

  it("confirms an approval naming the records and the SAP host before writing back", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [{ id: "a2", finding_id: null, version_id: null, requested_by: "other", records_updated: 2, sap_host: "ecc-prd", created_at: null }],
      live_enabled: true,
    });
    const approve = vi.spyOn(writeback, "approveWriteback").mockResolvedValue({ applied: 2, errors: [], status: "applied" });
    renderWithQuery(<ApprovalsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(approve).not.toHaveBeenCalled();
    expect(await screen.findByText(/2 records on ecc-prd, requested by Unknown user/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve and write back" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("a2"));
  });

  it("shows an empty state when nothing is pending", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({ approvals: [], live_enabled: true });
    renderWithQuery(<ApprovalsPanel />);
    expect(await screen.findByText(/no write-backs/i)).toBeInTheDocument();
  });
});

const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id, scope: "s", module: "material_master", check_id: "MM101", record_key: `MATNR=${id}`, grain: null, severity: "high",
  status: "open", resolution: null, assigned_to: null, assignee_email: null, first_seen_version: "v", last_seen_version: "v",
  resolved_version: null, first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z", resolved_at: null,
  reopened_count: 0, message: "Material has no base unit", field: "MEINS", priority: null, assigned_team_id: null,
  acknowledged_at: null, due_at: null, ack_due_at: null, risk_at: null, sla_state: null, sla_paused_at: null,
  snoozed_until: null, snooze_reason: null, ...over,
});

describe("IssuesPanel", () => {
  const mount = () => {
    vi.spyOn(issues, "getIssues").mockResolvedValue({
      total: 2, counts: { open: 2 },
      items: [issue("1", { sla_state: "breached", due_at: "2000-01-01T00:00:00Z" }), issue("2")],
    } as never);
    vi.spyOn(issues, "getIssue").mockResolvedValue({ issue: issue("1"), events: [], runs: [] } as never);
    vi.spyOn(users, "getAssignableUsers").mockResolvedValue([]);
    renderWithQuery(<IssuesPanel />);
  };

  it("marks overdue issues and filters to them", async () => {
    mount();
    expect((await screen.findAllByText(/\d+d overdue$/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: "Overdue (1)" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Issues" }).querySelectorAll("li")).toHaveLength(1));
  });

  it("releases and resolves the ticked issues with the resolution the server needs", async () => {
    mount();
    const update = vi.spyOn(issues, "updateIssues").mockResolvedValue({ updated: 2 });
    fireEvent.click(await screen.findByLabelText("Select all 2"));
    const bar = await screen.findByTestId("inbox-bulk");
    fireEvent.click(within(bar).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ids: ["1", "2"], assigned_to: "" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Fixed in SAP" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ids: ["1", "2"], status: "resolved", resolution: "fixed_in_source" }));
  });
});

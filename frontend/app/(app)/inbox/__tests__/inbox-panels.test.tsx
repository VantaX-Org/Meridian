import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as writeback from "@/lib/api/writeback";
import * as issues from "@/lib/api/issues";
import * as rules from "@/lib/api/rules";
import * as users from "@/lib/api/users";
import * as exceptions from "@/lib/api/exceptions";
import type { Exception } from "@/types/api";
import { ApprovalsPanel, IssuesPanel, SapMonitorPanel, reExtractHref, sapSignalSource } from "../inbox-panels";

const perms = vi.hoisted(() => ({ can: (() => true) as (action: string) => boolean }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.can(a) }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me", name: "Me", email: "me@example.test" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { vi.restoreAllMocks(); perms.can = () => true; });

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

  it("names the requester from the assignable list when the full user list is not readable", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [{ id: "a3", finding_id: null, version_id: null, requested_by: "u-sam", records_updated: 3, sap_host: "ecc-prd", created_at: null }],
      live_enabled: true,
    });
    vi.spyOn(users, "getUsers").mockRejectedValue(new Error("403"));
    vi.spyOn(users, "getAssignableUsers").mockResolvedValue([{ id: "u-sam", name: "Sam Steward", email: "sam@example.com", role: "steward" }]);
    renderWithQuery(<ApprovalsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/3 records on ecc-prd, requested by Sam Steward/)).toBeInTheDocument();
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

  it("titles the selected issue by its rule, opens its record and marks it fixed in SAP on its own", async () => {
    vi.spyOn(rules, "getRules").mockResolvedValue({ rules: [{ id: "MM101", name: "Base unit is set" }], total: 1 } as never);
    mount();
    const update = vi.spyOn(issues, "updateIssues").mockResolvedValue({ updated: 1 });
    const detail = await screen.findByRole("region", { name: "Selected item" });
    expect(await within(detail).findByText("Base unit is set in Material master")).toBeInTheDocument();
    expect(within(detail).getByText("MM101")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open record" })).toHaveAttribute("href", "/objects/material_master/records/MATNR%3D1");
    fireEvent.click(within(detail).getByRole("button", { name: "Fixed in SAP" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ids: ["1"], status: "resolved", resolution: "fixed_in_source" }));
  });

  it("lets a data owner (approve, no assign) accept the risk, and nothing that needs assign", async () => {
    perms.can = (a) => a === "view" || a === "approve" || a === "export";
    mount();
    const update = vi.spyOn(issues, "updateIssues").mockResolvedValue({ updated: 1 });
    const detail = await screen.findByRole("region", { name: "Selected item" });
    expect(within(detail).queryByRole("button", { name: "Fixed in SAP" })).toBeNull();
    expect(within(detail).queryByRole("button", { name: "Claim" })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Accept risk" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ids: ["1"], status: "accepted", resolution: "accepted_risk" }));
    fireEvent.click(await screen.findByLabelText("Select all 2"));
    const bar = await screen.findByTestId("inbox-bulk");
    expect(within(bar).queryByRole("button", { name: "Release" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Accept risk" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ids: ["1", "2"], status: "accepted", resolution: "accepted_risk" }));
  });

  it("offers Accept risk to nobody without approve", async () => {
    perms.can = (a) => a === "view" || a === "analyse";
    mount();
    const detail = await screen.findByRole("region", { name: "Selected item" });
    expect(within(detail).queryByRole("button", { name: "Accept risk" })).toBeNull();
  });

  it("says how many issues are loaded and loads more, rather than capping the list silently", async () => {
    const get = vi.spyOn(issues, "getIssues").mockResolvedValue({ total: 450, counts: { open: 450 }, items: [issue("1"), issue("2")] } as never);
    vi.spyOn(issues, "getIssue").mockResolvedValue({ issue: issue("1"), events: [], runs: [] } as never);
    vi.spyOn(users, "getAssignableUsers").mockResolvedValue([]);
    renderWithQuery(<IssuesPanel />);
    expect(await screen.findByText(/^2 of 450 issues loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.objectContaining({ limit: 400 })));
  });
});

const signal = (over: Partial<Exception> = {}): Exception => ({
  id: "e1", tenant_id: "t", type: "sap_transaction", category: "operational", severity: "high", status: "open",
  title: "SAP Monitor: Failed Production Confirmation", description: "AFRU confirmation was cancelled", source_system: "SAP PP",
  source_reference: "failed_confirmation", affected_records: { matched_fields: ["AFRU.STOKZ"], modules: ["production_planning"], system_id: "sys-1", version_id: "v1" },
  estimated_impact_zar: null, assigned_to: null, escalation_tier: 1, sla_deadline: null, root_cause_category: null, resolution_type: null,
  resolution_notes: null, linked_finding_id: null, linked_cleaning_id: null, billing_tier: null, created_at: "2026-10-26T00:00:00Z",
  resolved_at: null, closed_at: null, ...over,
} as Exception);

describe("SapMonitorPanel", () => {
  const open = async (e: Exception) => {
    vi.spyOn(exceptions, "getSAPMonitor").mockResolvedValue({ exceptions: [e], by_category: { operational: [e] } } as never);
    renderWithQuery(<SapMonitorPanel />);
    fireEvent.click(await screen.findByText(e.title));
    return screen.findByRole("dialog");
  };

  it("lets SAP Basis (manage_systems, trigger_sync) claim, resolve and re-extract an SAP-raised signal", async () => {
    perms.can = (a) => ["view", "manage_systems", "trigger_sync", "upload", "analyse"].includes(a);
    const assign = vi.spyOn(exceptions, "assignException").mockResolvedValue({ id: "e1", assigned_to: "me" });
    const resolve = vi.spyOn(exceptions, "resolveException").mockResolvedValue({ id: "e1", status: "resolved", billing_tier: 2 });
    const drawer = await open(signal());
    expect(within(drawer).getByRole("link", { name: "Re-extract" })).toHaveAttribute("href", "/systems/sys-1?extract=1&object=production_planning");
    fireEvent.click(within(drawer).getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("e1", { user_id: "me", user_name: "Me" }));
    const resolveBtn = within(drawer).getByRole("button", { name: "Resolve" });
    expect(resolveBtn).toBeDisabled(); // a resolution says what was done in SAP
    fireEvent.change(within(drawer).getByRole("textbox"), { target: { value: "Confirmation re-posted in CO11N" } });
    fireEvent.click(resolveBtn);
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("e1", { resolution_type: "steward", resolution_notes: "Confirmation re-posted in CO11N", root_cause_category: "system" }));
  });

  it("gives SAP Basis no Claim or Resolve on a signal that did not come from SAP", async () => {
    perms.can = (a) => ["view", "manage_systems", "trigger_sync"].includes(a);
    const drawer = await open(signal({ source_system: null }));
    expect(within(drawer).queryByRole("button", { name: "Claim" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("gives a viewer the signal's detail and no action", async () => {
    perms.can = (a) => a === "view";
    const drawer = await open(signal());
    expect(within(drawer).getByText("AFRU confirmation was cancelled")).toBeInTheDocument();
    for (const name of ["Claim", "Resolve"]) expect(within(drawer).queryByRole("button", { name })).toBeNull();
    expect(within(drawer).queryByRole("link", { name: "Re-extract" })).toBeNull();
  });

  it("reads the signal's system and objects, and leaves Re-extract out when the run had no system", () => {
    expect(sapSignalSource(signal())).toEqual({ systemId: "sys-1", objects: ["production_planning"] });
    expect(sapSignalSource(signal({ affected_records: { matched_fields: ["AFRU.STOKZ"] } }))).toEqual({ systemId: null, objects: [] });
    expect(reExtractHref("sys-1", ["a", "b"])).toBe("/systems/sys-1?extract=1&object=a&object=b");
  });
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as writeback from "@/lib/api/writeback";
import * as remediation from "@/lib/api/remediation";
import * as rules from "@/lib/api/rules";
import * as users from "@/lib/api/users";
import * as exceptions from "@/lib/api/exceptions";
import type { Exception } from "@/types/api";
import { ApprovalsPanel, SapMonitorPanel, reExtractHref, sapSignalSource } from "../inbox-panels";

const perms = vi.hoisted(() => ({ can: (() => true) as (action: string) => boolean }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.can(a) }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me", name: "Me", email: "me@example.test" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { vi.restoreAllMocks(); perms.can = () => true; });

const batch = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Fixes by Sam ${id}`, status: "draft", filter: {}, created_by: "u-sam", created_by_label: "Sam Steward",
  created_at: "2026-10-01T00:00:00Z", approved_by: null, approved_by_label: null, approved_at: null, exported_at: null,
  items: 3, with_proposal: 3, auto_approvable: 1, fixed: 0, still_failing: 0, ...over,
});

describe("ApprovalsPanel: fix batches", () => {
  it("lists the batches waiting for approval with the rule by name, the requester and the first change", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({ approvals: [], live_enabled: false });
    vi.spyOn(remediation, "listBatches").mockResolvedValue({ items: [batch("b1"), batch("b2", { status: "exported" })] } as never);
    vi.spyOn(remediation, "getBatchDiff").mockResolvedValue({ records: [{ record_key: "MATNR=1", table: "MARA", changes: [
      { field: "MATKL", before: null, after: "001", rule: "MM101" }, { field: "MEINS", before: "X", after: "EA", rule: "MM102" },
    ] }] });
    vi.spyOn(rules, "getRules").mockResolvedValue({ rules: [{ id: "r1", name: "MM101: Material group is blank" }], total: 1 } as never);
    renderWithQuery(<ApprovalsPanel />);
    expect(await screen.findByText("Fixes by Sam b1")).toBeInTheDocument();
    // The exported batch is evidence under its own filter, not a request waiting here.
    expect(screen.queryByText("Fixes by Sam b2")).toBeNull();
    expect(screen.getByText("Sam Steward")).toBeInTheDocument();
    const preview = await screen.findByTestId("batch-preview");
    expect(within(preview).getByText("MM101")).toBeInTheDocument();
    await waitFor(() => expect(within(preview).getByText("Material group is blank")).toBeInTheDocument());
    expect(within(preview).getByText("and 1 more")).toBeInTheDocument();
    expect(preview).toHaveTextContent("MARA.MATKL on MATNR=1: blank to 001, and 1 more");
  });

  it("lets view_audit read the batches without approve, and asks nothing of the write-back API", async () => {
    perms.can = (a) => a === "view_audit";
    const pending = vi.spyOn(writeback, "getPendingApprovals");
    vi.spyOn(remediation, "listBatches").mockResolvedValue({ items: [batch("b1")] } as never);
    vi.spyOn(remediation, "getBatchDiff").mockResolvedValue({ records: [] });
    renderWithQuery(<ApprovalsPanel />);
    expect(await screen.findByText("Fixes by Sam b1")).toBeInTheDocument();
    expect(screen.queryByText("SAP write-backs")).toBeNull();
    expect(pending).not.toHaveBeenCalled();
  });
});

describe("ApprovalsPanel", () => {
  beforeEach(() => { vi.spyOn(remediation, "listBatches").mockResolvedValue({ items: [] }); });

  it("says why there is no Approve when live write-back is off, instead of a greyed button", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [{ id: "a1", finding_id: null, version_id: null, requested_by: "someone", records_updated: 4, sap_host: null, created_at: null }],
      live_enabled: false,
    });
    renderWithQuery(<ApprovalsPanel />);
    await screen.findByText(/live sap write-back is off/i);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Write-back is off")).toBeInTheDocument();
  });

  it("offers no Approve on the viewer's own request (4-eyes) and a primary Approve on others'", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [
        { id: "a1", finding_id: null, version_id: null, requested_by: "me", records_updated: 1, sap_host: null, created_at: null },
        { id: "a2", finding_id: null, version_id: null, requested_by: "other", records_updated: 2, sap_host: null, created_at: null },
      ],
      live_enabled: true,
    });
    renderWithQuery(<ApprovalsPanel />);
    const buttons = await screen.findAllByRole("button", { name: "Approve" });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText("Needs another approver")).toBeInTheDocument();
    expect(buttons[0]).toBeEnabled();
    expect(buttons[0]).toHaveClass("m-btn-primary");
  });

  it("names the rule and the requester from the approvals payload, never a finding id or Unknown user", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({
      approvals: [{ id: "a3", finding_id: "f1f1f1f1-0000-4000-8000-000000000001", version_id: null, requested_by: "u-9", records_updated: 14, sap_host: "sap-dev", created_at: null,
        check_id: "MM101", module: "material_master", rule_message: "Material type not allowed", requested_by_name: "Thandi Nkosi" }],
      live_enabled: true,
    });
    renderWithQuery(<ApprovalsPanel />);
    expect(await screen.findByText("MM101")).toBeInTheDocument();
    expect(screen.getByText("Material type not allowed")).toBeInTheDocument();
    expect(screen.getByText("Thandi Nkosi")).toBeInTheDocument();
    expect(screen.queryByText(/f1f1f1f1/)).toBeNull();
    expect(screen.queryByText("Unknown user")).toBeNull();
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

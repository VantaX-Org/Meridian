import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/golden-writeback";
import * as usersApi from "@/lib/api/users";
import type { WritebackPreview, WritebackRequest, WritebackTarget } from "@/lib/api/golden-writeback";
import { GoldenWriteback } from "../golden-writeback";

const role = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: (p: string) => !role.denied.has(p) }),
}));
// requested_by is the simulating user's id (api/routes/golden_writeback.py stores the JWT subject).
const me = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: me.id, email: `${me.id}@x.com`, name: me.id, role: "data_steward" } }) }));

const planned: WritebackTarget = {
  system_id: "s1", system_name: "S4C PRD", system_type: "s4hana_cloud", supported: true, method: "odata_patch", reason: null,
  fields: [
    { field: "BUT000.NAME_ORG1", golden_value: "Acme Ltd", target: "OrganizationBPName1", supported: true, reason: null },
    { field: "BUT000.BU_GROUP", golden_value: "BP01", target: null, supported: false,
      reason: "A_BusinessPartner has no writable property for BUT000.BU_GROUP" },
  ],
};
const ecc: WritebackTarget = {
  system_id: "s2", system_name: "ECC PRD", system_type: "ecc", supported: false, method: null,
  reason: "BAPI_BUPA_CENTRAL_DATA_SET has no verified parameter mapping for these fields yet; load them with a remediation batch",
  fields: [{ field: "BUT000.NAME_ORG1", golden_value: "Acme Ltd", target: null, supported: false, reason: "No verified mapping" }],
};
const preview: WritebackPreview = {
  record_id: "g1", domain: "business_partner", sap_object_key: "1000", golden_fields: {},
  writeback_supported: true, live_enabled: true, message: "Simulate the write-back to see what would change.",
  targets: [planned, ecc], unresolved_sources: [],
};
const simulated: WritebackRequest = {
  id: "r1", master_record_id: "g1", status: "simulated", requested_by: "alice", approved_by: null, rejected_by: null,
  error: null, counts: { would_change: 1, unsupported: 1 }, created_at: null, simulated_at: null, decided_at: null, applied_at: null,
  targets: [{ ...planned, fields: [
    { ...planned.fields[0], current_value: "ACME LTD.", result: "would_change" },
    { ...planned.fields[1], result: "unsupported" },
  ] }],
};

describe("GoldenWriteback", () => {
  beforeEach(() => {
    role.denied = new Set();
    me.id = "alice";
    vi.restoreAllMocks();
  });

  it("offers Simulate again, not Request approval, when someone else simulated, and names them", async () => {
    me.id = "bob";
    vi.spyOn(api, "getWritebackRequests").mockResolvedValue({ requests: [simulated] });
    vi.spyOn(api, "getWritebackPreview").mockResolvedValue(preview);
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([{ id: "alice", name: "Alice Ng", email: "alice@x.com", role: "data_steward" }]);
    const submit = vi.spyOn(api, "submitWriteback");
    const simulate = vi.spyOn(api, "requestWriteback").mockResolvedValue({ ...simulated, requested_by: "bob", status: "simulating" });
    renderWithQuery(<GoldenWriteback recordId="g1" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back to SAP" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText(/Alice Ng simulated this write-back, so only they can request approval/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Request approval" })).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "Simulate again" }));
    await waitFor(() => expect(simulate).toHaveBeenCalledWith("g1"));
    expect(submit).not.toHaveBeenCalled();
  });

  it("says another user simulated when this role cannot list people", async () => {
    me.id = "bob";
    role.denied = new Set(["assign"]);
    vi.spyOn(api, "getWritebackRequests").mockResolvedValue({ requests: [simulated] });
    vi.spyOn(api, "getWritebackPreview").mockResolvedValue(preview);
    const people = vi.spyOn(usersApi, "getAssignableUsers");
    renderWithQuery(<GoldenWriteback recordId="g1" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back to SAP" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText(/Another user simulated this write-back/)).toBeInTheDocument();
    expect(people).not.toHaveBeenCalled();
  });

  it("shows target systems and per-field support, then simulates", async () => {
    const requests = vi.spyOn(api, "getWritebackRequests").mockResolvedValue({ requests: [] });
    vi.spyOn(api, "getWritebackPreview").mockResolvedValue(preview);
    const simulate = vi.spyOn(api, "requestWriteback").mockResolvedValue({ ...simulated, status: "simulating", targets: [planned] });
    renderWithQuery(<GoldenWriteback recordId="g1" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back to SAP" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("S4C PRD")).toBeInTheDocument();
    expect(within(drawer).getByText("OData PATCH")).toBeInTheDocument();
    expect(within(drawer).getByText("ECC PRD")).toBeInTheDocument();
    expect(within(drawer).getByText(/BAPI_BUPA_CENTRAL_DATA_SET has no verified parameter mapping/)).toBeInTheDocument();
    expect(within(drawer).getByText("A_BusinessPartner has no writable property for BUT000.BU_GROUP")).toBeInTheDocument();
    const before = requests.mock.calls.length;
    fireEvent.click(within(drawer).getByRole("button", { name: "Simulate" }));
    await waitFor(() => expect(simulate).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(requests.mock.calls.length).toBeGreaterThan(before));
  });

  it("shows the simulated diff and requests approval", async () => {
    vi.spyOn(api, "getWritebackRequests").mockResolvedValue({ requests: [simulated] });
    vi.spyOn(api, "getWritebackPreview").mockResolvedValue(preview);
    const submit = vi.spyOn(api, "submitWriteback").mockResolvedValue({ ...simulated, status: "pending_approval" });
    renderWithQuery(<GoldenWriteback recordId="g1" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back to SAP" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("ACME LTD.")).toBeInTheDocument();
    expect(within(drawer).getByText("Will change")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Request approval" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("g1", "r1"));
  });

  it("reports per-field results after the write and says when nothing is supported", async () => {
    const applied: WritebackRequest = {
      ...simulated, status: "applied_with_errors", approved_by: "bob", applied_at: "2026-10-26T10:00:00Z",
      counts: { written: 1, error: 1 },
      targets: [{ ...planned, fields: [
        { ...planned.fields[0], current_value: "ACME LTD.", result: "written" },
        { ...planned.fields[0], field: "BUT000.BU_SORT1", result: "error", message: "400 property is read-only" },
      ] }],
    };
    vi.spyOn(api, "getWritebackRequests").mockResolvedValue({ requests: [applied] });
    vi.spyOn(api, "getWritebackPreview").mockResolvedValue({ ...preview, writeback_supported: false, live_enabled: false,
      message: "Write-back is not supported for this object on its source systems." });
    renderWithQuery(<GoldenWriteback recordId="g1" status="golden" />);
    const line = await screen.findByTestId("writeback-status");
    expect(within(line).getByText("Written with errors")).toBeInTheDocument();
    expect(within(line).getByText("1 written, 1 failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write back to SAP" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("400 property is read-only")).toBeInTheDocument();
    expect(within(drawer).getByText("Written")).toBeInTheDocument();
    expect(within(drawer).getByText("Live SAP write-back is off on this deployment")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Simulate again" })).toBeDisabled();
  });

  it("keeps the action visible but disabled without apply rights, and hides it before golden", async () => {
    role.denied = new Set(["apply"]);
    vi.spyOn(api, "getWritebackRequests").mockResolvedValue({ requests: [] });
    const { unmount } = renderWithQuery(<GoldenWriteback recordId="g1" status="golden" />);
    expect(await screen.findByRole("button", { name: /^Write back to SAP\. Needs Data steward/ })).toBeDisabled();
    unmount();
    renderWithQuery(<GoldenWriteback recordId="g1" status="candidate" />);
    expect(screen.queryByRole("button", { name: /Write back to SAP/ })).not.toBeInTheDocument();
  });
});

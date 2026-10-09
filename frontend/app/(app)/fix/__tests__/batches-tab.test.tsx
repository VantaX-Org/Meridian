import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { BatchesTab } from "../batches-tab";
import * as remediationApi from "@/lib/api/remediation";
import type { BatchDetail, BatchSummary, MonitorItem } from "@/lib/api/remediation";

// Stable instance across re-renders, same reasoning as rules/__tests__/page.test.tsx:
// useUrlState's sync effect depends on this object's identity.
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/fix",
  useSearchParams: () => searchParams,
}));

let can = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => can }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "creator-1" } }) }));

const batch = (over: Partial<BatchSummary>): BatchSummary => ({
  id: "b1", name: "AP001 batch", status: "draft", filter: {}, created_by: "someone-else",
  created_by_label: "Priya Steward", created_at: "2026-01-01T00:00:00Z", approved_by: null,
  approved_by_label: null, approved_at: null, exported_at: null,
  items: 10, with_proposal: 8, auto_approvable: 3, fixed: 0, still_failing: 0,
  ...over,
});

const detail = (over: Partial<BatchDetail["batch"]> = {}): BatchDetail => ({
  batch: batch(over) as BatchDetail["batch"],
  items: [
    {
      id: "i1", batch_id: "b1", issue_id: "iss1", scope: "sys1", module: "business_partner",
      check_id: "AP001", record_key: "100001", grain: "vendor", field: "LFA1.STCD1",
      current_value: null, proposed_value: "DE123", proposal_source: "rule", confidence: "high",
      accepted: false, recon_status: null, recon_version: null, updated_at: "2026-01-01T00:00:00Z",
      auto_approvable: true,
    },
  ],
});

beforeEach(() => {
  can = true;
  searchParams.forEach((_, key) => searchParams.delete(key));
  vi.spyOn(remediationApi, "listBatches").mockResolvedValue({ items: [batch({})] });
  vi.spyOn(remediationApi, "getMonitor").mockResolvedValue({ items: [] });
  vi.spyOn(remediationApi, "getBatch").mockResolvedValue(detail());
  vi.spyOn(remediationApi, "getBatchEvents").mockResolvedValue({ items: [] });
});

describe("BatchesTab", () => {
  it("lists batches and shows an empty state when there are none", async () => {
    vi.spyOn(remediationApi, "listBatches").mockResolvedValue({ items: [] });
    renderWithQuery(<BatchesTab />);
    expect(await screen.findByText(/No fix batches yet/)).toBeInTheDocument();
  });

  it("opens a batch's detail drawer on row click", async () => {
    renderWithQuery(<BatchesTab />);
    const row = await screen.findByText("AP001 batch");
    await userEvent.click(row);
    await waitFor(() => expect(remediationApi.getBatch).toHaveBeenCalledWith("b1"));
    expect(await screen.findByRole("button", { name: /Accept 1 high-confidence proposal/ })).toBeInTheDocument();
  });

  it("blocks the batch's own creator from approving it (four-eyes)", async () => {
    vi.spyOn(remediationApi, "getBatch").mockResolvedValue(detail({ created_by: "creator-1" }));
    renderWithQuery(<BatchesTab />);
    await userEvent.click(await screen.findByText("AP001 batch"));
    const approveBtn = await screen.findByRole("button", { name: "Approve batch" });
    expect(approveBtn).toBeDisabled();
  });

  it("accepts high-confidence proposals and refreshes the list", async () => {
    const accept = vi.spyOn(remediationApi, "acceptHighConfidence").mockResolvedValue({ id: "b1", accepted: 3, accepted_by: "u1" });
    const getBatch = vi.spyOn(remediationApi, "getBatch").mockResolvedValue(detail());
    renderWithQuery(<BatchesTab />);
    await userEvent.click(await screen.findByText("AP001 batch"));
    await waitFor(() => expect(getBatch).toHaveBeenCalledWith("b1"));
    const callsBeforeAccept = getBatch.mock.calls.length;
    await userEvent.click(await screen.findByRole("button", { name: /Accept 1 high-confidence proposal/ }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("b1"));
    // The accept mutation must invalidate/refetch the batch detail, not just fire the API call.
    await waitFor(() => expect(getBatch.mock.calls.length).toBeGreaterThan(callsBeforeAccept));
  });

  it("shows a regression link in Monitoring that opens the batch drawer", async () => {
    const monitorItem: MonitorItem = {
      scope: "sys1", system_name: "ECC Prod",
      baseline: { id: "v1", run_at: "2026-01-01T00:00:00Z", dqs: 90 },
      latest: { id: "v2", run_at: "2026-01-05T00:00:00Z", dqs: 85 },
      monitor: {
        baseline_id: "v1", baseline_run_at: "2026-01-01T00:00:00Z", new_records: 4,
        regressed_checks: [], regressed_check_count: 0, resolved_records: 0,
        batch_id: "b1", batch_items: 4, batch_auto_approvable: 2,
      },
    };
    vi.spyOn(remediationApi, "getMonitor").mockResolvedValue({ items: [monitorItem] });
    renderWithQuery(<BatchesTab />);
    const link = await screen.findByRole("button", { name: /records regressed.*in a new fix batch/ });
    await userEvent.click(link);
    await waitFor(() => expect(remediationApi.getBatch).toHaveBeenCalledWith("b1"));
  });

  it("disables approve without the matching permission", async () => {
    can = false;
    // created_by is "someone-else" (not the current user "creator-1"), so this is
    // disabled by the missing permission, not by four-eyes.
    renderWithQuery(<BatchesTab />);
    await userEvent.click(await screen.findByText("AP001 batch"));
    expect(await screen.findByRole("button", { name: "Approve batch" })).toBeDisabled();
  });

  it("disables export without the matching permission", async () => {
    can = false;
    vi.spyOn(remediationApi, "getBatch").mockResolvedValue(detail({ status: "approved" }));
    renderWithQuery(<BatchesTab />);
    await userEvent.click(await screen.findByText("AP001 batch"));
    expect(await screen.findByRole("button", { name: "Export batch" })).toBeDisabled();
  });

  it("defaults the batch list sort to created_at:desc, as #411 did", async () => {
    vi.spyOn(remediationApi, "listBatches").mockResolvedValue({
      items: [
        batch({ id: "older", name: "Older batch", created_at: "2026-01-01T00:00:00Z" }),
        batch({ id: "newer", name: "Newer batch", created_at: "2026-02-01T00:00:00Z" }),
      ],
    });
    renderWithQuery(<BatchesTab />);
    const rows = await screen.findAllByRole("row");
    // rows[0] is the header row; the newer batch (created later) sorts first by default.
    expect(rows[1]).toHaveTextContent("Newer batch");
    expect(rows[2]).toHaveTextContent("Older batch");
  });

  it("re-sorts the batch list on a column header click, keeping the sort in the URL", async () => {
    vi.spyOn(remediationApi, "listBatches").mockResolvedValue({
      items: [
        batch({ id: "b-zebra", name: "Zebra batch", created_at: "2026-02-01T00:00:00Z" }),
        batch({ id: "b-alpha", name: "Alpha batch", created_at: "2026-01-01T00:00:00Z" }),
      ],
    });
    renderWithQuery(<BatchesTab />);
    await screen.findByText("Zebra batch");
    await userEvent.click(screen.getByRole("button", { name: "Batch" }));
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("Alpha batch");
    expect(rows[2]).toHaveTextContent("Zebra batch");
  });
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as contractsApi from "@/lib/api/contracts";
import * as usersApi from "@/lib/api/users";
import type { Contract } from "@/types/api";
import ContractsPage from "../page";

const searchParams = new URLSearchParams();
const push = vi.fn();
let allowed = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/rules/contracts",
  useSearchParams: () => searchParams,
}));
let denied = new Set<string>();
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (p: string) => allowed && !denied.has(p) }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

const CONTRACT: Contract = {
  id: "c1",
  tenant_id: "t1",
  name: "Vendor master to S/4HANA",
  producer: "ECC PRD",
  consumer: "S/4HANA Cloud",
  description: null,
  status: "active",
  schema_contract: null,
  quality_contract: null,
  freshness_contract: null,
  volume_contract: null,
  latest_compliant: true,
  last_checked: null,
  created_at: "2026-01-01T00:00:00Z",
  created_by: null,
  activated_at: null,
  approved_by: null,
  expires_at: null,
};

describe("rules contracts page", () => {
  it("renders contracts once loaded", async () => {
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [CONTRACT], total: 1 });
    renderWithQuery(<ContractsPage />);
    await waitFor(() => expect(screen.getByText("Vendor master to S/4HANA")).toBeInTheDocument());
  });

  it("shows a retryable error when contracts fail to load", async () => {
    const spy = vi.spyOn(contractsApi, "getContracts").mockRejectedValue(new Error("network down"));
    renderWithQuery(<ContractsPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue({ contracts: [CONTRACT], total: 1 });
    retry.click();
    await waitFor(() => expect(screen.getByText("Vendor master to S/4HANA")).toBeInTheDocument());
  });

  it("keeps the Awaiting approval count unfiltered when another status is selected", async () => {
    const pending: Contract = { ...CONTRACT, id: "c2", name: "Pending one", status: "pending_approval" };
    const rows = [CONTRACT, pending];
    const spy = vi.spyOn(contractsApi, "getContracts").mockImplementation(async (status) => {
      const contracts = status ? rows.filter((c) => c.status === status) : rows;
      return { contracts, total: contracts.length };
    });
    searchParams.set("status", "breached");
    try {
      renderWithQuery(<ContractsPage />);
      const stat = screen.getByText("Awaiting approval").parentElement as HTMLElement;
      await waitFor(() => expect(within(stat).getByText("1")).toBeInTheDocument());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual([]);
    } finally {
      searchParams.delete("status");
    }
  });

  it("offers Submit for approval on a draft and Activate only on a contract awaiting approval", async () => {
    const draft: Contract = { ...CONTRACT, id: "d1", name: "Draft one", status: "draft", created_by: "me", quality_contract: { min_dqs: 80 } };
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [draft], total: 1 });
    const update = vi.spyOn(contractsApi, "updateContract").mockResolvedValue({ ...draft, status: "pending_approval" });
    const activate = vi.spyOn(contractsApi, "activateContract");
    vi.spyOn(contractsApi, "getContractCompliance").mockResolvedValue({ contract_id: "d1", compliance_history: [] });
    renderWithQuery(<ContractsPage />);
    fireEvent.click(await screen.findByText("Draft one"));
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("d1", { status: "pending_approval" }));
    expect(activate).not.toHaveBeenCalled();
  });

  it("offers Activate on a contract awaiting approval, but not to its author", async () => {
    const theirs: Contract = { ...CONTRACT, id: "p1", name: "Theirs", status: "pending_approval", created_by: "someone" };
    const mine: Contract = { ...CONTRACT, id: "p2", name: "Mine", status: "pending_approval", created_by: "me" };
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [theirs, mine], total: 2 });
    vi.spyOn(contractsApi, "getContractCompliance").mockResolvedValue({ contract_id: "p1", compliance_history: [] });
    const activate = vi.spyOn(contractsApi, "activateContract").mockResolvedValue({ id: "p1", status: "active" });
    renderWithQuery(<ContractsPage />);
    fireEvent.click(await screen.findByText("Mine"));
    expect(await screen.findByText(/someone else with approval rights activates it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for approval" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Theirs"));
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    await waitFor(() => expect(activate).toHaveBeenCalledWith("p1"));
  });

  it("offers a link to rules in the empty state without manage_rules", async () => {
    allowed = false;
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [], total: 0 });
    try {
      renderWithQuery(<ContractsPage />);
      const btn = await screen.findByRole("button", { name: "Open rules" });
      btn.click();
      expect(push).toHaveBeenCalledWith("/rules");
    } finally {
      allowed = true;
    }
  });

  it("blocks Submit for approval until the draft states a term, and says why", async () => {
    const draft: Contract = { ...CONTRACT, id: "d2", name: "Bare draft", status: "draft", created_by: "me", quality_contract: { modules: ["fi_gl"] } as unknown as Record<string, number> };
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [draft], total: 1 });
    vi.spyOn(contractsApi, "getContractCompliance").mockResolvedValue({ contract_id: "d2", compliance_history: [] });
    renderWithQuery(<ContractsPage />);
    fireEvent.click(await screen.findByText("Bare draft"));
    expect(await screen.findByRole("button", { name: "Submit for approval" })).toBeDisabled();
    expect(screen.getByText("Add at least one term before submitting it for approval")).toBeInTheDocument();
  });

  it("adds terms to a draft through the update API, keeping the object scope", async () => {
    const draft: Contract = { ...CONTRACT, id: "d3", name: "New draft", status: "draft", created_by: "me", quality_contract: { modules: ["fi_gl"] } as unknown as Record<string, number> };
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [draft], total: 1 });
    vi.spyOn(contractsApi, "getContractCompliance").mockResolvedValue({ contract_id: "d3", compliance_history: [] });
    const update = vi.spyOn(contractsApi, "updateContract").mockResolvedValue(draft);
    renderWithQuery(<ContractsPage />);
    fireEvent.click(await screen.findByText("New draft"));
    fireEvent.click(await screen.findByRole("button", { name: "Add terms" }));
    fireEvent.change(screen.getByLabelText("Minimum DQS"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Completeness %"), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText("Maximum age of the latest analysis, in hours"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("Minimum records"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Maximum records"), { target: { value: "100" } });
    expect(await screen.findByText("The maximum is below the minimum")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save terms" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Maximum records"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }));
    fireEvent.change(screen.getByLabelText("SAP field"), { target: { value: "lifnr" } });
    fireEvent.change(screen.getByLabelText("Allowed values, comma separated"), { target: { value: "A, B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("d3", {
      quality_contract: { modules: ["fi_gl"], min_dqs: 80, completeness: 95 },
      freshness_contract: { max_age_hours: 24 },
      volume_contract: { min_records: 500 },
      schema_contract: { LIFNR: { mandatory: true, allowed_values: ["A", "B"] } },
    }));
  });

  it("shows terms as label and value pairs and names the author and approver", async () => {
    const active: Contract = { ...CONTRACT, id: "a1", name: "Stated", created_by: "u-1", approved_by: "u-2", activated_at: "2026-01-02T00:00:00Z",
      quality_contract: { completeness: 95 }, freshness_contract: { max_age_hours: 24 }, schema_contract: { LIFNR: { mandatory: true, allowed_values: ["A"] } } };
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [active], total: 1 });
    vi.spyOn(contractsApi, "getContractCompliance").mockResolvedValue({ contract_id: "a1", compliance_history: [] });
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([{ id: "u-1", name: "Ana Silva", email: "a@x", role: "steward" }]);
    renderWithQuery(<ContractsPage />);
    fireEvent.click(await screen.findByText("Stated"));
    expect(await screen.findByText("At least 95%")).toBeInTheDocument();
    expect(screen.getByText("24 hours")).toBeInTheDocument();
    expect(screen.getByText(/Mandatory, allowed/)).toBeInTheDocument();
    expect(await screen.findByText(/by Ana Silva/)).toBeInTheDocument();
    expect(screen.getByText(/by a user/)).toBeInTheDocument();
    expect(screen.queryByText(/u-1|u-2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it("says a user when the viewer can read no user list", async () => {
    denied = new Set(["assign", "manage_users"]);
    const active: Contract = { ...CONTRACT, id: "a2", name: "Anon", created_by: "u-1" };
    vi.spyOn(contractsApi, "getContracts").mockResolvedValue({ contracts: [active], total: 1 });
    vi.spyOn(contractsApi, "getContractCompliance").mockResolvedValue({ contract_id: "a2", compliance_history: [] });
    try {
      renderWithQuery(<ContractsPage />);
      fireEvent.click(await screen.findByText("Anon"));
      expect(await screen.findByText(/by a user/)).toBeInTheDocument();
    } finally {
      denied = new Set();
    }
  });
});

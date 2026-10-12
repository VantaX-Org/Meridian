import { screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as contractsApi from "@/lib/api/contracts";
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
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));

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
});

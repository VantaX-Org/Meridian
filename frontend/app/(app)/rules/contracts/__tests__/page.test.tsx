import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as contractsApi from "@/lib/api/contracts";
import type { Contract } from "@/types/api";
import ContractsPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const CONTRACT: Contract = {
  id: "c1",
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
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue({ contracts: [CONTRACT], total: 1 });
    retry.click();
    await waitFor(() => expect(screen.getByText("Vendor master to S/4HANA")).toBeInTheDocument());
  });
});

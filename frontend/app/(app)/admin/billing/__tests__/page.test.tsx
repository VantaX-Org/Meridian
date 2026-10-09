import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as exceptionsApi from "@/lib/api/exceptions";
import type { ExceptionBilling } from "@/types/api";
import ExceptionBillingPage from "../page";

const BILLING: ExceptionBilling = {
  period: "2026-01",
  tier1_count: 2,
  tier2_count: 1,
  tier3_count: 0,
  tier4_count: 0,
  tier1_amount: 100,
  tier2_amount: 50,
  tier3_amount: 0,
  tier4_amount: 0,
  base_fee: 500,
  total_amount: 650,
  stripe_invoice_id: "inv_123",
};

describe("admin billing page", () => {
  it("renders billing once loaded", async () => {
    vi.spyOn(exceptionsApi, "getExceptionBilling").mockResolvedValue(BILLING);
    renderWithQuery(<ExceptionBillingPage />);
    await waitFor(() => expect(screen.getByText("Invoice inv_123")).toBeInTheDocument());
  });

  it("shows a retryable error when billing fails to load", async () => {
    const spy = vi.spyOn(exceptionsApi, "getExceptionBilling").mockRejectedValue(new Error("network down"));
    renderWithQuery(<ExceptionBillingPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(BILLING);
    retry.click();
    await waitFor(() => expect(screen.getByText("Invoice inv_123")).toBeInTheDocument());
  });
});

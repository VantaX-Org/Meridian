import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as exceptionsApi from "@/lib/api/exceptions";
import ExceptionBillingPage from "../page";

const perms = vi.hoisted(() => ({ settings: true }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => a !== "manage_settings" || perms.settings, loading: false }) }));

const BILLING: exceptionsApi.ExceptionBillingPeriod = {
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
  currency: "ZAR",
};

describe("admin billing page", () => {
  it("renders billing once loaded", async () => {
    vi.spyOn(exceptionsApi, "getExceptionBilling").mockResolvedValue(BILLING);
    renderWithQuery(<ExceptionBillingPage />);
    await waitFor(() => expect(screen.getByText("Invoiced. The invoice is in Meridian HQ")).toBeInTheDocument());
  });

  it("shows every amount in the period's currency", async () => {
    vi.spyOn(exceptionsApi, "getExceptionBilling").mockResolvedValue({ ...BILLING, currency: "USD" });
    renderWithQuery(<ExceptionBillingPage />);
    const usd = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
    await waitFor(() => expect(screen.getByText(usd(650))).toBeInTheDocument());
    expect(screen.getByText(usd(500))).toBeInTheDocument();
    expect(screen.getByText(usd(100))).toBeInTheDocument();
    expect(screen.getByText("Amount (USD)")).toBeInTheDocument();
  });

  it("names the Meridian base fee and the currency of the amounts, apart from the ROI subscription", async () => {
    vi.spyOn(exceptionsApi, "getExceptionBilling").mockResolvedValue(BILLING);
    renderWithQuery(<ExceptionBillingPage />);
    expect(await screen.findByText("Meridian base fee")).toBeInTheDocument();
    expect(screen.getByText("All amounts in ZAR")).toBeInTheDocument();
  });

  it("falls back to the plain number for an unknown currency code", async () => {
    vi.spyOn(exceptionsApi, "getExceptionBilling").mockResolvedValue({ ...BILLING, currency: "nope" });
    renderWithQuery(<ExceptionBillingPage />);
    await waitFor(() => expect(screen.getByText((650).toLocaleString(undefined, { minimumFractionDigits: 2 }))).toBeInTheDocument());
  });

  it("says the page needs manage_settings, and never asks the API, for a user without it", async () => {
    perms.settings = false;
    const spy = vi.spyOn(exceptionsApi, "getExceptionBilling").mockResolvedValue(BILLING);
    try {
      renderWithQuery(<ExceptionBillingPage />);
      expect(await screen.findByText("Exception billing needs the manage-settings permission")).toBeInTheDocument();
      expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
      expect(screen.queryByText(/could not reach the server/i)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      perms.settings = true;
    }
  });

  it("shows a retryable error when billing fails to load", async () => {
    const spy = vi.spyOn(exceptionsApi, "getExceptionBilling").mockRejectedValue(new Error("network down"));
    renderWithQuery(<ExceptionBillingPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(BILLING);
    retry.click();
    await waitFor(() => expect(screen.getByText("Invoiced. The invoice is in Meridian HQ")).toBeInTheDocument());
  });
});

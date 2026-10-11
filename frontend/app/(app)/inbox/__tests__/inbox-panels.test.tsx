import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as writeback from "@/lib/api/writeback";
import { ApprovalsPanel } from "../inbox-panels";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
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

  it("shows an empty state when nothing is pending", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({ approvals: [], live_enabled: true });
    renderWithQuery(<ApprovalsPanel />);
    expect(await screen.findByText(/no .*approval/i)).toBeInTheDocument();
  });
});

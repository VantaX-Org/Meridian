import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as writeback from "@/lib/api/writeback";
import { ApprovalsPanel } from "../inbox-panels";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
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

  it("shows an empty state when nothing is pending", async () => {
    vi.spyOn(writeback, "getPendingApprovals").mockResolvedValue({ approvals: [], live_enabled: true });
    renderWithQuery(<ApprovalsPanel />);
    expect(await screen.findByText(/no .*approval/i)).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as ownersApi from "@/lib/api/owners";
import userEvent from "@testing-library/user-event";
import OwnersPage from "../page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const JANE = {
  owner: "jane.doe", score: 82.5, delta: 3.2, open_by_severity: { critical: 1 }, fixed_since_baseline: 1,
  oldest_item_age_days: 4, digest: "one critical item", schedule: "weekly", last_sent: null,
};

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("OwnersPage", () => {
  it("renders one card per owner with score, delta, severities and digest", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({
      owners: [
        {
          owner: "jane.doe",
          score: 82.5,
          delta: 3.2,
          open_by_severity: { critical: 1, high: 4 },
          fixed_since_baseline: 11,
          oldest_item_age_days: 40,
          digest: "3 new critical findings in material_master",
          schedule: "weekly",
          last_sent: "2026-10-01T06:00:00Z",
        },
      ],
    });
    renderWithQuery(<OwnersPage />);
    expect((await screen.findAllByText("jane.doe")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("82.5").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: /Score/ })).toBeInTheDocument();
    expect(screen.getByText(/Critical: 1/)).toBeInTheDocument();
    expect(screen.getByText(/High: 4/)).toBeInTheDocument();
    expect(screen.queryByText(/critical: 1/)).toBeNull();
    expect(screen.getByText(/3 new critical findings/)).toBeInTheDocument();
    // last_sent is relative, never the raw ISO string; the schedule reads as a word.
    expect(screen.getByText(/Weekly digest, last sent .* ago/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-01T06:00:00Z/)).toBeNull();
    expect(screen.getByText(/oldest open item 40 days/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send digests to everyone" })).toBeInTheDocument();
  });

  it("opens each owner's own inbox, and no inbox link for an owner without a user", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({
      owners: [{ ...JANE, user_id: "u-jane" }, { ...JANE, owner: "ops@example.test", user_id: null }],
    } as never);
    renderWithQuery(<OwnersPage />);
    expect(await screen.findByRole("link", { name: "Open the inbox of jane.doe" })).toHaveAttribute("href", "/inbox?assignee=u-jane");
    expect(screen.queryByRole("link", { name: "Open the inbox of ops@example.test" })).toBeNull();
    expect(screen.getAllByRole("link", { name: /^Open the inbox of/ })).toHaveLength(1);
  });

  it("labels the numbers by what they measure: open issues, the change and fixes over the last 7 days", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({
      owners: [{ ...JANE, user_id: "u-jane", delta: -4 }, { ...JANE, owner: "bob", user_id: "u-bob" }],
    } as never);
    renderWithQuery(<OwnersPage />);
    expect(await screen.findByRole("columnheader", { name: /Open issues/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Change this week/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Fixed in the last 7 days/ })).toBeInTheDocument();
    expect(screen.queryByText(/since the first run/)).toBeNull();
    expect(screen.getByText("1 owner lost ground in the last 7 days")).toBeInTheDocument();
    // No list shows exactly an owner's open issues across runs, so the count is not a link.
    expect(screen.queryByRole("link", { name: /open records of/ })).toBeNull();
  });

  it("shows a loading skeleton while the request is in flight", () => {
    vi.spyOn(insightsApi, "getOwners").mockReturnValue(new Promise(() => {}));
    renderWithQuery(<OwnersPage />);
    expect(screen.queryByTestId("owner-card")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no owners, without a Send digests to everyone button", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [] });
    renderWithQuery(<OwnersPage />);
    await waitFor(() => expect(screen.getByText(/no issues are assigned yet/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Send digests to everyone" })).toBeNull();
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(insightsApi, "getOwners").mockRejectedValue(new Error("network error"));
    renderWithQuery(<OwnersPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the owners request when the retry button is clicked", async () => {
    const getOwners = vi
      .spyOn(insightsApi, "getOwners")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ owners: [] });
    renderWithQuery(<OwnersPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/no issues are assigned yet/i)).toBeInTheDocument());
    expect(getOwners).toHaveBeenCalledTimes(2);
  });

  it("sends one owner's digest now", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [JANE] });
    const send = vi.spyOn(ownersApi, "sendOwnerDigests").mockResolvedValue({ sent: 1, owner: "jane.doe" });
    renderWithQuery(<OwnersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Send digest now" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ owner: "jane.doe" }));
  });

  it("sends to everyone only after the confirm dialog", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [JANE] });
    const send = vi.spyOn(ownersApi, "sendOwnerDigests").mockResolvedValue({ sent: 1, owner: null });
    renderWithQuery(<OwnersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Send digests to everyone" }));
    expect(send).not.toHaveBeenCalled();
    const confirm = (await screen.findAllByRole("button", { name: "Send digests" })).pop() as HTMLElement;
    await userEvent.click(confirm);
    await waitFor(() => expect(send).toHaveBeenCalledWith({}));
  });

  it("links to where digests are scheduled", async () => {
    vi.spyOn(insightsApi, "getOwners").mockResolvedValue({ owners: [JANE] });
    renderWithQuery(<OwnersPage />);
    expect(await screen.findByRole("link", { name: "Schedule digests" })).toHaveAttribute("href", "/admin/alerts");
  });
});

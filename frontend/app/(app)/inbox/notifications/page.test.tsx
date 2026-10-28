import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/notifications";
import NotificationsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox/notifications",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => vi.restoreAllMocks());

describe("NotificationsPage mark all read", () => {
  it("is disabled when nothing is unread", async () => {
    vi.spyOn(api, "getNotifications").mockResolvedValue({ items: [], total: 0 } as never);
    const count = vi.spyOn(api, "getUnreadCount").mockResolvedValue(0);
    renderWithQuery(<NotificationsPage />);
    await waitFor(() => expect(count).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });

  it("is enabled when something is unread", async () => {
    vi.spyOn(api, "getNotifications").mockResolvedValue({ items: [], total: 0 } as never);
    vi.spyOn(api, "getUnreadCount").mockResolvedValue(2);
    renderWithQuery(<NotificationsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark all read" })).toBeEnabled());
  });
});

describe("NotificationsPage per-item read", () => {
  const unreadItem = { id: "n1", tenant_id: "t", user_id: null, type: "finding", title: "New critical finding", body: "Body", link: "/inbox", is_read: false, created_at: new Date().toISOString() };

  it("marks one notification read from its row and refreshes", async () => {
    vi.spyOn(api, "getNotifications").mockResolvedValue({ items: [unreadItem, { ...unreadItem, id: "n2", title: "Seen", is_read: true }], total: 2 } as never);
    vi.spyOn(api, "getUnreadCount").mockResolvedValue(1);
    const mark = vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    renderWithQuery(<NotificationsPage />);
    expect(screen.queryByRole("button", { name: "Mark read: Seen" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Mark read: New critical finding" }));
    await waitFor(() => expect(mark.mock.calls[0]?.[0]).toBe("n1"));
  });

  it("marks everything read", async () => {
    vi.spyOn(api, "getNotifications").mockResolvedValue({ items: [unreadItem], total: 1 } as never);
    vi.spyOn(api, "getUnreadCount").mockResolvedValue(1);
    const all = vi.spyOn(api, "markAllNotificationsRead").mockResolvedValue(undefined);
    renderWithQuery(<NotificationsPage />);
    const btn = await screen.findByRole("button", { name: "Mark all read" });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(all).toHaveBeenCalled());
  });

  it("shows the empty state", async () => {
    vi.spyOn(api, "getNotifications").mockResolvedValue({ items: [], total: 0 } as never);
    vi.spyOn(api, "getUnreadCount").mockResolvedValue(0);
    renderWithQuery(<NotificationsPage />);
    expect(await screen.findByText("You are all caught up")).toBeInTheDocument();
  });

  it("shows the error state with a retry", async () => {
    vi.spyOn(api, "getNotifications").mockRejectedValue(new Error("down"));
    vi.spyOn(api, "getUnreadCount").mockResolvedValue(0);
    renderWithQuery(<NotificationsPage />);
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

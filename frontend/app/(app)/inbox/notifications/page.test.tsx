import { screen, waitFor } from "@testing-library/react";
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

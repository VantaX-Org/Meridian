import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Notification } from "../../types/api";

const api = vi.hoisted(() => ({
  getUnreadCount: vi.fn(),
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock("../../lib/api/notifications", () => api);
vi.mock("../../hooks/use-jobs", () => ({ useJobs: () => ({ jobs: [], active: [] }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(); }} className={className}>{children}</a>
  ),
}));

import { NotificationBell, internalHref } from "./NotificationBell";

const note = (over: Partial<Notification>): Notification => ({
  id: "n1", tenant_id: "t", user_id: null, type: "finding", title: "New critical finding", body: "b",
  link: "/inbox", is_read: false, created_at: new Date().toISOString(), ...over,
});

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><NotificationBell /></QueryClientProvider>);
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.markNotificationRead.mockResolvedValue(undefined);
  api.markAllNotificationsRead.mockResolvedValue(undefined);
});

describe("NotificationBell", () => {
  it("shows the unread count in the badge and the accessible name", async () => {
    api.getUnreadCount.mockResolvedValue(3);
    renderBell();
    expect(await screen.findByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("has no badge when everything is read", async () => {
    api.getUnreadCount.mockResolvedValue(0);
    renderBell();
    await waitFor(() => expect(api.getUnreadCount).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("lists the latest ten when opened, with type pill and link to all", async () => {
    api.getUnreadCount.mockResolvedValue(1);
    api.getNotifications.mockResolvedValue({ items: [note({}), note({ id: "n2", type: "warning", title: "Extraction late", is_read: true })], total: 2 });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("New critical finding")).toBeInTheDocument();
    expect(api.getNotifications).toHaveBeenCalledWith({ limit: 10 });
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open all" })).toHaveAttribute("href", "/inbox/notifications");
  });

  it("marks a notification read when it is opened", async () => {
    api.getUnreadCount.mockResolvedValue(1);
    api.getNotifications.mockResolvedValue({ items: [note({})], total: 1 });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    fireEvent.click(await screen.findByText("New critical finding"));
    await waitFor(() => expect(api.markNotificationRead.mock.calls[0]?.[0]).toBe("n1"));
  });

  it("marks everything read", async () => {
    api.getUnreadCount.mockResolvedValue(2);
    api.getNotifications.mockResolvedValue({ items: [note({})], total: 1 });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalled());
  });

  it("says so when there is nothing", async () => {
    api.getUnreadCount.mockResolvedValue(0);
    api.getNotifications.mockResolvedValue({ items: [], total: 0 });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("You are all caught up")).toBeInTheDocument();
  });
});

describe("internalHref", () => {
  it("follows in-app paths only", () => {
    expect(internalHref("/inbox?kind=exception")).toBe("/inbox?kind=exception");
    expect(internalHref("https://evil.example/x")).toBeNull();
    expect(internalHref("//evil.example/x")).toBeNull();
    expect(internalHref(null)).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { AletheiaProvider } from "@/ui/kit";
import { Inbox } from "./Inbox";

const api = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), all: vi.fn() }));
vi.mock("@/lib/api/v2/inbox", () => ({ getNotifications: api.get, putRead: api.read, putReadAll: api.all }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const item = { id: "n1", title: "Run finished", body: "b", created_at: "2026-11-01T00:00:00Z", is_read: false, link: null };

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/inbox");
});

describe("Inbox", () => {
  it("mark read refetches the list and the unread badge", async () => {
    api.get.mockResolvedValue({ items: [item] });
    api.read.mockResolvedValue({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(<QueryClientProvider client={qc}><AletheiaProvider><Inbox /></AletheiaProvider></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(spy.mock.calls.some(([a]) => JSON.stringify(a?.queryKey).includes("notifications-unread"))).toBe(true));
  });

  it("shows a retry when the load fails", async () => {
    api.get.mockRejectedValue(new Error("x"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AletheiaProvider><Inbox /></AletheiaProvider></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

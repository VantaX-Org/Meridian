import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api/attention";
import { item } from "@/components/attention/__tests__/fixtures";
import { AttentionControl } from "./Rail";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AttentionControl /></QueryClientProvider>);
}
const counts = (c: Partial<api.AttentionCount>): api.AttentionCount => ({ critical: 0, high: 0, medium: 0, low: 0, top: null, ...c });

beforeEach(() => vi.restoreAllMocks());

describe("To do control in the index bar", () => {
  it("opens /attention and is named To do", async () => {
    vi.spyOn(api, "getAttentionCount").mockResolvedValue(counts({}));
    mount();
    expect(screen.getByRole("link", { name: "To do" })).toHaveAttribute("href", "/attention");
  });

  it("shows no badge while the count loads", () => {
    vi.spyOn(api, "getAttentionCount").mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.queryByTestId("attention-badge")).toBeNull();
  });

  it("shows critical plus high, in the critical tone when any is critical", async () => {
    vi.spyOn(api, "getAttentionCount").mockResolvedValue(counts({ critical: 2, high: 3, medium: 9, low: 4, top: item() }));
    mount();
    const badge = await screen.findByTestId("attention-badge");
    expect(badge).toHaveTextContent("5");
    expect(badge.querySelector(".m-badge-critical")).not.toBeNull();
    // The badge counts critical and high only: the control's name and tooltip say so.
    const link = screen.getByRole("link", { name: "To do, 5 critical or high to-do items" });
    expect(link).toHaveAttribute("title", "5 critical or high to-do items");
  });

  it("is neutral with only high items, and absent when nothing is critical or high", async () => {
    const spy = vi.spyOn(api, "getAttentionCount").mockResolvedValue(counts({ high: 4, medium: 2 }));
    const first = mount();
    const badge = await screen.findByTestId("attention-badge");
    expect(badge).toHaveTextContent("4");
    expect(badge.querySelector(".m-badge-neutral")).not.toBeNull();
    first.unmount();
    spy.mockResolvedValue(counts({ medium: 6, low: 1 }));
    mount();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("attention-badge")).toBeNull();
  });

  it("matches the badge helper the count endpoint feeds", () => {
    expect(api.attentionBadge({ critical: 1, high: 2, medium: 30, low: 40 })).toBe(3);
  });
});

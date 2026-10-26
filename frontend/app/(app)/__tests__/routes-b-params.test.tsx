import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import apiClient, { longApiClient, uploadApiClient } from "@/lib/api/client";

const h = vi.hoisted(() => ({ qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(h.qs),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-day-one", () => ({ useDayOne: () => ({ status: "loading", step: null, error: null, refetch: () => {} }), DayOneAction: () => null }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u1", role: "admin" } }) }));

const calls: { url?: string; params?: unknown }[] = [];
beforeAll(() => {
  for (const c of [apiClient, longApiClient, uploadApiClient]) {
    c.defaults.adapter = (cfg) => { calls.push({ url: cfg.url, params: cfg.params }); return new Promise(() => {}); };
  }
});
afterEach(() => { cleanup(); calls.length = 0; });

async function show(load: () => Promise<{ default: ComponentType }>, qs: string) {
  h.qs = qs;
  const { default: Page } = await load();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent ?? "";
// The filter banner names what is shown and ends in "only" (no "Showing" sentence).
const showing = () => screen.queryByText(/ only$/);

const fix = () => import("../fix/page");
const inbox = () => import("../inbox/page");
const mining = () => import("../insights/mining/page");
const process_ = () => import("../insights/process/page");
const designer = () => import("../insights/process/designer/page");
const GARBAGE = ["constructor", "__proto__", "toString", "zzz"];

describe("wave 10 URL params are whitelisted", () => {
  it.each(GARBAGE)("fix ?tab=%s falls back to records to fix", async (g) => {
    await show(fix, `tab=${g}`);
    expect(selected()).toMatch(/Records to fix/);
  });
  it("fix ?tab=batches selects batches", async () => {
    await show(fix, "tab=batches");
    expect(selected()).toMatch(/Approvals and export/);
  });
  it.each(GARBAGE)("fix batches ?status=%s and ?sort=%s apply no filter and show no banner", async (g) => {
    await show(fix, `tab=batches&status=${g}&sort=${g}`);
    expect(showing()).toBeNull();
  });
  it("fix batches ?status=draft shows a filter banner with Show all", async () => {
    await show(fix, "tab=batches&status=draft");
    expect(showing()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show all" })).toBeTruthy();
  });

  it.each(GARBAGE)("inbox ?view, ?type, ?kind = %s apply no filter and show no banner", async (g) => {
    await show(inbox, `view=${g}&type=${g}&kind=${g}`);
    expect(showing()).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });
  // The inbox shows its filters as removable chips (no "Showing" sentence), with one Clear filters button.
  it("inbox ?view=mine shows a Who chip with Clear filters", async () => {
    await show(inbox, "view=mine");
    expect(showing()).toBeNull();
    expect(screen.getByRole("button", { name: "Remove filter Who" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });

  it.each(GARBAGE)("process ?tab=%s falls back to readiness", async (g) => {
    await show(process_, `tab=${g}&module=${g}`);
    // Readiness and Map are a pressed-button toggle under the view's tab strip, not a second strip of tabs.
    expect(await screen.findByRole("button", { name: "Readiness" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(GARBAGE)("mining ?tab=%s falls back to links", async (g) => {
    await show(mining, `tab=${g}`);
    expect(selected()).toMatch(/link/i);
  });
  it("mining honours legacy ?lens= only when ?tab= is missing", async () => {
    await show(mining, "lens=patterns");
    expect(selected()).toMatch(/pattern/i);
    cleanup();
    await show(mining, "tab=links&lens=patterns");
    expect(selected()).toMatch(/link/i);
  });
  it.each(GARBAGE)("mining ?lens=%s falls back to links", async (g) => {
    await show(mining, `lens=${g}`);
    expect(selected()).toMatch(/link/i);
  });

  it.each(["abc", "constructor", "1e3", "-1"])("designer ?v=%s sends no version", async (g) => {
    await show(designer, `model=m1&v=${g}`);
    await waitFor(() => expect(calls.find((c) => c.url?.endsWith("/models/m1"))).toBeDefined());
    expect(calls.find((c) => c.url?.endsWith("/models/m1"))?.params).toBeUndefined();
  });
  it("designer ?v=3 sends version 3", async () => {
    await show(designer, "model=m1&v=3");
    await waitFor(() => expect(calls.find((c) => c.url?.endsWith("/models/m1"))?.params).toEqual({ version: 3 }));
  });
});

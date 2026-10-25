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
vi.mock("@/hooks/use-day-one", () => ({ useDayOne: () => ({ status: "ready", step: null }), DayOneAction: () => null }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u1", role: "admin" } }) }));

const task = (id: string, item_type: string, assigned_to: string | null) => ({
  id, tenant_id: "t", item_type, source_id: `rec-${id}`, domain: "material_master", priority: 1, due_at: null,
  assigned_to, status: "open", sla_hours: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  ai_recommendation: null, ai_confidence: null,
});
const TASKS = [task("A", "match_review", "u1"), task("B", "merge_proposal", null)];
const batch = (id: string, name: string, status: string) => ({
  id, name, status, filter: {}, created_by: null, created_by_label: null, created_at: "2026-10-01T00:00:00Z",
  approved_by: null, approved_by_label: null, approved_at: null, items: 1, with_proposal: 1, auto_approvable: 0, fixed: 0, still_failing: 0,
});
const BATCHES = [batch("1", "Draft batch one", "draft"), batch("2", "Exported batch two", "exported")];

beforeAll(() => {
  for (const c of [apiClient, longApiClient, uploadApiClient]) {
    c.defaults.adapter = async (cfg) => {
      const url = cfg.url ?? "";
      const data = url.includes("/stewardship?") && url.includes("status=open") ? { items: TASKS, total: 2 }
        : url.includes("/stewardship?") ? { items: [], total: 0 }
        : url.endsWith("/remediation/batches") ? { items: BATCHES }
        : { items: [], weekly: [], backlog_by_owner: [], users: [], count: 0 };
      return { data, status: 200, statusText: "OK", headers: {}, config: cfg };
    };
  }
});
afterEach(cleanup);

async function show(load: () => Promise<{ default: ComponentType }>, qs: string) {
  h.qs = qs;
  const { default: Page } = await load();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}
const showing = () => screen.queryByText(/^Showing/);
const GARBAGE = ["constructor", "__proto__", "zzz"];
const inbox = () => import("../inbox/page");
const fix = () => import("../fix/page");

// The inbox shows active filters as removable chips ("Remove filter Type"), never a "Showing ..." sentence.
const chip = (label: string) => screen.queryByRole("button", { name: `Remove filter ${label}` })?.parentElement?.textContent ?? null;

describe("inbox filters against loaded tasks", () => {
  it("type=match_review filters to that type, with a chip", async () => {
    await show(inbox, "type=match_review");
    await waitFor(() => expect(screen.getByText(/record rec-A/)).toBeInTheDocument());
    expect(screen.queryByText(/record rec-B/)).toBeNull();
    expect(showing()).toBeNull();
    expect(chip("Type")).toBe("TypeMatch review");
  });
  it.each(GARBAGE)("type=%s applies no filter and shows no chip", async (g) => {
    await show(inbox, `type=${g}`);
    await waitFor(() => expect(screen.getByText(/record rec-A/)).toBeInTheDocument());
    expect(screen.getByText(/record rec-B/)).toBeInTheDocument();
    expect(chip("Type")).toBeNull();
  });
  it("view=mine filters to my tasks with proper wording", async () => {
    await show(inbox, "view=mine");
    await waitFor(() => expect(screen.getByText(/record rec-A/)).toBeInTheDocument());
    expect(screen.queryByText(/record rec-B/)).toBeNull();
    expect(chip("Who")).toBe("WhoMine");
  });
  it("legacy view=breached reads as the Overdue urgency filter, not a lowercased key", async () => {
    await show(inbox, "view=breached");
    await waitFor(() => expect(chip("When")).toBe("WhenOverdue"));
  });
});

describe("fix batches filters against loaded batches", () => {
  it("status=draft shows only draft batches", async () => {
    await show(fix, "tab=batches&status=draft");
    await waitFor(() => expect(screen.getByText("Draft batch one")).toBeInTheDocument());
    expect(screen.queryByText("Exported batch two")).toBeNull();
    expect(showing()).not.toBeNull();
  });
  it.each(GARBAGE)("status=%s and sort=%s leave every row visible", async (g) => {
    await show(fix, `tab=batches&status=${g}&sort=${g}`);
    await waitFor(() => expect(screen.getByText("Draft batch one")).toBeInTheDocument());
    expect(screen.getByText("Exported batch two")).toBeInTheDocument();
    expect(showing()).toBeNull();
  });
});

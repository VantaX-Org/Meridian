import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as exceptions from "@/lib/api/exceptions";
import * as stewardship from "@/lib/api/stewardship";
import * as triage from "@/lib/api/triage";
import InboxPage from "../page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), qs: "view=mine&type=exception&keep=1" }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => false }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ step: null }),
  DayOneAction: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(nav.qs),
}));

afterEach(() => vi.restoreAllMocks());

describe("InboxPage show all", () => {
  it("clears view and type in one URL replace", async () => {
    nav.replace.mockClear();
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({
      items: [{
        id: "i1", tenant_id: "t", item_type: "exception", source_id: "s", domain: "material_master", priority: 1,
        due_at: null, assigned_to: "someone-else", status: "open", sla_hours: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: null, ai_confidence: null,
      }],
      total: 1,
    });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({} as never);
    renderWithQuery(<InboxPage />);
    const buttons = await screen.findAllByRole("button", { name: "Show all" });
    fireEvent.click(buttons[0]!);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace.mock.calls[0]?.[0]).toBe("/inbox?keep=1");
  });

  it("clears the search from the exceptions empty state", async () => {
    nav.qs = "kind=exception";
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({} as never);
    vi.spyOn(exceptions, "getExceptionMetrics").mockResolvedValue({} as never);
    vi.spyOn(exceptions, "getExceptions").mockResolvedValue({
      exceptions: [{ id: "e1", title: "Dup vendor", category: "c", type: "t", status: "open", assigned_to: null, sla_deadline: null }],
      total: 1,
    } as never);
    renderWithQuery(<InboxPage />);
    fireEvent.change(await screen.findByLabelText("Search exceptions"), { target: { value: "zzzz" } });
    fireEvent.click(await screen.findByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(screen.queryByText("No exceptions in this view")).toBeNull());
    expect(screen.getByLabelText("Search exceptions")).toHaveValue("");
  });
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as exceptions from "@/lib/api/exceptions";
import * as stewardship from "@/lib/api/stewardship";
import * as triage from "@/lib/api/triage";
import InboxPage from "../page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), qs: "view=mine&type=exception&keep=1", can: false }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => nav.can }) }));
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

afterEach(() => { vi.restoreAllMocks(); nav.can = false; nav.qs = "view=mine&type=exception&keep=1"; });

describe("InboxPage counts", () => {
  it("labels the team counts as all queues, not the inbox list, and groups digits", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [{
        id: "i1", tenant_id: "t", item_type: "exception", source_id: "s", domain: "material_master", priority: 1,
        due_at: null, assigned_to: null, status: "open", sla_hours: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: null, ai_confidence: null,
      }] : [],
      total: p?.status === "open" ? 1 : 0,
    }));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 41191, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    expect(await screen.findByText("1 open, 0 overdue")).toBeTruthy();
    expect(await screen.findByText("Who holds the work across all queues")).toBeTruthy();
    expect(screen.getByText("41,191 open across all queues")).toBeTruthy();
  });
});

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

const task = (id: string, domain: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: "t", item_type: "exception", source_id: `rec-${id}`, domain, priority: 1,
  due_at: null, assigned_to: null, status: "open", sla_hours: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: "approve", ai_confidence: 0.9, ...over,
});

describe("InboxPage workbench", () => {
  const mountTasks = () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master"), task("b", "business_partner")] : [],
      total: p?.status === "open" ? 2 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
  };

  it("lists the tasks on the left and the selected one on the right, with its one decision", async () => {
    mountTasks();
    const list = await screen.findByRole("list", { name: "Tasks" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    const detail = screen.getByRole("region", { name: "Selected item" });
    // The first task is open until another is picked.
    expect(detail).toHaveTextContent("rec-a");
    expect(within(detail).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open record" })).toHaveAttribute("href", "/objects/material_master/records/rec-a");
    fireEvent.click(within(list).getByRole("button", { name: /Exception in Business partner/ }));
    expect(screen.getByRole("region", { name: "Selected item" })).toHaveTextContent("rec-b");
  });

  it("offers the bulk actions once a row is ticked", async () => {
    mountTasks();
    expect(screen.queryByTestId("inbox-bulk")).toBeNull();
    fireEvent.click(await screen.findByLabelText("Select Exception rec-a"));
    const bar = await screen.findByTestId("inbox-bulk");
    expect(bar).toHaveTextContent("1 selected");
    expect(within(bar).getByRole("button", { name: "Reject with reason" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Approve 1 at 85%+ confidence" })).toBeInTheDocument();
  });

  it("confirms a bulk approve with its count before calling the API", async () => {
    const bulk = vi.spyOn(stewardship, "bulkApprove").mockResolvedValue({ approved: 2, history_rows_created: 2 });
    mountTasks();
    fireEvent.click(await screen.findByLabelText("Select Exception rec-a"));
    fireEvent.click(screen.getByLabelText("Select Exception rec-b"));
    fireEvent.click(await screen.findByRole("button", { name: "Approve 2 at 85%+ confidence" }));
    expect(bulk).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Approve 2" }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(["a", "b"], 0.85));
  });

  it("r arms the focused task and Enter approves it; another key disarms", async () => {
    const resolve = vi.spyOn(stewardship, "resolveItem").mockResolvedValue({ id: "a", status: "resolved", action: "approve" });
    mountTasks();
    await screen.findByRole("list", { name: "Tasks" });
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("b", "approve"));
  });

  it("ignores the keys on the tabs that own their own tables", async () => {
    nav.qs = "kind=issues";
    nav.can = true;
    const resolve = vi.spyOn(stewardship, "resolveItem").mockResolvedValue({ id: "a", status: "resolved", action: "approve" });
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [task("a", "material_master")], total: 1 } as never);
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({} as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({} as never);
    renderWithQuery(<InboxPage />);
    await screen.findByText("One open issue per failing SAP record, closed when the record passes");
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("focuses the task named by ?focus=", async () => {
    nav.qs = "keep=1&focus=b";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master"), task("b", "business_partner")] : [],
      total: p?.status === "open" ? 2 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    await screen.findByRole("list", { name: "Tasks" });
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected item" })).toHaveTextContent("rec-b"));
  });

  it("names an assignee it cannot resolve as Unknown user, never an id", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master", { assigned_to: "0f3c9d2e-aaaa" })] : [],
      total: p?.status === "open" ? 1 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    const detail = await screen.findByRole("region", { name: "Selected item" });
    expect(within(detail).getByText("Unknown user")).toBeInTheDocument();
    expect(screen.queryByText(/0f3c9d2e/)).toBeNull();
  });

  it("offers Load more when the queue holds more than the newest page", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    const get = vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master")] : [],
      total: p?.status === "open" ? 450 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    expect(await screen.findByText("Newest 1 of 450 loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.objectContaining({ limit: 400 })));
  });

  it("shows the selected exception with its severity and SLA", async () => {
    nav.qs = "kind=exception";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    vi.spyOn(exceptions, "getExceptionMetrics").mockResolvedValue({ open_count: 1, overdue_count: 1 } as never);
    vi.spyOn(exceptions, "getExceptions").mockResolvedValue({
      exceptions: [{ id: "e1", title: "Duplicate vendor", category: "master_data", type: "t", severity: "critical", status: "open", assigned_to: null, sla_deadline: "2000-01-01T00:00:00Z", escalation_tier: 0, description: "Two vendors share a tax number", created_at: "2026-01-01T00:00:00Z", source_system: null, estimated_impact_zar: null }],
      total: 1,
    } as never);
    renderWithQuery(<InboxPage />);
    const detail = await screen.findByRole("region", { name: "Selected item" });
    expect(detail).toHaveTextContent("Duplicate vendor");
    expect(detail).toHaveTextContent("Critical");
    expect(detail).toHaveTextContent("over");
    expect(within(detail).getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });
});

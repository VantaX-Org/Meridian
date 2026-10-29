import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as cleaning from "@/lib/api/cleaning";
import * as contracts from "@/lib/api/contracts";
import * as exceptions from "@/lib/api/exceptions";
import * as glossary from "@/lib/api/glossary";
import * as masterRecords from "@/lib/api/master-records";
import * as matchReview from "@/lib/api/match-review";
import * as rules from "@/lib/api/rules";
import * as stewardship from "@/lib/api/stewardship";
import * as triage from "@/lib/api/triage";
import * as users from "@/lib/api/users";
import InboxPage from "../page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "view=mine&type=exception&keep=1", can: false }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => nav.can }) }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ step: null }),
  DayOneAction: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(nav.qs),
}));

afterEach(() => { vi.restoreAllMocks(); nav.can = false; nav.qs = "view=mine&type=exception&keep=1"; });

describe("InboxPage counts", () => {
  it("counts the inbox list only: no all-queues team totals beside it, no tiles repeating the When chips", async () => {
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
    expect(await screen.findByText(/^1 open, 0 overdue\. Fixes and matches waiting for a steward/)).toBeTruthy();
    expect(screen.queryByText(/across all queues/)).toBeNull();
    expect(screen.queryByText("41,191")).toBeNull();
    // Overdue and due soon live in the When chips; no Stat tile repeats them.
    expect(screen.queryByRole("button", { name: /^Overdue 0/ })).toBeNull();
  });

  it("names a task by its kind alone when its domain is unknown, never \"in Unknown\"", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [{
        id: "i1", tenant_id: "t", item_type: "exception", source_id: "s", domain: "unknown", priority: 1,
        due_at: null, assigned_to: null, status: "open", sla_hours: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: null, ai_confidence: null,
      }] : [],
      total: p?.status === "open" ? 1 : 0,
    }));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    renderWithQuery(<InboxPage />);
    const list = await screen.findByRole("list", { name: "Tasks" });
    expect(within(list).getByRole("button", { name: /^Exception/ })).toBeInTheDocument();
    expect(screen.queryByText(/in Unknown/)).toBeNull();
    // A task row carries no ranked bar: the SLA pill already says how late it is.
    expect(list.querySelector(".m-ranked-track")).toBeNull();
  });

  it("titles an exception task by its check and object, with the meta as separate sentences and the Object named", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [{
        id: "i1", tenant_id: "t", item_type: "exception", source_id: "e1", domain: "unknown", priority: 2,
        due_at: null, assigned_to: null, status: "open", sla_hours: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: null, ai_confidence: null,
      }] : [],
      total: p?.status === "open" ? 1 : 0,
    }));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(exceptions, "getExceptions").mockResolvedValue({
      exceptions: [{ id: "e1", title: "Custom Rule: Blank material group", category: "material_master", type: "custom_business", status: "open", assigned_to: null, sla_deadline: null, affected_records: null }],
      total: 1,
    } as never);
    vi.spyOn(exceptions, "getException").mockRejectedValue(new Error("not needed"));
    renderWithQuery(<InboxPage />);
    const list = await screen.findByRole("list", { name: "Tasks" });
    expect(await within(list).findByText("Custom Rule: Blank material group in Material master")).toBeInTheDocument();
    expect(within(list).getByText(/^Unassigned\. Priority 2\. Raised \S+ ago\.$/)).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Selected item" });
    expect(within(detail).getByText("Material master")).toBeInTheDocument();
    expect(within(detail).queryByText("—")).toBeNull();
  });

  it("names an exception task from the source the queue sends when the exceptions list is out of reach", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [
        {
          id: "i1", tenant_id: "t", item_type: "exception", source_id: "e1", domain: "Financial", priority: 1,
          due_at: null, assigned_to: null, status: "open", sla_hours: null,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: null, ai_confidence: null,
          source_title: null, source_check_id: "MM045", source_module: "material_master",
        },
        {
          id: "i2", tenant_id: "t", item_type: "exception", source_id: "e2", domain: "Financial", priority: 2,
          due_at: null, assigned_to: null, status: "open", sla_hours: null,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ai_recommendation: null, ai_confidence: null,
          source_title: null, source_check_id: null, source_module: null,
        },
      ] : [],
      total: p?.status === "open" ? 2 : 0,
    }));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, ai_acceptance_rate: 0, sla_breached: 0 } as never);
    vi.spyOn(exceptions, "getExceptions").mockRejectedValue(new Error("down"));
    vi.spyOn(exceptions, "getException").mockRejectedValue(new Error("down"));
    vi.spyOn(rules, "getRuleNames").mockResolvedValue({ names: { MM045: "Material description is missing" }, generated: {} });
    renderWithQuery(<InboxPage />);
    const list = await screen.findByRole("list", { name: "Tasks" });
    expect(await within(list).findByText("Material description is missing in Material master")).toBeInTheDocument();
    // A source system ("Financial") is not an object: the task without a source is just "Exception", no "in Financial".
    expect(screen.queryByText(/in Financial/)).toBeNull();
    const detail = screen.getByRole("region", { name: "Selected item" });
    expect(within(detail).getByText("Material master")).toBeInTheDocument();
    expect(screen.queryByText("Not named")).toBeNull();
    // The purpose and the acceptance are separate sentences.
    expect(screen.getByText(/approve or reject it\. Suggestion acceptance: 0%\.$/)).toBeInTheDocument();
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

  it("keeps the search in the URL and clears it from the exceptions empty state", async () => {
    nav.qs = "kind=exception&q=zzzz";
    nav.replace.mockClear();
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({} as never);
    vi.spyOn(exceptions, "getExceptionMetrics").mockResolvedValue({} as never);
    vi.spyOn(exceptions, "getExceptions").mockResolvedValue({
      exceptions: [{ id: "e1", title: "Dup vendor", category: "c", type: "t", status: "open", assigned_to: null, sla_deadline: null }],
      total: 1,
    } as never);
    renderWithQuery(<InboxPage />);
    expect(await screen.findByLabelText("Search exceptions")).toHaveValue("zzzz");
    fireEvent.click(await screen.findByRole("button", { name: "Clear search" }));
    expect(nav.replace).toHaveBeenCalledWith("/inbox?kind=exception", { scroll: false });
  });
});

/** The selected task's one link out; an exception task opens its exception, named by the task's source id. */
const openedSource = (region: HTMLElement) => within(region).getByRole("link", { name: "Open the exception" }).getAttribute("href");

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
    expect(openedSource(detail)).toBe("/inbox?kind=exception&focus=rec-a");
    // Unassigned, so Claim is the primary and Approve sits beside it.
    expect(within(detail).getByRole("button", { name: "Claim" })).toHaveClass("m-btn-primary");
    expect(within(detail).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    // The source id is not an SAP record key: it is neither labelled a record nor opened as one.
    expect(within(detail).queryByText("Record")).toBeNull();
    expect(within(detail).queryByRole("link", { name: "Open record" })).toBeNull();
    expect(list).not.toHaveTextContent("rec-a");
    fireEvent.click(within(list).getByRole("button", { name: /Exception in Business partner/ }));
    expect(openedSource(screen.getByRole("region", { name: "Selected item" }))).toBe("/inbox?kind=exception&focus=rec-b");
  });

  it("offers the bulk actions once a row is ticked", async () => {
    mountTasks();
    expect(screen.queryByTestId("inbox-bulk")).toBeNull();
    fireEvent.click(await screen.findByLabelText(/Select Exception in Material master/));
    const bar = await screen.findByTestId("inbox-bulk");
    expect(bar).toHaveTextContent("1 selected");
    expect(within(bar).getByRole("button", { name: "Reject with reason" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Approve 1 at 85%+ confidence" })).toBeInTheDocument();
  });

  it("confirms a bulk approve with its count before calling the API", async () => {
    const bulk = vi.spyOn(stewardship, "bulkApprove").mockResolvedValue({ approved: 2, history_rows_created: 2 });
    mountTasks();
    fireEvent.click(await screen.findByLabelText(/Select Exception in Material master/));
    fireEvent.click(screen.getByLabelText(/Select Exception in Business partner/));
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

  it("sends the retired Issues tab to Fix work, on the viewer's own records", async () => {
    nav.qs = "kind=issues";
    nav.replace.mockClear();
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({} as never);
    renderWithQuery(<InboxPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/fix?mine=1"));
    // Tasks, Approvals and SAP signals; exceptions are a view of Tasks, and Issues is gone.
    expect(screen.queryByRole("tab", { name: "Issues" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Exceptions" })).toBeNull();
  });

  it("ignores the keys on the tabs that own their own tables", async () => {
    nav.qs = "kind=sap";
    nav.can = true;
    const resolve = vi.spyOn(stewardship, "resolveItem").mockResolvedValue({ id: "a", status: "resolved", action: "approve" });
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [task("a", "material_master")], total: 1 } as never);
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({} as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({} as never);
    renderWithQuery(<InboxPage />);
    await screen.findByText(/Live signals from SAP/);
    expect(screen.getByRole("tab", { name: "SAP signals" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /monitor/i })).toBeNull();
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
    await waitFor(() => expect(openedSource(screen.getByRole("region", { name: "Selected item" }))).toBe("/inbox?kind=exception&focus=rec-b"));
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

  it("?assignee= keeps the tasks held by that owner, matched by name or email", async () => {
    nav.qs = "keep=1&assignee=ann%40acme.test";
    nav.can = true;
    vi.spyOn(users, "getUsers").mockResolvedValue({ users: [{ id: "u-ann", name: "Ann", email: "ann@acme.test" }] } as never);
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master", { assigned_to: "u-ann" }), task("b", "business_partner", { assigned_to: "u-bob" })] : [],
      total: p?.status === "open" ? 2 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    await waitFor(() => expect(screen.getByRole("list", { name: "Tasks" }).querySelectorAll("li")).toHaveLength(1));
    expect(openedSource(screen.getByRole("region", { name: "Selected item" }))).toBe("/inbox?kind=exception&focus=rec-a");
    expect(screen.getByRole("button", { name: "Remove filter Owner" })).toBeInTheDocument();
  });

  it("names the Owner chip by the person, never the user id, and the Priority chip in words", async () => {
    const ann = "6f1c2d3e-0000-4000-8000-0000000000a1";
    nav.qs = `keep=1&assignee=${ann}&prio=2`;
    nav.can = true;
    vi.spyOn(users, "getUsers").mockResolvedValue({ users: [{ id: ann, name: "Ann", email: "ann@acme.test" }] } as never);
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master", { assigned_to: ann, priority: 2 })] : [],
      total: p?.status === "open" ? 1 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    const owner = (await screen.findByRole("button", { name: "Remove filter Owner" })).parentElement as HTMLElement;
    await waitFor(() => expect(owner).toHaveTextContent("Ann"));
    expect(owner).not.toHaveTextContent(ann);
    expect((screen.getByRole("button", { name: "Remove filter Priority" }).parentElement as HTMLElement)).toHaveTextContent("Priority 2");
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
    // The next page by offset: the API takes at most 200 a call.
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.objectContaining({ status: "open", limit: 200, offset: 200 })));
    expect(get).not.toHaveBeenCalledWith(expect.objectContaining({ limit: 400 }));
  });

  it("keeps the loaded tasks on screen and Load more disabled while the next page loads", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    let release: () => void = () => {};
    const later = new Promise<void>((r) => { release = r; });
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => {
      if ((p?.offset ?? 0) > 0) await later;
      const open = p?.status === "open";
      return { items: open ? [task((p?.offset ?? 0) > 0 ? "b" : "a", "material_master")] : [], total: open ? 450 : 0 } as never;
    });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    await waitFor(() => expect(screen.getByRole("list", { name: "Tasks" }).querySelectorAll("li")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more" })).toBeDisabled());
    expect(screen.getByRole("list", { name: "Tasks" }).querySelectorAll("li")).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.getByRole("list", { name: "Tasks" }).querySelectorAll("li")).toHaveLength(2));
  });

  it("counts open tasks from the server total and says overdue covers only the loaded tasks", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master", { due_at: "2020-01-01T00:00:00Z" })] : [],
      total: p?.status === "open" ? 450 : p?.status === "escalated" ? 50 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    expect(await screen.findByText(/^500 open, 1 overdue in the newest 1\. /)).toBeInTheDocument();
  });

  it("takes overdue from the server's count when it sends one", async () => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("a", "material_master", { due_at: "2020-01-01T00:00:00Z" })] : [],
      total: p?.status === "open" ? 450 : p?.status === "escalated" ? 50 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, overdue_count: 37 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    expect(await screen.findByText(/^500 open, 37 overdue\. /)).toBeInTheDocument();
    expect(screen.queryByText(/in the newest/)).toBeNull();
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

  it("states no open or overdue counts above an exceptions list that failed to load", async () => {
    nav.qs = "kind=exception";
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(exceptions, "getExceptionMetrics").mockResolvedValue({ open_count: 0, overdue_count: 0 } as never);
    vi.spyOn(exceptions, "getExceptions").mockRejectedValue(new Error("down"));
    renderWithQuery(<InboxPage />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /retry/i }).length).toBeGreaterThan(0));
    expect(screen.queryByText(/\d+ open, \d+ overdue/)).toBeNull();
  });
});

describe("InboxPage urgency and stacked filters", () => {
  const HOUR = 3_600_000;
  const mount = () => {
    nav.qs = "keep=1";
    nav.can = true;
    const soon = new Date(Date.now() + 5 * HOUR).toISOString();
    const later = new Date(Date.now() + 72 * HOUR).toISOString();
    const past = new Date(Date.now() - 3 * HOUR).toISOString();
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [
        task("late", "material_master", { due_at: past, assigned_to: "me" }),
        task("soon", "business_partner", { due_at: soon, priority: 2 }),
        task("calm", "fi_gl", { due_at: later, assigned_to: "me" }),
      ] : [],
      total: p?.status === "open" ? 3 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    vi.spyOn(users, "getUsers").mockResolvedValue({ users: [] } as never);
    vi.spyOn(users, "getAssignableUsers").mockResolvedValue([{ id: "u2", name: "Sam Steward", email: "sam@example.com", role: "steward" }]);
    renderWithQuery(<InboxPage />);
  };

  it("colours overdue red and due within 24 hours amber, in plain words", async () => {
    mount();
    const list = await screen.findByRole("list", { name: "Tasks" });
    expect(within(list).getByText("3h overdue")).toBeInTheDocument();
    expect(within(list).getByText("Due in 5h")).toBeInTheDocument();
    expect(within(list).getByText("Due in 3d")).toBeInTheDocument();
  });

  it("stacks who and when, and the pill counts follow the other row", async () => {
    mount();
    const who = await screen.findByRole("group", { name: "Who" });
    const when = screen.getByRole("group", { name: "When" });
    expect(await within(who).findByRole("button", { name: "Mine (2)" })).toBeInTheDocument();
    expect(within(when).getByRole("button", { name: "Overdue (1)" })).toBeInTheDocument();
    expect(within(when).getByRole("button", { name: "Due in 24 hours (1)" })).toBeInTheDocument();
    // Picking "Mine" narrows the urgency counts to my tasks: one of mine is overdue, none is due soon.
    fireEvent.click(within(who).getByRole("button", { name: "Mine (2)" }));
    expect(nav.replace).toHaveBeenCalled();
  });

  it("claims or reassigns every ticked task from the bulk bar", async () => {
    mount();
    const bulk = vi.spyOn(triage, "bulkTriage").mockResolvedValue({ action: "reassign", updated: 3, sla: {} });
    const assign = vi.spyOn(stewardship, "assignItem").mockResolvedValue({ id: "x", status: "in_progress" });
    fireEvent.click(await screen.findByLabelText("Select all 3"));
    const bar = await screen.findByTestId("inbox-bulk");
    expect(bar).toHaveTextContent("3 selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(3));
    expect(assign.mock.calls.every((c) => c[1] === "me")).toBe(true);
    expect(await within(bar).findByLabelText("Reassign to")).toBeInTheDocument();
    expect(bulk).not.toHaveBeenCalled();
  });

  it("releases every ticked task from the bulk bar", async () => {
    mount();
    const assign = vi.spyOn(stewardship, "assignItem").mockResolvedValue({ id: "x", status: "open", assigned_to: null });
    fireEvent.click(await screen.findByLabelText("Select all 3"));
    const bar = await screen.findByTestId("inbox-bulk");
    fireEvent.click(within(bar).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(3));
    expect(assign.mock.calls.every((c) => c[1] === null)).toBe(true);
  });

  it("releases the selected task from its detail when it has an owner", async () => {
    mount();
    const assign = vi.spyOn(stewardship, "assignItem").mockResolvedValue({ id: "late", status: "open", assigned_to: null });
    const detail = await screen.findByRole("region", { name: "Selected item" });
    // Owned, so Approve is the primary; Release waits in the menu.
    expect(within(detail).getByRole("button", { name: "Approve" })).toHaveClass("m-btn-primary");
    expect(within(detail).queryByRole("button", { name: "Release" })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Release" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("late", null));
  });
});

describe("InboxPage task sources", () => {
  const mountOne = (over: Record<string, unknown>) => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("t1", "material_master", { ai_recommendation: null, ...over })] : [],
      total: p?.status === "open" ? 1 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    return screen.findByRole("region", { name: "Selected item" });
  };

  it("opens a merge decision on its pair and shows the two records", async () => {
    vi.spyOn(matchReview, "getReviewPair").mockResolvedValue({ id: "ms1", a: "BP=1001", b: "BP=1002", total: 0.91 } as never);
    const detail = await mountOne({ item_type: "merge_decision", source_id: "ms1" });
    expect(await within(detail).findByText("BP=1001")).toBeInTheDocument();
    expect(within(detail).getByText("91%")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Review the pair" })).toHaveAttribute("href", "/mdm/golden/merge?pair=ms1");
  });

  it("opens a write-back approval on the proposal's record, by its SAP key, from the button and from Enter", async () => {
    vi.spyOn(cleaning, "getCleaningItem").mockResolvedValue({ id: "cq1", object_type: "material_master", record_key: "100001", rule_id: null, record_data_before: null, record_data_after: null } as never);
    nav.push.mockClear();
    const detail = await mountOne({ item_type: "writeback_approval", source_id: "cq1" });
    expect(await within(detail).findByRole("link", { name: "Open record" })).toHaveAttribute("href", "/objects/material_master/records/100001");
    expect(within(detail).getByText("100001")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/objects/material_master/records/100001"));
  });

  it("leaves Enter and the letter keys to a dialog's own buttons", async () => {
    vi.spyOn(cleaning, "getCleaningItem").mockResolvedValue({ id: "cq1", object_type: "material_master", record_key: "100001", rule_id: null, record_data_before: null, record_data_after: null } as never);
    const assign = vi.spyOn(stewardship, "assignItem").mockResolvedValue({} as never);
    nav.push.mockClear();
    const detail = await mountOne({ item_type: "writeback_approval", source_id: "cq1" });
    await within(detail).findByRole("link", { name: "Open record" });
    fireEvent.click(within(detail).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject with reason" });
    const keep = within(dialog).getByRole("button", { name: "Keep task open" });
    keep.focus();
    // Enter on the dialog's button is the button's: the window handler neither opens the record nor cancels it.
    expect(fireEvent.keyDown(keep, { key: "Enter" })).toBe(true);
    fireEvent.keyDown(keep, { key: "a" });
    fireEvent.keyDown(keep, { key: "x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(nav.push).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("opens the record from Enter on a queue row, not from Enter on a detail button", async () => {
    vi.spyOn(cleaning, "getCleaningItem").mockResolvedValue({ id: "cq1", object_type: "material_master", record_key: "100001", rule_id: null, record_data_before: null, record_data_after: null } as never);
    nav.push.mockClear();
    const detail = await mountOne({ item_type: "writeback_approval", source_id: "cq1" });
    await within(detail).findByRole("link", { name: "Open record" });
    const approve = within(detail).getByRole("button", { name: "Approve" });
    expect(fireEvent.keyDown(approve, { key: "Enter" })).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(nav.push).not.toHaveBeenCalled();
    const row = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("button")[0];
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/objects/material_master/records/100001"));
  });

  it("confirms a single write-back approve, naming the field, value and record, before calling the API", async () => {
    vi.spyOn(cleaning, "getCleaningItem").mockResolvedValue({
      id: "cq1", object_type: "material_master", record_key: "100001", rule_id: null,
      record_data_before: { MEINS: "XX" }, record_data_after: { MEINS: "EA" },
    } as never);
    const resolve = vi.spyOn(stewardship, "resolveItem").mockResolvedValue({ id: "t1", status: "resolved", action: "approve" });
    const detail = await mountOne({ item_type: "writeback_approval", source_id: "cq1" });
    await within(detail).findByText("100001");
    fireEvent.click(within(detail).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Approve this write-back?");
    expect(dialog).toHaveTextContent("Approves changing MEINS from XX to EA on 100001. It is applied in the export to SAP; nothing is written to SAP from here.");
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep open" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(within(detail).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve write-back" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("t1", "approve"));
  });

  it("refetches the queue and says the server's reason when an approve is refused (the task was closed)", async () => {
    vi.spyOn(cleaning, "getCleaningItem").mockResolvedValue({
      id: "cq1", object_type: "material_master", record_key: "100001", rule_id: null,
      record_data_before: { MEINS: "XX" }, record_data_after: { MEINS: "EA" },
    } as never);
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    vi.spyOn(stewardship, "resolveItem").mockRejectedValue(new AxiosError("409", "ERR_BAD_REQUEST", config, null, {
      status: 409, statusText: "Conflict", headers: {}, config,
      data: { detail: "This fix was already applied, rejected or rolled back. Refresh the inbox." },
    }));
    const detail = await mountOne({ item_type: "writeback_approval", source_id: "cq1" });
    await within(detail).findByText("100001");
    const reads = vi.mocked(stewardship.getQueueItems).mock.calls.length;
    fireEvent.click(within(detail).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve write-back" }));
    expect(await screen.findByText(/Not approved: This fix was already applied/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(stewardship.getQueueItems).mock.calls.length).toBeGreaterThan(reads));
  });

  it("confirms a single merge approve, naming both records", async () => {
    vi.spyOn(matchReview, "getReviewPair").mockResolvedValue({ id: "ms1", a: "BP=1001", b: "BP=1002", total: 0.91 } as never);
    const resolve = vi.spyOn(stewardship, "resolveItem").mockResolvedValue({ id: "t1", status: "resolved", action: "approve" });
    const detail = await mountOne({ item_type: "merge_decision", source_id: "ms1" });
    await within(detail).findByText("BP=1001");
    fireEvent.click(within(detail).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Approve this merge?");
    expect(dialog).toHaveTextContent("Merges BP=1001 and BP=1002 (match score 91%)");
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve merge" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("t1", "approve"));
  });

  it("shows a write-back's rule by its check id and message, linked to the rule, not by its row id", async () => {
    vi.spyOn(cleaning, "getCleaningItem").mockResolvedValue({ id: "cq1", object_type: "material_master", record_key: "100001", rule_id: "6f1c-uuid", record_data_before: null, record_data_after: null } as never);
    vi.spyOn(rules, "getRule").mockResolvedValue({ id: "6f1c-uuid", name: "MM101: Base unit is not allowed" } as never);
    const detail = await mountOne({ item_type: "writeback_approval", source_id: "cq1" });
    const link = await within(detail).findByRole("link", { name: "MM101" });
    expect(link).toHaveAttribute("href", "/rules/6f1c-uuid");
    expect(within(detail).getByText("Base unit is not allowed")).toBeInTheDocument();
    expect(within(detail).queryByText("6f1c-uuid")).toBeNull();
  });

  it("shows the glossary term under review and opens it", async () => {
    vi.spyOn(glossary, "getGlossaryTerm").mockResolvedValue({ id: "g1", business_name: "Base unit of measure", sap_table: "MARA", sap_field: "MEINS", last_reviewed_at: null, review_cycle_days: 90 } as never);
    const detail = await mountOne({ item_type: "glossary_review", source_id: "g1" });
    expect(await within(detail).findByText("Base unit of measure")).toBeInTheDocument();
    expect(within(detail).getByText("MARA.MEINS")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open the glossary term" })).toHaveAttribute("href", "/mdm/glossary/g1");
  });

  it("names the breached contract and opens the breached contracts", async () => {
    vi.spyOn(contracts, "getContracts").mockResolvedValue({ contracts: [{ id: "c1", name: "Vendor feed", producer: "accounts_payable", consumer: "Treasury", last_checked: null }], total: 1 } as never);
    const detail = await mountOne({ item_type: "contract_breach", source_id: "c1" });
    expect(await within(detail).findByText("Vendor feed")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open breached contracts" })).toHaveAttribute("href", "/rules/contracts?status=breached");
  });

  it("shows the golden record's SAP key and opens the golden record", async () => {
    vi.spyOn(masterRecords, "getMasterRecord").mockResolvedValue({ id: "m1", sap_object_key: "BP=1001", overall_confidence: 0.8, status: "candidate" } as never);
    const detail = await mountOne({ item_type: "golden_record_review", source_id: "m1" });
    expect(await within(detail).findByText("BP=1001")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open the golden record" })).toHaveAttribute("href", "/mdm/golden/m1");
  });

  it("offers no Issues export on the Tasks tab", async () => {
    await mountOne({});
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });
});

describe("InboxPage exceptions paging", () => {
  it("says how many exceptions are loaded and loads the next page", async () => {
    nav.qs = "kind=exception";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(exceptions, "getExceptionMetrics").mockResolvedValue({ open_count: 250, overdue_count: 0 } as never);
    const get = vi.spyOn(exceptions, "getExceptions").mockImplementation(async (p) => ({
      exceptions: [{ id: `e${p.page}`, title: `Exception ${p.page}`, category: "c", type: "t", severity: "low", status: "open", assigned_to: null, sla_deadline: null, escalation_tier: 0, description: null, created_at: "2026-01-01T00:00:00Z", source_system: null, estimated_impact_zar: null }],
      total: 250,
    } as never));
    renderWithQuery(<InboxPage />);
    expect(await screen.findByText("1 of 250 exceptions loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith({ per_page: 100, page: 2 }));
    expect(await screen.findByText("2 of 250 exceptions loaded")).toBeInTheDocument();
  });

describe("InboxPage suggested move", () => {
  const mountSuggested = (recommendation: string) => {
    nav.qs = "keep=1";
    nav.can = true;
    vi.spyOn(stewardship, "getQueueItems").mockImplementation(async (p) => ({
      items: p?.status === "open" ? [task("s1", "material_master", { ai_recommendation: recommendation, ai_confidence: 0.95 })] : [],
      total: p?.status === "open" ? 1 : 0,
    } as never));
    vi.spyOn(stewardship, "getMetrics").mockResolvedValue({ items_by_type: {}, items_by_status: {}, avg_resolution_hours: null, sla_breached: 0 } as never);
    vi.spyOn(triage, "getTriageMetrics").mockResolvedValue({ unassigned: 0, backlog_by_owner: [] } as never);
    renderWithQuery(<InboxPage />);
    return screen.findByRole("region", { name: "Selected item" });
  };

  it("surfaces a suggestion to escalate as an Escalate button beside the suggestion, with Claim still the one primary", async () => {
    const escalate = vi.spyOn(stewardship, "escalateItem").mockResolvedValue({ id: "s1", status: "escalated" } as never);
    const detail = await mountSuggested("escalate: critical severity requires immediate steward attention");
    expect(within(detail).getByText(/Meridian suggests: Escalate, 95% sure\. Critical severity requires immediate steward attention\./)).toBeInTheDocument();
    const button = within(detail).getByRole("button", { name: "Escalate" });
    expect(button).toHaveClass("m-btn-secondary");
    expect(within(detail).getByRole("button", { name: "Claim" })).toHaveClass("m-btn-primary");
    fireEvent.click(button);
    await waitFor(() => expect(escalate).toHaveBeenCalled());
    expect(escalate.mock.calls[0][0]).toBe("s1");
  });

  it("keeps Escalate in the menu when the suggestion is something else", async () => {
    const detail = await mountSuggested("approve");
    expect(within(detail).getByText(/Meridian suggests: Approve, 95% sure\./)).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Escalate" })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Escalate" })).toBeInTheDocument();
  });
});

});

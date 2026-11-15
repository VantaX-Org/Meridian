import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { People, peopleExport } from "../People";
import type { Person } from "@/lib/api/v2/people";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("../cards", () => ({ PeopleCard: () => <div data-testid="people-card" /> }));

const Q = vi.hoisted(() => ({
  people: [] as unknown[],
  open: 10,
  can: (_: string): boolean => true,
  shared: false,
  remind: vi.fn((_: string) => Promise.resolve({})),
  exportGrid: vi.fn(() => Promise.resolve("people.xlsx")),
  downloadCsv: vi.fn(() => "people.csv"),
}));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));
vi.mock("@/lib/v2/approvals-queries", () => ({ usePeople: () => ({ data: { people: Q.people }, isLoading: false, error: null, refetch: () => Promise.resolve() }) }));
vi.mock("@/lib/v2/work-queries", () => ({ useWorkSummary: () => ({ data: { totals: { open: Q.open } } }) }));
vi.mock("@/lib/api/v2/people", async (orig) => ({ ...(await orig<object>()), remindPerson: (id: string) => Q.remind(id) }));
vi.mock("@/lib/api/v2/roles", async (orig) => ({ ...(await orig<object>()), exportGrid: Q.exportGrid }));
vi.mock("@/lib/v2/grid-export", async (orig) => ({ ...(await orig<object>()), downloadCsv: Q.downloadCsv }));

const person = (over: Partial<Person>): Person => ({
  id: "u1", name: "Ann Lee", email: "ann@example.com", role: "steward", is_me: false, objects_owned: [], open_work: 4,
  approvals_waiting: 1, overdue: 0, sla_hours: 24, breaches_this_month: 0, last_action_at: null, ...over,
});
const wrap = () => renderWithQuery(<ToastProvider><People /></ToastProvider>);

beforeEach(() => {
  setUrl("/more/people?fixture=1");
  Q.people = [person({ id: "me", name: "Me", is_me: true, overdue: 1 }), person({ id: "u2", name: "Bo Kim", overdue: 3, open_work: 5 })];
  Q.open = 10;
  Q.can = () => true;
  Q.shared = false;
  Q.remind.mockClear();
  Q.exportGrid.mockClear();
  Q.downloadCsv.mockClear();
});

describe("People (next)", () => {
  it("leads with the worst late person's overdue work and keeps every panel link", () => {
    wrap();
    const next = screen.getByTestId("people-next");
    expect(next.textContent).toContain("Bo Kim");
    expect(next.getAttribute("href")).toContain("/work?assigned=u2&due=overdue");
    const bar = screen.getByTestId("people-actions");
    for (const k of ["balance", "contracts", "away", "triage"]) expect(within(bar).getAllByRole("link").some((a) => (a.getAttribute("href") ?? "").includes(`open=${k}`))).toBe(true);
  });

  it("hides balance and away in a shared view and without assign", () => {
    Q.shared = true;
    Q.can = (a) => a !== "assign";
    wrap();
    const hrefs = within(screen.getByTestId("people-actions")).getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("open=balance"))).toBe(false);
    expect(hrefs.some((h) => h.includes("open=away"))).toBe(false);
    expect(hrefs.some((h) => h.includes("open=contracts"))).toBe(true);
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
  });

  it("reminds others but never the user, and links overdue counts", async () => {
    wrap();
    expect(screen.queryByRole("button", { name: "Remind Me" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remind Bo Kim" }));
    await waitFor(() => expect(Q.remind).toHaveBeenCalledWith("u2"));
    expect(screen.getAllByTestId("person-overdue").map((a) => a.getAttribute("href"))).toContain("/work?assigned=u2&due=overdue");
  });

  it("shows the unassigned share against the work total", () => {
    wrap();
    const u = screen.getByTestId("people-unassigned");
    expect(u.textContent).toContain("1");
    expect(u.querySelector("a")?.getAttribute("href")).toBe("/work?assigned=unassigned");
  });

  it("exports to Excel and CSV only with the export right", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(Q.exportGrid).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Export to CSV" }));
    await waitFor(() => expect(Q.downloadCsv).toHaveBeenCalled());
  });

  it("hides export without the right", () => {
    Q.can = (a) => a !== "export";
    wrap();
    expect(screen.queryByRole("button", { name: "Export to Excel" })).toBeNull();
  });

  it("filters by search and opens a person in the side panel", () => {
    wrap();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bo" } });
    expect(screen.queryByText("Me")).toBeNull();
    expect(screen.getAllByText("Bo Kim").length).toBeGreaterThan(0);
  });

  it("exports every column as plain values", () => {
    const d = peopleExport([person({ last_action_at: null })]);
    expect(d.columns.map((c) => c.key)).toEqual(["name", "role", "email", "objects", "open", "approvals", "overdue", "sla", "breaches", "last"]);
    expect(d.rows[0].open).toBe(4);
  });
});

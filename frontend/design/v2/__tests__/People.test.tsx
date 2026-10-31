import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { Inspector } from "../Inspector";
import { PeopleCanvas } from "../screens/People";
import { ToastProvider } from "../Toast";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetActions();
  clearPatches();
  undoLayout = stubLayout(1400, 700);
});
afterEach(() => {
  undoLayout();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function mount(search = "", open?: string) {
  const url = `/people?fixture=1&persona=owner${search}${open ? `&open=${encodeURIComponent(open)}` : ""}`;
  window.history.pushState({}, "", url);
  setUrl(url);
  return renderWithQuery(
    <ToastProvider>
      <PeopleCanvas />
      <Inspector />
    </ToastProvider>,
  );
}
const table = () => screen.findByRole("table", { name: "People" });
const people = (t: HTMLElement) => within(t).getAllByRole("row").slice(1).filter((r) => !r.hasAttribute("data-testid"));
const names = (t: HTMLElement) => people(t).map((r) => text(within(r).getAllByRole("link")[0]));

describe("the People canvas", () => {
  it("is a table of owners and stewards: the sentence, the columns, the figures from /people", async () => {
    mount();
    const t = await table();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("People");
    expect(await screen.findByTestId("people-sentence")).toHaveTextContent(/^4 of 6 people hold open work: 270 records, 34 overdue\. 2 batches wait for your approval\. [\d,]+ of the [\d,]+ open records are assigned to nobody\.$/);
    expect(within(t).getAllByRole("columnheader").map(text)).toEqual(["Person", "Objects", "Open work", "Approvals waiting", "Overdue", "SLA met", "Breaches this month", "Last action"]);
    const naidoo = within(t).getByRole("link", { name: "A. Naidoo" }).closest("tr") as HTMLElement;
    const cells = within(naidoo).getAllByRole("cell").map(text);
    expect(text(within(naidoo).getByRole("rowheader"))).toContain("Data steward");
    expect(cells).toEqual(["2 stewarded", "214", "0", "31 Remind", "86%", "9", expect.stringMatching(/Oct/)]);
    // F30: the overdue count opens that person's overdue rows; Remind sends them a notice.
    expect(within(naidoo).getByTestId("person-overdue").getAttribute("href")).toMatch(/^\/work\?assigned=[^&]+&due=overdue/);
    expect(within(naidoo).getByRole("button", { name: "Remind A. Naidoo" })).toBeEnabled();
  });

  it("puts the caller's own row first and marks it, then orders by open work", async () => {
    mount();
    const t = await table();
    const rows = people(t);
    expect(rows[0]).toHaveAttribute("data-me", "true");
    expect(text(rows[0])).toContain("you");
    expect(names(t)).toEqual(["Demo user", "A. Naidoo", "R. Govender", "T. Mokoena", "P. Khumalo", "S. Dlamini"]);
    expect(screen.getByRole("button", { name: "Open work" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sorts by a column; a second click reverses; the caller's row stays first", async () => {
    mount();
    const t = await table();
    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));
    expect(names(t).slice(0, 2)).toEqual(["Demo user", "A. Naidoo"]);
    fireEvent.click(screen.getByRole("button", { name: "Approvals waiting" }));
    expect(names(t).slice(0, 2)).toEqual(["Demo user", "T. Mokoena"]);
    fireEvent.click(screen.getByRole("button", { name: "SLA met" }));
    expect(names(t).slice(0, 2)).toEqual(["Demo user", "A. Naidoo"]);
    fireEvent.click(screen.getByRole("button", { name: "SLA met" }));
    expect(names(t)[0]).toBe("Demo user");
    expect(names(t)[1]).not.toBe("A. Naidoo");
    expect(within(t).getAllByRole("columnheader").find((h) => h.getAttribute("aria-sort") === "ascending")).toBeDefined();
  });

  it("opens a person in the inspector from their name", async () => {
    mount();
    const t = await table();
    const link = within(t).getByRole("link", { name: "T. Mokoena" });
    expect(link.getAttribute("href")).toContain("open=person%3Au-tm");
  });

  it("shows a list at phone width", async () => {
    const mm = vi.fn().mockImplementation((q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    vi.stubGlobal("matchMedia", mm);
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    mount();
    const list = await screen.findByRole("list", { name: "People" });
    // Six people and, last, the open records nobody holds.
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(7));
    expect(within(list).getAllByRole("listitem")[6]).toHaveAttribute("data-testid", "people-unassigned");
    expect(text(within(list).getAllByRole("listitem")[0])).toContain("you");
    expect(screen.queryByRole("table", { name: "People" })).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("the person inspector", () => {
  const body = async (title: string) => {
    const insp = await screen.findByTestId("inspector");
    await screen.findByRole("heading", { level: 2, name: title });
    await within(insp).findByRole("heading", { name: "Waiting for their approval" });
    return insp;
  };
  const fact = (insp: HTMLElement, label: string) => text(within(insp).getByText(label, { selector: "dt" }).closest(".m2-fact") as Element);

  it("shows the facts, their objects as links, and their open work by object", async () => {
    mount("", "person:u-an");
    const insp = await body("A. Naidoo");
    expect(fact(insp, "Role")).toContain("Data steward");
    expect(fact(insp, "Open work")).toContain("214");
    expect(fact(insp, "Overdue")).toContain("31");
    expect(fact(insp, "SLA met")).toContain("86%");
    expect(fact(insp, "SLA")).toContain("1 day");
    expect(fact(insp, "Breaches this month")).toContain("9");
    const objects = within(insp).getByTestId("person-objects");
    expect(within(objects).getAllByRole("link").map(text)).toEqual(["Material master", "MM purchasing"]);
    expect(within(objects).getAllByRole("link")[0].getAttribute("href")).toContain("/o/ecc-production/material-master");
    const work = await within(insp).findByTestId("person-work");
    expect(text(work)).toContain("Material master");
    expect(text(work)).toMatch(/Material master\s*16/);
    expect(insp).toHaveTextContent("The first 16 of 214 open records are grouped here.");
  });

  it("lists the batches waiting for their approval, and an owner approves one from here", async () => {
    const approve = vi.spyOn(workApi, "postApproveBatch");
    mount("", "person:u-tm");
    const insp = await body("T. Mokoena");
    const list = within(insp).getByTestId("person-approvals");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(list).getByRole("button", { name: "Approve batch B-241" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("B-241"));
    await waitFor(() => expect(within(insp).getByTestId("person-approvals").querySelectorAll("li")).toHaveLength(2));
  });

  it("an owner sends a waiting batch back from here", async () => {
    const sendBack = vi.spyOn(workApi, "postSendBack");
    mount("", "person:u-tm");
    const insp = await body("T. Mokoena");
    fireEvent.click(within(insp).getByRole("button", { name: "Send batch B-238 back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send the batch back" });
    fireEvent.change(within(dialog).getByLabelText("What the author has to change"), { target: { value: "Wrong plant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(sendBack).toHaveBeenCalledWith("B-238", "Wrong plant"));
  });

  it("a role that cannot approve sees the batches but no Approve or Send back", async () => {
    mount("&role=viewer", "person:u-tm");
    const insp = await body("T. Mokoena");
    expect(within(insp).getByTestId("person-approvals")).toBeInTheDocument();
    expect(within(insp).queryByRole("button", { name: /^Approve batch/ })).toBeNull();
    expect(within(insp).getByText(/Reassigning needs the assign permission/)).toBeInTheDocument();
  });

  it("has Reassign…, and no Message (it is not built)", async () => {
    const decide = vi.spyOn(workApi, "postDecide");
    mount("", "person:u-an");
    const insp = await body("A. Naidoo");
    expect(within(insp).queryByText(/message/i)).toBeNull();
    fireEvent.click(within(insp).getByRole("button", { name: "Reassign…" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /R\. Govender/ }));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0][0][0]).toMatchObject({ action: "assign", assignee: "u-rg" });
    expect(await screen.findByText(/Reassigned 16 records of A\. Naidoo to R\. Govender; 198 more remain/)).toBeInTheDocument();
  });

  it("their own row reads the work assigned to 'me'", async () => {
    mount("", "person:u-me");
    const insp = await body("Demo user");
    expect(text(insp.querySelector(".m2-ih-sl") as Element)).toContain("you");
    expect(within(insp).getByRole("link", { name: "Open their work" }).getAttribute("href")).toContain("assigned=me");
    expect(getUrl()).toContain("person");
  });

  it("says when the person is not listed", async () => {
    mount("", "person:nobody");
    expect(await screen.findByText(/This person is not listed/)).toBeInTheDocument();
  });
});

describe("people add up to the work list", () => {
  it("an Unassigned row and the total reconcile what people hold with every open record", async () => {
    mount();
    const row = await screen.findByTestId("people-unassigned");
    const total = await screen.findByTestId("people-total");
    const table = screen.getByTestId("people-table");
    const held = Array.from(table.querySelectorAll("tbody tr:not([data-testid])")).reduce((n, tr) => n + Number((tr.querySelectorAll("td")[1]?.textContent ?? "0").replace(/,/g, "")), 0);
    const un = Number((row.querySelectorAll("td")[1]?.textContent ?? "0").replace(/,/g, ""));
    const all = Number((total.querySelectorAll("td")[1]?.textContent ?? "0").replace(/,/g, ""));
    expect(held + un).toBe(all);
    expect(all).toBeGreaterThan(held);
    expect(screen.getByTestId("people-sentence")).toHaveTextContent(/of the [\d,]+ open records are assigned to nobody\./);
    expect(within(row).getByRole("link", { name: "Unassigned" })).toHaveAttribute("href", expect.stringContaining("/work?assigned=unassigned"));
  });
});

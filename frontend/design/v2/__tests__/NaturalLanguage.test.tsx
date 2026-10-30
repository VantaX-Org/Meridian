import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s10 from "@/lib/api/v2/step10";
import { nlHref, nlQuestion, nlTarget, slotWord } from "@/lib/v2/step10";
import { readState } from "@/lib/v2/work";
import { V2Shell } from "../shell/V2Shell";
import { push, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const ECC = "a1b2c3d4-0001-4000-8000-000000000001";

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  resetWorkFixture();
  push.mockClear();
  setUrl("/?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

async function ask(sentence: string) {
  renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
  fireEvent.keyDown(document.body, { key: "k", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search or type a command" });
  const input = within(dialog).getByRole("combobox");
  fireEvent.change(input, { target: { value: sentence } });
  return { dialog, input };
}

describe("the command line's natural language mode", () => {
  it("shows the hint for a sentence before anything is typed", async () => {
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    fireEvent.keyDown(document.body, { key: "/" });
    const dialog = await screen.findByRole("dialog", { name: "Search or type a command" });
    expect(within(dialog).getByText(/Start with \? to ask in a sentence/)).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox")).toHaveAttribute("aria-describedby", "m2-pal-hint");
  });

  it("a leading ? asks /command/nl and shows the filter that will run as chips, the explanation and the words not understood", async () => {
    const spy = vi.spyOn(s10, "getNl");
    const { dialog, input } = await ask("?critical materials assigned to me due this week in ECC production zebra");
    const chips = await within(dialog).findByTestId("nl-chips", {}, { timeout: 3000 });
    expect(spy).toHaveBeenCalledWith("critical materials assigned to me due this week in ECC production zebra");
    const items = within(chips).getAllByRole("listitem").map((li) => norm(li));
    expect(items).toEqual(["Severityseverity critical(critical)", "ObjectMaterial master(material_master)", "Ownerassigned to you(me)", "Duedue within seven days(week)", `Systemsystem ECC production(${ECC})`]);
    expect(within(dialog).getByTestId("nl-explanation")).toHaveTextContent("Records severity critical, Material master, assigned to you, due within seven days, system ECC production. Open work only. Not understood: zebra.");
    expect(within(dialog).getByTestId("nl-unmatched")).toHaveTextContent("Not understood, left out of the filter: zebra");
    expect(within(dialog).queryByRole("listbox")).toBeNull();
    expect(input).toHaveAttribute("aria-controls", "m2-nl");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(`/work?assigned=me&due=week&module=material_master&severity=critical&system=${ECC}&filter=open&fixture=1`);
    expect(screen.queryByRole("dialog", { name: "Search or type a command" })).toBeNull();
  });

  it("Open in Work opens a policy class filter, and the ledger reads every slot the sentence filled", async () => {
    const { dialog } = await ask("?vendor bank data");
    const open = await within(dialog).findByRole("button", { name: "Open in Work" }, { timeout: 3000 });
    expect(within(dialog).getByText("/work?policy=sox%3Avendor_bank&filter=open")).toBeInTheDocument();
    fireEvent.click(open);
    const href = push.mock.calls.at(-1)?.[0] as string;
    const state = readState(new URLSearchParams(href.split("?")[1]));
    expect(state).toMatchObject({ policy: "sox:vendor_bank", chip: null });
  });

  it("pure parts: the question after ?, the address at the root, the slot words", () => {
    expect(nlQuestion("  ? overdue vendors ")).toBe("overdue vendors");
    expect(nlQuestion("?")).toBeNull();
    expect(nlQuestion("MM014")).toBeNull();
    expect(nlHref("/v2/work?severity=critical")).toBe("/work?severity=critical");
    expect(nlTarget({ href: "/v2/work?status=proposed", filter: { status: "proposed" } })).toBe("/work?status=proposed");
    expect(nlTarget({ href: "/v2/work", filter: {} })).toBe("/work?filter=open");
    expect(slotWord("policy")).toBe("Policy");
    const a = fixtureResponse<s10.NlAnswer>("/command/nl", { q: "show me the overdue mm014 failures" });
    expect(a.filter).toEqual({ due: "overdue", check_id: "MM014" });
    expect(a.unmatched_words).toEqual([]);
  });
});

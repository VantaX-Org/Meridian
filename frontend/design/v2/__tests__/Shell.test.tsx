import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { V2Shell } from "../shell/V2Shell";
import { JobLine } from "../shell/JobLine";
import { duration } from "../shell/StatusStrip";
import { getUrl, push, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({ matches, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
}

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  stubMatchMedia(false);
  push.mockClear();
  setUrl("/");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const mount = (page = <h1>Page</h1>) => renderWithQuery(<V2Shell>{page}</V2Shell>);
const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const keyOnBody = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

describe("top bar", () => {
  it("has the mark and name, the scope and run menus, a command line field with its shortcut, the inbox count and the persona", async () => {
    mount();
    const brand = screen.getByRole("link", { name: "Meridian, go to the landscape" });
    expect(brand.querySelector("svg.m2-mark")).not.toBeNull();
    expect(brand).toHaveTextContent("Meridian");
    expect(screen.getByRole("button", { name: "Scope, All systems" })).toHaveTextContent("All systems");
    expect(await screen.findByRole("button", { name: "Run 16 Oct 2026, 05:17" })).toBeInTheDocument();
    const search = screen.getByRole("button", { name: "Search, ask, or type a command" });
    expect(search).toHaveTextContent("⌘K");
    expect(await screen.findByRole("button", { name: "Inbox 7, unread" })).toHaveTextContent("Inbox 7");
    expect(screen.getByRole("button", { name: "Account, Programme lead" })).toHaveTextContent("Programme lead");
  });

  it("the scope menu lists the systems with their state, and chooses one through the URL", async () => {
    mount();
    await screen.findByRole("button", { name: /^Run 16 Oct/ });
    fireEvent.click(screen.getByRole("button", { name: /^Scope/ }));
    const menu = await screen.findByRole("menu", { name: "Scope" });
    await waitFor(() => expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4));
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => norm(i))).toEqual(["All systems3 systems", "ECC productionAnalysed", "S/4HANA sandboxExtracted, not analysed", "SuccessFactorsNot extracted yet"]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[1]).toHaveAttribute("href", expect.stringContaining("system=ecc-production"));
  });

  it("the run control opens the timeline of the last 8 runs: oldest to newest on a date axis, the latest selected, the baseline marked", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Run 16 Oct/ }));
    const dialog = await screen.findByRole("dialog", { name: /^Runs, 28 Aug 2026 to 16 Oct 2026/ });
    const chart = await within(dialog).findByTestId("run-timeline");
    const runs = within(chart).getAllByRole("button");
    expect(runs).toHaveLength(8);
    expect(runs[7]).toHaveAttribute("aria-pressed", "true");
    expect(runs[0]).toHaveAccessibleName("Run 28 Aug 2026, 05:11");
    expect(within(chart).getByTestId("tl-baseline")).toHaveTextContent("baseline");
    expect(norm(runs[5])).toContain("2 Oct");
  });

  it("menus move with the arrow keys, close with Esc and give focus back to the button", async () => {
    mount();
    const scope = screen.getByRole("button", { name: /^Scope/ });
    scope.focus();
    fireEvent.click(scope);
    const menu = await screen.findByRole("menu", { name: "Scope" });
    await waitFor(() => expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4));
    const items = within(menu).getAllByRole("menuitemradio");
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "End" });
    expect(items[3]).toHaveFocus();
    fireEvent.keyDown(items[3], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(scope).toHaveFocus();
  });

  it("the account menu offers theme, shortcuts and no way back to a second interface", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Account/ }));
    const menu = await screen.findByRole("menu", { name: "Account" });
    expect(within(menu).getAllByRole("menuitemradio").map((i) => norm(i))).toEqual(["System", "Light", "Dark"]);
    expect(within(menu).getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /current interface/ })).toBeNull();
  });
});

describe("map", () => {
  it("lists Landscape, Work, Runs, People and Requests, with the open-work count on Work and a neutral active pill", async () => {
    mount();
    const nav = screen.getByRole("navigation", { name: "Places" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => (l.firstChild as HTMLElement).textContent)).toEqual(["Landscape", "Work", "Runs", "People", "Requests"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).not.toHaveAttribute("aria-current");
    await waitFor(() => expect(links[1]).toHaveTextContent("25,712"));
    expect(links[1]).toHaveAttribute("href", expect.stringMatching(/^\/work/));
  });

  it("draws systems then objects: each object a row with its name, score, 48 ruler and the work waiting", async () => {
    mount();
    const map = screen.getByTestId("map");
    await within(map).findByText("ECC production");
    const rows = await within(map).findAllByRole("link", { name: /^(Material master|Business partner)/ });
    const mm = rows.find((r) => /^Material master/.test(norm(r))) as HTMLElement;
    expect(mm).toHaveAttribute("href", expect.stringMatching(/^\/o\/ecc-production\/material-master/));
    expect(norm(mm)).toContain("25,712");
    expect(norm(mm)).toContain("70.0");
    expect(mm.querySelector('svg[data-size="48"]')).not.toBeNull();
    expect(mm.getAttribute("title")).toContain("capped at 70 by MM003 and MM035");
    expect(map.querySelectorAll(".m2-orow")).toHaveLength(15);
  });

  it("says honestly what each system is: analysed, extracted and not analysed, never extracted", async () => {
    mount();
    const map = screen.getByTestId("map");
    expect(await within(map).findByText(/16 Oct 2026, 04:41, 15 objects/)).toBeInTheDocument();
    expect(within(map).getByText(/Extracted, not analysed\./)).toBeInTheDocument();
    expect(within(map).getByRole("link", { name: "Run analysis" })).toHaveAttribute("href", expect.stringContaining("open=system%3Aa1b2c3d4-0002"));
    expect(within(map).getByText(/Not extracted yet\./)).toBeInTheDocument();
    expect(within(map).getByRole("link", { name: "Extract" })).toHaveAttribute("href", expect.stringContaining("open=system%3Aa1b2c3d4-0003"));
  });

  it("collapses and expands a system, and marks the object you are on", async () => {
    setUrl("/o/ecc-production/material-master");
    mount();
    const map = screen.getByTestId("map");
    const toggle = await within(map).findByRole("button", { name: "ECC production" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const current = await within(map).findByRole("link", { current: "page", name: /Material master/ });
    expect(current).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(map.querySelectorAll(".m2-orow")).toHaveLength(0);
  });
});

describe("command line", () => {
  it("opens with the shortcut, finds a rule by its id, moves with the arrows, opens with Enter and closes with Esc", async () => {
    mount();
    keyOnBody("k", { metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Search, ask, or type a command" });
    const input = within(dialog).getByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    expect(within(dialog).getByText("Landscape")).toBeInTheDocument(); // empty query lists the places
    fireEvent.change(input, { target: { value: "MM0" } });
    await within(dialog).findByText("MM003: Material type is mandatory - determines procurement and storage behaviour");
    const options = within(dialog).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("Rules")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(dialog).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("open=rule:MM003"));
    expect(screen.queryByRole("dialog", { name: "Search, ask, or type a command" })).toBeNull();
  });

  it("finds a record by its number", async () => {
    mount();
    keyOnBody("/");
    const dialog = await screen.findByRole("dialog", { name: "Search, ask, or type a command" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "101" } });
    expect(await within(dialog).findByText(/Material 000000000000000101/)).toBeInTheDocument();
    expect(within(dialog).getByText("Records")).toBeInTheDocument();
  });

  it("answers a word with the action: approve lists the approvals waiting", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Search, ask, or type a command" }));
    const dialog = await screen.findByRole("dialog", { name: "Search, ask, or type a command" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "approve" } });
    expect(await within(dialog).findByText("Approvals waiting 612")).toBeInTheDocument();
  });

  it("says what to try when nothing matches", async () => {
    mount();
    keyOnBody("/");
    const dialog = await screen.findByRole("dialog", { name: "Search, ask, or type a command" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "zzzzqq" } });
    expect(await within(dialog).findByText(/No match for zzzzqq\. Try a material number, a rule id such as MM142/)).toBeInTheDocument();
  });

  it("shows the key hints from the registry and closes on Esc, returning focus to where it was", async () => {
    mount();
    const search = screen.getByRole("button", { name: "Search, ask, or type a command" });
    search.focus();
    fireEvent.click(search);
    const dialog = await screen.findByRole("dialog", { name: "Search, ask, or type a command" });
    expect(norm(dialog.querySelector(".m2-pal-foot") as HTMLElement)).toBe("↑ ↓ Move through the resultsEnter Open the resultEsc Close");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Search, ask, or type a command" })).toBeNull();
    expect(search).toHaveFocus();
  });
});

describe("keyboard", () => {
  it("? opens the sheet drawn from the registry, Esc closes it", async () => {
    mount();
    keyOnBody("?", { shiftKey: true });
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(sheet).getByRole("heading", { name: "Tables and lists" })).toBeInTheDocument();
    expect(within(sheet).getByText("Select or clear the row")).toBeInTheDocument();
    expect(within(sheet).getByText("g then w")).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("g then w goes to Work, g then l to the landscape", () => {
    mount();
    keyOnBody("g");
    keyOnBody("w");
    expect(push).toHaveBeenLastCalledWith(expect.stringMatching(/^\/work/));
    keyOnBody("g");
    keyOnBody("l");
    expect(push).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(\?|$)/));
  });

  it("Esc closes the inspector and takes ?open= out of the URL", async () => {
    setUrl("/?open=rule:MM142");
    mount();
    const dialog = await screen.findByRole("dialog", { name: /MM142/ });
    expect(dialog).toBeInTheDocument();
    keyOnBody("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(getUrl()).not.toContain("open=");
  });
});

describe("phone", () => {
  it("the map is a bottom sheet behind a Map button, one pane at a time", async () => {
    stubMatchMedia(true);
    mount();
    const map = screen.getByTestId("map");
    expect(map).not.toHaveClass("m2-open");
    expect(map).not.toHaveAttribute("role", "dialog");
    const button = screen.getByRole("button", { name: "Map" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(map).toHaveClass("m2-open");
    expect(map).toHaveAttribute("role", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "true");
    keyOnBody("Escape");
    await waitFor(() => expect(map).not.toHaveClass("m2-open"));
  });
});

describe("job line and status strip", () => {
  it("the job line is a 2px line that is empty until a job runs, then fills with a label", () => {
    const idle = renderWithQuery(<JobLine percent={null} />);
    const line = screen.getByTestId("job-line");
    expect(line).not.toHaveClass("m2-on");
    expect(line).toHaveAttribute("role", "status");
    expect((idle.container.querySelector(".m2-job-bar") as HTMLElement).style.width).toBe("0%");
    idle.unmount();
    const busy = renderWithQuery(<JobLine percent={42} label="Extraction, ECC production" />);
    const running = screen.getByTestId("job-line");
    expect(running).toHaveClass("m2-on");
    expect((busy.container.querySelector(".m2-job-bar") as HTMLElement).style.width).toBe("42%");
    expect(running).toHaveTextContent("Extraction, ECC production 42%");
  });

  it("the status strip reads the run, records, rules, time to score, cost model and licence", async () => {
    mount();
    const strip = await screen.findByTestId("status-strip");
    await waitFor(() => expect(norm(strip)).toContain("licence valid to 31 Mar 2027"));
    expect(norm(strip.querySelector(".m2-status-t") as HTMLElement)).toBe("Run 16 Oct 2026, 05:17 400,662 records checked 794 rules measured scored in 11 m 42 s cost model ZAR licence valid to 31 Mar 2027");
    expect(duration(702)).toBe("11 m 42 s");
    expect(duration(45)).toBe("45 s");
  });

  it("puts the page in the canvas under a skip link", () => {
    mount(<h1>Landscape</h1>);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#m2-canvas");
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "Landscape" })).toBeInTheDocument();
    act(() => undefined);
  });
});

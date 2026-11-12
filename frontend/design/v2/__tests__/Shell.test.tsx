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
  it("has the mark and name, a command line field with its shortcut, the inbox count and the persona, and no scope or run menu", async () => {
    mount();
    const brand = screen.getByRole("link", { name: "Meridian, go to the landscape" });
    expect(brand.querySelector("svg.m2-mark")).not.toBeNull();
    expect(brand).toHaveTextContent("Meridian");
    expect(screen.queryByRole("button", { name: /^Scope/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Run \d/ })).toBeNull();
    const search = screen.getByRole("button", { name: "Search, ask, or type a command" });
    expect(search).toHaveTextContent("\u2318K");
    expect(await screen.findByRole("button", { name: "Inbox 7, unread" })).toHaveTextContent("Inbox 7");
    expect(screen.getByRole("button", { name: "Account, Programme lead" })).toHaveTextContent("Programme lead");
  });

  it("shows Objects, system, object as a breadcrumb on an object page, and each part above the last is a link", async () => {
    setUrl("/o/ecc-production/material-master");
    mount();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(norm(crumb)).toBe("ObjectsECC productionMaterial master"));
    expect(within(crumb).getAllByRole("link")).toHaveLength(2);
    expect(within(crumb).getByRole("link", { name: "ECC production" })).toHaveAttribute("href", expect.stringMatching(/^\/s\//));
    expect(within(crumb).getByRole("link", { name: "Objects" })).toHaveAttribute("href", expect.stringMatching(/^\/objects/));
    expect(within(crumb).getByText("Material master")).toHaveAttribute("aria-current", "page");
  });

  it("adds the tab as the last crumb and links the object back to Overview", async () => {
    setUrl("/o/ecc-production/material-master/trend");
    mount();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(norm(crumb)).toBe("ObjectsECC productionMaterial masterTrend"));
    expect(within(crumb).getByRole("link", { name: "Material master" })).toHaveAttribute("href", expect.stringMatching(/^\/o\/ecc-production\/material-master/));
    expect(within(crumb).getByText("Trend")).toHaveAttribute("aria-current", "page");
  });

  it("has no breadcrumb off an object page", () => {
    mount();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("the account menu offers theme, shortcuts and no way back to a second interface", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Account/ }));
    const menu = await screen.findByRole("menu", { name: "Account" });
    expect(within(menu).getAllByRole("menuitemradio").map((i) => norm(i))).toEqual(["Light", "Dark"]);
    expect(within(menu).getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /current interface/ })).toBeNull();
  });
});

describe("rail and flyout", () => {
  it("lists the seven destinations, Home first and current, with Reports and Atlas below", () => {
    mount();
    const rail = screen.getByTestId("rail");
    const links = within(rail).getAllByRole("link").map((l) => norm(l));
    expect(links.slice(0, 7).map((l) => l.replace(/\d[\d,]*$/, ""))).toEqual(["Home", "Objects", "Runs", "Fix", "Rules", "Master data", "Migration"]);
    expect(links).toEqual(expect.arrayContaining(["Reports", "Atlas"]));
    expect(within(rail).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "Objects" })).toHaveAttribute("href", expect.stringMatching(/^\/objects/));
    expect(screen.queryByTestId("flyout")).toBeNull();
  });

  it("opens a flyout on hover with the destination's pages and the open-work count on Work, and Esc closes it", async () => {
    mount();
    fireEvent.mouseEnter(within(screen.getByTestId("rail")).getByRole("link", { name: "Fix" }));
    const fly = await screen.findByTestId("flyout");
    const links = within(within(fly).getByRole("navigation", { name: "Fix" })).getAllByRole("link");
    expect(links.map((l) => (l.firstChild as HTMLElement).textContent)).toEqual(["Action centre", "Work", "Aletheia verified fixes", "Cleansing", "Requests", "Data collection form", "Process analytics", "People"]);
    await waitFor(() => expect(links[1]).toHaveTextContent("25,712"));
    expect(links[1]).toHaveAttribute("href", expect.stringMatching(/^\/work/));
    keyOnBody("Escape");
    expect(screen.queryByTestId("flyout")).toBeNull();
  });

  it("the Objects flyout draws systems then objects: each object a row with its name, score, 48 ruler and the work waiting", async () => {
    mount();
    fireEvent.mouseEnter(within(screen.getByTestId("rail")).getByRole("link", { name: "Objects" }));
    const fly = await screen.findByTestId("flyout");
    await within(fly).findByText("ECC production");
    const rows = await within(fly).findAllByRole("link", { name: /^(Material master|Business partner)/ });
    const mm = rows.find((r) => /^Material master/.test(norm(r))) as HTMLElement;
    expect(mm).toHaveAttribute("href", expect.stringMatching(/^\/o\/ecc-production\/material-master/));
    expect(norm(mm)).toContain("25,712");
    expect(norm(mm)).toContain("70.0");
    expect(mm.querySelector('svg[data-size="48"]')).not.toBeNull();
    expect(mm.getAttribute("title")).toContain("held down from 71.8 because MM003 and MM035 fail");
    expect(fly.querySelectorAll(".m2-orow")).toHaveLength(15);
  });

  it("says honestly what each system is: analysed, extracted and not analysed, never extracted", async () => {
    mount();
    fireEvent.mouseEnter(within(screen.getByTestId("rail")).getByRole("link", { name: "Objects" }));
    const fly = await screen.findByTestId("flyout");
    expect(await within(fly).findByText(/16 Oct 2026, 04:41, 15 objects/)).toBeInTheDocument();
    expect(within(fly).getByText(/Extracted, not analysed\./)).toBeInTheDocument();
    expect(within(fly).getByRole("link", { name: "Run analysis" })).toHaveAttribute("href", expect.stringContaining("open=system%3Aa1b2c3d4-0002"));
    expect(within(fly).getByText(/Not extracted yet\./)).toBeInTheDocument();
    expect(within(fly).getByRole("link", { name: "Extract" })).toHaveAttribute("href", expect.stringContaining("open=system%3Aa1b2c3d4-0003"));
  });

  it("collapses and expands a system, and marks the object you are on", async () => {
    setUrl("/o/ecc-production/material-master");
    mount();
    fireEvent.mouseEnter(within(screen.getByTestId("rail")).getByRole("link", { name: "Objects" }));
    const fly = await screen.findByTestId("flyout");
    const toggle = await within(fly).findByRole("button", { name: "ECC production" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await within(fly).findByRole("link", { current: "page", name: /Material master/ })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(fly.querySelectorAll(".m2-orow")).toHaveLength(0);
  });

  it("opens nothing on a quick pass over the rail, and a slip off the flyout does not close it", async () => {
    mount();
    const rail = screen.getByTestId("rail");
    const fix = within(rail).getByRole("link", { name: "Fix" });
    const wrap = rail.parentElement as HTMLElement;
    fireEvent.mouseEnter(wrap);
    fireEvent.mouseEnter(fix);
    fireEvent.mouseLeave(wrap);
    await new Promise((r) => setTimeout(r, 160));
    expect(screen.queryByTestId("flyout")).toBeNull();

    fireEvent.mouseEnter(wrap);
    fireEvent.mouseEnter(fix);
    await screen.findByTestId("flyout");
    fireEvent.mouseLeave(wrap);
    fireEvent.mouseEnter(wrap);
    await new Promise((r) => setTimeout(r, 240));
    expect(screen.getByTestId("flyout")).toBeInTheDocument();

    fireEvent.mouseLeave(wrap);
    await waitFor(() => expect(screen.queryByTestId("flyout")).toBeNull());
  });

  it("pins the menu open for this browser and unpins it", async () => {
    mount();
    fireEvent.mouseEnter(within(screen.getByTestId("rail")).getByRole("link", { name: "Fix" }));
    fireEvent.click(within(await screen.findByTestId("flyout")).getByRole("button", { name: "Pin the menu open" }));
    expect(window.localStorage.getItem("m2.rail.pin")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Unpin the menu" }));
    expect(window.localStorage.getItem("m2.rail.pin")).toBe("0");
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

describe("canvas", () => {
  const scrolled = () => {
    const canvas = document.getElementById("m2-canvas") as HTMLElement;
    canvas.scrollTop = 500;
    return canvas;
  };

  it("opens a new page at the top, however far down the last page was", () => {
    mount();
    const canvas = scrolled();
    act(() => setUrl("/runs"));
    expect(canvas.scrollTop).toBe(0);
  });

  it("keeps the place when only the query changes", () => {
    mount();
    const canvas = scrolled();
    act(() => setUrl("/?open=rule:1"));
    expect(canvas.scrollTop).toBe(500);
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

  it("g then w goes to Work, g then h to Home, g then o to Objects", () => {
    mount();
    keyOnBody("g");
    keyOnBody("w");
    expect(push).toHaveBeenLastCalledWith(expect.stringMatching(/^\/work/));
    keyOnBody("g");
    keyOnBody("h");
    expect(push).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(\?|$)/));
    keyOnBody("g");
    keyOnBody("o");
    expect(push).toHaveBeenLastCalledWith(expect.stringMatching(/^\/objects/));
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
  it("the destinations are a bottom bar, and one opens its flyout as a sheet that Esc closes", async () => {
    stubMatchMedia(true);
    mount();
    const tabs = screen.getByTestId("bottom-tabs");
    const fix = within(tabs).getByRole("button", { name: "Fix" });
    expect(fix).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("flyout")).toBeNull();
    fireEvent.click(fix);
    expect(fix).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("flyout")).toBeInTheDocument();
    keyOnBody("Escape");
    await waitFor(() => expect(screen.queryByTestId("flyout")).toBeNull());
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

describe("stage 5: evidence ledger entry", () => {
  it("lists Evidence ledger in the menu and resolves its route to a destination", async () => {
    const { destinations, destinationAt } = await import("../shell/menu");
    const all = destinations();
    const links = all.flatMap((d) => d.kids);
    expect(links.some((l) => l.href === "/aletheia/evidence" && l.label === "Evidence ledger")).toBe(true);
    expect(destinationAt("/aletheia/evidence", all)).toBeDefined();
  });
});

describe("menu for every role", () => {
  it("leaves out rule tools a role cannot use and keeps them for a role that manages rules, while the routes still resolve", async () => {
    const { destinations, destinationAt, kidsFor } = await import("../shell/menu");
    const all = destinations();
    const rules = all.find((d) => d.id === "rules")!;
    const viewer = kidsFor(rules, () => false).map((k) => k.href);
    expect(viewer).not.toContain("/rule-dry-run");
    expect(viewer).not.toContain("/rule-promotion");
    expect(viewer).toContain("/rules");
    expect(kidsFor(rules, (p) => p === "manage_rules").map((k) => k.href)).toEqual(rules.kids.filter((k) => k.need !== "manage_settings").map((k) => k.href));
    expect(destinationAt("/rule-dry-run", all)?.id).toBe("rules");
  });
});

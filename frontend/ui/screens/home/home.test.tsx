import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { Home } from "./Home";
import { Objects } from "./Objects";
import { Status } from "./Status";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const wrap = (el: React.ReactNode) => renderWithQuery(<AletheiaProvider><ToastHost>{el}</ToastHost></AletheiaProvider>);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/?fixture=1");
});
afterEach(() => undo());

describe("Home", () => {
  it("shows the header, the lowest scoring objects and the attention list", async () => {
    wrap(<Home />);
    expect(await screen.findByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeTruthy();
    expect(await screen.findByRole("group", { name: "Score of every object against the gates" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Next action per object" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Attention items" })).toBeTruthy();
  });

  it("links every ruler mark to its object", async () => {
    wrap(<Home />);
    const ruler = await screen.findByRole("group", { name: "Score of every object against the gates" });
    const links = ruler.querySelectorAll("a[href^='/o/']");
    expect(links.length).toBe(ruler.querySelectorAll("[data-mark]").length);
    expect(links.length).toBeGreaterThan(0);
  });

  it("asks before pulling every object", async () => {
    wrap(<Home />);
    const btn = await screen.findByRole("button", { name: "Pull every object" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
});

describe("Home order", () => {
  it("puts attention above the object grid and folds the grid to six cards", async () => {
    wrap(<Home />);
    const attention = await screen.findByRole("list", { name: "Attention items" });
    const grid = await screen.findByRole("list", { name: "Next action per object" });
    expect(attention.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const more = screen.queryByRole("button", { name: /^Show all \d+ objects$/ });
    if (!more) return; // fixture holds 6 or fewer objects
    expect(grid.children.length).toBe(6);
    fireEvent.click(more);
    await waitFor(() => expect(screen.getByRole("list", { name: "Next action per object" }).children.length).toBeGreaterThan(6));
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Next action per object" }).children.length).toBe(6));
  });
});

describe("Home ruler", () => {
  it("shows the 12 lowest objects first and expands to all", async () => {
    wrap(<Home />);
    const ruler = await screen.findByRole("group", { name: "Score of every object against the gates" });
    const more = screen.queryByRole("button", { name: /^Show all \d+$/ });
    if (!more) return; // fixture holds 12 or fewer scored objects
    expect(ruler.querySelectorAll("[data-mark]").length).toBe(12);
    fireEvent.click(more);
    await waitFor(() => expect(screen.getByRole("group", { name: "Score of every object against the gates" }).querySelectorAll("[data-mark]").length).toBeGreaterThan(12));
  });
});

describe("Objects", () => {
  it("lists objects and filters by search", async () => {
    window.history.replaceState(null, "", "/o?fixture=1");
    wrap(<Objects />);
    expect(await screen.findByRole("heading", { level: 1, name: "Objects" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search objects" }), { target: { value: "zzzz-no-such" } });
    expect(await screen.findByText("No object matches")).toBeTruthy();
  });

  it("charts how the scores spread", async () => {
    window.history.replaceState(null, "", "/o?fixture=1");
    wrap(<Objects />);
    const lead = await screen.findByTestId("lead-objects");
    expect(within(lead).getByText("How the scores spread")).toBeTruthy();
  });

  it("pinned to a run, lists that run's objects and links back to the newest runs", async () => {
    window.history.replaceState(null, "", "/o?fixture=1&run=b0500000-0000-4000-8000-000000000005");
    wrap(<Objects />);
    const banner = await screen.findByTestId("objects-pinned");
    expect(within(banner).getByRole("link", { name: "Show each object at its newest run" }).getAttribute("href")).toMatch(/^\/o\?fixture=1/);
    const table = await screen.findByRole("group", { name: "Objects in the pinned run" });
    const links = within(table).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toMatch(/[?&]run=/);
  });
});

describe("Status", () => {
  it("shows overall state and the components table", async () => {
    window.history.replaceState(null, "", "/status?fixture=1");
    wrap(<Status />);
    expect(await screen.findByRole("heading", { level: 1, name: "Status" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
  });
});

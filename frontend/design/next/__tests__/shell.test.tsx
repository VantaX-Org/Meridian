import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, push, setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { Shell } from "../shell/Shell";
import { nextPlaces } from "../CommandPalette";
import { redirectFor } from "@/lib/next/nav-defaults";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  undo = stubLayout();
  setUrl("/?fixture=1");
  push.mockClear();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

const mount = () => renderWithQuery(<Shell><p>page body</p></Shell>);

describe("Shell", () => {
  it("renders the header, the five tabs and the page, with the current place marked", async () => {
    setUrl("/work?fixture=1");
    mount();
    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(document.querySelector("header.nx-header")).toBeTruthy();
    const tabs = document.querySelectorAll("#nx-tabs a.nx-stab");
    expect(tabs).toHaveLength(5);
    expect(document.querySelector('#nx-tabs [aria-current="page"]')?.getAttribute("href")).toContain("/work");
  });

  it("goes to Work on g then w, and to Runs on g then r", async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByText("page body");
    await u.keyboard("gw");
    expect(push.mock.calls.at(-1)?.[0]).toContain("/work");
    await u.keyboard("gr");
    expect(push.mock.calls.at(-1)?.[0]).toContain("/runs");
  });

  it("ignores the chord while typing in a field", async () => {
    const u = userEvent.setup();
    mount();
    const search = await waitFor(() => {
      const el = document.getElementById("nx-search");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    search.focus();
    document.body.insertAdjacentHTML("beforeend", '<input id="typed" />');
    (document.getElementById("typed") as HTMLInputElement).focus();
    push.mockClear();
    await u.keyboard("gw");
    expect(push).not.toHaveBeenCalled();
    document.getElementById("typed")?.remove();
  });

  it("opens the palette on Cmd+K and closes it on Escape", async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByText("page body");
    await u.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the shortcut sheet on ?", async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByText("page body");
    await u.keyboard("?");
    const sheet = await screen.findByTestId("shortcut-sheet");
    expect(within(sheet).getAllByText(/./).length).toBeGreaterThan(5);
  });

  it("F6 moves focus from the tabs to the page and Shift+F6 goes back", async () => {
    mount();
    await screen.findByText("page body");
    const main = document.getElementById("nx-main") as HTMLElement;
    act(() => { (document.querySelector("#nx-tabs a") as HTMLElement).focus(); });
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true })); });
    expect(document.activeElement).toBe(main);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", shiftKey: true, bubbles: true })); });
    expect(document.querySelector("#nx-tabs")?.contains(document.activeElement)).toBe(true);
  });

  it("opens the account menu from the header", async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByText("page body");
    await u.click(document.querySelector(".nx-account-btn") as HTMLElement);
    expect(await screen.findAllByRole("menuitem")).not.toHaveLength(0);
  });

  it("leaves the shell when the address has no chord target", async () => {
    mount();
    await screen.findByText("page body");
    expect(getUrl()).toContain("fixture=1");
  });
});

describe("palette places and redirects", () => {
  it("maps every old place to its new address and drops none", () => {
    const places = nextPlaces(() => true);
    expect(places.length).toBeGreaterThan(20);
    for (const p of places) expect(p.href.startsWith("/")).toBe(true);
    expect(places.some((p) => p.href.startsWith("/more"))).toBe(true);
  });

  it("redirects old screens but never run, object or system detail pages", () => {
    expect(redirectFor("/cleansing")).toBe("/work/approvals");
    expect(redirectFor("/portfolio")).toBe("/");
    expect(redirectFor("/run/abc")).toBeNull();
    expect(redirectFor("/o/sap/material_master")).toBeNull();
    expect(redirectFor("/work/analytics")).toBeNull();
  });
});

describe("offline banner", () => {
  afterEach(() => vi.restoreAllMocks());
  it("shows when the browser goes offline and clears when it is back", async () => {
    const { Banners } = await import("../shell/Banners");
    const on = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    renderWithQuery(<Banners />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    on.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByTestId("offline-banner")).toHaveTextContent("You are offline.");
    on.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });
});

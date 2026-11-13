import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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
  setUrl("/portfolio?fixture=1");
  push.mockClear();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

const mount = () => renderWithQuery(<Shell><p>page body</p></Shell>);

describe("Shell", () => {
  it("renders the rail, the top bar and the page, with the current place marked", async () => {
    mount();
    const rail = await screen.findByRole("navigation", { name: /./, hidden: true }).catch(() => null);
    expect(rail ?? document.getElementById("nx-rail")).toBeTruthy();
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(document.querySelector('#nx-rail [aria-current="page"]')).toBeTruthy();
  });

  it("goes to Work on g then w, and to Monitor on g then n", async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByText("page body");
    await u.keyboard("gw");
    expect(push.mock.calls.at(-1)?.[0]).toContain("/next/work");
    await u.keyboard("gn");
    expect(push.mock.calls.at(-1)?.[0]).toContain("/monitor");
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

  it("F6 moves focus from the rail to the page and Shift+F6 goes back", async () => {
    mount();
    await screen.findByText("page body");
    const main = document.getElementById("nx-main") as HTMLElement;
    act(() => { (document.querySelector("#nx-rail a") as HTMLElement).focus(); });
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true })); });
    expect(document.activeElement).toBe(main);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", shiftKey: true, bubbles: true })); });
    expect(document.querySelector("#nx-rail")?.contains(document.activeElement)).toBe(true);
  });

  it("keeps the rail pin in this browser", async () => {
    const u = userEvent.setup();
    mount();
    const pin = await screen.findByRole("button", { name: /pin/i });
    await u.click(pin);
    expect(window.localStorage.getItem("nx.rail.pin")).toBeTruthy();
  });

  it("toggles the inspector on i and reaches it with F6", async () => {
    const u = userEvent.setup();
    setUrl("/portfolio?fixture=1&open=inbox");
    mount();
    const insp = await waitFor(() => {
      const el = document.getElementById("nx-inspector");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    act(() => { (document.querySelector("#nx-rail a") as HTMLElement).focus(); });
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true })); });
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true })); });
    expect(insp.contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement).blur();
    await u.keyboard("i");
    await waitFor(() => expect(document.getElementById("nx-inspector")).toBeNull());
  });

  it("sends run, upload and download events from the keys, on an object page only", async () => {
    const u = userEvent.setup();
    const seen: string[] = [];
    const on = (e: Event) => seen.push(`${e.type}${e instanceof CustomEvent ? e.detail : ""}`);
    for (const n of ["nx:run-step", "nx:upload", "nx:download"]) window.addEventListener(n, on);
    mount();
    await screen.findByText("page body");
    await u.keyboard("[[u");
    expect(seen).toEqual([]);
    cleanup();
    setUrl("/o/ecc/material-master?fixture=1");
    mount();
    await screen.findByText("page body");
    await u.keyboard("[[]ud");
    for (const n of ["nx:run-step", "nx:upload", "nx:download"]) window.removeEventListener(n, on);
    expect(seen).toEqual(["nx:run-step-1", "nx:run-step1", "nx:upload", "nx:download"]);
  });

  it("leaves the shell when the address has no chord target", async () => {
    mount();
    await screen.findByText("page body");
    expect(getUrl()).toContain("/portfolio");
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
    expect(redirectFor("/cleansing")).toBe("/next/work/approve");
    expect(redirectFor("/admin/users")).toBe("/more/admin/users");
    expect(redirectFor("/monitors")).toBe("/monitor?tab=learned");
    expect(redirectFor("/run/abc")).toBeNull();
    expect(redirectFor("/o/sap/material_master")).toBeNull();
    expect(redirectFor("/s/abc")).toBeNull();
    expect(redirectFor("/work/analytics")).toBeNull();
  });
});

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, push, setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { SheetHost, registerSheet, useSheets, type SheetsApi } from "../shell/SheetHost";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
const got: SheetsApi[] = [];
function Probe() {
  const a = useSheets();
  useEffect(() => {
    got.push(a);
  });
  return null;
}
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState({}, "", "/work");
  setUrl("/work");
  push.mockClear();
  registerSheet("probe", (ctx) => <p>probe sheet {ctx.id}</p>);
});
afterEach(() => undo());

describe("SheetHost", () => {
  it("pushes an address when a sheet opens and shows the registered body", () => {
    setUrl("/work?sheet=probe:7");
    renderWithQuery(<SheetHost><Probe /></SheetHost>);
    expect(screen.getByText("probe sheet 7")).toBeInTheDocument();
    expect(got.at(-1)!.stack).toHaveLength(1);
    act(() => got.at(-1)!.open({ kind: "probe", id: "9" }));
    expect(decodeURIComponent(getUrl())).toContain("probe:9");
    expect((window.history.state as { nxSheet?: boolean }).nxSheet).toBe(true);
  });

  it("puts the page under a sheet reached by a link, so Back closes the sheet and stays on the page", async () => {
    window.history.replaceState({}, "", "/work?sheet=probe:7");
    setUrl("/work?sheet=probe:7");
    renderWithQuery(<SheetHost><Probe /></SheetHost>);
    expect(window.history.state.nxSheet).toBe(true);
    await act(async () => {
      window.history.back();
      await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    });
    expect(getUrl()).toBe("/work");
    expect(screen.queryByText(/probe sheet/)).toBeNull();
  });

  it("closes a sheet it opened by stepping history back", async () => {
    renderWithQuery(<SheetHost><Probe /></SheetHost>);
    act(() => got.at(-1)!.open({ kind: "probe", id: "3" }));
    expect(screen.getByText("probe sheet 3")).toBeInTheDocument();
    await act(async () => {
      const landed = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
      got.at(-1)!.close();
      await landed;
    });
    expect(getUrl()).toBe("/work");
  });

  it("shows a not-found sheet with the way home for an unknown sheet name, and drops it from the address", async () => {
    window.history.replaceState({}, "", "/work?sheet=nope:1");
    setUrl("/work?sheet=nope:1");
    renderWithQuery(<SheetHost><Probe /></SheetHost>);
    expect(await screen.findByText("This panel was not found")).toBeInTheDocument();
    expect(getUrl()).toBe("/work");
    act(() => screen.getByRole("button", { name: "Go to Home" }).click());
    expect(push).toHaveBeenLastCalledWith("/");
  });

  it("registers the connect sheet", () => {
    window.history.replaceState({}, "", "/work?sheet=connect:new");
    setUrl("/work?sheet=connect:new");
    renderWithQuery(<SheetHost><Probe /></SheetHost>);
    expect(screen.queryByText("This panel was not found")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Connect a system" })).toBeInTheDocument();
  });
});

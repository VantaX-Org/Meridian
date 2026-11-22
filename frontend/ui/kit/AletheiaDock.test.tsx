import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AletheiaDock } from "./AletheiaDock";
import { AppShell } from "./AppShell";

const dock = (onAsk = vi.fn(), onOpen = vi.fn()) => <AletheiaDock scope="Home" placeholder="Ask" inputLabel="Ask a question" send="Send" onAsk={onAsk} onOpen={onOpen} />;

describe("AletheiaDock", () => {
  it("opens the sheet when focused empty", () => {
    const onOpen = vi.fn();
    render(dock(vi.fn(), onOpen));
    fireEvent.focus(screen.getByRole("textbox", { name: "Ask a question" }));
    expect(onOpen).toHaveBeenCalled();
  });
  it("hands the typed question over and clears", () => {
    const onAsk = vi.fn();
    render(dock(onAsk));
    const box = screen.getByRole("textbox", { name: "Ask a question" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "What is held?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).toHaveBeenCalledWith("What is held?");
    expect(box.value).toBe("");
  });
});

describe("AppShell secondary nav", () => {
  it("lists other destinations under More, offers search, and renders the dock", () => {
    const open = vi.fn();
    render(
      <AppShell brand="Meridian" navLabel="Sections" skipLabel="Skip" skipNavLabel="Skip links" userMenuLabel="Account" user={{ name: "R" }} menu={[]}
        sections={[{ id: "h", label: "Home", href: "/", active: true }, { id: "o", label: "Objects", href: "/o" }]}
        more={{ label: "More", items: [{ id: "ins", label: "Insights", href: "/insights" }] }}
        search={{ label: "Jump to", hint: "Ctrl K", onOpen: open }} dock={dock()}>
        <p>Body</p>
      </AppShell>,
    );
    expect(screen.queryByRole("menuitem", { name: "Insights" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Insights" }).getAttribute("href")).toBe("/insights");
    fireEvent.click(screen.getByRole("button", { name: /Jump to/ }));
    expect(open).toHaveBeenCalled();
    expect(screen.getByRole("search", { name: "Ask a question" })).toBeTruthy();
  });
});

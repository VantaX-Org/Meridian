import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("shows sections with the active one marked, and a user menu", () => {
    const out = vi.fn();
    render(
      <AppShell brand="Meridian" navLabel="Sections" userMenuLabel="Account" user={{ name: "Resh", email: "r@x.co" }}
        sections={[{ id: "h", label: "Home", href: "/", active: true }, { id: "w", label: "Work", href: "/work" }]}
        menu={[{ id: "out", label: "Sign out", onClick: out }]}>
        <p>Body</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Work" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(out).toHaveBeenCalled();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("renders the launcher and the aside slot", () => {
    const open = vi.fn();
    render(
      <AppShell brand="Meridian" navLabel="Sections" userMenuLabel="Account" user={{ name: "Resh", email: "r@x.co" }} sections={[]} menu={[]}
        launcher={{ label: "Ask Aletheia", onOpen: open }} aside={<p>Panel slot</p>}>
        <p>Body</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" }));
    expect(open).toHaveBeenCalled();
    expect(screen.getByText("Panel slot")).toBeTruthy();
  });
});

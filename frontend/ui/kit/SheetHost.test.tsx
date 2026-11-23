import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SheetHost, useSheet } from "./SheetHost";
import { ToastHost } from "./Toast";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const sheets = { term: { label: "Glossary term", render: (a: unknown) => <p>term body {String(a)}</p> } };
const land = (search: string) => {
  window.history.replaceState({}, "", `/x${search}`);
  return render(<ToastHost><SheetHost sheets={sheets} closeLabel="Close">page</SheetHost></ToastHost>);
};

function Opener() {
  const s = useSheet();
  return <button type="button" onClick={() => s.open("rule", "R1")}>go</button>;
}

describe("SheetHost", () => {
  it("opens a registered sheet with its argument and closes it", () => {
    window.history.replaceState({}, "", "/x");
    render(<SheetHost closeLabel="Close" sheets={{ rule: { label: "Rule", render: (a) => <p>rule {String(a)}</p> } }}><Opener /></SheetHost>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("dialog", { name: "Rule" }).textContent).toContain("rule R1");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SheetHost ?open deep link", () => {
  beforeEach(async () => { (await import("@/ui/testing/nav-store")).replace.mockClear(); });

  it("opens a registered kind as a sheet", () => {
    land("?open=term:t1");
    expect(screen.getByText("term body t1")).toBeTruthy();
  });

  it("sends a kind that moved to its routed page, keeping other params", async () => {
    land("?open=user:u1&fixture=1");
    const { replace } = await import("@/ui/testing/nav-store");
    expect(replace).toHaveBeenCalledWith("/admin/users?fixture=1");
  });

  it("sends an id kind to its detail route", async () => {
    land("?open=run:r9");
    const { replace } = await import("@/ui/testing/nav-store");
    expect(replace).toHaveBeenCalledWith("/run/r9");
  });

  it("says so when no page shows the kind", () => {
    land("?open=feature:f1");
    expect(screen.getByRole("status").textContent).toContain("feature, which has no page yet");
  });
  it("asks before closing while a sheet reports unsaved work", () => {
    window.history.replaceState({}, "", "/x");
    const Dirty = () => { const s = useSheet(); return <button type="button" onClick={() => s.guard(true)}>mark</button>; };
    render(<SheetHost closeLabel="Close" sheets={{ rule: { label: "Rule", render: () => <Dirty /> } }}><Opener /></SheetHost>);
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(screen.getByText("mark"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "Rule" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByRole("dialog", { name: "Rule" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.queryByRole("dialog", { name: "Rule" })).toBeNull();
  });
});

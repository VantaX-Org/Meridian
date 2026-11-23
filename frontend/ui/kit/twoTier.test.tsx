import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, initials } from "./AppShell";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette } from "./CommandPalette";
import { ContextSwitcher } from "./ContextSwitcher";
import { EnvBadge, envCode } from "./EnvBadge";

const base = { brand: "M", navLabel: "n", skipLabel: "s", skipNavLabel: "k", userMenuLabel: "Account", sections: [], menu: [] };

describe("initials", () => {
  it("takes first and last word, else two letters", () => {
    expect(initials("Resh Gan")).toBe("RG");
    expect(initials("Ada Byron Lovelace")).toBe("AL");
    expect(initials("resh", "x@y.co")).toBe("RE");
    expect(initials("", "x@y.co")).toBe("XY");
  });
});

describe("EnvBadge", () => {
  it("maps real environments only", () => {
    expect(envCode("PRD")).toBe("PROD");
    expect(envCode("QAS")).toBe("QA");
    expect(envCode("DEV")).toBe("DEV");
    expect(envCode("SBX")).toBeNull();
    expect(envCode(undefined)).toBeNull();
    const { container } = render(<EnvBadge environment={null} title="x" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Breadcrumbs", () => {
  it("links parents, marks the last, folds the middle past four", () => {
    render(<Breadcrumbs label="Path" collapsedLabel="Hidden" items={[{ label: "A", href: "/a" }, { label: "B", href: "/b" }, { label: "C", href: "/c" }, { label: "D", href: "/d" }, { label: "E" }]} />);
    expect(screen.getByText("E").getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();
  });
});

describe("ContextSwitcher", () => {
  it("lists All systems first, then real systems, and reports the pick", () => {
    const pick = vi.fn();
    render(<ContextSwitcher label="Switch" allLabel="All systems" searchLabel="Search" envTitle={(c) => c} current={null} onSelect={pick}
      systems={[{ id: "1", name: "ECC", typeLabel: "ERP", environment: "PRD", lastRun: "1h ago" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    const opts = screen.getAllByRole("option");
    expect(opts[0].textContent).toBe("All systems");
    expect(screen.getByText("PROD")).toBeTruthy();
    fireEvent.click(screen.getByText("ECC"));
    expect(pick).toHaveBeenCalledWith("1");
  });
  it("shows search only past eight systems", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: `S${i}`, typeLabel: "ERP" }));
    render(<ContextSwitcher label="Switch" allLabel="All" searchLabel="Search" envTitle={(c) => c} current={null} onSelect={() => {}} systems={many} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByLabelText("Search")).toBeTruthy();
  });
});

describe("AppShell two tiers", () => {
  it("puts the sections in the section bar and marks a prod edge", () => {
    const { container } = render(<AppShell {...base} user={{ name: "A B", meta: ["Admin"] }} prod context={<span>ctx</span>} crumbs={<span>crumbs</span>}><p>x</p></AppShell>);
    expect(container.querySelector("header.mx-topbar")?.hasAttribute("data-prod")).toBe(true);
    expect(container.querySelector(".mx-subbar")?.textContent).toContain("crumbs");
    expect(screen.getByText("ctx")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("Admin")).toBeTruthy();
  });
});

describe("CommandPalette groups", () => {
  beforeEach(() => localStorage.clear());
  it("shows group headers, remembers a run, and shows footer hints", () => {
    const run = vi.fn();
    const props = { open: true, onClose: () => {}, onAsk: () => {}, label: "P", placeholder: "p", askLabel: (q: string) => `Ask ${q}`, emptyLabel: "none", recentLabel: "Recent", footer: ["Esc"], commands: [{ id: "a", label: "Alpha", group: "Go to", run }] };
    const { unmount } = render(<CommandPalette {...props} />);
    expect(screen.getByText("Go to")).toBeTruthy();
    expect(screen.getByText("Esc")).toBeTruthy();
    fireEvent.click(screen.getByText("Alpha"));
    expect(run).toHaveBeenCalled();
    unmount();
    render(<CommandPalette {...props} />);
    expect(screen.getByText("Recent")).toBeTruthy();
  });
});

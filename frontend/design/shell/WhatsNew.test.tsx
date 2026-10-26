import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { readPrefs, resetPreferencesCache, setPreferences } from "@/lib/preferences";
import { HelpMenu } from "./HelpMenu";
import { RELEASES, WhatsNew, useWhatsNew, type Release } from "./WhatsNew";

const releases: Release[] = [
  { version: "2.0.0", date: "2026-10-13", items: [{ title: "Faster runs", body: "Runs finish sooner", href: "/runs" }, { title: "New exports", body: "Export a deck" }] },
  { version: "1.9.0", date: "2026-09-01", items: [{ title: "Older thing", body: "From before" }] },
];

beforeEach(() => {
  localStorage.clear();
  resetPreferencesCache();
});

describe("whats-new.json", () => {
  it("is newest first, with dated versions and at least one item each", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Date.parse(r.date)).not.toBeNaN();
      expect(r.items.length).toBeGreaterThan(0);
      for (const i of r.items) {
        expect(i.title).not.toBe("");
        expect(i.body).not.toBe("");
        if (i.href) expect(i.href.startsWith("/")).toBe(true);
      }
    }
    const dates = RELEASES.map((r) => Date.parse(r.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });
});

describe("WhatsNew drawer", () => {
  it("lists each version with its items and the version you are on", () => {
    render(<WhatsNew open onOpenChange={() => {}} releases={releases} currentVersion="2.0.0" />);
    expect(screen.getByText("You are on version 2.0.0")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Version 2.0.0" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Version 1.9.0" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Faster runs" })).toHaveAttribute("href", "/runs");
    expect(screen.getByText("Export a deck")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("says so when there are no notes", () => {
    render(<WhatsNew open onOpenChange={() => {}} releases={[]} currentVersion="2.0.0" />);
    expect(screen.getByText("No release notes yet")).toBeInTheDocument();
  });
});

describe("useWhatsNew", () => {
  it("has something new until the newest version is seen", () => {
    const { result } = renderHook(() => useWhatsNew(releases));
    expect(result.current.hasNew).toBe(true);
    act(() => result.current.markSeen());
    expect(result.current.hasNew).toBe(false);
    expect(readPrefs().seen_version).toBe("2.0.0");
  });

  it("is not new when the stored version matches", () => {
    setPreferences({ seen_version: "2.0.0" });
    const { result } = renderHook(() => useWhatsNew(releases));
    expect(result.current.hasNew).toBe(false);
  });

  it("is new again when a later release ships", () => {
    setPreferences({ seen_version: "1.9.0" });
    const { result } = renderHook(() => useWhatsNew(releases));
    expect(result.current.hasNew).toBe(true);
  });
});

const context = { url: "https://meridian.test/objects?run=r1", runId: "r1", version: "2.0.0" };
const handlers = { onTour: () => {}, onShortcuts: () => {}, onWhatsNew: () => {}, onDocs: () => {} };

describe("HelpMenu", () => {
  it("offers every entry, with a dot on what's new when there is something new", async () => {
    render(<HelpMenu hasTour hasNew context={context} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: /^Help/ }));
    expect(await screen.findByRole("menuitem", { name: "Tour this page" })).toBeInTheDocument();
    for (const name of ["Keyboard shortcuts", "Documentation", "Report a problem"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("menuitem", { name: /What's new/ })).toHaveTextContent("(new)");
  });

  it("leaves out the tour when the page has none, and the dot when seen", async () => {
    render(<HelpMenu hasTour={false} hasNew={false} context={context} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("menuitem", { name: "Keyboard shortcuts" });
    expect(screen.queryByRole("menuitem", { name: "Tour this page" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "What's new" })).not.toHaveTextContent("(new)");
    expect(screen.queryByTestId("help-dot")).toBeNull();
  });

  it("report a problem shows the support address and the details, and sends nothing", async () => {
    render(<HelpMenu hasTour={false} hasNew={false} context={context} supportEmail="help@customer.example" {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Report a problem" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("help@customer.example");
    const details = screen.getByLabelText("Details") as HTMLTextAreaElement;
    expect(details.value).toBe("Page: https://meridian.test/objects?run=r1\nRun: r1\nVersion: 2.0.0");
  });

  it("without a support address it says to ask the administrator and never shows a placeholder", async () => {
    render(<HelpMenu hasTour={false} hasNew={false} context={context} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Report a problem" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ask your administrator for the support address");
    expect(dialog).not.toHaveTextContent("@");
  });
});

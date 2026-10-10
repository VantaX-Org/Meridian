// frontend/design/shell/Rail.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pathname = "/systems";
const searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", name: "A", role: "admin", permissions: ["approve", "apply", "assign", "upload", "view", "manage_users"] } }),
}));

vi.mock("@/context/licence-context", () => ({
  useLicence: () => ({ isMenuItemEnabled: () => true, isModuleEnabled: () => true, isFeatureEnabled: () => true, manifest: null, isLoading: false }),
}));

vi.mock("@/lib/api/shell", () => ({
  getShellCounts: vi.fn().mockResolvedValue({ fix: 3, inbox: 0 }),
}));

vi.mock("@/lib/api/connectivity", () => ({
  getSystems: vi.fn().mockResolvedValue([]),
}));

import { Rail } from "./Rail";

function renderRail() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Rail />
    </QueryClientProvider>,
  );
}

describe("Rail", () => {
  beforeEach(() => {
    pathname = "/systems";
    window.sessionStorage.clear();
    // Rail defaults to expanded at narrow widths only when no stored preference exists;
    // force a wide viewport so these tests see the same expanded-by-default start state
    // regardless of the ≥1280px default-expanded rule.
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1440 });
  });

  it("marks exactly one nav link as the current page", async () => {
    renderRail();
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Systems");
  });

  it("shows a badge only for an item with a positive live count", async () => {
    renderRail();
    const fix = await screen.findByRole("link", { name: "Fix" });
    expect(await within(fix).findByText("3")).toBeInTheDocument();
    const runs = screen.getByRole("link", { name: "Runs" });
    expect(within(runs).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("every nav href is unique in the flattened rail", async () => {
    renderRail();
    // Scoped to the nav-items list: the brand mark above it is a separate
    // "go home" shortcut that deliberately shares the Home item's href.
    const navItems = await screen.findByTestId("rail-nav-items");
    const links = await within(navItems).findAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it("collapses to icon-only rows with no section labels, hiding item text", async () => {
    renderRail();
    const toggle = await screen.findByRole("button", { name: "Collapse navigation" });
    toggle.click();
    expect(await screen.findByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
    expect(screen.queryByText("Systems")).not.toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    // the link is still reachable by its accessible name even with the text node hidden
    expect(screen.getByRole("link", { name: "Systems" })).toBeInTheDocument();
  });

  it("persists the collapsed state to sessionStorage and restores it on remount", async () => {
    const { unmount } = renderRail();
    const toggle = await screen.findByRole("button", { name: "Collapse navigation" });
    toggle.click();
    expect(window.sessionStorage.getItem("meridian:rail:open")).toBe("collapsed");
    unmount();

    renderRail();
    expect(await screen.findByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
  });

  it("clicking a parent row's own link navigates, without being hijacked to toggle its children", async () => {
    renderRail();
    const parent = await screen.findByRole("link", { name: "Insights" });
    const chevron = screen.getByRole("button", { name: "Expand Insights" });
    // A navigating anchor — no preventDefault/toggle side-channel on the row itself.
    expect(parent).toHaveAttribute("href");
    expect(parent.tagName).toBe("A");

    // Clicking the row's own link must not toggle the children open: the
    // chevron is the only control wired to toggleParent.
    fireEvent.click(parent);
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Readiness" })).not.toBeInTheDocument();

    // Clicking the chevron does toggle the children, and does not navigate
    // (preventDefault + stopPropagation on the chevron's own handler).
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("link", { name: "Readiness" })).toBeInTheDocument();
  });

  it("exposes a separate chevron button to expand/collapse a parent's children", async () => {
    renderRail();
    const toggleButton = await screen.findByRole("button", { name: /Expand Insights|Collapse Insights/ });
    expect(toggleButton).toHaveAttribute("aria-expanded");
    expect(toggleButton).toHaveAttribute("aria-controls");
  });

  it("collapsed flyout: ArrowRight opens and focuses the first child link, Escape closes and refocuses the trigger", async () => {
    renderRail();
    const collapse = await screen.findByRole("button", { name: "Collapse navigation" });
    collapse.click();
    const trigger = await screen.findByRole("link", { name: "Insights" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowRight" });

    const firstChild = await screen.findByRole("link", { name: "Readiness" });
    expect(firstChild).toHaveFocus();

    fireEvent.keyDown(firstChild, { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Readiness" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
